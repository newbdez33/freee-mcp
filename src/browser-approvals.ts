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

export interface BrowserApprovalPageInfo {
  page: number;
  pageCount: number;
  totalCount: number;
  perPage: number;
  rowCount: number;
  requestCodes: string[];
}

export interface BrowserApprovalDetail {
  application: BrowserApprovalSummary;
  fields: Array<{ label: string; value: string }>;
  tables: Array<{ headers: string[]; rows: string[][] }>;
  detailLines: string[];
  workTimeChange: BrowserApprovalWorkTimeChange | null;
  availableActions: BrowserApprovalAction[];
}

export interface BrowserApprovalWorkTimeValue {
  clockIn: string | null;
  clockOut: string | null;
  breakStart: string | null;
  breakEnd: string | null;
}

export interface BrowserApprovalWorkTimeChange {
  before: BrowserApprovalWorkTimeValue;
  after: BrowserApprovalWorkTimeValue;
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

export function parseApprovalPageInfo(value: unknown): BrowserApprovalPageInfo {
  if (!isRecord(value) || !Array.isArray(value.approval_requests) || !isRecord(value.meta)) {
    throw approvalResponseError();
  }
  const page = value.meta.current_page;
  const pageCount = value.meta.total_pages;
  const totalCount = value.meta.total_count;
  const perPage = value.meta.per;
  const requestCodes = value.approval_requests.map((application) =>
    isRecord(application) && isPositiveInteger(application.request_code)
      ? String(application.request_code)
      : null);
  if (!isPositiveInteger(page)
      || !isNonNegativeInteger(pageCount)
      || !isNonNegativeInteger(totalCount)
      || !isPositiveInteger(perPage)
      || value.approval_requests.length > perPage
      || value.approval_requests.length > totalCount
      || requestCodes.some((requestCode) => requestCode === null)
      || new Set(requestCodes).size !== requestCodes.length
      || Math.ceil(totalCount / perPage) !== pageCount
      || (totalCount === 0 && (pageCount !== 0 || value.approval_requests.length !== 0))
      || (totalCount > 0 && (pageCount === 0 || page > pageCount))) {
    throw approvalResponseError();
  }
  return {
    page,
    pageCount,
    totalCount,
    perPage,
    rowCount: value.approval_requests.length,
    requestCodes: requestCodes as string[],
  };
}

export function parseApprovalWorkTimeChange(
  application: Pick<BrowserApprovalSummary, "type">,
  tables: BrowserApprovalDetail["tables"],
): BrowserApprovalWorkTimeChange | null {
  if (application.type !== "勤務時間修正") {
    return null;
  }
  const workTimeRow = tables
    .flatMap((table) => table.rows)
    .find((row) => normalize(row[0]) === "勤務時間");
  const content = workTimeRow?.slice(1).join(" ").trim();
  if (!content) {
    return null;
  }

  const clockSection = sectionBetween(content, "出退勤時間", "休憩時間");
  const breakSection = sectionBetween(content, "休憩時間");
  const clockChange = parseTimeRangeChange(clockSection);
  const breakChange = parseTimeRangeChange(breakSection);
  if (!clockChange || !breakChange) {
    return null;
  }

  return {
    before: {
      clockIn: clockChange.before?.start ?? null,
      clockOut: clockChange.before?.end ?? null,
      breakStart: breakChange.before?.start ?? null,
      breakEnd: breakChange.before?.end ?? null,
    },
    after: {
      clockIn: clockChange.after?.start ?? null,
      clockOut: clockChange.after?.end ?? null,
      breakStart: breakChange.after?.start ?? null,
      breakEnd: breakChange.after?.end ?? null,
    },
  };
}

export function createApprovalFingerprint(
  detail: BrowserApprovalDetail,
  action: BrowserApprovalAction,
): string {
  return createHash("sha256")
    .update(JSON.stringify({ version: 2, action, detail }))
    .digest("hex");
}

function sectionBetween(value: string, startLabel: string, endLabel?: string): string | null {
  const start = value.indexOf(startLabel);
  if (start < 0) {
    return null;
  }
  const contentStart = start + startLabel.length;
  const end = endLabel ? value.indexOf(endLabel, contentStart) : value.length;
  if (endLabel && end < 0) {
    return null;
  }
  return value.slice(contentStart, end).trim();
}

function parseTimeRangeChange(value: string | null): {
  before: { start: string; end: string } | null;
  after: { start: string; end: string } | null;
} | null {
  if (!value) {
    return null;
  }
  const tokens = Array.from(value.matchAll(
    /未入力|([0-9]{1,2}:[0-9]{2})\s*[〜～]\s*([0-9]{1,2}:[0-9]{2})(?:\s*[（(][^）)]*[）)])?/g,
  ));
  if (tokens.length !== 2) {
    return null;
  }
  const parseToken = (token: RegExpMatchArray): { start: string; end: string } | null =>
    token[0] === "未入力" ? null : { start: token[1]!, end: token[2]! };
  return { before: parseToken(tokens[0]!), after: parseToken(tokens[1]!) };
}

function normalize(value: string | undefined): string | null {
  const normalized = value?.trim().replace(/\s+/g, " ") ?? "";
  return normalized === "" || normalized === "-" ? null : normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function approvalResponseError(): CliError {
  return new CliError(
    "BROWSER_APPROVAL_PAGE_UNEXPECTED",
    "The freee approval list response no longer matches the supported pagination schema.",
    { exitCode: 2 },
  );
}
