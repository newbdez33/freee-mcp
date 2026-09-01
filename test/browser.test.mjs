import assert from "node:assert/strict";
import test from "node:test";

import {
  FreeeBrowserClient,
  isAllowedFreeePageUrl,
  normalizeHeadlessChromeUserAgent,
  readPlaywrightRuntimeConfig,
} from "../dist/browser.js";
import { createApprovalFingerprint } from "../dist/browser-approvals.js";
import { normalizePersonalApplicationCreateInput } from "../dist/browser-personal-applications.js";
import { CliError } from "../dist/errors.js";

const labelsBySelector = new Map([
  ['[data-testid="出勤"]', "in"],
  ['[data-testid="休憩開始"]', "break-start"],
  ['[data-testid="休憩終了"]', "break-end"],
  ['[data-testid="退勤"]', "out"],
]);

function createFakeBrowser(availableActions) {
  const state = {
    available: new Set(availableActions),
    clicks: [],
    url: "https://p.secure.freee.co.jp/",
  };
  const page = {
    async goto(url) { state.url = url; },
    url() { return state.url; },
    locator(selector) {
      const action = labelsBySelector.get(selector);
      return {
        async count() { return action && state.available.has(action) ? 1 : 0; },
        async isVisible() { return action !== undefined && state.available.has(action); },
        async isEnabled() { return action !== undefined && state.available.has(action); },
        async click() {
          state.clicks.push(action);
          state.available.delete(action);
        },
      };
    },
    getByRole(_role, options) {
      const action = [...labelsBySelector.entries()]
        .find(([selector]) => selector.includes(options.name))?.[1];
      return {
        async count() { return action && state.available.has(action) ? 1 : 0; },
        async isVisible() { return action !== undefined && state.available.has(action); },
        async isEnabled() { return action !== undefined && state.available.has(action); },
        async click() {
          state.clicks.push(action);
          state.available.delete(action);
        },
      };
    },
    frames() { return []; },
    async waitForLoadState() {},
    async waitForTimeout() {},
  };
  const context = { async close() {} };
  const credentials = {
    async getCredentials() {
      throw new Error("credentials must not be read for an authenticated profile");
    },
  };
  const config = {
    headless: true,
    channel: "chrome",
    profileDirectory: "/tmp/freee-agent-browser-test",
    credentialService: "freee-agent-web-test",
    navigationTimeoutMs: 1_000,
    interactionTimeoutMs: 1_000,
  };
  return {
    state,
    client: new FreeeBrowserClient(context, page, credentials, config),
  };
}

const approvalListHeaders = [
  "ステータス",
  "No.",
  "申請者（代理申請者）",
  "種別",
  "対象日",
  "申請内容",
  "申請理由",
  "申請日",
  "現在の承認者",
  "チェック結果",
];

function approvalSummary(overrides = {}) {
  return {
    id: "7200",
    status: "未承認",
    applicant: "Applicant A",
    type: "休暇",
    targetDate: "2026/08/20",
    content: "有休 全休",
    reason: "Personal",
    appliedAt: "2026/08/19",
    currentApprover: "Approver A",
    checkResult: null,
    ...overrides,
  };
}

function approvalDetail(applicationOverrides = {}, detailOverrides = {}) {
  return {
    application: approvalSummary(applicationOverrides),
    fields: [],
    tables: [],
    detailLines: ["Application detail"],
    workTimeChange: null,
    availableActions: ["approve", "return"],
    ...detailOverrides,
  };
}

function installPendingApprovalPages(client, pages) {
  const pageReads = [];
  const totalCount = pages.reduce((count, page) => count + page.length, 0);
  let currentPage = 1;
  const pageInfo = (page) => ({
    page,
    pageCount: pages.length,
    totalCount,
    perPage: 1,
    rowCount: pages[page - 1].length,
    requestCodes: pages[page - 1].map(({ id }) => id),
  });
  client.ensureAuthenticated = async () => {};
  client.openApprovals = async () => {};
  client.selectApprovalFilter = async (status) => {
    assert.equal(status, "pending");
    currentPage = 1;
    return pageInfo(1);
  };
  client.selectApprovalPage = async (status, page, current) => {
    assert.equal(status, "pending");
    assert.equal(page, current.page + 1);
    currentPage = page;
    return pageInfo(page);
  };
  client.readApprovalListSnapshot = async () => {
    pageReads.push(currentPage);
    return {
      headers: approvalListHeaders,
      rows: pages[currentPage - 1].map((application) => [
        application.status,
        application.id,
        application.applicant ?? "-",
        application.type,
        application.targetDate ?? "-",
        application.content ?? "-",
        application.reason ?? "-",
        application.appliedAt ?? "-",
        application.currentApprover ?? "-",
        application.checkResult ?? "-",
      ]),
      pageCount: pages.length,
    };
  };
  return { pageReads };
}

function createFakeApprovalBrowser() {
  const state = {
    approvalTabSelected: false,
    filter: null,
    page: 1,
    rendered: false,
    responseWaiter: null,
    clicks: [],
    url: "https://p.secure.freee.co.jp/approval_requests",
  };
  const page = {
    url() { return state.url; },
    getByRole(role, options) {
      if (role === "tab" && options.name === "承認") {
        return {
          async count() { return 1; },
          async isVisible() { return true; },
          async getAttribute(name) {
            return name === "aria-selected" && state.approvalTabSelected ? "true" : "false";
          },
          async click() {
            state.approvalTabSelected = true;
            state.clicks.push("approval-tab");
          },
        };
      }
      if (role === "button" && ["未承認", "差戻し", "承認済", "全て"].includes(options.name)) {
        return {
          async count() { return 1; },
          async isVisible() { return true; },
          async getAttribute(name) {
            return name === "aria-pressed" && state.filter === options.name ? "true" : "false";
          },
          async click() {
            state.filter = options.name;
            state.page = 1;
            state.rendered = false;
            state.clicks.push(`filter:${options.name}`);
            state.responseWaiter?.(createApprovalResponse(options.name, 1));
          },
        };
      }
      const pageMatch = role === "button" ? /^ページ (\d+)$/.exec(options.name) : null;
      if (pageMatch) {
        const page = Number(pageMatch[1]);
        return {
          async count() { return page === 2 ? 1 : 0; },
          async isVisible() { return page === 2; },
          async isEnabled() { return page === 2; },
          async getAttribute(name) {
            return name === "aria-current" && state.page === page ? "true" : "false";
          },
          async click() {
            state.page = page;
            state.rendered = false;
            state.clicks.push(`page:${page}`);
            state.responseWaiter?.(createApprovalResponse(state.filter, page));
          },
        };
      }
      throw new Error(`unexpected role locator: ${role} ${options.name}`);
    },
    async evaluate() {
      return {
        headers: [
          "ステータス",
          "No.",
          "申請者（代理申請者）",
          "種別",
          "対象日",
          "申請内容",
          "申請理由",
          "申請日",
          "現在の承認者",
          "チェック結果",
        ],
        rows: state.rendered ? [[
          "",
          "未承認",
          "9876",
          "申請者 A",
          "休暇",
          "2026/08/14",
          "有休 全休",
          "私用",
          "2026/08/13",
          "承認者 B",
          "問題なし",
          "",
        ]] : [],
        pageCount: 1,
      };
    },
    waitForResponse(predicate) {
      return new Promise((resolve, reject) => {
        state.responseWaiter = (response) => {
          state.responseWaiter = null;
          if (!predicate(response)) {
            reject(new Error("approval response predicate did not match"));
            return;
          }
          resolve(response);
        };
      });
    },
    async waitForFunction(_predicate, expectedRequestCodes) {
      assert.deepEqual(expectedRequestCodes, ["9876"]);
      state.rendered = true;
    },
    async waitForLoadState() {},
    async waitForTimeout() {},
  };
  const context = { async close() {} };
  const credentials = {
    async getCredentials() {
      throw new Error("credentials must not be read for an authenticated profile");
    },
  };
  const config = {
    headless: true,
    channel: "chrome",
    profileDirectory: "/tmp/freee-agent-approval-browser-test",
    credentialService: "freee-agent-web-test",
    navigationTimeoutMs: 1_000,
    interactionTimeoutMs: 1_000,
  };
  const client = new FreeeBrowserClient(context, page, credentials, config);
  client.ensureAuthenticated = async () => {};
  return { client, state };
}

function createApprovalResponse(label, page) {
  const status = {
    "未承認": "in_progress",
    "差戻し": "feedback",
    "承認済": "approved",
    "全て": "all",
  }[label];
  return {
    url() {
      return `https://p.secure.freee.co.jp/api/p/employees/approval_requests/approvals?page=${page}&q%5Bstatus_eq%5D=${status}`;
    },
    request() { return { method() { return "GET"; } }; },
    ok() { return true; },
    status() { return 200; },
    async json() {
      return {
        approval_requests: [{ request_code: 9876 }],
        meta: { current_page: page, total_pages: 2, total_count: 2, per: 1 },
      };
    },
  };
}

