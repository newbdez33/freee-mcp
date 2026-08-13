import { chmod, mkdir } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

import { chromium, type BrowserContext, type Locator, type Page, type Response } from "playwright";

import { clockActionMap, type ClockAction } from "./attendance.js";
import {
  createApprovalFingerprint,
  getApprovalRowOffset,
  parseApprovalPageInfo,
  parseApprovalListSnapshot,
  type BrowserApprovalAction,
  type BrowserApprovalDetail,
  type BrowserApprovalListStatus,
  type BrowserApprovalPageInfo,
  type BrowserApprovalSummary,
} from "./browser-approvals.js";
import {
  createMonthlyFingerprint,
  parseMonthlyCalendarSnapshot,
  periodFromMonthlyTargetDate,
  type BrowserMonthlyAction,
  type BrowserMonthlyPreview,
  type BrowserMonthlyStatus,
  type BrowserMonthlySubmitForm,
} from "./browser-monthly.js";
import {
  createPersonalApplicationCreateFingerprint,
  createPersonalApplicationListFingerprint,
  createPersonalApplicationWithdrawFingerprint,
  normalizePersonalApplicationCreateInput,
  type BrowserPersonalApplicationCapability,
  type BrowserPersonalApplicationCreateInput,
  type BrowserPersonalApplicationCreatePreview,
  type BrowserPersonalApplicationDetail,
  type BrowserPersonalApplicationKind,
  type BrowserPersonalApplicationList,
  type BrowserPersonalApplicationListStatus,
  type BrowserPersonalApplicationOptions,
  type NormalizedPersonalApplicationCreateInput,
} from "./browser-personal-applications.js";
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
const approvalFilterLabels: Record<BrowserApprovalListStatus, string> = {
  pending: "未承認",
  returned: "差戻し",
  approved: "承認済",
  all: "全て",
};
const approvalApiStatuses: Record<BrowserApprovalListStatus, string> = {
  pending: "in_progress",
  returned: "feedback",
  approved: "approved",
  all: "all",
};
const personalApplicationFilterLabels: Record<BrowserPersonalApplicationListStatus, string> = {
  pending: "申請中",
  returned: "差戻し",
  approved: "承認済",
  all: "全て",
};
const personalApplicationApiStatuses: Record<BrowserPersonalApplicationListStatus, string> = {
  pending: "in_progress",
  returned: "draft_and_feedback",
  approved: "approved",
  all: "all",
};
const personalApplicationTypeLabels: Record<BrowserPersonalApplicationKind, string> = {
  leave: "休暇",
  overtime: "残業",
  "work-time-correction": "勤務時間修正",
};

