import { chmod, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

import { chromium, type BrowserContext, type Locator, type Page } from "playwright";

import { clockActionMap, type ClockAction } from "./attendance.js";
import {
  createApprovalFingerprint,
  parseApprovalListSnapshot,
  type BrowserApprovalAction,
  type BrowserApprovalDetail,
  type BrowserApprovalListStatus,
  type BrowserApprovalSummary,
} from "./browser-approvals.js";
import {
  parseAttendanceMonitorSnapshot,
  type BrowserTeamMemberStatus,
} from "./browser-team.js";
import { CliError } from "./errors.js";
import { SystemWebCredentialStore, type WebCredentialProvider } from "./secret-store.js";
import type { TimeClockType } from "./types.js";

const freeeHomeUrl = "https://p.secure.freee.co.jp/";
const allowedMainFrameHosts = new Set([
  "p.secure.freee.co.jp",
  "accounts.secure.freee.co.jp",
  "ep.secure.freee.co.jp",
]);

const browserClockActions = ["in", "break-start", "break-end", "out"] as const;
const clockButtonLabels: Record<ClockAction, string> = {
  in: "出勤",
  "break-start": "休憩開始",
  "break-end": "休憩終了",
  out: "退勤",
};

export interface PlaywrightRuntimeConfig {
  headless: boolean;
  channel?: string;
  profileDirectory: string;
  credentialService: string;
  navigationTimeoutMs: number;
  interactionTimeoutMs: number;
}

export interface BrowserClockStatus {
  availableActions: ClockAction[];
  availableTypes: TimeClockType[];
}

export interface BrowserTeamStatusOptions {
  date?: string;
}

export function readPlaywrightRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): PlaywrightRuntimeConfig {
  const configuredProfile = env.FREEE_BROWSER_PROFILE_DIR?.trim();
  const profileDirectory = resolve(
    configuredProfile || join(homedir(), ".freee-agent", "playwright-profile"),
  );
  assertProfileOutsideRepository(profileDirectory, cwd);
  return {
    headless: parseBoolean(env.FREEE_BROWSER_HEADLESS, true, "FREEE_BROWSER_HEADLESS"),
    ...(env.FREEE_BROWSER_CHANNEL?.trim() === ""
      ? {}
      : { channel: env.FREEE_BROWSER_CHANNEL?.trim() || "chrome" }),
    profileDirectory,
    credentialService: env.FREEE_WEB_CREDENTIAL_SERVICE?.trim() || "freee-agent-web",
    navigationTimeoutMs: parseTimeout(
      env.FREEE_BROWSER_TIMEOUT_MS,
      30_000,
      "FREEE_BROWSER_TIMEOUT_MS",
    ),
    interactionTimeoutMs: parseTimeout(
      env.FREEE_BROWSER_INTERACTION_TIMEOUT_MS,
      180_000,
      "FREEE_BROWSER_INTERACTION_TIMEOUT_MS",
    ),
  };
}

export function isAllowedFreeePageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && allowedMainFrameHosts.has(url.hostname);
  } catch {
    return false;
  }
}

export class FreeeBrowserClient {
  private constructor(
    private readonly context: BrowserContext,
    private page: Page,
    private readonly credentials: WebCredentialProvider,
    private readonly config: PlaywrightRuntimeConfig,
  ) {}

  static async launch(
    config: PlaywrightRuntimeConfig = readPlaywrightRuntimeConfig(),
    credentials: WebCredentialProvider = new SystemWebCredentialStore(config.credentialService),
  ): Promise<FreeeBrowserClient> {
    await prepareProfileDirectory(config.profileDirectory);
    try {
      const context = await chromium.launchPersistentContext(config.profileDirectory, {
        headless: config.headless,
        ...(config.channel ? { channel: config.channel } : {}),
        viewport: { width: 1440, height: 1000 },
      });
      context.setDefaultTimeout(config.navigationTimeoutMs);
      context.setDefaultNavigationTimeout(config.navigationTimeoutMs);
      const page = context.pages()[0] ?? await context.newPage();
      return new FreeeBrowserClient(context, page, credentials, config);
    } catch {
      throw new CliError(
        "BROWSER_LAUNCH_FAILED",
        "The dedicated freee browser session could not be started. Close another freee-agent browser process and verify the configured Chrome channel.",
        { exitCode: 2 },
      );
    }
  }

  async close(): Promise<void> {
    await this.context.close();
  }

  async getClockStatus(): Promise<BrowserClockStatus> {
    await this.ensureAuthenticated();
    await this.ensureClockPage();
    return this.inspectClockStatus();
  }