function createFakePersonalApplicationBrowser() {
  const state = {
    selected: false,
    filter: null,
    rendered: false,
    waiter: null,
    url: "https://p.secure.freee.co.jp/approval_requests",
  };
  const page = {
    url() { return state.url; },
    getByRole(role, options) {
      if (role === "tab" && options.name === "申請") {
        return {
          async count() { return 1; },
          async isVisible() { return true; },
          async getAttribute(name) { return name === "aria-selected" && state.selected ? "true" : "false"; },
          async click() { state.selected = true; },
        };
      }
      if (role === "button" && ["申請中", "差戻し", "承認済", "全て"].includes(options.name)) {
        return {
          async count() { return 1; },
          async isVisible() { return true; },
          async getAttribute(name) { return name === "aria-pressed" && state.filter === options.name ? "true" : "false"; },
          async click() {
            state.filter = options.name;
            state.rendered = false;
            state.waiter?.(createPersonalApplicationResponse(options.name));
          },
        };
      }
      throw new Error(`unexpected role locator: ${role} ${options.name}`);
    },
    waitForResponse(predicate) {
      return new Promise((resolve, reject) => {
        state.waiter = (response) => {
          state.waiter = null;
          predicate(response) ? resolve(response) : reject(new Error("request predicate mismatch"));
        };
      });
    },
    async waitForFunction(_predicate, expected) {
      assert.deepEqual(expected, ["2468"]);
      state.rendered = true;
    },
    async evaluate() {
      return {
        headers: [
          "ステータス", "No.", "種別", "対象日", "申請内容", "申請理由", "申請日",
          "現在の承認者", "チェック結果",
        ],
        rows: state.rendered ? [[
          "差戻し", "2468", "休暇", "2026/08/14", "有休", "私用", "2026/08/13", "承認者", "-",
        ]] : [],
        pageCount: 1,
      };
    },
    async waitForTimeout() {},
  };
  const client = new FreeeBrowserClient(
    { async close() {} },
    page,
    { async getCredentials() { throw new Error("credentials must not be read"); } },
    {
      headless: true,
      channel: "chrome",
      profileDirectory: "/tmp/freee-agent-personal-browser-test",
      credentialService: "freee-agent-web-test",
      navigationTimeoutMs: 1_000,
      interactionTimeoutMs: 1_000,
    },
  );
  client.ensureAuthenticated = async () => {};
  return { client, state };
}

function createPersonalApplicationResponse(label) {
  const status = {
    "申請中": "in_progress",
    "差戻し": "draft_and_feedback",
    "承認済": "approved",
    "全て": "all",
  }[label];
  return {
    url() {
      return `https://p.secure.freee.co.jp/api/p/employees/approval_requests/requests?page=1&q%5Bstatus_eq%5D=${status}`;
    },
    request() { return { method() { return "GET"; } }; },
    ok() { return true; },
    async json() {
      return {
        approval_requests: [{ request_code: 2468 }],
        meta: { current_page: 1, total_pages: 1, total_count: 1, per: 50 },
      };
    },
  };
}

test("browser main-frame allowlist accepts only the three official HTTPS hosts", () => {
  assert.equal(isAllowedFreeePageUrl("https://p.secure.freee.co.jp/"), true);
  assert.equal(isAllowedFreeePageUrl("https://accounts.secure.freee.co.jp/sessions/new"), true);
  assert.equal(isAllowedFreeePageUrl("https://ep.secure.freee.co.jp/"), true);
  assert.equal(isAllowedFreeePageUrl("http://p.secure.freee.co.jp/"), false);
  assert.equal(isAllowedFreeePageUrl("https://p.secure.freee.co.jp.example.com/"), false);
  assert.equal(isAllowedFreeePageUrl("https://secure.freee.co.jp/"), false);
});

test("headless Chrome user agent is normalized without pinning a browser version", () => {
  assert.equal(
    normalizeHeadlessChromeUserAgent(
      "Mozilla/5.0 AppleWebKit/537.36 HeadlessChrome/151.0.0.0 Safari/537.36",
    ),
    "Mozilla/5.0 AppleWebKit/537.36 Chrome/151.0.0.0 Safari/537.36",
  );
  assert.equal(
    normalizeHeadlessChromeUserAgent(
      "Mozilla/5.0 AppleWebKit/537.36 Chrome/151.0.0.0 Safari/537.36",
    ),
    "Mozilla/5.0 AppleWebKit/537.36 Chrome/151.0.0.0 Safari/537.36",
  );
});

test("browser profile must remain outside the repository", () => {
  assert.throws(
    () => readPlaywrightRuntimeConfig(
      { FREEE_BROWSER_PROFILE_DIR: "/workspace/project/browser-profile" },
      "/workspace/project",
    ),
    (error) => error.code === "BROWSER_PROFILE_UNSAFE",
  );
  assert.equal(
    readPlaywrightRuntimeConfig(
      { FREEE_BROWSER_PROFILE_DIR: "/tmp/freee-profile", FREEE_BROWSER_HEADLESS: "false" },
      "/workspace/project",
    ).headless,
    false,
  );
});

test("browser diagnostic screenshots are opt-in and must remain outside the repository", () => {
  assert.equal(
    readPlaywrightRuntimeConfig(
      { FREEE_BROWSER_PROFILE_DIR: "/tmp/freee-profile" },
      "/workspace/project",
    ).diagnosticDirectory,
    undefined,
  );
  assert.throws(
    () => readPlaywrightRuntimeConfig(
      {
        FREEE_BROWSER_PROFILE_DIR: "/tmp/freee-profile",
        FREEE_BROWSER_DIAGNOSTIC_DIR: "/workspace/project/diagnostics",
      },
      "/workspace/project",
    ),
    (error) => error.code === "BROWSER_DIAGNOSTIC_PATH_UNSAFE",
  );
  assert.throws(
    () => readPlaywrightRuntimeConfig(
      {
        FREEE_BROWSER_PROFILE_DIR: "/tmp/freee-profile",
        FREEE_BROWSER_DIAGNOSTIC_DIR: "/tmp",
      },
      "/workspace/project",
    ),
    (error) => error.code === "BROWSER_DIAGNOSTIC_PATH_UNSAFE",
  );
  assert.equal(
    readPlaywrightRuntimeConfig(
      {
        FREEE_BROWSER_PROFILE_DIR: "/tmp/freee-profile",
        FREEE_BROWSER_DIAGNOSTIC_DIR: "/tmp/freee-diagnostics",
      },
      "/workspace/project",
    ).diagnosticDirectory,
    "/tmp/freee-diagnostics",
  );
});

test("Playwright clock action never clicks without the confirm assertion", async () => {
  const { client, state } = createFakeBrowser(["in"]);

  await assert.rejects(
    client.performClockAction("in", false),
    (error) => error.code === "CONFIRMATION_REQUIRED",
  );
  assert.deepEqual(state.clicks, []);
});

test("confirmed Playwright clock action clicks once and verifies changed state", async () => {
  const { client, state } = createFakeBrowser(["in", "break-start"]);

  const result = await client.performClockAction("in", true);
  assert.deepEqual(state.clicks, ["in"]);
  assert.equal(result.verified, true);
  assert.deepEqual(result.status.availableActions, ["break-start"]);
});

test("Playwright approval list selects the manager queue before its pending filter", async () => {
  const { client, state } = createFakeApprovalBrowser();

  const result = await client.getApprovals("pending");

  assert.deepEqual(state.clicks, ["approval-tab", "filter:未承認"]);
  assert.equal(result.page, 1);
  assert.equal(result.pageCount, 2);
  assert.equal(result.totalCount, 2);
  assert.equal(result.applicationCount, 1);
  assert.equal(result.applications[0].applicant, "申請者 A");
  assert.equal(result.applications[0].type, "休暇");
});

test("Playwright approval list navigates to one explicit later page", async () => {
  const { client, state } = createFakeApprovalBrowser();

  const result = await client.getApprovals("approved", 2);

  assert.deepEqual(state.clicks, ["approval-tab", "filter:承認済", "page:2"]);
  assert.equal(result.page, 2);
  assert.equal(result.pageCount, 2);
  assert.equal(result.applicationCount, 1);
});

test("Playwright monthly approval list exposes only monthly closing applications", async () => {
  const { client } = createFakeBrowser([]);
  client.getApprovals = async () => ({
    filter: "pending",
    page: 1,
    pageCount: 2,
    totalCount: 3,
    applicationCount: 3,
    applications: [
      approvalSummary({ id: "100", type: "休暇" }),
      approvalSummary({
        id: "101",
        type: "月次勤怠締め",
        targetDate: "2026/09/01",
        content: "2026年09月の支払分",
      }),
      approvalSummary({ id: "102", type: "勤務時間修正" }),
    ],
  });
  client.openAttendanceMonitor = async () => {};
  client.readAttendancePeriodContext = async () => ({
    paymentPeriod: "2026-09",
    workPeriod: "2026-08",
  });
  const selectedPeriods = [];
  client.selectAttendanceWorkPeriod = async (period) => {
    selectedPeriods.push(period);
  };

  const result = await client.getMonthlyApprovals("pending", 1);

  assert.equal(result.sourceTotalCount, 3);
  assert.equal(result.applicationCount, 1);
  assert.equal(result.applications[0].id, "101");
  assert.equal(result.applications[0].paymentPeriod, "2026-09");
  assert.equal(result.applications[0].period, "2026-08");
  assert.deepEqual(selectedPeriods, ["2026-08"]);
});

