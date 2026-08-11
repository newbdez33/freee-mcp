import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod/v4";

import { toPublicError } from "./errors.js";
import type { FreeeOperations } from "./service.js";

export const mcpServerInstructions = [
  "Use read tools when they match the user's request. Never call freee_clock_commit_action or freee_approval_commit_action unless the user's current message explicitly authorizes that exact real action after reviewing the matching prepare-tool preview. Always prepare first and pass the unchanged fingerprint. A general request to implement, inspect, continue, or handle work is not approval for a real write.",
  "The selected API or Playwright backend is exclusive for each server process; never fall back. Never request or expose passwords, Tokens, Client Secrets, Cookies, or browser profiles. If Playwright reports WEB_CREDENTIALS_UNAVAILABLE, instruct the user to run `npm run freee -- browser configure --confirm` directly in a local interactive terminal; never accept credentials in chat or MCP arguments. If a preview changes or a result is unknown, stop and read status/detail before considering another write. Do not retry a write automatically.",
].join(" ");

const companyIdSchema = z.number().int().positive().optional()
  .describe("Optional freee company ID. Unsupported by the Playwright backend.");
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
  .describe("Optional date in YYYY-MM-DD format.");
const clockActionSchema = z.enum(["in", "break-start", "break-end", "out"]);
const approvalIdSchema = z.string().regex(/^\d+$/)
  .describe("The numeric No. shown in the freee application list.");
const approvalActionSchema = z.enum(["approve", "return"])
  .describe("approve maps to 承認; return maps to 申請者へ差し戻す.");
const fingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/)
  .describe("The unchanged SHA-256 fingerprint returned by the matching prepare tool.");

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

export function createFreeeMcpServer(service: FreeeOperations): McpServer {
  const server = new McpServer(
    { name: "freee-agent", version: "0.2.0" },
    { instructions: mcpServerInstructions },
  );

  server.registerTool("freee_backend_status", {
    title: "freee backend status",
    description: "Read the exclusive freee backend selected for this MCP server process.",
    annotations: readOnlyAnnotations,
  }, async () => executeTool(() => service.getBackendStatus()));

  server.registerTool("freee_auth_status", {
    title: "freee authentication status",
    description: "Verify freee authentication without returning any credential or secret. Missing Playwright credentials return safe local setup guidance.",
    annotations: readOnlyAnnotations,
  }, async () => executeTool(() => service.getAuthStatus()));

  server.registerTool("freee_me", {
    title: "freee identity",
    description: "Read the authenticated freee user and company identities. Available on the API backend.",
    annotations: readOnlyAnnotations,
  }, async () => executeTool(() => service.getMe()));

  server.registerTool("freee_clock_status", {
    title: "freee clock status",
    description: "Read the current available freee punch actions. This tool never creates a punch.",
    inputSchema: {
      company_id: companyIdSchema,
      date: dateSchema,
    },
    annotations: readOnlyAnnotations,
  }, async ({ company_id, date }) => executeTool(
    () => service.getClockStatus({
      ...(company_id === undefined ? {} : { companyId: company_id }),
      ...(date === undefined ? {} : { date }),
    }),
  ));

  server.registerTool("freee_clock_prepare_action", {
    title: "Preview a freee clock action",
    description: "Read and preview one currently available punch action, returning a binding fingerprint. No punch is created.",
    inputSchema: {
      action: clockActionSchema,
      company_id: companyIdSchema,
    },
    annotations: readOnlyAnnotations,
  }, async ({ action, company_id }) => executeTool(
    () => service.prepareClockAction(
      action,
      company_id === undefined ? {} : { companyId: company_id },
    ),
  ));

  server.registerTool("freee_clock_commit_action", {
    title: "Commit a freee clock action",
    description: "Create one real punch only after the matching preview and explicit current-message user approval. Never call directly or retry automatically.",
    inputSchema: {
      action: clockActionSchema,
      company_id: companyIdSchema,
      fingerprint: fingerprintSchema,
      confirm: z.literal(true).describe("Must be true only after explicit current-message user approval."),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  }, async ({ action, company_id, fingerprint, confirm }) => executeTool(
    () => service.commitClockAction(
      action,
      fingerprint,
      confirm,
      company_id === undefined ? {} : { companyId: company_id },
    ),
  ));

  server.registerTool("freee_team_status", {
    title: "freee team attendance",
    description: "Read department attendance or the selected monthly attendance-monitor summary without changing freee.",
    inputSchema: {
      company_id: companyIdSchema,
      group_id: z.number().int().positive().optional()
        .describe("Optional department ID. Unsupported by the Playwright backend."),
      date: dateSchema,
    },
    annotations: readOnlyAnnotations,
  }, async ({ company_id, group_id, date }) => executeTool(
    () => service.getTeamStatus({
      ...(company_id === undefined ? {} : { companyId: company_id }),
      ...(group_id === undefined ? {} : { groupId: group_id }),
      ...(date === undefined ? {} : { date }),
    }),
  ));

  server.registerTool("freee_approvals_list", {
    title: "freee application list",
    description: "Read applications visible in the current account's approval workflow. Defaults to pending applications.",
    inputSchema: {
      status: z.enum(["pending", "returned", "approved", "all"]).default("pending"),
    },
    annotations: readOnlyAnnotations,
  }, async ({ status }) => executeTool(() => service.getApprovals(status)));

  server.registerTool("freee_approval_detail", {
    title: "freee application detail",
    description: "Read one application, including applicant, dates, content, reason, comments, approval route, and automatic checks.",
    inputSchema: { id: approvalIdSchema },
    annotations: readOnlyAnnotations,
  }, async ({ id }) => executeTool(() => service.getApprovalDetail(id)));

  server.registerTool("freee_approval_prepare_action", {
    title: "Preview a freee application action",
    description: "Read and preview one available approval or return action, returning a binding fingerprint. No application is changed.",
    inputSchema: {
      id: approvalIdSchema,
      action: approvalActionSchema,
    },
    annotations: readOnlyAnnotations,
  }, async ({ id, action }) => executeTool(() => service.prepareApprovalAction(id, action)));

  server.registerTool("freee_approval_commit_action", {
    title: "Commit a freee application action",
    description: "Change one real application only after matching preview and explicit current-message approval. Never call directly or retry automatically.",
    inputSchema: {
      id: approvalIdSchema,
      action: approvalActionSchema,
      fingerprint: fingerprintSchema,
      confirm: z.literal(true).describe("Must be true only after explicit current-message user approval."),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
  }, async ({ id, action, fingerprint, confirm }) => executeTool(
    () => service.commitApprovalAction(id, action, fingerprint, confirm),
  ));

  return server;
}

async function executeTool(operation: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    const data = await operation();
    const envelope = { ok: true, data };
    return {
      content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }],
      structuredContent: envelope,
    };
  } catch (error) {
    const publicError = toPublicError(error);
    const { exitCode: _exitCode, ...safeError } = publicError;
    const envelope = { ok: false, error: safeError };
    return {
      isError: true,
      content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }],
      structuredContent: envelope,
    };
  }
}