  async performClockAction(
    action: ClockAction,
    confirm: boolean,
  ): Promise<{
    action: ClockAction;
    type: TimeClockType;
    verified: true;
    status: BrowserClockStatus;
  }> {
    await this.ensureAuthenticated();
    await this.ensureClockPage();
    const before = await this.inspectClockStatus();
    const type = clockActionMap[action];
    if (!before.availableActions.includes(action)) {
      throw new CliError(
        "CLOCK_ACTION_UNAVAILABLE",
        `The requested action '${action}' is not currently available in freee.`,
        {
          details: {
            requestedAction: action,
            requestedType: type,
            availableActions: before.availableActions,
            availableTypes: before.availableTypes,
          },
          exitCode: 2,
        },
      );
    }
    if (!confirm) {
      throw new CliError(
        "CONFIRMATION_REQUIRED",
        "This command would click a real freee time clock button. Re-run only after explicit user approval with `--confirm`.",
        {
          details: {
            requestedAction: action,
            requestedType: type,
            availableActions: before.availableActions,
          },
          exitCode: 2,
        },
      );
    }

    const button = await this.getUniqueClockButton(action);
    if (!await button.isVisible() || !await button.isEnabled()) {
      throw new CliError(
        "CLOCK_ACTION_UNAVAILABLE",
        `The requested action '${action}' became unavailable before it was clicked.`,
        { exitCode: 2 },
      );
    }
    try {
      await button.click({ timeout: this.config.navigationTimeoutMs });
      await this.page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
      await this.page.waitForTimeout(1_000);
    } catch {
      throw new CliError(
        "CLOCK_ACTION_RESULT_UNKNOWN",
        "The freee clock button interaction did not complete cleanly. Check status before attempting any further write.",
        { exitCode: 2 },
      );
    }

    const after = await this.inspectClockStatus();
    if (after.availableActions.includes(action)) {
      throw new CliError(
        "CLOCK_ACTION_RESULT_UNKNOWN",
        "The freee page did not confirm a changed clock state. Check status before attempting any further write.",
        { exitCode: 2 },
      );
    }
    return { action, type, verified: true, status: after };
  }

  async getTeamStatus(options: BrowserTeamStatusOptions = {}): Promise<{
    period: string;
    memberCount: number;
    issueMemberCount: number;
    members: BrowserTeamMemberStatus[];
  }> {
    await this.ensureAuthenticated();
    await this.openAttendanceMonitor();
    const snapshot = await this.page.evaluate(() => {
      const table = document.querySelector("table");
      if (!table) {
        return { headers: [], rows: [], periodCandidates: [] };
      }
      const headers = Array.from(table.querySelectorAll('tbody tr[class*="HeaderRow"] th'))
        .map((header) => header.textContent?.trim().replace(/\s+/g, " ") ?? "")
        .filter((value) => value.length > 0 && value.length <= 80);
      const rows = Array.from(table.querySelectorAll<HTMLTableRowElement>('tbody tr[class*="BodyRow"]'))
        .filter((row) => row.getClientRects().length > 0)
        .map((row) => Array.from(row.querySelectorAll<HTMLElement>("th, td"))
          .slice(0, 35)
          .map((cell) => cell.innerText.trim().replace(/\s+/g, " ")));
      const periodCandidates = Array.from(
        new Set(document.body.innerText.match(/20\d{2}年\d{1,2}月/g) ?? []),
      );
      const selectedPeriod = document.body.innerText
        .match(/(20\d{2}年\d{1,2}月)\d{1,2}日[〜～-].{0,30}勤務分/)?.[1] ?? null;
      const periodDescriptors = Array.from(document.querySelectorAll("body *"))
        .filter((element): element is HTMLElement => element instanceof HTMLElement)
        .map((element) => ({
          element,
          value: element.innerText.trim().replace(/\s+/g, " "),
        }))
        .filter(({ element, value }) =>
          /20\d{2}年\d{1,2}月/.test(value)
          && value.length <= 40
          && element.getClientRects().length > 0
          && !Array.from(element.children).some((child) =>
            (child as HTMLElement).innerText?.trim() === value))
        .map(({ element, value }) => ({
          value,
          tag: element.tagName.toLowerCase(),
          className: element.className,
          testId: element.dataset.testid ?? null,
          ariaCurrent: element.getAttribute("aria-current"),
        }))
        .slice(0, 20);
      return { headers, rows, periodCandidates, selectedPeriod, periodDescriptors };
    });
    return parseAttendanceMonitorSnapshot(snapshot, options.date);
  }

  async getApprovals(status: BrowserApprovalListStatus = "pending"): Promise<{
    filter: BrowserApprovalListStatus;
    applicationCount: number;
    applications: BrowserApprovalSummary[];
  }> {
    await this.ensureAuthenticated();
    await this.openApprovals();
    await this.selectApprovalFilter(status);
    const parsed = parseApprovalListSnapshot(await this.readApprovalListSnapshot());
    if (parsed.pageCount !== 1) {
      throw new CliError(
        "BROWSER_APPROVAL_PAGINATION_UNSUPPORTED",
        "The freee approval list spans multiple pages. No incomplete list was returned.",
        { details: { pageCount: parsed.pageCount }, exitCode: 2 },
      );
    }
    return {
      filter: status,
      applicationCount: parsed.applications.length,
      applications: parsed.applications,
    };
  }

  async getApprovalDetail(id: string): Promise<BrowserApprovalDetail> {
    await this.ensureAuthenticated();
    await this.openApprovals();
    await this.selectApprovalFilter("all");
    const summary = await this.findAndOpenApproval(id);
    return this.readApprovalDetail(summary);
  }