test("Playwright monthly approval review binds detail, member summary, daily attendance, and checks", async () => {
  const { client } = createFakeBrowser([]);
  const detail = {
    application: {
      id: "101",
      status: "未承認",
      applicant: "Member A",
      type: "月次勤怠締め",
      targetDate: "2026/09/01",
      content: "2026年09月の支払分",
      reason: null,
      appliedAt: "2026/09/01",
      currentApprover: "Manager B",
      checkResult: "要確認",
    },
    fields: [{ label: "部門", value: "Engineering" }],
    tables: [],
    detailLines: ["チェック結果: 要確認"],
    availableActions: ["approve", "return"],
  };
  const member = {
    name: "Member A",
    department: "Engineering",
    issues: {},
    work: {
      workDays: "20日",
      total: "170:31",
      scheduled: "160:00",
    },
    hasIssue: true,
  };
  client.getApprovalDetail = async () => detail;
  client.openAttendanceMonitor = async () => {};
  client.readAttendancePeriodContext = async () => ({
    paymentPeriod: "2026-09",
    workPeriod: "2026-08",
  });
  const selectedPeriods = [];
  client.selectAttendanceWorkPeriod = async (period) => {
    selectedPeriods.push(period);
  };
  client.readTeamStatus = async (options) => {
    assert.deepEqual(options, { date: "2026-08-01" });
    return { period: "2026年8月", memberCount: 1, issueMemberCount: 1, members: [member] };
  };
  client.openMonthlyApplicantAttendance = async (actualDetail, actualMember) => {
    assert.equal(actualDetail.application.id, "101");
    assert.equal(actualMember.name, "Member A");
  };
  client.selectAttendanceTableView = async () => {};
  client.readMonthlyAttendanceTableSnapshot = async () => ({
    selectedPeriod: "2026年8月",
    warnings: ["申請または修正が必要な勤怠が1日あります。"],
    tables: [{
      headers: ["日付", "出勤", "退勤", "アラート"],
      rows: [["8/01", "09:00", "18:00", "確認が必要です"]],
    }],
  });

  const result = await client.getMonthlyApprovalReview("101");

  assert.equal(result.period, "2026-08");
  assert.equal(result.paymentPeriod, "2026-09");
  assert.equal(result.attendanceSummary.work.workDays, "20日");
  assert.equal(result.attendanceSummary.work.total, "170:31");
  assert.equal(result.attendance.dayCount, 1);
  assert.equal(result.attendance.alertDayCount, 1);
  assert.ok(result.automaticChecks.some((check) => check.includes("確認が必要です")));
  assert.deepEqual(selectedPeriods, ["2026-08", "2026-08"]);
});

test("Playwright monthly approval review fails closed when freee does not expose one month mapping", async () => {
  const { client } = createFakeBrowser([]);
  client.getApprovalDetail = async () => approvalDetail({
    id: "101",
    type: "月次勤怠締め",
    targetDate: "2026/09/01",
    content: "2026年09月の支払分",
  });
  client.openAttendanceMonitor = async () => {};
  client.readAttendancePeriodContext = async () => {
    throw new CliError(
      "ATTENDANCE_PERIOD_NAVIGATION_UNEXPECTED",
      "Synthetic ambiguous payment/work period fixture.",
      { exitCode: 2 },
    );
  };
  client.readTeamStatus = async () => {
    throw new Error("attendance data must not be read after an ambiguous month mapping");
  };

  await assert.rejects(
    client.getMonthlyApprovalReview("101"),
    (error) => error.code === "MONTHLY_APPROVAL_PERIOD_MAPPING_UNCONFIRMED",
  );
});

test("Playwright monthly approval review follows an employee attendance link into a new tab", async () => {
  const state = {
    url: "https://p.secure.freee.co.jp/attendance_monitor",
    opened: false,
    pageWaiter: null,
  };
  const attendancePage = {
    url() { return "https://p.secure.freee.co.jp/attendances"; },
    setDefaultTimeout() {},
    setDefaultNavigationTimeout() {},
    async waitForLoadState() {},
  };
  const link = {
    async getAttribute(name) {
      if (name === "href") return "/attendances";
      if (name === "target") return "_blank";
      return null;
    },
    async isVisible() { return true; },
    async click() {
      state.opened = true;
      state.pageWaiter?.(attendancePage);
    },
  };
  const row = {
    async isVisible() { return true; },
    locator(selector) {
      if (selector === "th, td") {
        return { async allInnerTexts() { return ["Member A", "Engineering"]; } };
      }
      if (selector === "a[href]") {
        return { async count() { return 1; }, nth() { return link; } };
      }
      throw new Error(`unexpected row selector: ${selector}`);
    },
  };
  const monitorPage = {
    url() { return state.url; },
    locator(selector) {
      assert.equal(selector, "table tbody tr");
      return { async count() { return 1; }, nth() { return row; } };
    },
  };
  const context = {
    waitForEvent(event) {
      assert.equal(event, "page");
      return new Promise((resolve) => { state.pageWaiter = resolve; });
    },
  };
  const config = {
    headless: true,
    channel: "chrome",
    profileDirectory: "/tmp/freee-agent-browser-test",
    credentialService: "freee-agent-web-test",
    navigationTimeoutMs: 1_000,
    interactionTimeoutMs: 1_000,
  };
  const client = new FreeeBrowserClient(context, monitorPage, {}, config);
  client.settleAttendancePage = async () => {};

  await client.openMonthlyApplicantAttendance({
    application: { id: "101" },
  }, {
    name: "Member A",
    department: "Engineering",
  });

  assert.equal(state.opened, true);
  assert.equal(client.page, attendancePage);
});

test("Playwright monthly approval review selects the current table-view control", async () => {
  const { client } = createFakeBrowser([]);
  let clicked = false;
  client.page.locator = (selector) => {
    assert.match(selector, /\[data-testid="テーブル"\]/);
    return {
      async count() { return 1; },
      nth() {
        return {
          async isVisible() { return true; },
          async click() { clicked = true; },
        };
      },
    };
  };

  await client.selectAttendanceTableView();

  assert.equal(clicked, true);
});

test("Playwright attendance period navigation selects the derived payment month and verifies the work month", async () => {
  const { client } = createFakeBrowser([]);
  const contexts = [
    { paymentPeriod: "2026-09", workPeriod: "2026-08" },
    { paymentPeriod: "2026-08", workPeriod: "2026-07" },
  ];
  client.readAttendancePeriodContext = async () => contexts.shift() ?? {
    paymentPeriod: "2026-08",
    workPeriod: "2026-07",
  };
  let selectedPaymentPeriod = null;
  client.selectAttendancePaymentPeriod = async (period) => {
    selectedPaymentPeriod = period;
  };
  client.settleAttendancePage = async () => {};

  await client.selectAttendanceWorkPeriod("2026-07");

  assert.equal(selectedPaymentPeriod, "2026-08");
});

test("Playwright attendance period navigation leaves an already selected work month unchanged", async () => {
  const { client } = createFakeBrowser([]);
  client.readAttendancePeriodContext = async () => ({
    paymentPeriod: "2026-09",
    workPeriod: "2026-08",
  });
  client.selectAttendancePaymentPeriod = async () => {
    throw new Error("an already selected month must not be clicked");
  };

  await client.selectAttendanceWorkPeriod("2026-08");
});

test("Playwright personal monthly status navigates to an explicitly requested work month", async () => {
  const { client } = createFakeBrowser([]);
  const selectedPeriods = [];
  client.ensureAuthenticated = async () => {};
  client.openAttendanceCalendar = async () => {};
  client.selectAttendanceWorkPeriod = async (period) => {
    selectedPeriods.push(period);
  };
  client.captureDiagnosticScreenshot = async () => {};
  client.readMonthlyCalendarSnapshot = async () => ({
    periodLabels: ["2026年8月25日払い （2026年7月1日 〜 2026年7月31日 勤務分）"],
    statusLabels: ["未申請"],
    warnings: [],
    createActionCount: 1,
  });

  const status = await client.getMonthlyStatus("2026-07");

  assert.deepEqual(selectedPeriods, ["2026-07"]);
  assert.equal(status.period, "2026-07");
  assert.equal(status.state, "unsubmitted");
});