export interface PlaywrightRuntimeConfig {
  headless: boolean;
  channel?: string;
  profileDirectory: string;
  diagnosticDirectory?: string;
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
  assertPrivatePathOutsideRepository(
    profileDirectory,
    cwd,
    "FREEE_BROWSER_PROFILE_DIR",
    "BROWSER_PROFILE_UNSAFE",
  );
  const configuredDiagnosticDirectory = env.FREEE_BROWSER_DIAGNOSTIC_DIR?.trim();
  const diagnosticDirectory = configuredDiagnosticDirectory
    ? resolve(configuredDiagnosticDirectory)
    : undefined;
  if (diagnosticDirectory) {
    assertPrivatePathOutsideRepository(
      diagnosticDirectory,
      cwd,
      "FREEE_BROWSER_DIAGNOSTIC_DIR",
      "BROWSER_DIAGNOSTIC_PATH_UNSAFE",
    );
    assertDiagnosticPathIsNotBroad(diagnosticDirectory);
  }
  return {
    headless: parseBoolean(env.FREEE_BROWSER_HEADLESS, true, "FREEE_BROWSER_HEADLESS"),
    ...(env.FREEE_BROWSER_CHANNEL?.trim() === ""
      ? {}
      : { channel: env.FREEE_BROWSER_CHANNEL?.trim() || "chrome" }),
    profileDirectory,
    ...(diagnosticDirectory ? { diagnosticDirectory } : {}),
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

export function normalizeHeadlessChromeUserAgent(userAgent: string): string {
  return userAgent.replace("HeadlessChrome/", "Chrome/");
}

async function deriveHeadlessChromeUserAgent(channel?: string): Promise<string> {
  const browser = await chromium.launch({
    headless: true,
    ...(channel ? { channel } : {}),
  });
  try {
    const page = await browser.newPage();
    const userAgent = await page.evaluate(() => navigator.userAgent);
    return normalizeHeadlessChromeUserAgent(userAgent);
  } finally {
    await browser.close();
  }
}

export class FreeeBrowserClient {
  private preparedPersonalApplicationFirstPageIds: string[] = [];
  private diagnosticScreenshotSequence = 0;

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
    if (config.diagnosticDirectory) {
      await prepareDiagnosticDirectory(config.diagnosticDirectory);
    }
    try {
      const userAgent = config.headless
        ? await deriveHeadlessChromeUserAgent(config.channel)
        : undefined;
      const context = await chromium.launchPersistentContext(config.profileDirectory, {
        headless: config.headless,
        ...(config.channel ? { channel: config.channel } : {}),
        ...(userAgent ? { userAgent } : {}),
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

  async getMonthlyStatus(period?: string): Promise<BrowserMonthlyStatus> {
    await this.ensureAuthenticated();
    await this.openAttendanceCalendar();
    const parsed = parseMonthlyCalendarSnapshot(
      await this.readMonthlyCalendarSnapshot(),
      period,
    );
    if (parsed.state === "unsubmitted") {
      return { ...parsed, application: null };
    }
    const application = await this.findEmployeeMonthlyApplication(parsed.period);
    const expectedStatuses = parsed.state === "pending"
      ? new Set(["未承認", "申請中"])
      : parsed.state === "approved"
        ? new Set(["承認済"])
        : new Set(["差戻し"]);
    if (!expectedStatuses.has(application.status)) {
      throw new CliError(
        "BROWSER_MONTHLY_PAGE_UNEXPECTED",
        "The attendance calendar and employee application list exposed different monthly states.",
        {
          details: {
            period: parsed.period,
            calendarStatus: parsed.statusLabel,
            applicationStatus: application.status,
          },
          exitCode: 2,
        },
      );
    }
    return { ...parsed, application };
  }

  async prepareMonthlyAction(
    action: BrowserMonthlyAction,
    period?: string,
  ): Promise<{
    action: BrowserMonthlyAction;
    fingerprint: string;
    preview: BrowserMonthlyPreview;
  }> {
    const status = await this.getMonthlyStatus(period);
    if (!status.availableActions.includes(action)) {
      throw new CliError(
        "MONTHLY_ACTION_UNAVAILABLE",
        `The requested monthly action '${action}' is not currently available in freee.`,
        {
          details: {
            period: status.period,
            state: status.state,
            statusLabel: status.statusLabel,
            availableActions: status.availableActions,
          },
          exitCode: 2,
        },
      );
    }

    let preview: BrowserMonthlyPreview;
    if (action === "submit") {
      const create = this.page.locator('[data-testid="申請作成ボタン"]');
      if (await create.count() !== 1 || !await create.isVisible() || !await create.isEnabled()) {
        throw new CliError(
          "BROWSER_MONTHLY_PAGE_UNEXPECTED",
          "The freee monthly submission creation control was not uniquely available.",
          { details: { period: status.period }, exitCode: 2 },
        );
      }
      await create.click();
      await this.page.waitForLoadState("domcontentloaded", {
        timeout: this.config.navigationTimeoutMs,
      }).catch(() => undefined);
      await this.page.getByRole("heading", { name: "月次勤怠締め申請を作成", exact: true })
        .waitFor({ state: "visible", timeout: this.config.navigationTimeoutMs })
        .catch(() => undefined);
      await this.page.waitForFunction(() => {
        const normalize = (value: string) => value.trim().replace(/\s+/g, " ");
        const routeLabel = Array.from(document.querySelectorAll<HTMLElement>("label"))
          .find((element) => normalize(element.innerText).startsWith("申請経路"));
        const route = routeLabel?.closest("tr")?.querySelector<HTMLSelectElement>("select");
        return Boolean(route?.selectedOptions[0]?.textContent?.trim());
      }, undefined, { timeout: this.config.navigationTimeoutMs }).catch(() => undefined);
      this.assertOfficialPage();
      const submitForm = await this.readMonthlySubmitForm();
      const submit = this.page.getByRole("button", { name: "申請", exact: true });
      if (await submit.count() !== 1 || !await submit.isVisible() || !await submit.isEnabled()) {
        throw new CliError(
          "BROWSER_MONTHLY_PAGE_UNEXPECTED",
          "The freee monthly submission form did not expose one enabled final submission button.",
          { details: { period: status.period }, exitCode: 2 },
        );
      }
      preview = { status, submitForm };
    } else {
      const application = status.application;
      if (!application) {
        throw new CliError(
          "BROWSER_MONTHLY_PAGE_UNEXPECTED",
          "The pending freee month did not expose its application number.",
          { details: { period: status.period }, exitCode: 2 },
        );
      }
      const applicationDetail = await this.openEmployeeApplicationDetail(application.id);
      const withdraw = this.page.getByRole("button", { name: "申請を取り下げる", exact: true });
      if (await withdraw.count() !== 1 || !await withdraw.isVisible() || !await withdraw.isEnabled()) {
        throw new CliError(
          "MONTHLY_ACTION_UNAVAILABLE",
          "The pending monthly application did not expose one enabled withdrawal button.",
          { details: { period: status.period, id: application.id }, exitCode: 2 },
        );
      }
      preview = { status, applicationDetail };
    }
    return { action, fingerprint: createMonthlyFingerprint(preview, action), preview };
  }

  async commitMonthlyAction(
    action: BrowserMonthlyAction,
    fingerprint: string,
    confirm: boolean,
    period?: string,
  ): Promise<{
    action: BrowserMonthlyAction;
    period: string;
    verified: true;
    result: BrowserMonthlyStatus;
  }> {
    if (!confirm) {
      throw new CliError(
        "CONFIRMATION_REQUIRED",
        "This command changes a real monthly attendance application. Prepare it first, obtain explicit current-message approval, then re-run with its fingerprint and `--confirm`.",
        { details: { action, period: period ?? null }, exitCode: 2 },
      );
    }
    const prepared = await this.prepareMonthlyAction(action, period);
    if (prepared.fingerprint !== fingerprint) {
      throw new CliError(
        "MONTHLY_PREVIEW_CHANGED",
        "The monthly attendance details or requested action changed after preview. No action was taken; prepare a new preview.",
        {
          details: {
            action,
            period: prepared.preview.status.period,
            currentFingerprint: prepared.fingerprint,
          },
          exitCode: 2,
        },
      );
    }
    const label = action === "submit" ? "申請" : "申請を取り下げる";
    const button = this.page.getByRole("button", { name: label, exact: true });
    if (await button.count() !== 1 || !await button.isVisible() || !await button.isEnabled()) {
      throw new CliError(
        "MONTHLY_ACTION_UNAVAILABLE",
        `The '${label}' monthly action was not one unique, visible, enabled button. No action was taken.`,
        { details: { action, period: prepared.preview.status.period }, exitCode: 2 },
      );
    }
    try {
      await button.click({ timeout: this.config.navigationTimeoutMs });
      await this.page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
      await this.page.waitForTimeout(1_000);
    } catch {
      throw new CliError(
        "MONTHLY_ACTION_RESULT_UNKNOWN",
        "The freee monthly application interaction did not complete cleanly. Read monthly status before any further write.",
        { details: { action, period: prepared.preview.status.period }, exitCode: 2 },
      );
    }
    let result: BrowserMonthlyStatus;
    try {
      result = await this.getMonthlyStatus(prepared.preview.status.period);
    } catch {
      throw new CliError(
        "MONTHLY_ACTION_RESULT_UNKNOWN",
        "freee did not expose a verifiable monthly status after the click. Do not retry; inspect monthly status before any further write.",
        { details: { action, period: prepared.preview.status.period }, exitCode: 2 },
      );
    }
    const verified = action === "submit"
      ? (result.state === "pending" || result.state === "approved") && result.application !== null
      : result.state === "returned";
    if (!verified) {
      throw new CliError(
        "MONTHLY_ACTION_RESULT_UNKNOWN",
        `freee returned monthly state '${result.state}' after '${action}'. Do not retry; inspect the application before any further write.`,
        { details: { action, period: result.period, state: result.state }, exitCode: 2 },
      );
    }
    return { action, period: result.period, verified: true, result };
  }

  async getPersonalApplicationOptions(date?: string): Promise<BrowserPersonalApplicationOptions> {
    if (date !== undefined) {
      normalizePersonalApplicationCreateInput({
        kind: "leave",
        date,
        leaveType: "placeholder",
      });
    }
    await this.ensureAuthenticated();
    const applicationTypes = await this.openPersonalApplicationCreateChooser();
    let leaveTypes: string[] | null = null;
    if (date !== undefined) {
      const leave = applicationTypes.find((capability) => capability.kind === "leave");
      if (!leave?.available) {
        throw new CliError(
          "PERSONAL_APPLICATION_TYPE_UNAVAILABLE",
          "The current freee company does not enable leave applications for this employee.",
          { details: { kind: "leave" }, exitCode: 2 },
        );
      }
      await this.openPersonalApplicationForm("leave");
      await this.selectApplicationDate("#approval-request-fields-date", date);
      leaveTypes = await this.readLeaveTypes();
    }
    return {
      applicationTypes,
      leaveTypes,
      leaveTypesDate: date ?? null,
    };
  }

  async getPersonalApplications(
    status: BrowserPersonalApplicationListStatus = "pending",
    page = 1,
  ): Promise<BrowserPersonalApplicationList> {
    if (!Number.isInteger(page) || page <= 0) {
      throw new CliError(
        "INVALID_PERSONAL_APPLICATION_PAGE",
        "The personal application page must be a positive integer.",
        { details: { page }, exitCode: 2 },
      );
    }
    await this.ensureAuthenticated();
    await this.openEmployeeApplications();
    let pageInfo = await this.selectEmployeeApplicationFilter(status);
    pageInfo = await this.selectEmployeeApplicationPage(status, page, pageInfo);
    const parsed = parseApprovalListSnapshot(await this.readApprovalListSnapshot());
    return {
      filter: status,
      page: pageInfo.page,
      pageCount: pageInfo.pageCount,
      totalCount: pageInfo.totalCount,
      applicationCount: parsed.applications.length,
      applications: parsed.applications,
    };
  }

  async getPersonalApplicationDetail(id: string): Promise<BrowserPersonalApplicationDetail> {
    await this.ensureAuthenticated();
    return this.openPersonalApplicationDetail(id);
  }

  async preparePersonalApplicationCreate(
    rawInput: BrowserPersonalApplicationCreateInput,
  ): Promise<{
    action: "create";
    fingerprint: string;
    preview: BrowserPersonalApplicationCreatePreview;
  }> {
    const application = normalizePersonalApplicationCreateInput(rawInput);
    const existing = await this.getPersonalApplications("all", 1);
    const applicationTypes = await this.openPersonalApplicationCreateChooser();
    const capability = applicationTypes.find((candidate) => candidate.kind === application.kind);
    if (!capability?.available) {
      throw new CliError(
        "PERSONAL_APPLICATION_TYPE_UNAVAILABLE",
        `The current freee company does not enable '${personalApplicationTypeLabels[application.kind]}' applications for this employee.`,
        { details: { kind: application.kind, applicationTypes }, exitCode: 2 },
      );
    }
    if (!capability.supported) {
      throw new CliError(
        "PERSONAL_APPLICATION_TYPE_UNSUPPORTED",
        `The '${personalApplicationTypeLabels[application.kind]}' form is visible in freee but is not yet supported safely by this MCP version.`,
        { details: { kind: application.kind }, exitCode: 2 },
      );
    }
    await this.openPersonalApplicationForm(application.kind);
    const route = application.kind === "leave"
      ? await this.fillLeaveApplicationForm(application)
      : await this.fillWorkTimeCorrectionForm(application);
    const submit = this.page.getByRole("button", { name: "申請", exact: true });
    if (await submit.count() !== 1 || !await submit.isVisible() || !await submit.isEnabled()) {
      throw new CliError(
        "BROWSER_PERSONAL_APPLICATION_FORM_UNEXPECTED",
        "The freee personal application form did not expose one enabled final submission button.",
        { details: { kind: application.kind, date: application.date }, exitCode: 2 },
      );
    }
    const preview: BrowserPersonalApplicationCreatePreview = {
      application,
      typeLabel: personalApplicationTypeLabels[application.kind],
      route,
      existingFirstPage: {
        count: existing.applications.length,
        fingerprint: createPersonalApplicationListFingerprint(
          existing.applications.map((item) => item.id),
        ),
      },
    };
    this.preparedPersonalApplicationFirstPageIds = existing.applications.map((item) => item.id);
    return {
      action: "create",
      fingerprint: createPersonalApplicationCreateFingerprint(preview),
      preview,
    };
  }

  async commitPersonalApplicationCreate(
    input: BrowserPersonalApplicationCreateInput,
    fingerprint: string,
    confirm: boolean,
  ): Promise<{
    action: "create";
    verified: true;
    result: BrowserPersonalApplicationDetail;
  }> {
    if (!confirm) {
      throw new CliError(
        "CONFIRMATION_REQUIRED",
        "This command creates a real personal attendance application. Prepare it first, obtain explicit current-message approval, then commit with its fingerprint and `--confirm`.",
        { details: { kind: input.kind, date: input.date }, exitCode: 2 },
      );
    }
    const prepared = await this.preparePersonalApplicationCreate(input);
    if (prepared.fingerprint !== fingerprint) {
      throw new CliError(
        "PERSONAL_APPLICATION_PREVIEW_CHANGED",
        "The personal application form, route, or recent application list changed after preview. No action was taken; prepare a new preview.",
        {
          details: {
            kind: prepared.preview.application.kind,
            date: prepared.preview.application.date,
            currentFingerprint: prepared.fingerprint,
          },
          exitCode: 2,
        },
      );
    }
    const submit = this.page.getByRole("button", { name: "申請", exact: true });
    if (await submit.count() !== 1 || !await submit.isVisible() || !await submit.isEnabled()) {
      throw new CliError(
        "PERSONAL_APPLICATION_ACTION_UNAVAILABLE",
        "The final personal application submission button became unavailable. No action was taken.",
        { exitCode: 2 },
      );
    }
    await this.captureDiagnosticScreenshot("personal-application-before-submit");
    try {
      await submit.click({ timeout: this.config.navigationTimeoutMs });
      await this.page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
      await this.page.waitForTimeout(1_000);
      await this.captureDiagnosticScreenshot("personal-application-after-submit-click");
    } catch {
      throw new CliError(
        "PERSONAL_APPLICATION_ACTION_RESULT_UNKNOWN",
        "The freee personal application interaction did not complete cleanly. Do not retry; inspect the personal application list before any further write.",
        { details: { action: "create" }, exitCode: 2 },
      );
    }
    let result: BrowserPersonalApplicationDetail;
    try {
      const { applicationId, ...currentDetail } =
        await this.readCurrentPersonalApplicationDetailSnapshot();
      const after = await this.getPersonalApplications("all", 1);
      await this.captureDiagnosticScreenshot("personal-application-after-submit-list");
      const existingIds = new Set(this.preparedPersonalApplicationFirstPageIds);
      const created = after.applications.filter((application) => !existingIds.has(application.id));
      if (created.length !== 1 || created[0]!.id !== applicationId) {
        throw new Error(
          `expected detail ${applicationId} to be the one new application, found ${created.length}`,
        );
      }
      result = { application: created[0]!, ...currentDetail };
    } catch {
      throw new CliError(
        "PERSONAL_APPLICATION_ACTION_RESULT_UNKNOWN",
        "freee did not expose exactly one verifiable new personal application after the click. Do not retry; inspect the personal application list before any further write.",
        { details: { action: "create" }, exitCode: 2 },
      );
    }
    if (result.application.status !== "申請中" && result.application.status !== "未承認"
        && result.application.status !== "承認済") {
      throw new CliError(
        "PERSONAL_APPLICATION_ACTION_RESULT_UNKNOWN",
        `freee returned personal application status '${result.application.status}' after creation. Do not retry; inspect the application before any further write.`,
        { details: { id: result.application.id, status: result.application.status }, exitCode: 2 },
      );
    }
    return { action: "create", verified: true, result };
  }

  async preparePersonalApplicationWithdraw(id: string): Promise<{
    action: "withdraw";
    fingerprint: string;
    preview: BrowserPersonalApplicationDetail;
  }> {
    const preview = await this.getPersonalApplicationDetail(id);
    if (!preview.availableActions.includes("withdraw")) {
      throw new CliError(
        "PERSONAL_APPLICATION_ACTION_UNAVAILABLE",
        "The requested personal application does not currently expose 申請を取り下げる.",
        { details: { id, availableActions: preview.availableActions }, exitCode: 2 },
      );
    }
    return {
      action: "withdraw",
      fingerprint: createPersonalApplicationWithdrawFingerprint(preview),
      preview,
    };
  }

  async commitPersonalApplicationWithdraw(
    id: string,
    fingerprint: string,
    confirm: boolean,
  ): Promise<{
    id: string;
    action: "withdraw";
    verified: true;
    result: BrowserPersonalApplicationDetail;
  }> {
    if (!confirm) {
      throw new CliError(
        "CONFIRMATION_REQUIRED",
        "This command withdraws a real personal attendance application. Prepare it first, obtain explicit current-message approval, then commit with its fingerprint and `--confirm`.",
        { details: { id }, exitCode: 2 },
      );
    }
    const prepared = await this.preparePersonalApplicationWithdraw(id);
    if (prepared.fingerprint !== fingerprint) {
      throw new CliError(
        "PERSONAL_APPLICATION_PREVIEW_CHANGED",
        "The personal application changed after preview. No action was taken; prepare a new preview.",
        { details: { id, currentFingerprint: prepared.fingerprint }, exitCode: 2 },
      );
    }
    const withdraw = this.page.getByRole("button", { name: "申請を取り下げる", exact: true });
    if (await withdraw.count() !== 1 || !await withdraw.isVisible() || !await withdraw.isEnabled()) {
      throw new CliError(
        "PERSONAL_APPLICATION_ACTION_UNAVAILABLE",
        "申請を取り下げる became unavailable. No action was taken.",
        { details: { id }, exitCode: 2 },
      );
    }
    try {
      await withdraw.click({ timeout: this.config.navigationTimeoutMs });
      await this.page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
      await this.page.waitForTimeout(1_000);
    } catch {
      throw new CliError(
        "PERSONAL_APPLICATION_ACTION_RESULT_UNKNOWN",
        "The freee withdrawal interaction did not complete cleanly. Do not retry; inspect the application before any further write.",
        { details: { id, action: "withdraw" }, exitCode: 2 },
      );
    }
    let result: BrowserPersonalApplicationDetail;
    try {
      result = await this.getPersonalApplicationDetail(id);
    } catch {
      throw new CliError(
        "PERSONAL_APPLICATION_ACTION_RESULT_UNKNOWN",
        "freee did not expose a verifiable withdrawn application after the click. Do not retry; inspect the personal application list before any further write.",
        { details: { id, action: "withdraw" }, exitCode: 2 },
      );
    }
    if (result.application.status !== "差戻し" || result.availableActions.includes("withdraw")) {
      throw new CliError(
        "PERSONAL_APPLICATION_ACTION_RESULT_UNKNOWN",
        `freee returned personal application status '${result.application.status}' after withdrawal. Do not retry; inspect the application before any further write.`,
        { details: { id, status: result.application.status }, exitCode: 2 },
      );
    }
    return { id, action: "withdraw", verified: true, result };
  }

  async getApprovals(status: BrowserApprovalListStatus = "pending", page = 1): Promise<{
    filter: BrowserApprovalListStatus;
    page: number;
    pageCount: number;
    totalCount: number;
    applicationCount: number;
    applications: BrowserApprovalSummary[];
  }> {
    if (!Number.isInteger(page) || page <= 0) {
      throw new CliError("INVALID_APPROVAL_PAGE", "The approval page must be a positive integer.", {
        details: { page },
        exitCode: 2,
      });
    }
    await this.ensureAuthenticated();
    await this.openApprovals();
    let pageInfo = await this.selectApprovalFilter(status);
    pageInfo = await this.selectApprovalPage(status, page, pageInfo);
    const parsed = parseApprovalListSnapshot(await this.readApprovalListSnapshot());
    return {
      filter: status,
      page: pageInfo.page,
      pageCount: pageInfo.pageCount,
      totalCount: pageInfo.totalCount,
      applicationCount: parsed.applications.length,
      applications: parsed.applications,
    };
  }

  async getApprovalDetail(id: string): Promise<BrowserApprovalDetail> {
    await this.ensureAuthenticated();
    await this.openApprovals();
    const pageInfo = await this.selectApprovalFilter("all");
    const summary = await this.findAndOpenApproval(id, "all", pageInfo);
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
    let result: BrowserApprovalDetail;
    try {
      result = await this.getApprovalDetail(id);
    } catch (error) {
      if (error instanceof CliError && error.code === "APPROVAL_NOT_FOUND") {
        throw new CliError(
          "APPROVAL_ACTION_RESULT_UNKNOWN",
          "The application left the visible approval queue after the click, but freee did not expose a verifiable final state. Do not retry; inspect the application in freee before any further write.",
          { details: { id, action }, exitCode: 2 },
        );
      }
      throw error;
    }
    const expectedStatus = action === "approve" ? "承認済" : "差戻し";
    if (result.availableActions.includes(action) || createApprovalFingerprint(result, action) === fingerprint) {
      throw new CliError(
        "APPROVAL_ACTION_RESULT_UNKNOWN",
        "freee did not expose a verified changed application state. Read the application again before any further write.",
        { details: { id, action }, exitCode: 2 },
      );
    }
    if (result.application.status !== expectedStatus) {
      throw new CliError(
        "APPROVAL_ACTION_RESULT_UNKNOWN",
        `freee returned application status '${result.application.status}' instead of '${expectedStatus}'. Do not retry; inspect the application before any further write.`,
        { details: { id, action, status: result.application.status }, exitCode: 2 },
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

  private async openAttendanceCalendar(): Promise<void> {
    if (new URL(this.page.url()).pathname !== "/attendances") {
      const calendarLink = this.page.locator('[data-testid="勤怠カレンダー画面へ"]');
      if (await calendarLink.count() !== 1 || !await calendarLink.isVisible()) {
        throw new CliError(
          "BROWSER_MONTHLY_PAGE_UNAVAILABLE",
          "The freee attendance calendar entry point was not unique and visible.",
          { exitCode: 2 },
        );
      }
      const href = await calendarLink.getAttribute("href");
      if (href === null || !isAllowedFreeePageUrl(new URL(href, this.page.url()).href)) {
        throw new CliError(
          "BROWSER_NAVIGATION_BLOCKED",
          "The attendance calendar link did not target an allowlisted official freee page.",
          { exitCode: 2 },
        );
      }
      await calendarLink.click();
      await this.page.waitForLoadState("domcontentloaded", {
        timeout: this.config.navigationTimeoutMs,
      }).catch(() => undefined);
    }
    await this.settleAttendancePage();
    if (new URL(this.page.url()).pathname !== "/attendances") {
      throw new CliError(
        "BROWSER_NAVIGATION_FAILED",
        "freee did not open the expected attendance calendar page.",
        { exitCode: 2 },
      );
    }
  }

  private async readMonthlyCalendarSnapshot(): Promise<{
    periodLabels: string[];
    statusLabels: string[];
    createActionCount: number;
  }> {
    this.assertOfficialPage();
    const create = this.page.locator('[data-testid="申請作成ボタン"]');
    const snapshot = await this.page.evaluate(() => {
      const normalize = (value: string) => value.trim().replace(/\s+/g, " ");
      const bodyText = document.body?.innerText ?? "";
      const periodLabels = Array.from(
        new Set(bodyText.match(/20\d{2}年\d{1,2}月\d{1,2}日払い\s*[（(][^\n]{1,100}勤務分\s*[）)]/g) ?? []),
      ).map(normalize);
      const statusLabels = Array.from(
        new Set(bodyText.match(/未申請|未承認|申請中|承認済|差戻し/g) ?? []),
      );
      return { periodLabels, statusLabels };
    });
    return {
      ...snapshot,
      createActionCount: await create.count() === 1 && await create.isVisible() && await create.isEnabled()
        ? 1
        : 0,
    };
  }

  private async readMonthlySubmitForm(): Promise<BrowserMonthlySubmitForm> {
    this.assertOfficialPage();
    if (new URL(this.page.url()).pathname !== "/approval_requests") {
      throw new CliError(
        "BROWSER_MONTHLY_PAGE_UNEXPECTED",
        "The browser was not on the expected monthly application creation page.",
        { exitCode: 2 },
      );
    }
    const snapshot = await this.page.evaluate(() => {
      const normalize = (value: string) => value.trim().replace(/\s+/g, " ");
      const heading = Array.from(document.querySelectorAll<HTMLElement>("h1,h2,h3,h4"))
        .find((element) => normalize(element.innerText) === "月次勤怠締め申請を作成");
      const targetLabel = Array.from(document.querySelectorAll<HTMLElement>("label"))
        .find((element) => normalize(element.innerText) === "対象月");
      const routeLabel = Array.from(document.querySelectorAll<HTMLElement>("label"))
        .find((element) => normalize(element.innerText).startsWith("申請経路"));
      const targetRowText = targetLabel?.closest("tr") instanceof HTMLElement
        ? normalize(targetLabel.closest("tr")!.innerText)
        : "";
      const routeControl = routeLabel?.closest("tr")?.querySelector<HTMLSelectElement>("select");
      const tables = Array.from(document.querySelectorAll<HTMLTableElement>("table"))
        .filter((table) => table.getClientRects().length > 0)
        .map((table) => ({
          headers: Array.from(table.querySelectorAll<HTMLElement>("thead th"))
            .map((cell) => normalize(cell.innerText))
            .filter(Boolean),
          rows: Array.from(table.querySelectorAll<HTMLTableRowElement>("tbody tr"))
            .filter((row) => row.getClientRects().length > 0)
            .map((row) => Array.from(row.querySelectorAll<HTMLElement>("th,td"))
              .map((cell) => normalize(cell.innerText))),
        }))
        .filter((table) => table.headers.length > 0 || table.rows.length > 0);
      const checks = (document.body?.innerText ?? "")
        .split("\n")
        .map(normalize)
        .filter((value) => /エラー|アラート|警告|不備/.test(value) && value.length <= 300)
        .filter((value, index, values) => values.indexOf(value) === index)
        .slice(0, 50);
      return {
        headingFound: heading !== undefined,
        targetMonth: targetRowText.replace(/^対象月\s*/, ""),
        route: routeControl?.selectedOptions[0]?.textContent?.trim() ?? "",
        routeOptions: routeControl
          ? Array.from(routeControl.options).map((option) => normalize(option.textContent ?? ""))
          : [],
        approvalSteps: tables,
        checks,
      };
    });
    if (!snapshot.headingFound || !snapshot.targetMonth || !snapshot.route
        || snapshot.routeOptions.length === 0) {
      throw new CliError(
        "BROWSER_MONTHLY_PAGE_UNEXPECTED",
        "The freee monthly application form no longer matches the supported schema.",
        {
          details: {
            headingFound: snapshot.headingFound,
            targetMonthPresent: snapshot.targetMonth.length > 0,
            routePresent: snapshot.route.length > 0,
            routeOptionCount: snapshot.routeOptions.length,
          },
          exitCode: 2,
        },
      );
    }
    const { headingFound: _headingFound, ...form } = snapshot;
    return form;
  }

  private async openPersonalApplicationCreateChooser(): Promise<BrowserPersonalApplicationCapability[]> {
    await this.openEmployeeApplications();
    const create = this.page.locator('[data-testid="申請ボタン"]');
    if (await create.count() !== 1 || !await create.isVisible() || !await create.isEnabled()) {
      throw new CliError(
        "BROWSER_PERSONAL_APPLICATION_PAGE_UNEXPECTED",
        "The employee application list did not expose one enabled personal application creation button.",
        { exitCode: 2 },
      );
    }
    await create.click();
    await this.page.getByRole("heading", { name: "申請の新規作成", exact: true })
      .waitFor({ state: "visible", timeout: this.config.navigationTimeoutMs })
      .catch(() => undefined);
    this.assertOfficialPage();
    const visibleLinks = await this.page.evaluate(() => Array.from(
      document.querySelectorAll<HTMLAnchorElement>('a[href*="ApprovalRequest::"]'),
    )
      .filter((link) => link.getClientRects().length > 0)
      .map((link) => link.innerText.trim().replace(/\s+/g, " "))
      .filter((label, index, labels) => label.length > 0 && labels.indexOf(label) === index));
    const hasExactLabel = (label: string): boolean => visibleLinks.some((value) =>
      value === label || value.startsWith(`${label} `));
    return ([
      ["leave", "休暇", hasExactLabel("休暇"), true],
      ["overtime", "残業", hasExactLabel("残業"), false],
      ["work-time-correction", "勤務時間修正", hasExactLabel("勤務時間修正"), true],
    ] as const).map(([kind, label, available, supported]) => ({
      kind,
      label,
      available,
      supported,
    }));
  }

  private async openPersonalApplicationForm(kind: BrowserPersonalApplicationKind): Promise<void> {
    if (kind === "overtime") {
      throw new CliError(
        "PERSONAL_APPLICATION_TYPE_UNSUPPORTED",
        "Overtime creation is not supported until its enabled freee form can be verified safely.",
        { details: { kind }, exitCode: 2 },
      );
    }
    const type = kind === "leave" ? "ApprovalRequest::Holiday" : "ApprovalRequest::WorkTime";
    const link = await this.getUniqueVisibleLocator(
      `a[href="/approval_requests#/requests/new?type=${type}"]`,
      `${personalApplicationTypeLabels[kind]} application card`,
    );
    await link.click();
    const heading = kind === "leave" ? "休暇申請を作成" : "勤務時間修正申請を作成";
    await this.page.getByRole("heading", { name: heading, exact: true })
      .waitFor({ state: "visible", timeout: this.config.navigationTimeoutMs })
      .catch(() => undefined);
    if (await this.page.getByRole("heading", { name: heading, exact: true }).count() !== 1) {
      throw new CliError(
        "BROWSER_PERSONAL_APPLICATION_FORM_UNEXPECTED",
        `freee did not open the expected '${heading}' form.`,
        { details: { kind }, exitCode: 2 },
      );
    }
  }

  private async fillLeaveApplicationForm(
    application: NormalizedPersonalApplicationCreateInput,
  ): Promise<string> {
    await this.selectApplicationDate("#approval-request-fields-date", application.date);
    await this.captureDiagnosticScreenshot("personal-application-date-selected");
    const leaveTypes = await this.readLeaveTypes();
    if (!application.leaveType || !leaveTypes.includes(application.leaveType)) {
      throw new CliError(
        "PERSONAL_APPLICATION_LEAVE_TYPE_UNAVAILABLE",
        "The requested leave type is not available for the selected date in freee.",
        {
          details: {
            date: application.date,
            requestedLeaveType: application.leaveType,
            availableLeaveTypes: leaveTypes,
          },
          exitCode: 2,
        },
      );
    }
    const leaveType = this.page.locator("#approval-request-fields-holiday-category");
    await leaveType.selectOption({ label: application.leaveType });
    const selectedLeaveType = await leaveType.locator("option:checked").textContent();
    if (selectedLeaveType?.trim() !== application.leaveType) {
      throw new CliError(
        "BROWSER_PERSONAL_APPLICATION_FORM_UNEXPECTED",
        "freee did not retain the selected leave type.",
        { exitCode: 2 },
      );
    }
    await this.captureDiagnosticScreenshot("personal-application-leave-type-selected");
    const leaveTypeRow = leaveType.locator("xpath=ancestor::tr[1]");
    const leaveTimeInputs = leaveTypeRow.locator("input:visible");
    const leaveTimeInputCount = await leaveTimeInputs.count();
    if (leaveTimeInputCount === 0) {
      if (application.leaveStart || application.leaveEnd) {
        throw new CliError(
          "PERSONAL_APPLICATION_LEAVE_TIME_UNAVAILABLE",
          "The selected freee leave type does not expose a leave time range.",
          { details: { leaveType: application.leaveType }, exitCode: 2 },
        );
      }
    } else {
      if (leaveTimeInputCount !== 2) {
        throw new CliError(
          "BROWSER_PERSONAL_APPLICATION_FORM_UNEXPECTED",
          "The selected freee leave type exposed an ambiguous leave time range.",
          {
            details: { leaveType: application.leaveType, leaveTimeInputCount },
            exitCode: 2,
          },
        );
      }
      if (!application.leaveStart || !application.leaveEnd) {
        throw new CliError(
          "PERSONAL_APPLICATION_LEAVE_TIME_REQUIRED",
          "The selected freee leave type requires an explicit leave_start and leave_end.",
          { details: { leaveType: application.leaveType }, exitCode: 2 },
        );
      }
      for (const [index, expected] of [application.leaveStart, application.leaveEnd].entries()) {
        const input = leaveTimeInputs.nth(index);
        if (!await input.isVisible() || !await input.isEnabled()) {
          throw new CliError(
            "BROWSER_PERSONAL_APPLICATION_FORM_UNEXPECTED",
            "The selected freee leave type did not expose two enabled leave time inputs.",
            { details: { leaveType: application.leaveType }, exitCode: 2 },
          );
        }
        await input.fill(expected);
        await input.press("Tab");
        if (await input.inputValue() !== expected) {
          throw new CliError(
            "PERSONAL_APPLICATION_LEAVE_TIME_UNAVAILABLE",
            "freee did not retain the requested leave time range.",
            {
              details: {
                leaveType: application.leaveType,
                leaveStart: application.leaveStart,
                leaveEnd: application.leaveEnd,
              },
              exitCode: 2,
            },
          );
        }
      }
    }
    await this.page.locator('[data-testid="申請理由"]').fill(application.reason);
    await this.captureDiagnosticScreenshot("personal-application-fields-complete");
    return this.readPersonalApplicationRoute();
  }

  private async fillWorkTimeCorrectionForm(
    application: NormalizedPersonalApplicationCreateInput,
  ): Promise<string> {
    if (!application.clockIn || !application.clockOut) {
      throw new CliError(
        "INVALID_PERSONAL_APPLICATION_TIME",
        "A work-time correction requires clock-in and clock-out times.",
        { exitCode: 2 },
      );
    }
    await this.selectApplicationDate("#approval-request-date-input", application.date);
    await this.selectClockTime("出勤時刻", application.clockIn);
    await this.selectClockTime("退勤時刻", application.clockOut);
    if (application.breakStart && application.breakEnd) {
      await this.selectClockTime("休憩開始時刻", application.breakStart);
      await this.selectClockTime("休憩終了時刻", application.breakEnd);
    }
    await this.page.locator('[data-testid="申請理由"]').fill(application.reason);
    return this.readPersonalApplicationRoute();
  }

  private async selectApplicationDate(selector: string, date: string): Promise<void> {
    const [year, month, day] = date.split("-").map(Number);
    const input = this.page.locator(selector);
    if (await input.count() !== 1 || !await input.isVisible() || !await input.isEnabled()) {
      throw new CliError(
        "BROWSER_PERSONAL_APPLICATION_FORM_UNEXPECTED",
        "The freee personal application form did not expose one enabled date control.",
        { details: { date }, exitCode: 2 },
      );
    }
    await input.click();
    const calendar = this.page.getByRole("region", { name: "カレンダーで日付を選択", exact: true });
    await calendar.waitFor({ state: "visible", timeout: this.config.navigationTimeoutMs });
    const targetMonth = year! * 12 + month! - 1;
    let reachedTargetMonth = false;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const monthLabel = await calendar.innerText();
      const match = monthLabel.match(/(20\d{2})年(\d{1,2})月/);
      if (!match) {
        break;
      }
      const currentMonth = Number(match[1]) * 12 + Number(match[2]) - 1;
      if (currentMonth === targetMonth) {
        reachedTargetMonth = true;
        break;
      }
      const direction = currentMonth < targetMonth ? "次の月" : "前の月";
      await calendar.getByRole("button", { name: direction, exact: true }).click();
      await this.page.waitForTimeout(50);
    }
    if (!reachedTargetMonth) {
      throw new CliError(
        "BROWSER_PERSONAL_APPLICATION_FORM_UNEXPECTED",
        "The freee calendar could not navigate to the requested application date.",
        { details: { date }, exitCode: 2 },
      );
    }
    const dateLabel = `${year}年${month}月${day}日`;
    const dateButton = calendar.getByRole("button", { name: dateLabel, exact: true });
    if (await dateButton.count() !== 1 || !await dateButton.isVisible() || !await dateButton.isEnabled()) {
      throw new CliError(
        "PERSONAL_APPLICATION_DATE_UNAVAILABLE",
        "The requested date is not selectable in the freee application calendar.",
        { details: { date }, exitCode: 2 },
      );
    }
    await dateButton.click();
    await this.page.waitForFunction(
      ({ inputSelector, expected }) =>
        document.querySelector<HTMLInputElement>(inputSelector)?.value === expected,
      { inputSelector: selector, expected: date },
      { timeout: this.config.navigationTimeoutMs },
    );
  }

  private async readLeaveTypes(): Promise<string[]> {
    const control = this.page.locator("#approval-request-fields-holiday-category");
    await control.waitFor({ state: "visible", timeout: this.config.navigationTimeoutMs });
    const leaveTypes = await control.locator("option").allTextContents();
    const normalized = leaveTypes.map((value) => value.trim()).filter(Boolean);
    if (normalized.length === 0 || new Set(normalized).size !== normalized.length) {
      throw new CliError(
        "BROWSER_PERSONAL_APPLICATION_FORM_UNEXPECTED",
        "freee did not expose one unambiguous set of leave types for the selected date.",
        { exitCode: 2 },
      );
    }
    return normalized;
  }

  private async selectClockTime(label: string, time: string): Promise<void> {
    const [hour, minute] = time.split(":");
    for (const [suffix, value] of [["時", hour], ["分", minute]] as const) {
      const input = this.page.getByRole("combobox", { name: `${label}_${suffix}`, exact: true });
      if (await input.count() !== 1 || !await input.isVisible() || !await input.isEnabled()) {
        throw new CliError(
          "BROWSER_PERSONAL_APPLICATION_FORM_UNEXPECTED",
          `freee did not expose one enabled '${label}_${suffix}' control.`,
          { exitCode: 2 },
        );
      }
      await input.fill(value!);
      await input.press("ArrowDown");
      await input.press("Enter");
      if (await input.inputValue() !== value) {
        throw new CliError(
          "PERSONAL_APPLICATION_TIME_UNAVAILABLE",
          `freee did not accept '${time}' for '${label}'.`,
          { details: { label, time }, exitCode: 2 },
        );
      }
    }
  }

  private async readPersonalApplicationRoute(): Promise<string> {
    const route = this.page.locator("#approval-request-fields-route-id");
    await this.page.waitForFunction(() => {
      const value = document.querySelector<HTMLInputElement>("#approval-request-fields-route-id")?.value;
      return typeof value === "string" && value.trim().length > 0;
    }, undefined, { timeout: this.config.navigationTimeoutMs }).catch(() => undefined);
    if (await route.count() !== 1 || !await route.isVisible() || !await route.isEnabled()) {
      throw new CliError(
        "BROWSER_PERSONAL_APPLICATION_FORM_UNEXPECTED",
        "The freee personal application form did not expose one selected approval route.",
        { exitCode: 2 },
      );
    }
    const value = (await route.inputValue()).trim();
    if (!value) {
      throw new CliError(
        "PERSONAL_APPLICATION_ROUTE_REQUIRED",
        "freee requires an approval route, but no route was selected for this application.",
        { exitCode: 2 },
      );
    }
    return value;
  }

  private async captureDiagnosticScreenshot(label: string): Promise<void> {
    if (!this.config.diagnosticDirectory) {
      return;
    }
    this.diagnosticScreenshotSequence += 1;
    const sequence = String(this.diagnosticScreenshotSequence).padStart(2, "0");
    const screenshotPath = join(this.config.diagnosticDirectory, `${sequence}-${label}.png`);
    try {
      await this.page.screenshot({ path: screenshotPath, fullPage: true, animations: "disabled" });
      await chmod(screenshotPath, 0o600);
    } catch {
      throw new CliError(
        "BROWSER_DIAGNOSTIC_CAPTURE_FAILED",
        "The explicitly requested private Playwright diagnostic screenshot could not be saved. The current operation stopped.",
        { details: { label }, exitCode: 2 },
      );
    }
  }

  private async findEmployeeMonthlyApplication(period: string): Promise<BrowserApprovalSummary> {
    await this.openEmployeeApplications();
    const all = this.page.getByRole("button", { name: "全て", exact: true });
    if (await all.count() !== 1 || !await all.isVisible()) {
      throw new CliError(
        "BROWSER_MONTHLY_PAGE_UNEXPECTED",
        "The employee application list did not expose one visible '全て' filter.",
        { exitCode: 2 },
      );
    }
    let pageInfo = await this.loadEmployeeApplicationPage("all", 1, () => all.click());
    const matches: BrowserApprovalSummary[] = [];
    const lastPage = Math.max(1, pageInfo.pageCount);
    for (let page = 1; page <= lastPage; page += 1) {
      if (page > 1) {
        const next = this.page.getByRole("button", { name: `ページ ${page}`, exact: true });
        if (await next.count() !== 1 || !await next.isVisible() || !await next.isEnabled()) {
          throw new CliError(
            "BROWSER_MONTHLY_PAGE_UNEXPECTED",
            `The employee application page control for page ${page} was unavailable.`,
            { exitCode: 2 },
          );
        }
        pageInfo = await this.loadEmployeeApplicationPage("all", page, () => next.click());
      }
      const parsed = parseApprovalListSnapshot(await this.readApprovalListSnapshot());
      matches.push(...parsed.applications.filter((application) =>
        application.type === "月次勤怠締め"
        && periodFromMonthlyTargetDate(application.targetDate) === period));
      if (matches.length > 1) {
        break;
      }
    }
    if (matches.length !== 1) {
      throw new CliError(
        matches.length === 0 ? "MONTHLY_APPLICATION_NOT_FOUND" : "BROWSER_MONTHLY_PAGE_UNEXPECTED",
        matches.length === 0
          ? "No monthly attendance application matched the selected freee month."
          : "More than one monthly attendance application matched the selected freee month.",
        { details: { period, matchCount: matches.length }, exitCode: 2 },
      );
    }
    return matches[0]!;
  }

  private async openEmployeeApplications(): Promise<void> {
    if (new URL(this.page.url()).pathname !== "/approval_requests") {
      const navigation = this.page.locator('[data-testid="グロナビ_申請承認"]');
      if (await navigation.count() !== 1 || !await navigation.isVisible()) {
        throw new CliError(
          "BROWSER_MONTHLY_PAGE_UNAVAILABLE",
          "The freee employee application page was unavailable.",
          { exitCode: 2 },
        );
      }
      await navigation.click();
      await this.page.waitForLoadState("domcontentloaded", {
        timeout: this.config.navigationTimeoutMs,
      }).catch(() => undefined);
      await this.page.waitForTimeout(500);
    }
    const tab = this.page.getByRole("tab", { name: "申請", exact: true });
    if (await tab.count() !== 1 || !await tab.isVisible()) {
      throw new CliError(
        "BROWSER_MONTHLY_PAGE_UNEXPECTED",
        "The freee application page did not expose one visible employee application tab.",
        { exitCode: 2 },
      );
    }
    if (await tab.getAttribute("aria-selected") !== "true") {
      await tab.click();
      await this.page.waitForTimeout(500);
    }
    if (await tab.getAttribute("aria-selected") !== "true") {
      throw new CliError(
        "BROWSER_MONTHLY_PAGE_UNEXPECTED",
        "freee did not select the employee application tab.",
        { exitCode: 2 },
      );
    }
  }

  private async selectEmployeeApplicationFilter(
    status: BrowserPersonalApplicationListStatus,
  ): Promise<BrowserApprovalPageInfo> {
    const label = personalApplicationFilterLabels[status];
    const button = this.page.getByRole("button", { name: label, exact: true });
    if (await button.count() !== 1 || !await button.isVisible()) {
      throw new CliError(
        "BROWSER_PERSONAL_APPLICATION_PAGE_UNEXPECTED",
        `The employee application filter '${label}' was not one unique visible button.`,
        { exitCode: 2 },
      );
    }
    const pageInfo = await this.loadEmployeeApplicationPage(status, 1, () => button.click());
    if (await button.getAttribute("aria-pressed") !== "true") {
      throw new CliError(
        "BROWSER_PERSONAL_APPLICATION_PAGE_UNEXPECTED",
        `freee did not select the employee application filter '${label}'.`,
        { exitCode: 2 },
      );
    }
    return pageInfo;
  }

  private async selectEmployeeApplicationPage(
    status: BrowserPersonalApplicationListStatus,
    page: number,
    initial: BrowserApprovalPageInfo,
  ): Promise<BrowserApprovalPageInfo> {
    if (page === initial.page) {
      return initial;
    }
    if (page < initial.page || page > initial.pageCount) {
      throw new CliError(
        "INVALID_PERSONAL_APPLICATION_PAGE",
        `Personal application page ${page} is outside the available ${initial.pageCount} pages.`,
        { details: { page, pageCount: initial.pageCount }, exitCode: 2 },
      );
    }
    let current = initial;
    for (let nextPage = initial.page + 1; nextPage <= page; nextPage += 1) {
      const button = this.page.getByRole("button", { name: `ページ ${nextPage}`, exact: true });
      if (await button.count() !== 1 || !await button.isVisible() || !await button.isEnabled()) {
        throw new CliError(
          "BROWSER_PERSONAL_APPLICATION_PAGE_UNEXPECTED",
          `The employee application page control for page ${nextPage} was not uniquely available.`,
          { exitCode: 2 },
        );
      }
      current = await this.loadEmployeeApplicationPage(status, nextPage, () => button.click());
      if (await button.getAttribute("aria-current") !== "true") {
        throw new CliError(
          "BROWSER_PERSONAL_APPLICATION_PAGE_UNEXPECTED",
          `freee did not select employee application page ${nextPage}.`,
          { exitCode: 2 },
        );
      }
    }
    return current;
  }

  private async loadEmployeeApplicationPage(
    status: BrowserPersonalApplicationListStatus,
    page: number,
    navigate: () => Promise<unknown>,
  ): Promise<BrowserApprovalPageInfo> {
    const responsePromise = this.page.waitForResponse((response) => {
      try {
        const url = new URL(response.url());
        return response.request().method() === "GET"
          && url.protocol === "https:"
          && url.hostname === "p.secure.freee.co.jp"
          && url.pathname === "/api/p/employees/approval_requests/requests"
          && url.searchParams.get("page") === String(page)
          && url.searchParams.get("q[status_eq]") === personalApplicationApiStatuses[status];
      } catch {
        return false;
      }
    }, { timeout: this.config.navigationTimeoutMs }).catch(() => null);
    await navigate();
    const response = await responsePromise;
    if (!response?.ok()) {
      throw new CliError(
        "BROWSER_MONTHLY_PAGE_UNEXPECTED",
        `freee did not return employee application page ${page} for '${personalApplicationFilterLabels[status]}'.`,
        { exitCode: 2 },
      );
    }
    const pageInfo = parseApprovalPageInfo(await response.json());
    if (pageInfo.page !== page) {
      throw new CliError(
        "BROWSER_MONTHLY_PAGE_UNEXPECTED",
        `freee returned employee application page ${pageInfo.page} while ${page} was requested.`,
        { exitCode: 2 },
      );
    }
    await this.waitForApprovalRows(pageInfo.requestCodes);
    return pageInfo;
  }

  private async openEmployeeApplicationDetail(id: string): Promise<BrowserApprovalDetail> {
    await this.openEmployeeApplications();
    const all = this.page.getByRole("button", { name: "全て", exact: true });
    let pageInfo = await this.loadEmployeeApplicationPage("all", 1, () => all.click());
    const lastPage = Math.max(1, pageInfo.pageCount);
    for (let page = 1; page <= lastPage; page += 1) {
      if (page > 1) {
        const next = this.page.getByRole("button", { name: `ページ ${page}`, exact: true });
        pageInfo = await this.loadEmployeeApplicationPage("all", page, () => next.click());
      }
      const snapshot = await this.readApprovalListSnapshot();
      const summary = parseApprovalListSnapshot(snapshot).applications
        .find((application) => application.id === id);
      if (summary) {
        await this.openApprovalRow(id, snapshot);
        return this.readApprovalDetail(summary);
      }
    }
    throw new CliError(
      "PERSONAL_APPLICATION_NOT_FOUND",
      "The requested application No. was not found after reading every employee application page.",
      { details: { id }, exitCode: 2 },
    );
  }

  private async openPersonalApplicationDetail(id: string): Promise<BrowserPersonalApplicationDetail> {
    const detail = await this.openEmployeeApplicationDetail(id);
    const currentDetail = await this.readCurrentPersonalApplicationActions(id);
    const { availableActions: _managerActions, ...personalDetail } = detail;
    return { ...personalDetail, ...currentDetail };
  }

  private async readCurrentPersonalApplicationDetailSnapshot(): Promise<
    Omit<BrowserPersonalApplicationDetail, "application"> & { applicationId: string }
  > {
    const back = this.page.getByText("一覧に戻る", { exact: true });
    if (await back.count() !== 1 || !await back.isVisible()) {
      throw new CliError(
        "BROWSER_APPROVAL_DETAIL_UNEXPECTED",
        "freee did not expose one unambiguous personal application detail after submission.",
        { exitCode: 2 },
      );
    }
    const applicationNumber = this.page.getByText(/^No\.\s*\d+$/, { exact: true });
    if (await applicationNumber.count() !== 1 || !await applicationNumber.isVisible()) {
      throw new CliError(
        "BROWSER_APPROVAL_DETAIL_UNEXPECTED",
        "freee did not expose one unambiguous application No. after submission.",
        { exitCode: 2 },
      );
    }
    const applicationId = /^No\.\s*(\d+)$/.exec((await applicationNumber.innerText()).trim())?.[1];
    if (applicationId === undefined) {
      throw new CliError(
        "BROWSER_APPROVAL_DETAIL_UNEXPECTED",
        "freee exposed an invalid application No. after submission.",
        { exitCode: 2 },
      );
    }
    return {
      applicationId,
      ...await this.readApprovalDetailSnapshot(),
      ...await this.readCurrentPersonalApplicationActions(),
    };
  }

  private async readCurrentPersonalApplicationActions(
    id?: string,
  ): Promise<Pick<BrowserPersonalApplicationDetail, "availableActions">> {
    const withdraw = this.page.getByRole("button", { name: "申請を取り下げる", exact: true });
    if (await withdraw.count() > 1) {
      throw new CliError(
        "BROWSER_PAGE_AMBIGUOUS",
        "freee rendered more than one 申請を取り下げる action.",
        { details: id === undefined ? undefined : { id }, exitCode: 2 },
      );
    }
    const availableActions: Array<"withdraw"> = [];
    if (await withdraw.count() === 1 && await withdraw.isVisible() && await withdraw.isEnabled()) {
      availableActions.push("withdraw");
    }
    return { availableActions };
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
    const approvalTab = this.page.getByRole("tab", { name: "承認", exact: true });
    if (await approvalTab.count() !== 1 || !await approvalTab.isVisible()) {
      throw new CliError(
        "BROWSER_APPROVAL_PAGE_UNEXPECTED",
        "The freee application page did not expose one unique visible approval tab.",
        { details: await this.getApprovalPageDiagnostics(), exitCode: 2 },
      );
    }
    if (await approvalTab.getAttribute("aria-selected") !== "true") {
      await approvalTab.click();
      await this.page.waitForTimeout(500);
    }
    if (await approvalTab.getAttribute("aria-selected") !== "true") {
      throw new CliError(
        "BROWSER_APPROVAL_PAGE_UNEXPECTED",
        "freee did not select the approval workflow tab.",
        { details: await this.getApprovalPageDiagnostics(), exitCode: 2 },
      );
    }
  }

  private async selectApprovalFilter(
    status: BrowserApprovalListStatus,
  ): Promise<BrowserApprovalPageInfo> {
    const label = approvalFilterLabels[status];
    const button = this.page.getByRole("button", { name: label, exact: true });
    if (await button.count() !== 1 || !await button.isVisible()) {
      throw new CliError(
        "BROWSER_APPROVAL_PAGE_UNEXPECTED",
        `The freee approval filter '${label}' was not one unique visible button.`,
        { details: await this.getApprovalPageDiagnostics(), exitCode: 2 },
      );
    }
    const pageInfo = await this.loadApprovalPage(status, 1, () => button.click());
    if (await button.getAttribute("aria-pressed") !== "true") {
      throw new CliError(
        "BROWSER_APPROVAL_PAGE_UNEXPECTED",
        `freee did not select the approval filter '${label}'.`,
        { details: await this.getApprovalPageDiagnostics(), exitCode: 2 },
      );
    }
    return pageInfo;
  }

  private async selectApprovalPage(
    status: BrowserApprovalListStatus,
    page: number,
    initial: BrowserApprovalPageInfo,
  ): Promise<BrowserApprovalPageInfo> {
    if (page === initial.page) {
      return initial;
    }
    if (page < initial.page || page > initial.pageCount) {
      throw new CliError(
        "INVALID_APPROVAL_PAGE",
        `Approval page ${page} is outside the available ${initial.pageCount} pages.`,
        { details: { page, pageCount: initial.pageCount }, exitCode: 2 },
      );
    }
    let current = initial;
    for (let nextPage = initial.page + 1; nextPage <= page; nextPage += 1) {
      const button = this.page.getByRole("button", { name: `ページ ${nextPage}`, exact: true });
      if (await button.count() !== 1 || !await button.isVisible() || !await button.isEnabled()) {
        throw new CliError(
          "BROWSER_APPROVAL_PAGE_UNEXPECTED",
          `The freee approval page control for page ${nextPage} was not uniquely available.`,
          { details: await this.getApprovalPageDiagnostics(), exitCode: 2 },
        );
      }
      current = await this.loadApprovalPage(status, nextPage, () => button.click());
      if (await button.getAttribute("aria-current") !== "true") {
        throw new CliError(
          "BROWSER_APPROVAL_PAGE_UNEXPECTED",
          `freee did not select approval page ${nextPage}.`,
          { details: await this.getApprovalPageDiagnostics(), exitCode: 2 },
        );
      }
    }
    return current;
  }

  private async loadApprovalPage(
    status: BrowserApprovalListStatus,
    page: number,
    navigate: () => Promise<unknown>,
  ): Promise<BrowserApprovalPageInfo> {
    const responsePromise = this.page.waitForResponse((response) => {
      try {
        const url = new URL(response.url());
        return response.request().method() === "GET"
          && url.protocol === "https:"
          && url.hostname === "p.secure.freee.co.jp"
          && url.pathname === "/api/p/employees/approval_requests/approvals"
          && url.searchParams.get("page") === String(page)
          && url.searchParams.get("q[status_eq]") === approvalApiStatuses[status];
      } catch {
        return false;
      }
    }, { timeout: this.config.navigationTimeoutMs }).catch(() => null);
    let response: Response | null;
    try {
      await navigate();
      response = await responsePromise;
    } catch {
      throw new CliError(
        "BROWSER_APPROVAL_PAGE_UNEXPECTED",
        `freee did not finish loading approval page ${page} for '${approvalFilterLabels[status]}'.`,
        { details: await this.getApprovalPageDiagnostics(), exitCode: 2 },
      );
    }
    if (!response) {
      throw new CliError(
        "BROWSER_APPROVAL_PAGE_UNEXPECTED",
        `freee did not return approval page ${page} for '${approvalFilterLabels[status]}'.`,
        { details: await this.getApprovalPageDiagnostics(), exitCode: 2 },
      );
    }
    if (!response.ok()) {
      throw new CliError(
        "BROWSER_APPROVAL_PAGE_UNEXPECTED",
        `freee returned HTTP ${response.status()} while loading the approval list.`,
        { exitCode: 2 },
      );
    }
    let pageInfo: BrowserApprovalPageInfo;
    try {
      pageInfo = parseApprovalPageInfo(await response.json());
    } catch (error) {
      if (error instanceof CliError) {
        throw error;
      }
      throw new CliError(
        "BROWSER_APPROVAL_PAGE_UNEXPECTED",
        "The freee approval list response was not valid JSON.",
        { exitCode: 2 },
      );
    }
    if (pageInfo.page !== page) {
      throw new CliError(
        "BROWSER_APPROVAL_PAGE_UNEXPECTED",
        `freee returned approval page ${pageInfo.page} while page ${page} was requested.`,
        { exitCode: 2 },
      );
    }
    try {
      await this.waitForApprovalRows(pageInfo.requestCodes);
    } catch {
      throw new CliError(
        "BROWSER_APPROVAL_PAGE_UNEXPECTED",
        "The freee approval table did not finish rendering the loaded response.",
        { details: await this.getApprovalPageDiagnostics(), exitCode: 2 },
      );
    }
    return pageInfo;
  }

  private async waitForApprovalRows(expectedRequestCodes: string[]): Promise<void> {
    await this.page.waitForFunction((expectedCodes) => {
      const table = document.querySelector("table");
      if (!table || !table.querySelector("thead th")) {
        return false;
      }
      const rows = Array.from(table.querySelectorAll<HTMLTableRowElement>("tbody tr"))
        .filter((row) => row.getClientRects().length > 0);
      if (rows.length !== expectedCodes.length) {
        return false;
      }
      const expected = new Set(expectedCodes);
      const actual = rows.map((row) => {
        const matches = Array.from(row.querySelectorAll<HTMLElement>("th, td"))
          .map((cell) => cell.innerText.trim())
          .filter((value) => expected.has(value));
        return matches.length === 1 ? matches[0] : null;
      });
      return actual.every((value, index) => value === expectedCodes[index]);
    }, expectedRequestCodes, { timeout: this.config.navigationTimeoutMs });
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
        .map((cell) => cell.innerText.trim().replace(/\s+/g, " "));
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

  private async findAndOpenApproval(
    id: string,
    status: BrowserApprovalListStatus,
    initial: BrowserApprovalPageInfo,
  ): Promise<BrowserApprovalSummary> {
    const lastPage = Math.max(1, initial.pageCount);
    let current = initial;
    for (let page = 1; page <= lastPage; page += 1) {
      if (page > 1) {
        current = await this.selectApprovalPage(status, page, current);
      }
      const snapshot = await this.readApprovalListSnapshot();
      const parsed = parseApprovalListSnapshot(snapshot);
      const summary = parsed.applications.find((application) => application.id === id);
      if (summary) {
        await this.openApprovalRow(id, snapshot);
        return summary;
      }
    }
    throw new CliError(
      "APPROVAL_NOT_FOUND",
      "The requested application No. was not found after reading every freee approval page.",
      { details: { id, pageCount: initial.pageCount }, exitCode: 2 },
    );
  }

  private async openApprovalRow(
    id: string,
    snapshot: { headers: string[]; rows: string[][] },
  ): Promise<void> {
    const idColumnIndex = snapshot.headers.indexOf("No.");
    if (idColumnIndex < 0) {
      throw new CliError(
        "BROWSER_APPROVAL_PAGE_UNEXPECTED",
        "The freee approval list did not expose its application number column.",
        { details: await this.getApprovalPageDiagnostics(), exitCode: 2 },
      );
    }
    const rowOffset = getApprovalRowOffset(snapshot.headers, snapshot.rows[0]!);
    const rows = this.page.locator("table tbody tr.vb-tableListRow--clickable");
    const matches: Locator[] = [];
    for (let index = 0; index < await rows.count(); index += 1) {
      const row = rows.nth(index);
      if ((await row.locator("th, td").nth(idColumnIndex + rowOffset).innerText()).trim() === id) {
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
    const back = this.page.getByText("一覧に戻る", { exact: true });
    await back.waitFor({ state: "visible", timeout: this.config.navigationTimeoutMs })
      .catch(() => undefined);
    if (await back.count() !== 1 || !await back.isVisible()) {
      throw new CliError(
        "BROWSER_APPROVAL_DETAIL_UNEXPECTED",
        "freee did not open one unambiguous application detail view.",
        { details: { id, page: safePageLocation(this.page.url()) }, exitCode: 2 },
      );
    }
    await this.page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
    await this.page.waitForTimeout(250);
  }

  private async readApprovalDetailSnapshot(): Promise<
    Pick<BrowserApprovalDetail, "fields" | "tables" | "detailLines">
  > {
    this.assertOfficialPage();
    return this.page.evaluate(() => {
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
  }

  private async readApprovalDetail(summary: BrowserApprovalSummary): Promise<BrowserApprovalDetail> {
    const snapshot = await this.readApprovalDetailSnapshot();
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

async function prepareDiagnosticDirectory(diagnosticDirectory: string): Promise<void> {
  try {
    await mkdir(diagnosticDirectory, { recursive: true, mode: 0o700 });
    await chmod(diagnosticDirectory, 0o700);
  } catch {
    throw new CliError(
      "BROWSER_DIAGNOSTIC_DIRECTORY_UNAVAILABLE",
      "The private Playwright diagnostic screenshot directory could not be prepared.",
      { exitCode: 2 },
    );
  }
}

function assertPrivatePathOutsideRepository(
  privatePath: string,
  cwd: string,
  settingName: string,
  errorCode: string,
): void {
  const pathFromRepository = relative(resolve(cwd), privatePath);
  if (pathFromRepository === "" || (!pathFromRepository.startsWith("..") && !isAbsolute(pathFromRepository))) {
    throw new CliError(
      errorCode,
      `${settingName} must be outside the repository.`,
      { exitCode: 2 },
    );
  }
}

function assertDiagnosticPathIsNotBroad(diagnosticDirectory: string): void {
  const broadPaths = new Set([
    resolve("/"),
    resolve(homedir()),
    resolve(tmpdir()),
    resolve("/tmp"),
    resolve("/var/tmp"),
  ]);
  if (broadPaths.has(resolve(diagnosticDirectory))) {
    throw new CliError(
      "BROWSER_DIAGNOSTIC_PATH_UNSAFE",
      "FREEE_BROWSER_DIAGNOSTIC_DIR must be a dedicated subdirectory, not a filesystem root, home directory, or shared temporary root.",
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