  async prepareApprovalAction(id: string, action: BrowserApprovalAction): Promise<{
    action: BrowserApprovalAction;
    fingerprint: string;
    preview: BrowserApprovalDetail;
  }> {
    const preview = await this.getApprovalDetail(id);
    if (!preview.availableActions.includes(action)) {
      throw new CliError(
        "APPROVAL_ACTION_UNAVAILABLE",
        `The requested approval action '${action}' is not currently available in freee.`,
        { details: { id, action, availableActions: preview.availableActions }, exitCode: 2 },
      );
    }
    return { action, fingerprint: createApprovalFingerprint(preview, action), preview };
  }

  async commitApprovalAction(
    id: string,
    action: BrowserApprovalAction,
    fingerprint: string,
    confirm: boolean,
  ): Promise<{
    id: string;
    action: BrowserApprovalAction;
    verified: true;
    result: BrowserApprovalDetail;
  }> {
    if (!confirm) {
      throw new CliError(
        "CONFIRMATION_REQUIRED",
        "This command changes a real employee application. Prepare it first, obtain explicit current-message approval, then re-run with its fingerprint and `--confirm`.",
        { details: { id, action }, exitCode: 2 },
      );
    }
    const before = await this.getApprovalDetail(id);
    const currentFingerprint = createApprovalFingerprint(before, action);
    if (fingerprint !== currentFingerprint) {
      throw new CliError(
        "APPROVAL_PREVIEW_CHANGED",
        "The application details or requested action changed after preview. No action was taken; prepare a new preview.",
        { details: { id, action, currentFingerprint }, exitCode: 2 },
      );
    }
    if (!before.availableActions.includes(action)) {
      throw new CliError(
        "APPROVAL_ACTION_UNAVAILABLE",
        `The requested approval action '${action}' is no longer available in freee.`,
        { details: { id, action, availableActions: before.availableActions }, exitCode: 2 },
      );
    }

    const label = action === "approve" ? "承認" : "申請者へ差し戻す";
    const button = this.page.getByRole("button", { name: label, exact: true });
    if (await button.count() !== 1 || !await button.isVisible() || !await button.isEnabled()) {
      throw new CliError(
        "BROWSER_PAGE_AMBIGUOUS",
        `The '${label}' action was not one unique, visible, enabled button. No action was taken.`,
        { exitCode: 2 },
      );
    }
    try {
      await button.click({ timeout: this.config.navigationTimeoutMs });
      await this.page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
      await this.page.waitForTimeout(1_000);
    } catch {
      throw new CliError(
        "APPROVAL_ACTION_RESULT_UNKNOWN",
        "The freee approval interaction did not complete cleanly. Read the application again before any further write.",
        { details: { id, action }, exitCode: 2 },
      );
    }
    const result = await this.getApprovalDetail(id);
    if (result.availableActions.includes(action) || createApprovalFingerprint(result, action) === fingerprint) {
      throw new CliError(
        "APPROVAL_ACTION_RESULT_UNKNOWN",
        "freee did not expose a verified changed application state. Read the application again before any further write.",
        { details: { id, action }, exitCode: 2 },
      );
    }
    return { id, action, verified: true, result };
  }

  private async ensureAuthenticated(): Promise<void> {
    try {
      await this.page.goto(freeeHomeUrl, { waitUntil: "domcontentloaded" });
    } catch {
      throw new CliError(
        "BROWSER_NAVIGATION_FAILED",
        "Could not open the official freee attendance page.",
        { exitCode: 2 },
      );
    }
    this.assertOfficialPage();
    if (new URL(this.page.url()).hostname === "p.secure.freee.co.jp") {
      await this.settleAttendancePage();
      return;
    }

    const current = new URL(this.page.url());
    if (current.hostname !== "accounts.secure.freee.co.jp" || current.pathname !== "/sessions/new") {
      await this.waitForInteractiveLoginIfPossible();
      return;
    }

    const credentials = await this.credentials.getCredentials();
    const username = await this.getUniqueVisibleLocator("input[name='loginId']", "username");
    const password = await this.getUniqueVisibleLocator("input[name='password']", "password");
    const submit = await this.getUniqueVisibleLocator("button[type='submit']", "login submit button");
    try {
      await username.fill(credentials.username);
      await password.fill(credentials.password);
      const loginTransition = this.page.waitForURL(
        (url) =>
          isAllowedFreeePageUrl(url.href)
          && (url.hostname === "p.secure.freee.co.jp" || url.pathname !== "/sessions/new"),
        { timeout: this.config.navigationTimeoutMs },
      ).then(() => true, () => false);
      await submit.click();
      await loginTransition;
      await this.page.waitForLoadState("domcontentloaded", {
        timeout: this.config.navigationTimeoutMs,
      }).catch(() => undefined);
    } finally {
      credentials.username = "";
      credentials.password = "";
    }
    this.assertOfficialPage();
    if (new URL(this.page.url()).hostname === "p.secure.freee.co.jp") {
      await this.settleAttendancePage();
      return;
    }
    if (new URL(this.page.url()).pathname === "/sessions/new") {
      throw new CliError(
        "BROWSER_LOGIN_FAILED",
        "freee did not accept the stored web login. Update the System Keychain credential locally.",
        { exitCode: 2 },
      );
    }
    await this.waitForInteractiveLoginIfPossible();
  }