test("Playwright attendance period navigation stops when freee does not show the target work month", async () => {
  const { client } = createFakeBrowser([]);
  client.readAttendancePeriodContext = async () => ({
    paymentPeriod: "2026-09",
    workPeriod: "2026-08",
  });
  client.selectAttendancePaymentPeriod = async () => {};

  await assert.rejects(
    client.selectAttendanceWorkPeriod("2026-07"),
    (error) => error.code === "ATTENDANCE_PERIOD_NAVIGATION_FAILED",
  );
});

test("Playwright monthly approval commit stops before page access without confirmation or with a stale review", async () => {
  const { client, state } = createFakeBrowser([]);
  let reviewReads = 0;
  const review = {
    application: {
      application: {
        id: "101",
        status: "未承認",
        applicant: "Member A",
        type: "月次勤怠締め",
        targetDate: "2026/08/01",
      },
      fields: [],
      tables: [],
      detailLines: [],
      availableActions: ["approve", "return"],
    },
    paymentPeriod: "2026-09",
    period: "2026-08",
    attendanceSummary: { name: "Member A" },
    attendance: { period: "2026-08", selectedPeriod: "2026年8月", headers: [], dayCount: 0, alertDayCount: 0, warnings: [], days: [] },
    automaticChecks: [],
  };
  client.getMonthlyApprovalReview = async () => {
    reviewReads += 1;
    return review;
  };

  await assert.rejects(
    client.commitMonthlyApprovalAction("101", "approve", "a".repeat(64), false),
    (error) => error.code === "CONFIRMATION_REQUIRED",
  );
  assert.equal(reviewReads, 0);
  await assert.rejects(
    client.commitMonthlyApprovalAction("101", "approve", "a".repeat(64), true),
    (error) => error.code === "MONTHLY_APPROVAL_PREVIEW_CHANGED",
  );
  assert.equal(reviewReads, 1);
  assert.deepEqual(state.clicks, []);
});

test("Playwright monthly approval commit rechecks the payment/work mapping and never clicks when it becomes ambiguous", async () => {
  const { client } = createFakeBrowser([]);
  const detail = approvalDetail({
    id: "101",
    type: "月次勤怠締め",
    targetDate: "2026/09/01",
    content: "2026年09月の支払分",
  });
  const review = {
    application: detail,
    paymentPeriod: "2026-09",
    period: "2026-08",
    attendanceSummary: { name: "Member A" },
    attendance: {
      period: "2026-08",
      selectedPeriod: "2026年8月",
      headers: ["日付", "出勤", "退勤"],
      dayCount: 1,
      alertDayCount: 0,
      warnings: [],
      days: [{ date: "2026-08-01", fields: [], alerts: [] }],
    },
    automaticChecks: [],
  };
  let reviewReads = 0;
  client.getMonthlyApprovalReview = async () => {
    reviewReads += 1;
    if (reviewReads === 1) {
      return review;
    }
    throw new CliError(
      "MONTHLY_APPROVAL_PERIOD_MAPPING_UNCONFIRMED",
      "Synthetic mapping changed after prepare.",
      { exitCode: 2 },
    );
  };
  let commits = 0;
  client.commitOpenApprovalAction = async () => {
    commits += 1;
  };

  const prepared = await client.prepareMonthlyApprovalAction("101", "approve");
  await assert.rejects(
    client.commitMonthlyApprovalAction("101", "approve", prepared.fingerprint, true),
    (error) => error.code === "MONTHLY_APPROVAL_PERIOD_MAPPING_UNCONFIRMED",
  );

  assert.equal(reviewReads, 2);
  assert.equal(commits, 0);
});

test("Playwright monthly approval commit reopens the unchanged application before one action", async () => {
  const { client } = createFakeBrowser([]);
  client.readAllPendingApprovals = async () => {
    throw new Error("monthly approval must not run the leave dependency check");
  };
  const detail = {
    application: {
      id: "101",
      status: "未承認",
      applicant: "Member A",
      type: "月次勤怠締め",
      targetDate: "2026/09/01",
      content: "2026年09月の支払分",
    },
    fields: [],
    tables: [],
    detailLines: [],
    availableActions: ["approve", "return"],
  };
  const review = {
    application: detail,
    paymentPeriod: "2026-09",
    period: "2026-08",
    attendanceSummary: { name: "Member A" },
    attendance: {
      period: "2026-08",
      selectedPeriod: "2026年8月",
      headers: ["日付", "出勤", "退勤"],
      dayCount: 1,
      alertDayCount: 0,
      warnings: [],
      days: [{ date: "2026-08-01", fields: [], alerts: [] }],
    },
    automaticChecks: [],
  };
  client.getMonthlyApprovalReview = async () => review;
  client.getApprovalDetail = async (id) => {
    assert.equal(id, "101");
    return detail;
  };
  let commits = 0;
  client.commitOpenApprovalAction = async (id, action, before) => {
    commits += 1;
    assert.equal(id, "101");
    assert.equal(action, "approve");
    assert.equal(before, detail);
    return { id, action, verified: true, result: { ...detail, application: { ...detail.application, status: "承認済" } } };
  };

  const prepared = await client.prepareMonthlyApprovalAction("101", "approve");
  const result = await client.commitMonthlyApprovalAction(
    "101",
    "approve",
    prepared.fingerprint,
    true,
  );

  assert.equal(commits, 1);
  assert.equal(result.result.application.status, "承認済");
});

test("Playwright approval detail waits for the route to render after a row click", async () => {
  const { client } = createFakeBrowser([]);
  let detailVisible = false;
  let waitedForDetail = false;
  let waitedForNetworkIdle = false;
  const row = {
    locator() {
      return {
        nth() {
          return { async innerText() { return "1234"; } };
        },
      };
    },
    async isVisible() { return true; },
    async click() {},
  };
  client.page.locator = (selector) => {
    assert.equal(selector, "table tbody tr.vb-tableListRow--clickable");
    return {
      async count() { return 1; },
      nth() { return row; },
    };
  };
  client.page.getByText = (text, options) => {
    assert.equal(text, "一覧に戻る");
    assert.equal(options.exact, true);
    return {
      async waitFor(options) {
        assert.equal(options.state, "visible");
        waitedForDetail = true;
        detailVisible = true;
      },
      async count() { return detailVisible ? 1 : 0; },
      async isVisible() { return detailVisible; },
    };
  };
  client.page.waitForLoadState = async (state, options) => {
    assert.equal(state, "networkidle");
    assert.equal(options.timeout, 5_000);
    waitedForNetworkIdle = true;
  };

  await client.openApprovalRow("1234", {
    headers: ["ステータス", "No.", "種別"],
    rows: [["未承認", "1234", "休暇"]],
  });

  assert.equal(waitedForDetail, true);
  assert.equal(waitedForNetworkIdle, true);
});

test("Playwright approval detail fingerprints only a settled async snapshot", async () => {
  const { client } = createFakeBrowser([]);
  const partial = { fields: [], tables: [], detailLines: ["申請内容"] };
  const complete = {
    fields: [],
    tables: [{ headers: ["項目名", "内容"], rows: [["申請経路", "勤怠申請"]] }],
    detailLines: ["申請内容", "自動でチェックしました。特に問題ないように見えます。"],
  };
  const snapshots = [partial, complete, complete];
  let snapshotReads = 0;
  let waits = 0;
  client.readApprovalDetailSnapshot = async () => {
    snapshotReads += 1;
    return snapshots.shift() ?? complete;
  };
  client.page.waitForTimeout = async (milliseconds) => {
    assert.equal(milliseconds, 200);
    waits += 1;
  };
  client.page.getByRole = () => ({
    async count() { return 1; },
    async isVisible() { return true; },
    async isEnabled() { return true; },
  });

  const result = await client.readApprovalDetail({
    id: "10039",
    status: "未承認",
    applicant: "申請者 A",
    type: "休暇取消",
    targetDate: "2026/08/14",
    content: "有休 半休",
    reason: null,
    appliedAt: "2026/08/14",
    currentApprover: "承認者 A",
    checkResult: null,
  });

  assert.deepEqual(result.tables, complete.tables);
  assert.deepEqual(result.detailLines, complete.detailLines);
  assert.equal(result.workTimeChange, null);
  assert.equal(snapshotReads, 3);
  assert.equal(waits, 2);
});

test("Playwright approval detail stops when its async snapshot never settles", async () => {
  const { client } = createFakeBrowser([]);
  let snapshotReads = 0;
  client.readApprovalDetailSnapshot = async () => ({
    fields: [],
    tables: [],
    detailLines: [`render-${snapshotReads += 1}`],
  });

  await assert.rejects(
    client.readStableApprovalDetailSnapshot(),
    (error) => error.code === "BROWSER_APPROVAL_DETAIL_UNEXPECTED",
  );
  assert.equal(snapshotReads, 11);
});

