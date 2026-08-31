import assert from "node:assert/strict";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { CliError } from "../dist/errors.js";
import { createFreeeMcpServer } from "../dist/mcp-server.js";

function createFakeService() {
  const calls = [];
  return {
    calls,
    backend: "playwright",
    async getBackendStatus() { return { version: "0.3.3", backend: "playwright" }; },
    async getAuthStatus() { return { backend: "playwright", authenticated: true }; },
    async getMe() { return { backend: "playwright" }; },
    async getClockStatus() { return { backend: "playwright", status: { available_actions: [] } }; },
    async prepareClockAction(action) { return { backend: "playwright", action, fingerprint: "a".repeat(64) }; },
    async commitClockAction(action, fingerprint, confirm) {
      calls.push(["clock-commit", action, fingerprint, confirm]);
      return { backend: "playwright", action, verified: true };
    },
    async getTeamStatus() { return { backend: "playwright", memberCount: 0 }; },
    async getMonthlyStatus(period) {
      calls.push(["monthly-status", period]);
      return { backend: "playwright", period: period ?? "2026-08", state: "unsubmitted" };
    },
    async prepareMonthlyAction(action, period) {
      return { backend: "playwright", action, period: period ?? "2026-08", fingerprint: "c".repeat(64) };
    },
    async commitMonthlyAction(action, fingerprint, confirm, period) {
      calls.push(["monthly-commit", action, fingerprint, confirm, period]);
      return { backend: "playwright", action, period: period ?? "2026-08", verified: true };
    },
    async getPersonalApplicationOptions(date) {
      calls.push(["requests-options", date]);
      return { backend: "playwright", leaveTypesDate: date ?? null, applicationTypes: [] };
    },
    async getPersonalApplications(status, page) {
      calls.push(["requests-list", status, page]);
      return { backend: "playwright", filter: status, page, applicationCount: 0, applications: [] };
    },
    async getPersonalApplicationDetail(id) {
      return { backend: "playwright", application: { id }, availableActions: [] };
    },
    async preparePersonalApplicationCreate(input) {
      calls.push(["requests-prepare-create", input]);
      return { backend: "playwright", action: "create", fingerprint: "d".repeat(64) };
    },
    async commitPersonalApplicationCreate(input, fingerprint, confirm) {
      calls.push(["requests-commit-create", input, fingerprint, confirm]);
      return { backend: "playwright", action: "create", verified: true };
    },
    async preparePersonalApplicationCancel(id, reason) {
      calls.push(["requests-prepare-cancel", id, reason]);
      return { backend: "playwright", id, action: "cancel", fingerprint: "f".repeat(64) };
    },
    async commitPersonalApplicationCancel(id, reason, fingerprint, confirm) {
      calls.push(["requests-commit-cancel", id, reason, fingerprint, confirm]);
      return { backend: "playwright", id, action: "cancel", verified: true };
    },
    async preparePersonalApplicationWithdraw(id) {
      return { backend: "playwright", id, action: "withdraw", fingerprint: "e".repeat(64) };
    },
    async commitPersonalApplicationWithdraw(id, fingerprint, confirm) {
      calls.push(["requests-commit-withdraw", id, fingerprint, confirm]);
      return { backend: "playwright", id, action: "withdraw", verified: true };
    },
    async getApprovals(status, page) {
      calls.push(["approvals-list", status, page]);
      return { backend: "playwright", filter: status, page, applicationCount: 0, applications: [] };
    },
    async getApprovalDetail(id) { return { backend: "playwright", id }; },
    async prepareApprovalAction(id, action) {
      return { backend: "playwright", id, action, fingerprint: "b".repeat(64) };
    },
    async commitApprovalAction(id, action, fingerprint, confirm) {
      calls.push(["approval-commit", id, action, fingerprint, confirm]);
      return { backend: "playwright", id, action, verified: true };
    },
    async getMonthlyApprovals(status, page) {
      calls.push(["monthly-approvals-list", status, page]);
      return { backend: "playwright", filter: status, page, applicationCount: 0, applications: [] };
    },
    async getMonthlyApprovalReview(id) {
      calls.push(["monthly-approval-review", id]);
      return { backend: "playwright", period: "2026-08", application: { application: { id } } };
    },
    async prepareMonthlyApprovalAction(id, action) {
      return { backend: "playwright", id, action, fingerprint: "1".repeat(64) };
    },
    async commitMonthlyApprovalAction(id, action, fingerprint, confirm) {
      calls.push(["monthly-approval-commit", id, action, fingerprint, confirm]);
      return { backend: "playwright", id, action, verified: true };
    },
  };
}

