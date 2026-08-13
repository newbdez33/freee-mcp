import assert from "node:assert/strict";
import test from "node:test";

import {
  FreeeBrowserClient,
  isAllowedFreeePageUrl,
  readPlaywrightRuntimeConfig,
} from "../dist/browser.js";

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
            state.clicks.push(`filter:${options.name}`);
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
        rows: [[
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
        ]],
        pageCount: 1,
      };
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

test("browser main-frame allowlist accepts only the three official HTTPS hosts", () => {
  assert.equal(isAllowedFreeePageUrl("https://p.secure.freee.co.jp/"), true);
  assert.equal(isAllowedFreeePageUrl("https://accounts.secure.freee.co.jp/sessions/new"), true);
  assert.equal(isAllowedFreeePageUrl("https://ep.secure.freee.co.jp/"), true);
  assert.equal(isAllowedFreeePageUrl("http://p.secure.freee.co.jp/"), false);
  assert.equal(isAllowedFreeePageUrl("https://p.secure.freee.co.jp.example.com/"), false);
  assert.equal(isAllowedFreeePageUrl("https://secure.freee.co.jp/"), false);
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
  assert.equal(result.applicationCount, 1);
  assert.equal(result.applications[0].applicant, "申請者 A");
  assert.equal(result.applications[0].type, "休暇");
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