test("Playwright leave approval prepare reads every pending page and reports all same-day correction blockers", async () => {
  const { client, state } = createFakeBrowser([]);
  const leave = approvalDetail({ id: "7200" });
  let detailReads = 0;
  client.getApprovalDetail = async (id) => {
    assert.equal(id, "7200");
    detailReads += 1;
    return leave;
  };
  const firstCorrection = approvalSummary({
    id: "7201",
    type: "勤務時間修正",
    content: "09:30 - 18:30",
  });
  const differentApplicant = approvalSummary({
    id: "7202",
    type: "勤務時間修正",
    applicant: "Applicant B",
  });
  const deletionCorrection = approvalSummary({
    id: "7203",
    type: "勤務時間修正",
    content: "勤務時間を削除",
    appliedAt: "2026/08/20",
    workTimeChange: null,
  });
  const { pageReads } = installPendingApprovalPages(client, [
    [firstCorrection],
    [differentApplicant],
    [deletionCorrection],
  ]);

  await assert.rejects(
    client.prepareApprovalAction("7200", "approve"),
    (error) => {
      assert.equal(error.code, "LEAVE_APPROVAL_BLOCKED_BY_WORK_TIME_CORRECTION");
      assert.match(error.message, /must be processed first/);
      assert.deepEqual(error.details, {
        leaveApplication: {
          id: "7200",
          applicant: "Applicant A",
          targetDate: "2026/08/20",
        },
        blockingWorkTimeCorrections: [
          {
            id: "7201",
            status: "未承認",
            content: "09:30 - 18:30",
            appliedAt: "2026/08/19",
          },
          {
            id: "7203",
            status: "未承認",
            content: "勤務時間を削除",
            appliedAt: "2026/08/20",
          },
        ],
      });
      return true;
    },
  );

  assert.deepEqual(pageReads, [1, 2, 3]);
  assert.equal(detailReads, 1);
  assert.deepEqual(state.clicks, []);
});

test("Playwright leave approval prepare does not block on a different applicant or target date", async () => {
  const { client } = createFakeBrowser([]);
  const leave = approvalDetail({ id: "7210" });
  let detailReads = 0;
  client.getApprovalDetail = async () => {
    detailReads += 1;
    return structuredClone(leave);
  };
  const { pageReads } = installPendingApprovalPages(client, [[
    approvalSummary({ id: "7211", type: "勤務時間修正", applicant: "Applicant B" }),
  ], [
    approvalSummary({ id: "7212", type: "勤務時間修正", targetDate: "2026/08/21" }),
  ]]);

  const prepared = await client.prepareApprovalAction("7210", "approve");

  assert.match(prepared.fingerprint, /^[a-f0-9]{64}$/);
  assert.deepEqual(pageReads, [1, 2]);
  assert.equal(detailReads, 2);
});

test("Playwright leave return and work-time correction approval skip the leave dependency rule", async () => {
  const { client } = createFakeBrowser([]);
  let dependencyReads = 0;
  client.readAllPendingApprovals = async () => {
    dependencyReads += 1;
    return [approvalSummary({ id: "7222", type: "勤務時間修正" })];
  };
  const leave = approvalDetail({ id: "7220" });
  client.getApprovalDetail = async () => leave;

  const returned = await client.prepareApprovalAction("7220", "return");
  assert.equal(returned.action, "return");

  const correction = approvalDetail({
    id: "7221",
    type: "勤務時間修正",
    content: "勤務時間を削除",
  });
  client.getApprovalDetail = async () => correction;
  const approvedCorrection = await client.prepareApprovalAction("7221", "approve");
  assert.equal(approvedCorrection.action, "approve");
  assert.equal(dependencyReads, 0);
});

test("Playwright leave approval commit stops when a correction appears after prepare", async () => {
  const { client, state } = createFakeBrowser([]);
  const leave = approvalDetail({ id: "7230" });
  client.getApprovalDetail = async () => structuredClone(leave);
  let dependencyReads = 0;
  client.readAllPendingApprovals = async () => {
    dependencyReads += 1;
    return dependencyReads === 1 ? [] : [approvalSummary({
      id: "7231",
      type: "勤務時間修正",
      content: "勤務時間を削除",
      workTimeChange: null,
    })];
  };
  let commits = 0;
  client.commitOpenApprovalAction = async () => {
    commits += 1;
  };

  const prepared = await client.prepareApprovalAction("7230", "approve");
  await assert.rejects(
    client.commitApprovalAction("7230", "approve", prepared.fingerprint, true),
    (error) => error.code === "LEAVE_APPROVAL_BLOCKED_BY_WORK_TIME_CORRECTION",
  );

  assert.equal(dependencyReads, 2);
  assert.equal(commits, 0);
  assert.deepEqual(state.clicks, []);
});

test("Playwright leave approval fails closed when applicant or target date is unavailable", async () => {
  for (const [field, value] of [["applicant", null], ["targetDate", null]]) {
    const { client, state } = createFakeBrowser([]);
    const leave = approvalDetail({ id: "7240", [field]: value });
    client.getApprovalDetail = async () => leave;
    let dependencyReads = 0;
    client.readAllPendingApprovals = async () => {
      dependencyReads += 1;
      return [];
    };

    await assert.rejects(
      client.prepareApprovalAction("7240", "approve"),
      (error) => error.code === "LEAVE_APPROVAL_DEPENDENCY_UNCONFIRMED"
        && error.details.missingFields.includes(field),
    );
    await assert.rejects(
      client.commitApprovalAction(
        "7240",
        "approve",
        createApprovalFingerprint(leave, "approve"),
        true,
      ),
      (error) => error.code === "LEAVE_APPROVAL_DEPENDENCY_UNCONFIRMED"
        && error.details.missingFields.includes(field),
    );
    assert.equal(dependencyReads, 0);
    assert.deepEqual(state.clicks, []);
  }
});

test("Playwright leave approval reopens the exact unchanged target after each dependency scan", async () => {
  const { client } = createFakeBrowser([]);
  const leave = approvalDetail({ id: "7250" });
  let location = "start";
  let detailReads = 0;
  client.getApprovalDetail = async (id) => {
    assert.equal(id, "7250");
    detailReads += 1;
    location = `detail:${id}`;
    return structuredClone(leave);
  };
  let dependencyReads = 0;
  client.readAllPendingApprovals = async () => {
    dependencyReads += 1;
    location = "pending:last-page";
    return [];
  };
  let commits = 0;
  client.commitOpenApprovalAction = async (id, action, before, fingerprint) => {
    commits += 1;
    assert.equal(location, "detail:7250");
    assert.equal(id, "7250");
    assert.equal(action, "approve");
    assert.deepEqual(before, leave);
    assert.match(fingerprint, /^[a-f0-9]{64}$/);
    return {
      id,
      action,
      verified: true,
      result: {
        ...before,
        application: { ...before.application, status: "承認済" },
        availableActions: [],
      },
    };
  };

  const prepared = await client.prepareApprovalAction("7250", "approve");
  const result = await client.commitApprovalAction(
    "7250",
    "approve",
    prepared.fingerprint,
    true,
  );

  assert.equal(result.verified, true);
  assert.equal(result.result.application.status, "承認済");
  assert.equal(dependencyReads, 2);
  assert.equal(detailReads, 4);
  assert.equal(commits, 1);
});

test("Playwright leave approval never commits if the reopened target differs after pagination", async () => {
  const { client, state } = createFakeBrowser([]);
  const leave = approvalDetail({ id: "7260" });
  const wrongTarget = approvalDetail({ id: "7261" });
  let detailReads = 0;
  client.getApprovalDetail = async () => {
    detailReads += 1;
    return detailReads === 1 ? leave : wrongTarget;
  };
  client.readAllPendingApprovals = async () => [];
  let commits = 0;
  client.commitOpenApprovalAction = async () => {
    commits += 1;
  };

  await assert.rejects(
    client.commitApprovalAction(
      "7260",
      "approve",
      createApprovalFingerprint(leave, "approve"),
      true,
    ),
    (error) => error.code === "APPROVAL_PREVIEW_CHANGED",
  );
  assert.equal(commits, 0);
  assert.deepEqual(state.clicks, []);
});

test("Playwright leave approval never commits if the action becomes unavailable after pagination", async () => {
  const { client, state } = createFakeBrowser([]);
  const leave = approvalDetail({ id: "7270" });
  const unavailable = approvalDetail({ id: "7270" }, { availableActions: ["return"] });
  let detailReads = 0;
  client.getApprovalDetail = async () => {
    detailReads += 1;
    return detailReads === 1 ? leave : unavailable;
  };
  client.readAllPendingApprovals = async () => [];
  let commits = 0;
  client.commitOpenApprovalAction = async () => {
    commits += 1;
  };

  await assert.rejects(
    client.commitApprovalAction(
      "7270",
      "approve",
      createApprovalFingerprint(leave, "approve"),
      true,
    ),
    (error) => error.code === "APPROVAL_ACTION_UNAVAILABLE",
  );
  assert.equal(commits, 0);
  assert.deepEqual(state.clicks, []);
});

test("Playwright personal application list uses the employee returned-state filter", async () => {
  const { client, state } = createFakePersonalApplicationBrowser();
  const result = await client.getPersonalApplications("returned", 1);
  assert.equal(state.selected, true);
  assert.equal(state.filter, "差戻し");
  assert.equal(result.filter, "returned");
  assert.equal(result.totalCount, 1);
  assert.equal(result.applications[0].id, "2468");
  assert.equal(result.applications[0].status, "差戻し");
});

