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
    async getBackendStatus() { return { backend: "playwright" }; },
    async getAuthStatus() { return { backend: "playwright", authenticated: true }; },
    async getMe() { return { backend: "playwright" }; },
    async getClockStatus() { return { backend: "playwright", status: { available_actions: [] } }; },
    async prepareClockAction(action) { return { backend: "playwright", action, fingerprint: "a".repeat(64) }; },
    async commitClockAction(action, fingerprint, confirm) {
      calls.push(["clock-commit", action, fingerprint, confirm]);
      return { backend: "playwright", action, verified: true };
    },
    async getTeamStatus() { return { backend: "playwright", memberCount: 0 }; },
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
      "freee_approvals_list",
      "freee_approval_detail",
      "freee_approval_prepare_action",
      "freee_approval_commit_action",
    ]);
    assert.match(client.getInstructions(), /Always prepare first/);
    assert.match(client.getInstructions(), /setupCommand/);
    assert.equal(
      listed.tools.find((tool) => tool.name === "freee_team_status").annotations.readOnlyHint,
      true,
    );
    assert.equal(
      listed.tools.find((tool) => tool.name === "freee_approval_commit_action").annotations.destructiveHint,
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
      data: { backend: "playwright" },
    });

    const approvals = await client.callTool({ name: "freee_approvals_list", arguments: {} });
    assert.equal(approvals.structuredContent.data.filter, "pending");
    assert.equal(approvals.structuredContent.data.page, 1);
    const approved = await client.callTool({
      name: "freee_approvals_list",
      arguments: { status: "approved", page: 2 },
    });
    assert.equal(approved.structuredContent.data.page, 2);
    assert.deepEqual(service.calls, [
      ["approvals-list", "pending", 1],
      ["approvals-list", "approved", 2],
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
  } finally {
    await client.close();
    await server.close();
  }
});