  private async waitForInteractiveLoginIfPossible(): Promise<void> {
    if (this.config.headless) {
      throw new CliError(
        "BROWSER_INTERACTION_REQUIRED",
        "freee requires MFA, CAPTCHA, or another interactive login step. Set FREEE_BROWSER_HEADLESS=false and retry while present.",
        { exitCode: 2 },
      );
    }
    try {
      await this.page.waitForURL(
        (url) => url.protocol === "https:" && url.hostname === "p.secure.freee.co.jp",
        { timeout: this.config.interactionTimeoutMs },
      );
      this.assertOfficialPage();
      await this.settleAttendancePage();
    } catch {
      throw new CliError(
        "BROWSER_INTERACTION_TIMEOUT",
        "The interactive freee login was not completed before the local timeout.",
        { exitCode: 2 },
      );
    }
  }

  private async settleAttendancePage(): Promise<void> {
    await this.page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
    await this.page.waitForTimeout(2_000);
    this.assertOfficialPage();
  }

  private async ensureClockPage(): Promise<void> {
    for (const action of browserClockActions) {
      if (await (await this.findClockButton(action)).count() !== 0) {
        return;
      }
    }

    let portalEntry = this.page.getByRole("link", { name: /従業員ポータル/ });
    let count = await portalEntry.count();
    if (count === 0) {
      portalEntry = this.page.getByRole("button", { name: /従業員ポータル/ });
      count = await portalEntry.count();
    }
    if (count === 0) {
      return;
    }
    if (count !== 1 || !await portalEntry.isVisible()) {
      throw new CliError(
        "BROWSER_PAGE_AMBIGUOUS",
        "The employee portal entry point was not unique and visible. No navigation occurred.",
        { exitCode: 2 },
      );
    }
    const href = await portalEntry.getAttribute("href");
    if (href !== null && !isAllowedFreeePageUrl(new URL(href, this.page.url()).href)) {
      throw new CliError(
        "BROWSER_NAVIGATION_BLOCKED",
        "The employee portal link did not target an allowlisted official freee page.",
        { details: { target: safePageLocation(new URL(href, this.page.url()).href) }, exitCode: 2 },
      );
    }
    try {
      const openedPage = this.context.waitForEvent("page", {
        timeout: this.config.navigationTimeoutMs,
      }).then((page) => page, () => null);
      await portalEntry.click();
      const portalPage = await openedPage;
      if (portalPage) {
        portalPage.setDefaultTimeout(this.config.navigationTimeoutMs);
        portalPage.setDefaultNavigationTimeout(this.config.navigationTimeoutMs);
        this.page = portalPage;
      }
      await this.page.waitForLoadState("domcontentloaded", {
        timeout: this.config.navigationTimeoutMs,
      }).catch(() => undefined);
      await this.settleAttendancePage();
    } catch (error) {
      if (error instanceof CliError) {
        throw error;
      }
      throw new CliError(
        "BROWSER_NAVIGATION_FAILED",
        "Could not open the freee employee portal.",
        { exitCode: 2 },
      );
    }
  }

  private async openAttendanceMonitor(): Promise<void> {
    const monitorLink = this.page.locator('a[href*="/attendance_monitor"]');
    let count = await monitorLink.count();
    if (count === 0 || (count === 1 && !await monitorLink.isVisible())) {
      const attendanceNavigation = this.page.locator('[data-testid="グロナビ_勤怠"]');
      if (await attendanceNavigation.count() !== 1 || !await attendanceNavigation.isVisible()) {
        throw new CliError(
          "BROWSER_TEAM_PAGE_UNAVAILABLE",
          "The freee attendance navigation was not unique and visible.",
          { exitCode: 2 },
        );
      }
      await attendanceNavigation.click();
      await this.page.waitForTimeout(300);
      count = await monitorLink.count();
    }
    if (count !== 1 || !await monitorLink.isVisible()) {
      let visibleLinks = 0;
      for (let index = 0; index < count; index += 1) {
        if (await monitorLink.nth(index).isVisible()) {
          visibleLinks += 1;
        }
      }
      throw new CliError(
        "BROWSER_TEAM_PAGE_UNAVAILABLE",
        "The freee attendance monitor entry point was not unique and visible.",
        { details: { linkCount: count, visibleLinks }, exitCode: 2 },
      );
    }
    const href = await monitorLink.getAttribute("href");
    if (href === null || !isAllowedFreeePageUrl(new URL(href, this.page.url()).href)) {
      throw new CliError(
        "BROWSER_NAVIGATION_BLOCKED",
        "The attendance monitor link did not target an allowlisted official freee page.",
        { exitCode: 2 },
      );
    }
    await monitorLink.click();
    await this.page.waitForLoadState("domcontentloaded", {
      timeout: this.config.navigationTimeoutMs,
    }).catch(() => undefined);
    await this.settleAttendancePage();
    if (new URL(this.page.url()).pathname !== "/attendance_monitor") {
      throw new CliError(
        "BROWSER_NAVIGATION_FAILED",
        "freee did not open the expected attendance monitor page.",
        { exitCode: 2 },
      );
    }
  }