test("Playwright approval commit stops before page access without the confirm assertion", async () => {
  const { client, state } = createFakeBrowser([]);

  await assert.rejects(
    client.commitApprovalAction("1234", "approve", "a".repeat(64), false),
    (error) => error.code === "CONFIRMATION_REQUIRED",
  );
  assert.deepEqual(state.clicks, []);
});

test("Playwright approval commit stops when the prepared detail fingerprint changed", async () => {
  const { client, state } = createFakeBrowser([]);
  client.readAllPendingApprovals = async () => [];
  client.getApprovalDetail = async () => ({
    application: {
      id: "1234",
      status: "申請中",
      applicant: "申請者 A",
      type: "休暇",
      targetDate: "2026/08/12",
      content: "有休 全休",
      reason: "私用",
      appliedAt: "2026/08/11",
      currentApprover: "承認者 A",
      checkResult: null,
    },
    fields: [],
    tables: [],
    detailLines: ["申請内容が更新されました"],
    availableActions: ["approve", "return"],
  });

  await assert.rejects(
    client.commitApprovalAction("1234", "approve", "0".repeat(64), true),
    (error) => error.code === "APPROVAL_PREVIEW_CHANGED",
  );
  assert.deepEqual(state.clicks, []);
});

test("Playwright approval commit reports unknown when the item disappears from both workflows", async () => {
  const { client, state } = createFakeBrowser([]);
  const detail = {
    application: {
      id: "1234",
      status: "未承認",
      applicant: "申請者 A",
      type: "休暇",
      targetDate: "2026/08/12",
      content: "有休 全休",
      reason: "私用",
      appliedAt: "2026/08/11",
      currentApprover: "承認者 A",
      checkResult: null,
    },
    fields: [],
    tables: [],
    detailLines: ["申請内容"],
    availableActions: ["approve", "return"],
  };
  client.readAllPendingApprovals = async () => [];
  let detailReads = 0;
  client.getApprovalDetail = async () => {
    detailReads += 1;
    if (detailReads <= 2) {
      return detail;
    }
    throw new CliError("APPROVAL_NOT_FOUND", "missing after click", { exitCode: 2 });
  };
  client.getPersonalApplicationDetail = async () => {
    throw new CliError("PERSONAL_APPLICATION_NOT_FOUND", "missing from employee history", {
      exitCode: 2,
    });
  };
  client.page.getByRole = (_role, options) => {
    assert.equal(options.name, "承認");
    return {
      async count() { return 1; },
      async isVisible() { return true; },
      async isEnabled() { return true; },
      async click() { state.clicks.push("approve"); },
    };
  };

  await assert.rejects(
    client.commitApprovalAction("1234", "approve", createApprovalFingerprint(detail, "approve"), true),
    (error) => error.code === "APPROVAL_ACTION_RESULT_UNKNOWN",
  );
  assert.deepEqual(state.clicks, ["approve"]);
});

test("Playwright approval return verifies the current user's item through employee history", async () => {
  const { client, state } = createFakeBrowser([]);
  const detail = {
    application: {
      id: "1234",
      status: "未承認",
      applicant: "申請者 A",
      type: "休暇",
      targetDate: "2026/08/17",
      content: "有休 全休",
      reason: "return validation",
      appliedAt: "2026/08/13",
      currentApprover: "承認者 A",
      checkResult: null,
    },
    fields: [],
    tables: [],
    detailLines: ["申請内容"],
    availableActions: ["approve", "return"],
  };
  let detailReads = 0;
  client.getApprovalDetail = async () => {
    detailReads += 1;
    if (detailReads === 1) {
      return detail;
    }
    throw new CliError("APPROVAL_NOT_FOUND", "missing from manager history", { exitCode: 2 });
  };
  client.getPersonalApplicationDetail = async () => ({
    application: {
      ...detail.application,
      status: "差戻し",
      applicant: null,
      currentApprover: null,
    },
    fields: [],
    tables: [],
    detailLines: ["申請者 Aさんが休暇申請を差戻ししました。"],
    availableActions: [],
  });
  client.page.getByRole = (_role, options) => {
    assert.equal(options.name, "申請者へ差し戻す");
    return {
      async count() { return 1; },
      async isVisible() { return true; },
      async isEnabled() { return true; },
      async click() { state.clicks.push("return"); },
    };
  };

  const result = await client.commitApprovalAction(
    "1234",
    "return",
    createApprovalFingerprint(detail, "return"),
    true,
  );

  assert.equal(result.verified, true);
  assert.equal(result.result.application.status, "差戻し");
  assert.equal(result.result.application.applicant, "申請者 A");
  assert.deepEqual(result.result.availableActions, []);
  assert.deepEqual(state.clicks, ["return"]);
});

test("Playwright monthly commit never clicks without the confirm assertion", async () => {
  const { client, state } = createFakeBrowser([]);
  let prepares = 0;
  client.prepareMonthlyAction = async () => {
    prepares += 1;
    return { action: "submit", fingerprint: "a".repeat(64), preview: {} };
  };

  await assert.rejects(
    client.commitMonthlyAction("submit", "a".repeat(64), false, "2026-08"),
    (error) => error.code === "CONFIRMATION_REQUIRED",
  );
  assert.equal(prepares, 0);
  assert.deepEqual(state.clicks, []);
});

test("Playwright personal application commits never click without the confirm assertion", async () => {
  const { client, state } = createFakeBrowser([]);
  await assert.rejects(
    client.commitPersonalApplicationCreate({
      kind: "leave",
      date: "2026-08-14",
      leaveType: "有休",
    }, "a".repeat(64), false),
    (error) => error.code === "CONFIRMATION_REQUIRED",
  );
  await assert.rejects(
    client.commitPersonalApplicationWithdraw("100", "b".repeat(64), false),
    (error) => error.code === "CONFIRMATION_REQUIRED",
  );
  await assert.rejects(
    client.commitPersonalApplicationCancel("100", "计划变更", "c".repeat(64), false),
    (error) => error.code === "CONFIRMATION_REQUIRED",
  );
  assert.deepEqual(state.clicks, []);
});

test("Playwright work-time deletion selects only the exact form option without submitting", async () => {
  const { client, state } = createFakeBrowser([]);
  let selected = false;
  let selectedDate = null;
  let reason = null;
  client.selectApplicationDate = async (selector, date) => {
    assert.equal(selector, "#approval-request-date-input");
    selectedDate = date;
  };
  client.readPersonalApplicationRoute = async () => "勤怠申請";
  client.captureDiagnosticScreenshot = async () => {};
  client.page.locator = (selector) => {
    assert.equal(selector, '[data-testid="申請理由"]');
    return { async fill(value) { reason = value; } };
  };
  client.page.getByRole = (role, options) => {
    assert.equal(options.name, "勤務時間を削除");
    assert.equal(options.exact, true);
    const exists = role === "radio";
    return {
      async count() { return exists ? 1 : 0; },
      async isVisible() { return exists; },
      async isEnabled() { return exists; },
      async check() { selected = true; },
      async isChecked() { return selected; },
    };
  };

  const route = await client.fillWorkTimeCorrectionForm(
    normalizePersonalApplicationCreateInput({
      kind: "work-time-correction",
      date: "2026-08-17",
      workTimeAction: "delete",
      reason: "Duplicate registered work time",
    }),
  );

  assert.equal(route, "勤怠申請");
  assert.equal(selectedDate, "2026-08-17");
  assert.equal(reason, "Duplicate registered work time");
  assert.equal(selected, true);
  assert.deepEqual(state.clicks, []);
});

test("Playwright work-time deletion supports freee's exact visible label and hidden input", async () => {
  const { client, state } = createFakeBrowser([]);
  let selected = false;
  client.selectApplicationDate = async () => {};
  client.readPersonalApplicationRoute = async () => "勤怠申請";
  client.captureDiagnosticScreenshot = async () => {};
  client.page.getByRole = () => ({
    async count() { return 0; },
  });
  client.page.locator = (selector) => {
    if (selector === '[data-testid="clear-work-time-true"]') {
      return {
        async count() { return 1; },
        async isVisible() { return true; },
        async click() { selected = true; },
        async evaluate() {
          return {
            tagName: "label",
            text: "勤務時間を削除する",
            inputType: "radio",
            disabled: false,
            checked: selected,
          };
        },
      };
    }
    assert.equal(selector, '[data-testid="申請理由"]');
    return { async fill() {} };
  };

  const route = await client.fillWorkTimeCorrectionForm(
    normalizePersonalApplicationCreateInput({
      kind: "work-time-correction",
      date: "2026-08-17",
      workTimeAction: "delete",
    }),
  );

  assert.equal(route, "勤怠申請");
  assert.equal(selected, true);
  assert.deepEqual(state.clicks, []);
});

