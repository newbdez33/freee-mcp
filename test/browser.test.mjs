import assert from "node:assert/strict";
import test from "node:test";

import {
  FreeeBrowserClient,
  isAllowedFreeePageUrl,
  normalizeHeadlessChromeUserAgent,
  readPlaywrightRuntimeConfig,
} from "../dist/browser.js";
import { createApprovalFingerprint } from "../dist/browser-approvals.js";
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

test("Playwright clock action never clicks without explicit confirmation", async () => {
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

test("Playwright approval commit stops before page access without explicit confirmation", async () => {
  const { client, state } = createFakeBrowser([]);

  await assert.rejects(
    client.commitApprovalAction("1234", "approve", "a".repeat(64), false),
    (error) => error.code === "CONFIRMATION_REQUIRED",
  );
  assert.deepEqual(state.clicks, []);
});

test("Playwright approval commit stops when the prepared detail fingerprint changed", async () => {
  const { client, state } = createFakeBrowser([]);
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
  let detailReads = 0;
  client.getApprovalDetail = async () => {
    detailReads += 1;
    if (detailReads === 1) {
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

test("Playwright monthly commit never clicks without explicit confirmation", async () => {
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

test("Playwright personal application commits never click without explicit confirmation", async () => {
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
  assert.deepEqual(state.clicks, []);
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