  private async openApprovals(): Promise<void> {
    if (new URL(this.page.url()).pathname !== "/approval_requests") {
      const approvalNavigation = this.page.locator('[data-testid="グロナビ_申請承認"]');
      if (await approvalNavigation.count() !== 1 || !await approvalNavigation.isVisible()) {
        throw new CliError(
          "BROWSER_APPROVAL_PAGE_UNAVAILABLE",
          "The freee application navigation was not unique and visible.",
          { exitCode: 2 },
        );
      }
      await approvalNavigation.click();
      await this.page.waitForLoadState("domcontentloaded", {
        timeout: this.config.navigationTimeoutMs,
      }).catch(() => undefined);
      await this.page.waitForTimeout(500);

      if (new URL(this.page.url()).pathname !== "/approval_requests") {
        const applicationLinks = this.page.locator('a[href]').filter({ hasText: /^申請$/ });
        const visibleLinks: Locator[] = [];
        for (let index = 0; index < await applicationLinks.count(); index += 1) {
          const candidate = applicationLinks.nth(index);
          if (await candidate.isVisible()) {
            visibleLinks.push(candidate);
          }
        }
        if (visibleLinks.length !== 1) {
          throw new CliError(
            "BROWSER_APPROVAL_PAGE_UNAVAILABLE",
            "The freee application entry point was not unique and visible.",
            { details: await this.getApprovalPageDiagnostics(), exitCode: 2 },
          );
        }
        const applicationLink = visibleLinks[0]!;
        const href = await applicationLink.getAttribute("href");
        if (href === null || !isAllowedFreeePageUrl(new URL(href, this.page.url()).href)) {
          throw new CliError(
            "BROWSER_NAVIGATION_BLOCKED",
            "The application link did not target an allowlisted official freee page.",
            { exitCode: 2 },
          );
        }
        await applicationLink.click();
        await this.page.waitForLoadState("domcontentloaded", {
          timeout: this.config.navigationTimeoutMs,
        }).catch(() => undefined);
      }
    }
    await this.settleAttendancePage();
    if (new URL(this.page.url()).pathname !== "/approval_requests") {
      throw new CliError(
        "BROWSER_NAVIGATION_FAILED",
        "freee did not open the expected application page.",
        { exitCode: 2 },
      );
    }
    const approvalTab = this.page.getByText("承認", { exact: true });
    if (await approvalTab.count() === 0) {
      throw new CliError(
        "BROWSER_APPROVAL_PAGE_UNEXPECTED",
        "The freee application page did not expose the approval tab.",
        { details: await this.getApprovalPageDiagnostics(), exitCode: 2 },
      );
    }
  }

  private async selectApprovalFilter(status: BrowserApprovalListStatus): Promise<void> {
    const labels: Record<BrowserApprovalListStatus, string> = {
      pending: "申請中",
      returned: "差戻し",
      approved: "承認済",
      all: "全て",
    };
    const label = labels[status];
    const button = this.page.getByRole("button", { name: label, exact: true });
    if (await button.count() !== 1 || !await button.isVisible()) {
      throw new CliError(
        "BROWSER_APPROVAL_PAGE_UNEXPECTED",
        `The freee approval filter '${label}' was not one unique visible button.`,
        { details: await this.getApprovalPageDiagnostics(), exitCode: 2 },
      );
    }
    await button.click();
    await this.page.waitForTimeout(500);
  }

  private async readApprovalListSnapshot(): Promise<{
    headers: string[];
    rows: string[][];
    pageCount: number;
  }> {
    this.assertOfficialPage();
    if (new URL(this.page.url()).pathname !== "/approval_requests") {
      throw new CliError(
        "BROWSER_APPROVAL_PAGE_UNEXPECTED",
        "The browser was not on the expected freee approval list.",
        { exitCode: 2 },
      );
    }
    return this.page.evaluate(() => {
      const table = document.querySelector("table");
      if (!table) {
        return { headers: [], rows: [], pageCount: 1 };
      }
      const headers = Array.from(table.querySelectorAll<HTMLElement>("thead th"))
        .map((cell) => cell.innerText.trim().replace(/\s+/g, " "))
        .filter((value) => value.length > 0);
      const rows = Array.from(table.querySelectorAll<HTMLTableRowElement>("tbody tr"))
        .filter((row) => row.getClientRects().length > 0)
        .map((row) => Array.from(row.querySelectorAll<HTMLElement>("th, td"))
          .map((cell) => cell.innerText.trim().replace(/\s+/g, " ")));
      const pageNumbers = Array.from(document.querySelectorAll<HTMLElement>("button"))
        .filter((button) => button.getClientRects().length > 0)
        .map((button) => button.innerText.trim())
        .filter((value) => /^\d+$/.test(value))
        .map(Number);
      return {
        headers,
        rows,
        pageCount: pageNumbers.length === 0 ? 1 : Math.max(...pageNumbers),
      };
    });
  }

