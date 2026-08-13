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

test("Playwright approval commit reports an unknown result when the clicked item disappears", async () => {
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