async function connect(service) {
  const server = createFreeeMcpServer(service);
  const client = new Client({ name: "freee-mcp-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
}

test("MCP server advertises structured freee tools, safety instructions, and annotations", async () => {
  const service = createFakeService();
  const { client, server } = await connect(service);
  try {
    const listed = await client.listTools();
    const names = listed.tools.map((tool) => tool.name);
    assert.deepEqual(names, [
      "freee_backend_status",
      "freee_auth_status",
      "freee_me",
      "freee_clock_status",
      "freee_clock_prepare_action",
      "freee_clock_commit_action",
      "freee_team_status",
      "freee_monthly_status",
      "freee_monthly_prepare_action",
      "freee_monthly_commit_action",
      "freee_personal_application_options",
      "freee_personal_applications_list",
      "freee_personal_application_detail",
      "freee_personal_application_prepare_create",
      "freee_personal_application_commit_create",
      "freee_personal_application_prepare_cancel",
      "freee_personal_application_commit_cancel",
      "freee_personal_application_prepare_withdraw",
      "freee_personal_application_commit_withdraw",
      "freee_approvals_list",
      "freee_monthly_approvals_list",
      "freee_monthly_approval_review",
      "freee_monthly_approval_prepare_action",
      "freee_monthly_approval_commit_action",
      "freee_approval_detail",
      "freee_approval_prepare_action",
      "freee_approval_commit_action",
    ]);
    const instructions = client.getInstructions();
    assert.match(instructions, /Always prepare first/);
    assert.match(instructions, /setupCommand/);
    assert.match(instructions, /user-authorized policy/);
    assert.match(instructions, /match fingerprints on the user's behalf/);
    assert.match(instructions, /approve\/return mapping/);
    assert.match(instructions, /need not pre-enumerate application Nos/);
    assert.match(instructions, /continue independent matches/);
    assert.match(
      instructions.slice(0, 512),
      /No batch endpoint or per-item confirmation is required/,
    );
    assert.equal(
      listed.tools.find((tool) => tool.name === "freee_team_status").annotations.readOnlyHint,
      true,
    );
    assert.equal(
      listed.tools.find((tool) => tool.name === "freee_monthly_commit_action").annotations.destructiveHint,
      true,
    );
    assert.equal(
      listed.tools.find((tool) => tool.name === "freee_approval_commit_action").annotations.destructiveHint,
      true,
    );
    assert.equal(
      listed.tools.find((tool) => tool.name === "freee_monthly_approval_review").annotations.readOnlyHint,
      true,
    );
    assert.equal(
      listed.tools.find((tool) => tool.name === "freee_monthly_approval_commit_action").annotations.destructiveHint,
      true,
    );
    assert.match(
      listed.tools.find((tool) => tool.name === "freee_approval_prepare_action").description,
      /every pending approval-list page/,
    );
    assert.match(
      listed.tools.find((tool) => tool.name === "freee_approval_prepare_action").description,
      /confirmed policy run/,
    );
    assert.match(
      listed.tools.find((tool) => tool.name === "freee_approval_commit_action").description,
      /reopens the exact target/,
    );
    assert.match(
      listed.tools.find((tool) => tool.name === "freee_approval_commit_action").description,
      /matches the fingerprint on the user's behalf/,
    );
    assert.match(
      listed.tools.find((tool) => tool.name === "freee_approval_commit_action").description,
      /cover later-discovered matches/,
    );
    assert.match(
      listed.tools.find((tool) => tool.name === "freee_approval_commit_action")
        .inputSchema.properties.confirm.description,
      /conditions, approve\/return mapping, scope, termination, and error handling/,
    );
    assert.doesNotMatch(
      listed.tools.find((tool) => tool.name === "freee_monthly_approval_commit_action").description,
      /policy run/,
    );
    assert.equal(
      listed.tools.find((tool) => tool.name === "freee_personal_application_commit_create").annotations.destructiveHint,
      false,
    );
    assert.equal(
      listed.tools.find((tool) => tool.name === "freee_personal_application_commit_cancel").annotations.destructiveHint,
      true,
    );
    assert.equal(
      listed.tools.find((tool) => tool.name === "freee_personal_application_commit_withdraw").annotations.destructiveHint,
      true,
    );
  } finally {
    await client.close();
    await server.close();
  }
});

test("MCP tools return safe structured envelopes and default the approval filter", async () => {
  const service = createFakeService();
  const { client, server } = await connect(service);
  try {
    const backend = await client.callTool({ name: "freee_backend_status", arguments: {} });
    assert.deepEqual(backend.structuredContent, {
      ok: true,
      data: { version: "0.3.3", backend: "playwright" },
    });

    const monthly = await client.callTool({
      name: "freee_monthly_status",
      arguments: { period: "2026-08" },
    });
    assert.equal(monthly.structuredContent.data.period, "2026-08");

    const approvals = await client.callTool({ name: "freee_approvals_list", arguments: {} });
    assert.equal(approvals.structuredContent.data.filter, "pending");
    assert.equal(approvals.structuredContent.data.page, 1);
    const approved = await client.callTool({
      name: "freee_approvals_list",
      arguments: { status: "approved", page: 2 },
    });
    assert.equal(approved.structuredContent.data.page, 2);
    const monthlyApprovals = await client.callTool({
      name: "freee_monthly_approvals_list",
      arguments: {},
    });
    assert.equal(monthlyApprovals.structuredContent.data.filter, "pending");
    const monthlyReview = await client.callTool({
      name: "freee_monthly_approval_review",
      arguments: { id: "101" },
    });
    assert.equal(monthlyReview.structuredContent.data.period, "2026-08");
    const requests = await client.callTool({
      name: "freee_personal_applications_list",
      arguments: {},
    });
    assert.equal(requests.structuredContent.data.filter, "pending");
    assert.equal(requests.structuredContent.data.page, 1);
    const options = await client.callTool({
      name: "freee_personal_application_options",
      arguments: { date: "2026-08-14" },
    });
    assert.equal(options.structuredContent.data.leaveTypesDate, "2026-08-14");
    const halfDay = await client.callTool({
      name: "freee_personal_application_prepare_create",
      arguments: {
        kind: "leave",
        date: "2026-08-14",
        leave_type: "有休（半休）",
        leave_start: "13:00",
        leave_end: "18:00",
      },
    });
    assert.equal(halfDay.structuredContent.data.action, "create");
    const cancellation = await client.callTool({
      name: "freee_personal_application_prepare_cancel",
      arguments: { id: "10034", reason: "Plans changed" },
    });
    assert.equal(cancellation.structuredContent.data.action, "cancel");
    assert.deepEqual(service.calls, [
      ["monthly-status", "2026-08"],
      ["approvals-list", "pending", 1],
      ["approvals-list", "approved", 2],
      ["monthly-approvals-list", "pending", 1],
      ["monthly-approval-review", "101"],
      ["requests-list", "pending", 1],
      ["requests-options", "2026-08-14"],
      ["requests-prepare-create", {
        kind: "leave",
        date: "2026-08-14",
        leaveType: "有休（半休）",
        leaveStart: "13:00",
        leaveEnd: "18:00",
      }],
      ["requests-prepare-cancel", "10034", "Plans changed"],
    ]);
  } finally {
    await client.close();
    await server.close();
  }
});

test("MCP authentication status returns safe local Playwright setup guidance", async () => {
  const service = createFakeService();
  service.getAuthStatus = async () => {
    throw new CliError(
      "WEB_CREDENTIALS_UNAVAILABLE",
      "freee web credentials are not configured.",
      {
        details: {
          configured: false,
          setupCommand: "npm run freee -- browser configure --confirm",
        },
        exitCode: 2,
      },
    );
  };
  const { client, server } = await connect(service);
  try {
    const result = await client.callTool({ name: "freee_auth_status", arguments: {} });
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.error.code, "WEB_CREDENTIALS_UNAVAILABLE");
    assert.match(result.structuredContent.error.details.setupCommand, /browser configure --confirm/);
    assert.equal(JSON.stringify(result).includes("password"), false);
  } finally {
    await client.close();
    await server.close();
  }
});

test("MCP returns structured leave approval dependency errors", async () => {
  const service = createFakeService();
  service.prepareApprovalAction = async () => {
    throw new CliError(
      "LEAVE_APPROVAL_BLOCKED_BY_WORK_TIME_CORRECTION",
      "Process the pending work-time correction first.",
      {
        details: {
          leaveApplication: {
            id: "7300",
            applicant: "Applicant A",
            targetDate: "2026/08/20",
          },
          blockingWorkTimeCorrections: [{
            id: "7301",
            status: "未承認",
            content: "勤務時間を削除",
            appliedAt: "2026/08/20",
          }],
        },
        exitCode: 2,
      },
    );
  };
  const { client, server } = await connect(service);
  try {
    const result = await client.callTool({
      name: "freee_approval_prepare_action",
      arguments: { id: "7300", action: "approve" },
    });
    assert.equal(result.isError, true);
    assert.equal(
      result.structuredContent.error.code,
      "LEAVE_APPROVAL_BLOCKED_BY_WORK_TIME_CORRECTION",
    );
    assert.deepEqual(result.structuredContent.error.details.blockingWorkTimeCorrections, [{
      id: "7301",
      status: "未承認",
      content: "勤務時間を削除",
      appliedAt: "2026/08/20",
    }]);
  } finally {
    await client.close();
    await server.close();
  }
});

test("MCP commit schema rejects missing explicit confirmation before service invocation", async () => {
  const service = createFakeService();
  const { client, server } = await connect(service);
  try {
    const result = await client.callTool({
      name: "freee_approval_commit_action",
      arguments: {
        id: "1234",
        action: "approve",
        fingerprint: "b".repeat(64),
        confirm: false,
      },
    });
    assert.equal(result.isError, true);
    assert.deepEqual(service.calls, []);

    const monthly = await client.callTool({
      name: "freee_monthly_commit_action",
      arguments: {
        action: "submit",
        period: "2026-08",
        fingerprint: "c".repeat(64),
        confirm: false,
      },
    });
    assert.equal(monthly.isError, true);
    assert.deepEqual(service.calls, []);

    const monthlyApproval = await client.callTool({
      name: "freee_monthly_approval_commit_action",
      arguments: {
        id: "1234",
        action: "approve",
        fingerprint: "1".repeat(64),
        confirm: false,
      },
    });
    assert.equal(monthlyApproval.isError, true);
    assert.deepEqual(service.calls, []);

    const create = await client.callTool({
      name: "freee_personal_application_commit_create",
      arguments: {
        kind: "leave",
        date: "2026-08-14",
        leave_type: "有休",
        fingerprint: "d".repeat(64),
        confirm: false,
      },
    });
    assert.equal(create.isError, true);
    const withdraw = await client.callTool({
      name: "freee_personal_application_commit_withdraw",
      arguments: {
        id: "1234",
        fingerprint: "e".repeat(64),
        confirm: false,
      },
    });
    assert.equal(withdraw.isError, true);
    const cancel = await client.callTool({
      name: "freee_personal_application_commit_cancel",
      arguments: {
        id: "10034",
        reason: "Plans changed",
        fingerprint: "f".repeat(64),
        confirm: false,
      },
    });
    assert.equal(cancel.isError, true);
    assert.deepEqual(service.calls, []);
  } finally {
    await client.close();
    await server.close();
  }
});