  private async findAndOpenApproval(id: string): Promise<BrowserApprovalSummary> {
    const parsed = parseApprovalListSnapshot(await this.readApprovalListSnapshot());
    if (parsed.pageCount !== 1) {
      throw new CliError(
        "BROWSER_APPROVAL_PAGINATION_UNSUPPORTED",
        "The requested application may be on another page. No row was opened.",
        { details: { id, pageCount: parsed.pageCount }, exitCode: 2 },
      );
    }
    const summary = parsed.applications.find((application) => application.id === id);
    if (!summary) {
      throw new CliError(
        "APPROVAL_NOT_FOUND",
        "The requested application No. was not found in the complete freee approval list.",
        { details: { id }, exitCode: 2 },
      );
    }
    const rows = this.page.locator("table tbody tr.vb-tableListRow--clickable");
    const matches: Locator[] = [];
    for (let index = 0; index < await rows.count(); index += 1) {
      const row = rows.nth(index);
      if ((await row.locator("th, td").nth(1).innerText()).trim() === id) {
        matches.push(row);
      }
    }
    if (matches.length !== 1 || !await matches[0]!.isVisible()) {
      throw new CliError(
        "BROWSER_PAGE_AMBIGUOUS",
        "The requested application did not map to one unique visible row. No row was opened.",
        { details: { id, matchCount: matches.length }, exitCode: 2 },
      );
    }
    await matches[0]!.click();
    await this.page.waitForTimeout(500);
    const back = this.page.getByText("一覧に戻る", { exact: true });
    if (await back.count() !== 1 || !await back.isVisible()) {
      throw new CliError(
        "BROWSER_APPROVAL_DETAIL_UNEXPECTED",
        "freee did not open one unambiguous application detail view.",
        { details: { id }, exitCode: 2 },
      );
    }
    return summary;
  }

  private async readApprovalDetail(summary: BrowserApprovalSummary): Promise<BrowserApprovalDetail> {
    this.assertOfficialPage();
    const snapshot = await this.page.evaluate(() => {
      const normalize = (value: string) => value.trim().replace(/\s+/g, " ");
      const tables = Array.from(document.querySelectorAll("table"))
        .filter((table) => table.getClientRects().length > 0)
        .map((table) => ({
          headers: Array.from(table.querySelectorAll<HTMLElement>("thead th"))
            .map((cell) => normalize(cell.innerText))
            .filter((value) => value.length > 0),
          rows: Array.from(table.querySelectorAll<HTMLTableRowElement>("tbody tr"))
            .filter((row) => row.getClientRects().length > 0)
            .map((row) => Array.from(row.querySelectorAll<HTMLElement>("th, td"))
              .map((cell) => normalize(cell.innerText))),
        }));
      const fields = Array.from(document.querySelectorAll<HTMLElement>("dt"))
        .filter((label) => label.getClientRects().length > 0)
        .map((label) => {
          const value = label.nextElementSibling;
          return {
            label: normalize(label.innerText),
            value: value instanceof HTMLElement ? normalize(value.innerText) : "",
          };
        })
        .filter((field) => field.label.length > 0 && field.value.length > 0);
      const excluded = new Set([
        "ホーム", "従業員情報", "勤怠", "AIシフト", "申請", "給与", "賞与", "年末調整",
        "書類", "設定", "タスク", "申請一覧", "一覧に戻る",
      ]);
      const detailLines = (document.body?.innerText ?? "")
        .split("\n")
        .map(normalize)
        .filter((value) => value.length > 0 && value.length <= 500 && !excluded.has(value))
        .filter((value, index, values) => values.indexOf(value) === index)
        .slice(0, 200);
      return { fields, tables, detailLines };
    });
    const availableActions: BrowserApprovalAction[] = [];
    for (const [action, label] of [
      ["approve", "承認"],
      ["return", "申請者へ差し戻す"],
    ] as const) {
      const button = this.page.getByRole("button", { name: label, exact: true });
      if (await button.count() > 1) {
        throw new CliError(
          "BROWSER_PAGE_AMBIGUOUS",
          `freee rendered more than one '${label}' application action.`,
          { details: { id: summary.id }, exitCode: 2 },
        );
      }
      if (await button.count() === 1 && await button.isVisible() && await button.isEnabled()) {
        availableActions.push(action);
      }
    }
    return { application: summary, ...snapshot, availableActions };
  }