test("Playwright personal application route selects only one controlled combobox option", async () => {
  const { client, state } = createFakeBrowser([]);
  let routeValue = "";
  const presses = [];
  const routeControl = {
    async count() { return 1; },
    async isVisible() { return true; },
    async isEnabled() { return true; },
    async inputValue() { return routeValue; },
    async getAttribute(name) {
      if (name === "role") return "combobox";
      if (name === "aria-controls") return "approval-route-options";
      return null;
    },
    async click() {},
    async press(key) {
      presses.push(key);
      if (key === "Enter") routeValue = "勤怠申請";
    },
  };
  const option = {
    async isVisible() { return true; },
    async isEnabled() { return true; },
  };
  const options = {
    async allTextContents() { return [" 勤怠申請 "]; },
    async count() { return 1; },
    first() { return option; },
  };
  const listbox = {
    async count() { return 1; },
    async isVisible() { return true; },
    async getAttribute(name) { return name === "role" ? "listbox" : null; },
    getByRole(role) {
      assert.equal(role, "option");
      return options;
    },
  };
  client.page.waitForFunction = async () => {};
  client.page.locator = (selector) => {
    if (selector === "#approval-request-fields-route-id") return routeControl;
    assert.equal(selector, '[id="approval-route-options"]');
    return listbox;
  };

  const route = await client.readPersonalApplicationRoute();

  assert.equal(route, "勤怠申請");
  assert.deepEqual(presses, ["ArrowDown", "Enter"]);
  assert.deepEqual(state.clicks, []);
});

test("Playwright personal application route fails closed when multiple options exist", async () => {
  const { client, state } = createFakeBrowser([]);
  const presses = [];
  const routeControl = {
    async count() { return 1; },
    async isVisible() { return true; },
    async isEnabled() { return true; },
    async inputValue() { return ""; },
    async getAttribute(name) {
      if (name === "role") return "combobox";
      if (name === "aria-controls") return "approval-route-options";
      return null;
    },
    async click() {},
    async press(key) { presses.push(key); },
  };
  const options = {
    async allTextContents() { return ["勤怠申請", "別の経路"]; },
    async count() { return 2; },
    first() {
      return {
        async isVisible() { return true; },
        async isEnabled() { return true; },
      };
    },
  };
  const listbox = {
    async count() { return 1; },
    async isVisible() { return true; },
    async getAttribute(name) { return name === "role" ? "listbox" : null; },
    getByRole(role) {
      assert.equal(role, "option");
      return options;
    },
  };
  client.page.waitForFunction = async () => {};
  client.page.locator = (selector) => {
    if (selector === "#approval-request-fields-route-id") return routeControl;
    assert.equal(selector, '[id="approval-route-options"]');
    return listbox;
  };

  await assert.rejects(
    client.readPersonalApplicationRoute(),
    (error) => error.code === "PERSONAL_APPLICATION_ROUTE_REQUIRED"
      && error.details.availableRoutes.join(",") === "勤怠申請,別の経路",
  );
  assert.deepEqual(presses, ["ArrowDown"]);
  assert.deepEqual(state.clicks, []);
});

test("Playwright work-time deletion fails closed when the exact option is missing or ambiguous", async () => {
  for (const availableRoles of [[], ["radio", "checkbox"]]) {
    const { client, state } = createFakeBrowser([]);
    client.selectApplicationDate = async () => {};
    client.page.getByRole = (role, options) => {
      assert.equal(options.name, "勤務時間を削除");
      const exists = availableRoles.includes(role);
      return {
        async count() { return exists ? 1 : 0; },
        async isVisible() { return exists; },
        async isEnabled() { return exists; },
        async check() { state.clicks.push(role); },
        async isChecked() { return true; },
      };
    };
    await assert.rejects(
      client.fillWorkTimeCorrectionForm(normalizePersonalApplicationCreateInput({
        kind: "work-time-correction",
        date: "2026-08-17",
        workTimeAction: "delete",
      })),
      (error) => error.code === "BROWSER_PERSONAL_APPLICATION_FORM_UNEXPECTED",
    );
    assert.deepEqual(state.clicks, []);
  }
});

test("Playwright work-time deletion commit rechecks the selection before clicking", async () => {
  const { client } = createFakeBrowser([]);
  const fingerprint = "9".repeat(64);
  let clicks = 0;
  client.preparePersonalApplicationCreate = async () => ({
    action: "create",
    fingerprint,
    preview: {
      application: normalizePersonalApplicationCreateInput({
        kind: "work-time-correction",
        date: "2026-08-17",
        workTimeAction: "delete",
      }),
      typeLabel: "勤務時間修正",
      route: "勤怠申請",
      existingFirstPage: { count: 0, fingerprint: "a".repeat(64) },
    },
  });
  client.page.getByRole = (role, options) => {
    if (role === "button" && options.name === "申請") {
      return {
        async count() { return 1; },
        async isVisible() { return true; },
        async isEnabled() { return true; },
        async click() { clicks += 1; },
      };
    }
    const deletion = role === "radio" && options.name === "勤務時間を削除";
    return {
      async count() { return deletion ? 1 : 0; },
      async isVisible() { return deletion; },
      async isEnabled() { return deletion; },
      async isChecked() { return false; },
    };
  };

  await assert.rejects(
    client.commitPersonalApplicationCreate({
      kind: "work-time-correction",
      date: "2026-08-17",
      workTimeAction: "delete",
    }, fingerprint, true),
    (error) => error.code === "PERSONAL_APPLICATION_PREVIEW_CHANGED",
  );
  assert.equal(clicks, 0);
});

test("Playwright work-time deletion commit verifies the exact new deletion request", async () => {
  const { client } = createFakeBrowser([]);
  const fingerprint = "8".repeat(64);
  let clicks = 0;
  let selected = true;
  const application = normalizePersonalApplicationCreateInput({
    kind: "work-time-correction",
    date: "2026-08-17",
    workTimeAction: "delete",
    reason: "Duplicate registered work time",
  });
  client.preparePersonalApplicationCreate = async () => {
    client.preparedPersonalApplicationFirstPageIds = ["20"];
    return {
      action: "create",
      fingerprint,
      preview: {
        application,
        typeLabel: "勤務時間修正",
        route: "勤怠申請",
        existingFirstPage: { count: 1, fingerprint: "a".repeat(64) },
      },
    };
  };
  client.page.getByRole = (role, options) => {
    if (role === "button" && options.name === "申請") {
      return {
        async count() { return 1; },
        async isVisible() { return true; },
        async isEnabled() { return true; },
        async click() { clicks += 1; selected = false; },
      };
    }
    const deletion = role === "radio" && options.name === "勤務時間を削除";
    return {
      async count() { return deletion ? 1 : 0; },
      async isVisible() { return deletion; },
      async isEnabled() { return deletion; },
      async isChecked() { return selected; },
    };
  };
  client.readCurrentPersonalApplicationDetailSnapshot = async () => ({
    applicationId: "21",
    fields: [{ label: "申請内容", value: "勤務時間を削除" }],
    tables: [],
    detailLines: ["勤務時間を削除"],
    workTimeChange: null,
    availableActions: ["withdraw"],
  });
  client.getPersonalApplications = async () => ({
    applications: [{
      id: "21",
      status: "申請中",
      applicant: null,
      type: "勤務時間修正",
      targetDate: "2026/08/17",
      content: "勤務時間を削除",
      reason: "Duplicate registered work time",
      appliedAt: "2026/08/16",
      currentApprover: "Approver A",
      checkResult: null,
    }, {
      id: "20",
      status: "承認済",
    }],
  });

  const result = await client.commitPersonalApplicationCreate({
    kind: "work-time-correction",
    date: "2026-08-17",
    workTimeAction: "delete",
    reason: "Duplicate registered work time",
  }, fingerprint, true);

  assert.equal(clicks, 1);
  assert.equal(result.verified, true);
  assert.equal(result.result.application.content, "勤務時間を削除");
});

test("Playwright personal application creation binds its preview and verifies one new item", async () => {
  const { client } = createFakeBrowser([]);
  let clicks = 0;
  let currentDetailReads = 0;
  let detailReopens = 0;
  const fingerprint = "c".repeat(64);
  client.preparePersonalApplicationCreate = async () => {
    client.preparedPersonalApplicationFirstPageIds = ["10"];
    return {
      action: "create",
      fingerprint,
      preview: {
        application: { kind: "leave", date: "2026-08-14" },
        existingFirstPage: { count: 1, fingerprint: "d".repeat(64) },
      },
    };
  };
  client.page.getByRole = () => ({
    async count() { return 1; },
    async isVisible() { return true; },
    async isEnabled() { return true; },
    async click() { clicks += 1; },
  });
  client.readCurrentPersonalApplicationDetailSnapshot = async () => {
    currentDetailReads += 1;
    return {
      applicationId: "11",
      fields: [{ label: "申請内容", value: "有休（半休） 13:00 - 18:00" }],
      tables: [],
      detailLines: ["申請が作成されました。"],
      availableActions: ["withdraw"],
    };
  };
  client.getPersonalApplicationDetail = async () => {
    detailReopens += 1;
    throw new Error("creation must not reopen the detail after submission");
  };
  client.getPersonalApplications = async () => ({
    applications: [{ id: "11", status: "申請中" }, { id: "10", status: "承認済" }],
  });

  const result = await client.commitPersonalApplicationCreate({
    kind: "leave",
    date: "2026-08-14",
    leaveType: "有休",
  }, fingerprint, true);
  assert.equal(clicks, 1);
  assert.equal(currentDetailReads, 1);
  assert.equal(detailReopens, 0);
  assert.equal(result.verified, true);
  assert.equal(result.result.application.id, "11");
  assert.deepEqual(result.result.fields, [
    { label: "申請内容", value: "有休（半休） 13:00 - 18:00" },
  ]);
});

