import { createHash } from "node:crypto";

import { CliError } from "./errors.js";

export type BrowserApprovalListStatus = "pending" | "returned" | "approved" | "all";
export type BrowserApprovalAction = "approve" | "return";

export interface BrowserApprovalSummary {
  id: string;
  status: string;
  applicant: string | null;
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

  const applicantHeader = ["申請者（代理申請者）", "申請者"]
    .find((header) => snapshot.headers.includes(header));
  const applications = snapshot.rows.map((cells) => {
    const offset = getApprovalRowOffset(snapshot.headers, cells);
    const valueFor = (header: string): string | undefined => {
      const index = snapshot.headers.indexOf(header);
      return index < 0 ? undefined : cells[index + offset];
    };
    const id = normalize(valueFor("No."));
    const status = normalize(valueFor("ステータス"));
    const type = normalize(valueFor("種別"));
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
      applicant: applicantHeader
        ? normalize(valueFor(applicantHeader))
        : null,
      type,
      targetDate: normalize(valueFor("対象日")),
      content: normalize(valueFor("申請内容")),
      reason: normalize(valueFor("申請理由")),
      appliedAt: normalize(valueFor("申請日")),
      currentApprover: normalize(valueFor("現在の承認者")),
      checkResult: normalize(valueFor("チェック結果")),
    };
  });
  return { pageCount: snapshot.pageCount ?? 1, applications };
}

export function getApprovalRowOffset(headers: string[], cells: string[]): number {
  const statusIndex = headers.indexOf("ステータス");
  const idIndex = headers.indexOf("No.");
  const typeIndex = headers.indexOf("種別");
  const maximumOffset = Math.max(0, cells.length - headers.length);
  const candidates = Array.from({ length: maximumOffset + 1 }, (_, offset) => offset)
    .filter((offset) => {
      const status = normalize(cells[statusIndex + offset]);
      const id = normalize(cells[idIndex + offset]);
      const type = normalize(cells[typeIndex + offset]);
      return Boolean(status && id && /^\d+$/.test(id) && type);
    });
  if (candidates.length !== 1) {
    throw new CliError(
      "BROWSER_APPROVAL_PAGE_UNEXPECTED",
      "A freee approval row did not align uniquely with the supported table headers.",
      { exitCode: 2 },
    );
  }
  return candidates[0]!;
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