  private async getApprovalPageDiagnostics(): Promise<{
    page: { host: string; path: string } | null;
    visibleControls: string[];
    candidatePaths: string[];
    tables: Array<{ headers: string[]; rowCount: number }>;
    firstRow: unknown;
    definitionLabels: string[];
    dialogCount: number;
  }> {
    return {
      page: safePageLocation(this.page.url()),
      ...await this.page.evaluate(() => ({
        visibleControls: Array.from(document.querySelectorAll<HTMLElement>("a[href], button"))
          .filter((element) => element.getClientRects().length > 0)
          .map((element) => element.innerText.trim().replace(/\s+/g, " "))
          .filter((value) => value.length > 0 && value.length <= 80)
          .filter((value, index, values) => values.indexOf(value) === index)
          .slice(0, 80),
        candidatePaths: Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"))
          .filter((element) => element.getClientRects().length > 0)
          .map((element) => {
            try {
              const url = new URL(element.href, location.href);
              return url.hostname === location.hostname
                ? url.pathname.replace(/\/\d+(?=\/|$)/g, "/:id")
                : "";
            } catch {
              return "";
            }
          })
          .filter((value, index, values) => value !== "" && values.indexOf(value) === index)
          .slice(0, 80),
        tables: Array.from(document.querySelectorAll("table")).map((table) => ({
          headers: Array.from(table.querySelectorAll("th"))
            .map((cell) => cell.textContent?.trim().replace(/\s+/g, " ") ?? "")
            .filter((value) => value.length > 0 && value.length <= 80)
            .slice(0, 30),
          rowCount: table.querySelectorAll("tbody tr").length,
        })),
        firstRow: (() => {
          const row = document.querySelector<HTMLTableRowElement>("table tbody tr");
          if (!row) {
            return null;
          }
          return {
            classTokens: Array.from(row.classList).filter((value) => /^[A-Za-z0-9_-]{1,80}$/.test(value)),
            role: row.getAttribute("role"),
            testId: row.dataset.testid ?? null,
            attributeNames: row.getAttributeNames().filter((value) => value !== "style"),
            cells: Array.from(row.querySelectorAll<HTMLElement>("th, td")).map((cell) => ({
              textLength: cell.innerText.trim().length,
              interactives: Array.from(cell.querySelectorAll<HTMLElement>("a[href], button, [role='button']"))
                .map((element) => {
                  const href = element instanceof HTMLAnchorElement ? element.href : null;
                  let path: string | null = null;
                  let query: Array<{ key: string; numericValueLength: number | null }> = [];
                  if (href) {
                    try {
                      const url = new URL(href, location.href);
                      path = url.hostname === location.hostname
                        ? url.pathname.replace(/\/\d+(?=\/|$)/g, "/:id")
                        : null;
                      query = Array.from(url.searchParams.entries()).map(([key, value]) => ({
                        key,
                        numericValueLength: /^\d+$/.test(value) ? value.length : null,
                      }));
                    } catch {
                      path = null;
                    }
                  }
                  return {
                    tag: element.tagName.toLowerCase(),
                    role: element.getAttribute("role"),
                    testId: element.dataset.testid ?? null,
                    path,
                    query,
                    textLength: element.innerText.trim().length,
                  };
                }),
            })),
          };
        })(),
        definitionLabels: Array.from(document.querySelectorAll<HTMLElement>("dt, label"))
          .filter((element) => element.getClientRects().length > 0)
          .map((element) => element.innerText.trim().replace(/\s+/g, " "))
          .filter((value) => value.length > 0 && value.length <= 80)
          .filter((value, index, values) => values.indexOf(value) === index)
          .slice(0, 80),
        dialogCount: document.querySelectorAll("[role='dialog']").length,
      })),
    };
  }

  private async inspectClockStatus(): Promise<BrowserClockStatus> {
    this.assertOfficialPage();
    const availableActions: ClockAction[] = [];
    const matchedActions: ClockAction[] = [];
    for (const action of browserClockActions) {
      const locator = await this.findClockButton(action);
      const count = await locator.count();
      if (count > 1) {
        throw new CliError(
          "BROWSER_PAGE_AMBIGUOUS",
          `freee rendered more than one '${clockButtonLabels[action]}' control. No action was taken.`,
          { exitCode: 2 },
        );
      }
      if (count === 1) {
        matchedActions.push(action);
        if (await locator.isVisible() && await locator.isEnabled()) {
          availableActions.push(action);
        }
      }
    }
    if (matchedActions.length === 0) {
      throw new CliError(
        "BROWSER_CLOCK_CONTROLS_NOT_FOUND",
        "No available freee clock controls were found on the expected attendance page.",
        {
          details: {
            page: safePageLocation(this.page.url()),
            matchedActions,
            diagnostics: await this.getClockControlDiagnostics(),
          },
          exitCode: 2,
        },
      );
    }
    return {
      availableActions,
      availableTypes: availableActions.map((action) => clockActionMap[action]),
    };
  }

  private async getUniqueClockButton(action: ClockAction): Promise<Locator> {
    const locator = await this.findClockButton(action);
    if (await locator.count() !== 1) {
      throw new CliError(
        "BROWSER_PAGE_AMBIGUOUS",
        `The '${clockButtonLabels[action]}' control is not unique. No action was taken.`,
        { exitCode: 2 },
      );
    }
    return locator;
  }

  private async findClockButton(action: ClockAction): Promise<Locator> {
    const label = clockButtonLabels[action];
    const byTestId = this.page.locator(`[data-testid="${label}"]`);
    if (await byTestId.count() !== 0) {
      return byTestId;
    }
    return this.page.getByRole("button", { name: label, exact: true });
  }

