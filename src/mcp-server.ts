import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod/v4";

import { toPublicError } from "./errors.js";
import type { FreeeOperations } from "./service.js";
import { version } from "./version.js";

export const mcpServerInstructions = [
  "Use read tools when they match the user's request. For a 月次勤怠締め manager action, use the dedicated monthly approval review and prepare tools; never bypass them with the general approval commit. Never call a clock, approval, monthly, or personal-application commit tool unless the user's current message explicitly authorizes that exact real action after reviewing the matching prepare-tool preview. Always prepare first and pass the unchanged fingerprint. A general request to implement, inspect, continue, or handle work is not approval for a real write.",
  "The selected API or Playwright backend is exclusive for each server process; never fall back. Never request or expose passwords, Tokens, Client Secrets, Cookies, or browser profiles. If Playwright reports WEB_CREDENTIALS_UNAVAILABLE, show the exact setupCommand returned in the error and instruct the user to run it directly in a local interactive terminal; never accept credentials in chat or MCP arguments. If a preview changes or a result is unknown, stop and read status/detail before considering another write. Do not retry a write automatically.",
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
const monthlyActionSchema = z.enum(["submit", "withdraw"])
  .describe("submit creates a 月次勤怠締め application; withdraw uses 申請を取り下げる.");
const periodSchema = z.string().regex(/^\d{4}-\d{2}$/).optional()
  .describe("Optional work month in YYYY-MM. Playwright selects and verifies that work month before reading.");
const personalApplicationKindSchema = z.enum(["leave", "overtime", "work-time-correction"])
  .describe("Use the options tool first. Overtime is reported as unavailable until its company form is enabled and safely supported.");
const personalApplicationDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe("Application target date in YYYY-MM-DD format.");
const personalApplicationReasonSchema = z.string().max(1_000).optional()
  .describe("Optional application reason. Empty is allowed when freee allows it.");
const personalApplicationTimeSchema = z.string().regex(/^\d{2}:\d{2}$/).optional()
  .describe("Optional local time in HH:MM. Required clock fields depend on kind.");

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

export function createFreeeMcpServer(service: FreeeOperations): McpServer {
  const server = new McpServer(
    { name: "freee-agent", version },
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

  server.registerTool("freee_monthly_status", {
    title: "freee monthly attendance status",
    description: "Read the requested or currently selected personal 月次勤怠締め month and its available actions without changing freee.",
    inputSchema: { period: periodSchema },
    annotations: readOnlyAnnotations,
  }, async ({ period }) => executeTool(() => service.getMonthlyStatus(period)));

  server.registerTool("freee_monthly_prepare_action", {
    title: "Preview a freee monthly attendance action",
    description: "Read and preview one monthly submit or withdrawal action, returning a binding fingerprint. No application is changed.",
    inputSchema: {
      action: monthlyActionSchema,
      period: periodSchema,
    },
    annotations: readOnlyAnnotations,
  }, async ({ action, period }) => executeTool(
    () => service.prepareMonthlyAction(action, period),
  ));

  server.registerTool("freee_monthly_commit_action", {
    title: "Commit a freee monthly attendance action",
    description: "Submit or withdraw one real monthly attendance application only after matching preview and explicit current-message approval. Never call directly or retry automatically.",
    inputSchema: {
      action: monthlyActionSchema,
      period: periodSchema,
      fingerprint: fingerprintSchema,
      confirm: z.literal(true).describe("Must be true only after explicit current-message user approval."),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
  }, async ({ action, period, fingerprint, confirm }) => executeTool(
    () => service.commitMonthlyAction(action, fingerprint, confirm, period),
  ));

  server.registerTool("freee_personal_application_options", {
    title: "freee personal application options",
    description: "Read application types enabled for the current employee and, for an optional date, the leave types configured in freee. No application is changed.",
    inputSchema: { date: dateSchema },
    annotations: readOnlyAnnotations,
  }, async ({ date }) => executeTool(() => service.getPersonalApplicationOptions(date)));

  server.registerTool("freee_personal_applications_list", {
    title: "freee personal application list",
    description: "Read the current employee's pending, returned, approved, or complete personal application list.",
    inputSchema: {
      status: z.enum(["pending", "returned", "approved", "all"]).default("pending"),
      page: z.number().int().positive().default(1)
        .describe("One employee application-list page. Use pageCount from the result to continue."),
    },
    annotations: readOnlyAnnotations,
  }, async ({ status, page }) => executeTool(
    () => service.getPersonalApplications(status, page),
  ));

  server.registerTool("freee_personal_application_detail", {
    title: "freee personal application detail",
    description: "Read one application submitted by the current employee and report whether pending withdrawal or approved-application cancellation is currently available.",
    inputSchema: { id: approvalIdSchema },
    annotations: readOnlyAnnotations,
  }, async ({ id }) => executeTool(() => service.getPersonalApplicationDetail(id)));

  server.registerTool("freee_personal_application_prepare_create", {
    title: "Preview a freee personal application",
    description: "Fill and validate one leave or work-time correction form without submitting it, returning the route, exact values, and a binding fingerprint.",
    inputSchema: {
      kind: personalApplicationKindSchema,
      date: personalApplicationDateSchema,
      reason: personalApplicationReasonSchema,
      leave_type: z.string().min(1).max(100).optional()
        .describe("Required for leave; use one exact label returned by the options tool for this date."),
      leave_start: personalApplicationTimeSchema.describe("Required with leave_end when the selected leave type exposes a time range."),
      leave_end: personalApplicationTimeSchema.describe("Required with leave_start when the selected leave type exposes a time range."),
      clock_in: personalApplicationTimeSchema,
      clock_out: personalApplicationTimeSchema,
      break_start: personalApplicationTimeSchema,
      break_end: personalApplicationTimeSchema,
    },
    annotations: readOnlyAnnotations,
  }, async (args) => executeTool(
    () => service.preparePersonalApplicationCreate(toPersonalApplicationCreateInput(args)),
  ));

  server.registerTool("freee_personal_application_commit_create", {
    title: "Submit a freee personal application",
    description: "Submit one real leave or work-time correction application only after matching preview and explicit current-message approval. Never call directly or retry automatically.",
    inputSchema: {
      kind: personalApplicationKindSchema,
      date: personalApplicationDateSchema,
      reason: personalApplicationReasonSchema,
      leave_type: z.string().min(1).max(100).optional(),
      leave_start: personalApplicationTimeSchema,
      leave_end: personalApplicationTimeSchema,
      clock_in: personalApplicationTimeSchema,
      clock_out: personalApplicationTimeSchema,
      break_start: personalApplicationTimeSchema,
      break_end: personalApplicationTimeSchema,
      fingerprint: fingerprintSchema,
      confirm: z.literal(true).describe("Must be true only after explicit current-message user approval."),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  }, async ({ fingerprint, confirm, ...args }) => executeTool(
    () => service.commitPersonalApplicationCreate(
      toPersonalApplicationCreateInput(args),
      fingerprint,
      confirm,
    ),
  ));

  server.registerTool("freee_personal_application_prepare_cancel", {
    title: "Preview a freee approved-application cancellation",
    description: "Open and validate the cancellation form for one exact approved personal application without submitting it. Returns the original application, cancellation reason, route, and a binding fingerprint.",
    inputSchema: {
      id: approvalIdSchema,
      reason: personalApplicationReasonSchema
        .describe("Optional reason for cancelling the approved application. Empty is allowed when freee allows it."),
    },
    annotations: readOnlyAnnotations,
  }, async ({ id, reason }) => executeTool(
    () => service.preparePersonalApplicationCancel(id, reason),
  ));

  server.registerTool("freee_personal_application_commit_cancel", {
    title: "Submit a freee approved-application cancellation",
    description: "Create one real cancellation application for an approved personal application only after matching preview and explicit current-message approval. The result is a new cancellation application that may still require approval; never call directly or retry automatically.",
    inputSchema: {
      id: approvalIdSchema,
      reason: personalApplicationReasonSchema,
      fingerprint: fingerprintSchema,
      confirm: z.literal(true).describe("Must be true only after explicit current-message user approval."),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
  }, async ({ id, reason, fingerprint, confirm }) => executeTool(
    () => service.commitPersonalApplicationCancel(id, reason, fingerprint, confirm),
  ));

  server.registerTool("freee_personal_application_prepare_withdraw", {
    title: "Preview a freee personal application withdrawal",
    description: "Read one exact pending personal application and return a binding fingerprint without withdrawing it.",
    inputSchema: { id: approvalIdSchema },
    annotations: readOnlyAnnotations,
  }, async ({ id }) => executeTool(() => service.preparePersonalApplicationWithdraw(id)));

  server.registerTool("freee_personal_application_commit_withdraw", {
    title: "Withdraw a freee personal application",
    description: "Withdraw one real personal application only after matching preview and explicit current-message approval. Never call directly or retry automatically.",
    inputSchema: {
      id: approvalIdSchema,
      fingerprint: fingerprintSchema,
      confirm: z.literal(true).describe("Must be true only after explicit current-message user approval."),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
  }, async ({ id, fingerprint, confirm }) => executeTool(
    () => service.commitPersonalApplicationWithdraw(id, fingerprint, confirm),
  ));

  server.registerTool("freee_approvals_list", {
    title: "freee application list",
    description: "Read applications visible in the current account's approval workflow. Defaults to pending applications.",
    inputSchema: {
      status: z.enum(["pending", "returned", "approved", "all"]).default("pending"),
      page: z.number().int().positive().default(1)
        .describe("One freee approval-list page. Use pageCount from the result to continue."),
    },
    annotations: readOnlyAnnotations,
  }, async ({ status, page }) => executeTool(() => service.getApprovals(status, page)));

  server.registerTool("freee_monthly_approvals_list", {
    title: "freee monthly attendance approval list",
    description: "Read only 月次勤怠締め applications visible in the current account's approval workflow. Results are filtered from one explicit approval-list page.",
    inputSchema: {
      status: z.enum(["pending", "returned", "approved", "all"]).default("pending"),
      page: z.number().int().positive().default(1)
        .describe("One freee approval-list page. Use pageCount from the result to continue."),
    },
    annotations: readOnlyAnnotations,
  }, async ({ status, page }) => executeTool(
    () => service.getMonthlyApprovals(status, page),
  ));

  server.registerTool("freee_monthly_approval_review", {
    title: "Review a freee monthly attendance application",
    description: "Read one exact 月次勤怠締め application, its applicant's monthly attendance summary, daily attendance table, alerts, and automatic checks without changing freee.",
    inputSchema: { id: approvalIdSchema },
    annotations: readOnlyAnnotations,
  }, async ({ id }) => executeTool(() => service.getMonthlyApprovalReview(id)));

  server.registerTool("freee_monthly_approval_prepare_action", {
    title: "Preview a freee monthly attendance approval action",
    description: "Review one exact 月次勤怠締め application and bind its detail, monthly summary, daily attendance, alerts, automatic checks, and requested approval/return action into a fingerprint. No application is changed.",
    inputSchema: {
      id: approvalIdSchema,
      action: approvalActionSchema,
    },
    annotations: readOnlyAnnotations,
  }, async ({ id, action }) => executeTool(
    () => service.prepareMonthlyApprovalAction(id, action),
  ));

  server.registerTool("freee_monthly_approval_commit_action", {
    title: "Commit a freee monthly attendance approval action",
    description: "Approve or return one real 月次勤怠締め application only after matching the complete monthly review and receiving explicit current-message approval. Never call directly or retry automatically.",
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
    () => service.commitMonthlyApprovalAction(id, action, fingerprint, confirm),
  ));

  server.registerTool("freee_approval_detail", {
    title: "freee application detail",
    description: "Read one application, including applicant, dates, content, reason, comments, approval route, and automatic checks. A supported 勤務時間修正 also returns structured workTimeChange.before and workTimeChange.after values; null time fields mean freee displayed 未入力.",
    inputSchema: { id: approvalIdSchema },
    annotations: readOnlyAnnotations,
  }, async ({ id }) => executeTool(() => service.getApprovalDetail(id)));

  server.registerTool("freee_approval_prepare_action", {
    title: "Preview a freee application action",
    description: "Read and preview one available approval or return action, including any structured 勤務時間修正 before/after comparison, and return a binding fingerprint. No application is changed.",
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

function toPersonalApplicationCreateInput(args: {
  kind: "leave" | "overtime" | "work-time-correction";
  date: string;
  reason?: string;
  leave_type?: string;
  leave_start?: string;
  leave_end?: string;
  clock_in?: string;
  clock_out?: string;
  break_start?: string;
  break_end?: string;
}): {
  kind: "leave" | "overtime" | "work-time-correction";
  date: string;
  reason?: string;
  leaveType?: string;
  leaveStart?: string;
  leaveEnd?: string;
  clockIn?: string;
  clockOut?: string;
  breakStart?: string;
  breakEnd?: string;
} {
  return {
    kind: args.kind,
    date: args.date,
    ...(args.reason === undefined ? {} : { reason: args.reason }),
    ...(args.leave_type === undefined ? {} : { leaveType: args.leave_type }),
    ...(args.leave_start === undefined ? {} : { leaveStart: args.leave_start }),
    ...(args.leave_end === undefined ? {} : { leaveEnd: args.leave_end }),
    ...(args.clock_in === undefined ? {} : { clockIn: args.clock_in }),
    ...(args.clock_out === undefined ? {} : { clockOut: args.clock_out }),
    ...(args.break_start === undefined ? {} : { breakStart: args.break_start }),
    ...(args.break_end === undefined ? {} : { breakEnd: args.break_end }),
  };
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