test("Playwright personal application creation treats a missing post-submit detail as unknown", async () => {
  const { client } = createFakeBrowser([]);
  const fingerprint = "c".repeat(64);
  client.preparePersonalApplicationCreate = async () => ({
    action: "create",
    fingerprint,
    preview: {
      application: { kind: "leave", date: "2026-08-14" },
      existingFirstPage: { count: 0, fingerprint: "d".repeat(64) },
    },
  });
  client.page.getByRole = () => ({
    async count() { return 1; },
    async isVisible() { return true; },
    async isEnabled() { return true; },
    async click() {},
  });
  client.readCurrentPersonalApplicationDetailSnapshot = async () => {
    throw new Error("detail did not render");
  };
  client.getPersonalApplications = async () => ({
    applications: [{ id: "11", status: "申請中" }],
  });

  await assert.rejects(
    client.commitPersonalApplicationCreate({
      kind: "leave",
      date: "2026-08-14",
      leaveType: "有休",
    }, fingerprint, true),
    (error) => error.code === "PERSONAL_APPLICATION_ACTION_RESULT_UNKNOWN",
  );
});

test("Playwright personal application creation binds the detail No. to the new list item", async () => {
  const { client } = createFakeBrowser([]);
  const fingerprint = "c".repeat(64);
  client.preparePersonalApplicationCreate = async () => {
    client.preparedPersonalApplicationFirstPageIds = ["10"];
    return {
      action: "create",
      fingerprint,
      preview: {
        application: { kind: "leave", date: "2026-08-14" },
        existingFirstPage: { count: 1, fingerprint: "d".repeat(64) },
      },
    };
  };
  client.page.getByRole = () => ({
    async count() { return 1; },
    async isVisible() { return true; },
    async isEnabled() { return true; },
    async click() {},
  });
  client.readCurrentPersonalApplicationDetailSnapshot = async () => ({
    applicationId: "12",
    fields: [],
    tables: [],
    detailLines: [],
    availableActions: ["withdraw"],
  });
  client.getPersonalApplications = async () => ({
    applications: [{ id: "11", status: "申請中" }, { id: "10", status: "承認済" }],
  });

  await assert.rejects(
    client.commitPersonalApplicationCreate({
      kind: "leave",
      date: "2026-08-14",
      leaveType: "有休",
    }, fingerprint, true),
    (error) => error.code === "PERSONAL_APPLICATION_ACTION_RESULT_UNKNOWN",
  );
});

test("Playwright personal application withdrawal verifies the exact returned item", async () => {
  const { client } = createFakeBrowser([]);
  let clicks = 0;
  const fingerprint = "e".repeat(64);
  client.preparePersonalApplicationWithdraw = async () => ({
    action: "withdraw",
    fingerprint,
    preview: { application: { id: "12", status: "申請中" }, availableActions: ["withdraw"] },
  });
  client.page.getByRole = () => ({
    async count() { return 1; },
    async isVisible() { return true; },
    async isEnabled() { return true; },
    async click() { clicks += 1; },
  });
  client.getPersonalApplicationDetail = async (id) => ({
    application: { id, status: "差戻し" },
    availableActions: [],
  });

  const result = await client.commitPersonalApplicationWithdraw("12", fingerprint, true);
  assert.equal(clicks, 1);
  assert.equal(result.verified, true);
  assert.equal(result.result.application.status, "差戻し");
});

test("Playwright personal application cancellation creates and verifies one new request", async () => {
  const { client } = createFakeBrowser([]);
  let clicks = 0;
  let currentDetailReads = 0;
  const fingerprint = "f".repeat(64);
  client.preparePersonalApplicationCancel = async () => {
    client.preparedPersonalApplicationFirstPageIds = ["10034"];
    return {
      id: "10034",
      action: "cancel",
      fingerprint,
      preview: {
        original: { application: { id: "10034", status: "承認済" } },
        reason: "计划变更",
        route: "勤怠申請",
        existingFirstPage: { count: 1, fingerprint: "a".repeat(64) },
      },
    };
  };
  client.page.getByRole = () => ({
    async count() { return 1; },
    async isVisible() { return true; },
    async isEnabled() { return true; },
    async click() { clicks += 1; },
  });
  client.readCurrentPersonalApplicationDetailSnapshot = async () => {
    currentDetailReads += 1;
    return {
      applicationId: "10036",
      fields: [{ label: "元申請No", value: "10034" }],
      tables: [],
      detailLines: ["取消申請"],
      availableActions: ["withdraw"],
    };
  };
  client.getPersonalApplications = async () => ({
    applications: [
      { id: "10036", status: "申請中", type: "取消" },
      { id: "10034", status: "承認済", type: "休暇" },
    ],
  });

  const result = await client.commitPersonalApplicationCancel(
    "10034",
    "计划变更",
    fingerprint,
    true,
  );
  assert.equal(clicks, 1);
  assert.equal(currentDetailReads, 1);
  assert.equal(result.id, "10034");
  assert.equal(result.action, "cancel");
  assert.equal(result.verified, true);
  assert.equal(result.result.application.id, "10036");
});

test("Playwright personal application cancellation stops when the preview changes", async () => {
  const { client } = createFakeBrowser([]);
  let clicks = 0;
  client.preparePersonalApplicationCancel = async () => ({
    id: "10034",
    action: "cancel",
    fingerprint: "1".repeat(64),
    preview: {},
  });
  client.page.getByRole = () => ({
    async count() { return 1; },
    async isVisible() { return true; },
    async isEnabled() { return true; },
    async click() { clicks += 1; },
  });

  await assert.rejects(
    client.commitPersonalApplicationCancel("10034", "计划变更", "2".repeat(64), true),
    (error) => error.code === "PERSONAL_APPLICATION_PREVIEW_CHANGED",
  );
  assert.equal(clicks, 0);
});

test("Playwright monthly commit binds the preview and verifies the changed state", async () => {
  const { client, state } = createFakeBrowser([]);
  const fingerprint = "a".repeat(64);
  client.prepareMonthlyAction = async () => ({
    action: "submit",
    fingerprint,
    preview: { status: { period: "2026-08" } },
  });
  client.getMonthlyStatus = async () => ({
    period: "2026-08",
    periodLabel: "2026年8月勤務分",
    state: "pending",
    statusLabel: "未承認",
    application: { id: "1234" },
    availableActions: ["withdraw"],
  });
  client.page.getByRole = (_role, options) => {
    assert.equal(options.name, "申請");
    return {
      async count() { return 1; },
      async isVisible() { return true; },
      async isEnabled() { return true; },
      async click() { state.clicks.push("submit"); },
    };
  };

  await assert.rejects(
    client.commitMonthlyAction("submit", "b".repeat(64), true, "2026-08"),
    (error) => error.code === "MONTHLY_PREVIEW_CHANGED",
  );
  assert.deepEqual(state.clicks, []);

  const result = await client.commitMonthlyAction("submit", fingerprint, true, "2026-08");
  assert.equal(result.verified, true);
  assert.deepEqual(state.clicks, ["submit"]);
});

test("Playwright monthly withdrawal preview binds the exact pending application", async () => {
  const { client } = createFakeBrowser([]);
  client.getMonthlyStatus = async () => ({
    period: "2026-08",
    periodLabel: "2026年8月勤務分",
    state: "pending",
    statusLabel: "未承認",
    application: { id: "1234", status: "未承認", type: "月次勤怠締め" },
    availableActions: ["withdraw"],
  });
  client.openEmployeeApplicationDetail = async (id) => ({
    application: { id, status: "未承認", type: "月次勤怠締め" },
    fields: [],
    tables: [],
    detailLines: ["月次勤怠締め"],
    availableActions: [],
  });
  client.page.getByRole = (_role, options) => {
    assert.equal(options.name, "申請を取り下げる");
    return {
      async count() { return 1; },
      async isVisible() { return true; },
      async isEnabled() { return true; },
    };
  };

  const result = await client.prepareMonthlyAction("withdraw", "2026-08");
  assert.equal(result.preview.applicationDetail.application.id, "1234");
  assert.match(result.fingerprint, /^[a-f0-9]{64}$/);
});