  private async getClockControlDiagnostics(): Promise<{
    frames: Array<{ host: string; path: string } | null>;
    matches: Record<ClockAction, { testIdContains: number; buttonText: number; exactText: number }>;
    structure: {
      titleLength: number;
      bodyTextLength: number;
      htmlLength: number;
      buttons: number;
      links: number;
      inputs: number;
      testIds: string[];
      attendanceControlLabels: string[];
      candidatePaths: string[];
    };
  }> {
    const frames = this.page.frames().filter((frame) => isAllowedFreeePageUrl(frame.url()));
    const matches = {} as Record<
      ClockAction,
      { testIdContains: number; buttonText: number; exactText: number }
    >;
    for (const action of browserClockActions) {
      const label = clockButtonLabels[action];
      let testIdContains = 0;
      let buttonText = 0;
      let exactText = 0;
      for (const frame of frames) {
        testIdContains += await frame.locator(`[data-testid*="${label}"]`).count();
        buttonText += await frame.locator(`button:has-text("${label}")`).count();
        exactText += await frame.getByText(label, { exact: true }).count();
      }
      matches[action] = { testIdContains, buttonText, exactText };
    }
    return {
      frames: frames.map((frame) => safePageLocation(frame.url())),
      matches,
      structure: await this.page.evaluate(() => ({
        titleLength: document.title.length,
        bodyTextLength: document.body?.innerText.length ?? 0,
        htmlLength: document.documentElement?.outerHTML.length ?? 0,
        buttons: document.querySelectorAll("button").length,
        links: document.querySelectorAll("a[href]").length,
        inputs: document.querySelectorAll("input").length,
        testIds: Array.from(document.querySelectorAll<HTMLElement>("[data-testid]"))
          .map((element) => element.dataset.testid ?? "")
          .filter((value) => /^[\p{L}\p{N}_ -]{1,80}$/u.test(value))
          .slice(0, 40),
        attendanceControlLabels: Array.from(
          document.querySelectorAll<HTMLElement>("button, a[href]"),
        )
          .map((element) => element.innerText.trim().replace(/\s+/g, " "))
          .filter((value) => /出勤|退勤|休憩|勤務|打刻/.test(value) && value.length <= 80)
          .filter((value, index, values) => values.indexOf(value) === index)
          .slice(0, 40),
        candidatePaths: Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"))
          .map((element) => {
            try {
              const url = new URL(element.href, location.href);
              if (url.hostname !== location.hostname) {
                return "";
              }
              return url.pathname.replace(/\/\d+(?=\/|$)/g, "/:id");
            } catch {
              return "";
            }
          })
          .filter((value) => /clock|attendance|stamp|punch|record|home/i.test(value))
          .filter((value, index, values) => value !== "" && values.indexOf(value) === index)
          .slice(0, 40),
      })),
    };
  }

  private async getUniqueVisibleLocator(selector: string, description: string): Promise<Locator> {
    const locator = this.page.locator(selector);
    if (await locator.count() !== 1 || !await locator.isVisible()) {
      throw new CliError(
        "BROWSER_LOGIN_PAGE_UNEXPECTED",
        `The official freee login page did not contain one visible ${description}.`,
        { exitCode: 2 },
      );
    }
    return locator;
  }

  private assertOfficialPage(): void {
    if (!isAllowedFreeePageUrl(this.page.url())) {
      throw new CliError(
        "BROWSER_NAVIGATION_BLOCKED",
        "The browser left the allowlisted official freee pages. No credentials or actions were sent.",
        { exitCode: 2 },
      );
    }
  }
}

async function prepareProfileDirectory(profileDirectory: string): Promise<void> {
  try {
    await mkdir(profileDirectory, { recursive: true, mode: 0o700 });
    await chmod(profileDirectory, 0o700);
  } catch {
    throw new CliError(
      "BROWSER_PROFILE_UNAVAILABLE",
      "The private browser profile directory could not be prepared.",
      { exitCode: 2 },
    );
  }
}

function assertProfileOutsideRepository(profileDirectory: string, cwd: string): void {
  const pathFromRepository = relative(resolve(cwd), profileDirectory);
  if (pathFromRepository === "" || (!pathFromRepository.startsWith("..") && !isAbsolute(pathFromRepository))) {
    throw new CliError(
      "BROWSER_PROFILE_UNSAFE",
      "FREEE_BROWSER_PROFILE_DIR must be outside the repository.",
      { exitCode: 2 },
    );
  }
}

function parseBoolean(value: string | undefined, defaultValue: boolean, name: string): boolean {
  if (value === undefined || value.trim() === "") {
    return defaultValue;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1") {
    return true;
  }
  if (normalized === "false" || normalized === "0") {
    return false;
  }
  throw new CliError("INVALID_BROWSER_CONFIG", `${name} must be true or false.`, { exitCode: 2 });
}

function parseTimeout(value: string | undefined, defaultValue: number, name: string): number {
  if (value === undefined || value.trim() === "") {
    return defaultValue;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1_000 || parsed > 600_000) {
    throw new CliError(
      "INVALID_BROWSER_CONFIG",
      `${name} must be an integer between 1000 and 600000 milliseconds.`,
      { exitCode: 2 },
    );
  }
  return parsed;
}

function safePageLocation(value: string): { host: string; path: string } | null {
  try {
    const url = new URL(value);
    return { host: url.hostname, path: url.pathname };
  } catch {
    return null;
  }
}
