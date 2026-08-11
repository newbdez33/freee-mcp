import { createHash } from "node:crypto";

import { CliError } from "./errors.js";

export type BrowserApprovalListStatus = "pending" | "returned" | "approved" | "all";
export type BrowserApprovalAction = "approve" | "return";

export interface BrowserApprovalSummary {
  id: string;
  status: string;
  type: string;
  targetDate: string | null;
  content: string | null;
  reason: string | null;
  appliedAt: string | null;
  currentApprover: string | null;
  checkResult: string | null;
}

export interface ApprovalListSnapshot {
  headers: string[];
  rows: string[][];
  pageCount?: number;
}

export interface BrowserApprovalDetail {
  application: BrowserApprovalSummary;
  fields: Array<{ label: string; value: string }>;
  tables: Array<{ headers: string[]; rows: string[][] }>;
  detailLines: string[];
  availableActions: BrowserApprovalAction[];
}

export function parseApprovalListSnapshot(snapshot: ApprovalListSnapshot): {
  pageCount: number;
  applications: BrowserApprovalSummary[];
} {
  const requiredHeaders = [
    "ステータス",
    "No.",
    "種別",
    "対象日",
    "申請内容",
    "申請理由",
    "申請日",
    "現在の承認者",
    "チェック結果",
  ];
  if (!requiredHeaders.every((header) => snapshot.headers.includes(header))) {
    throw new CliError(
      "BROWSER_APPROVAL_PAGE_UNEXPECTED",
      "The freee approval list headers no longer match the supported schema.",
      { details: { headers: snapshot.headers }, exitCode: 2 },
    );
  }

  const indexes = Object.fromEntries(
    requiredHeaders.map((header) => [header, snapshot.headers.indexOf(header)]),
  ) as Record<string, number>;
  const applications = snapshot.rows.map((cells) => {
    const id = normalize(cells[indexes["No."] ?? -1]);
    const status = normalize(cells[indexes["ステータス"] ?? -1]);
    const type = normalize(cells[indexes["種別"] ?? -1]);
    if (!id || !/^\d+$/.test(id) || !status || !type) {
      throw new CliError(
        "BROWSER_APPROVAL_PAGE_UNEXPECTED",
        "A freee approval row did not contain a numeric No., status, and type.",
        { exitCode: 2 },
      );
    }
    return {
      id,
      status,
      type,
      targetDate: normalize(cells[indexes["対象日"] ?? -1]),
      content: normalize(cells[indexes["申請内容"] ?? -1]),
      reason: normalize(cells[indexes["申請理由"] ?? -1]),
      appliedAt: normalize(cells[indexes["申請日"] ?? -1]),
      currentApprover: normalize(cells[indexes["現在の承認者"] ?? -1]),
      checkResult: normalize(cells[indexes["チェック結果"] ?? -1]),
    };
  });
  return { pageCount: snapshot.pageCount ?? 1, applications };
}

export function createApprovalFingerprint(
  detail: BrowserApprovalDetail,
  action: BrowserApprovalAction,
): string {
  return createHash("sha256")
    .update(JSON.stringify({ version: 1, action, detail }))
    .digest("hex");
}

function normalize(value: string | undefined): string | null {
  const normalized = value?.trim().replace(/\s+/g, " ") ?? "";
  return normalized === "" || normalized === "-" ? null : normalized;
}
