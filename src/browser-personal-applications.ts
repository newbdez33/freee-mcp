import { createHash } from "node:crypto";

import type {
  BrowserApprovalDetail,
  BrowserApprovalListStatus,
  BrowserApprovalSummary,
} from "./browser-approvals.js";
import { CliError } from "./errors.js";

export type BrowserPersonalApplicationListStatus = BrowserApprovalListStatus;
export type BrowserPersonalApplicationKind =
  | "leave"
  | "overtime"
  | "work-time-correction";

export interface BrowserPersonalApplicationCapability {
  kind: BrowserPersonalApplicationKind;
  label: string;
  available: boolean;
  supported: boolean;
}

export interface BrowserPersonalApplicationOptions {
  applicationTypes: BrowserPersonalApplicationCapability[];
  leaveTypes: string[] | null;
  leaveTypesDate: string | null;
}

export interface BrowserPersonalApplicationDetail
  extends Omit<BrowserApprovalDetail, "availableActions"> {
  availableActions: Array<"withdraw">;
}

export interface BrowserPersonalApplicationList {
  filter: BrowserPersonalApplicationListStatus;
  page: number;
  pageCount: number;
  totalCount: number;
  applicationCount: number;
  applications: BrowserApprovalSummary[];
}

export interface BrowserPersonalApplicationCreateInput {
  kind: BrowserPersonalApplicationKind;
  date: string;
  reason?: string;
  leaveType?: string;
  leaveStart?: string;
  leaveEnd?: string;
  clockIn?: string;
  clockOut?: string;
  breakStart?: string;
  breakEnd?: string;
}

export interface NormalizedPersonalApplicationCreateInput {
  kind: BrowserPersonalApplicationKind;
  date: string;
  reason: string;
  leaveType: string | null;
  leaveStart: string | null;
  leaveEnd: string | null;
  clockIn: string | null;
  clockOut: string | null;
  breakStart: string | null;
  breakEnd: string | null;
}

export interface BrowserPersonalApplicationCreatePreview {
  application: NormalizedPersonalApplicationCreateInput;
  typeLabel: string;
  route: string;
  existingFirstPage: {
    count: number;
    fingerprint: string;
  };
}

export function normalizePersonalApplicationCreateInput(
  input: BrowserPersonalApplicationCreateInput,
): NormalizedPersonalApplicationCreateInput {
  const date = input.date.trim();
  if (!isCalendarDate(date)) {
    throw new CliError(
      "INVALID_PERSONAL_APPLICATION_DATE",
      "The personal application date must be a real calendar date in YYYY-MM-DD format.",
      { details: { date }, exitCode: 2 },
    );
  }
  const reason = input.reason?.trim() ?? "";
  if (reason.length > 1_000) {
    throw new CliError(
      "INVALID_PERSONAL_APPLICATION_REASON",
      "The personal application reason must not exceed 1000 characters.",
      { exitCode: 2 },
    );
  }
  const leaveType = normalizeOptional(input.leaveType);
  const leaveStart = normalizeOptional(input.leaveStart);
  const leaveEnd = normalizeOptional(input.leaveEnd);
  const clockIn = normalizeOptional(input.clockIn);
  const clockOut = normalizeOptional(input.clockOut);
  const breakStart = normalizeOptional(input.breakStart);
  const breakEnd = normalizeOptional(input.breakEnd);

  if (input.kind === "leave") {
    if (!leaveType || leaveType.length > 100) {
      throw new CliError(
        "INVALID_PERSONAL_APPLICATION_LEAVE_TYPE",
        "A leave application requires one freee leave type returned by the options tool.",
        { exitCode: 2 },
      );
    }
    if ((leaveStart === null) !== (leaveEnd === null)
        || (leaveStart !== null && (!isClockTime(leaveStart) || !isClockTime(leaveEnd)))) {
      throw new CliError(
        "INVALID_PERSONAL_APPLICATION_LEAVE_TIME",
        "leave_start and leave_end must either both be omitted or both use HH:MM format.",
        { exitCode: 2 },
      );
    }
    if (leaveStart !== null && leaveEnd !== null && toMinutes(leaveStart) >= toMinutes(leaveEnd)) {
      throw new CliError(
        "INVALID_PERSONAL_APPLICATION_LEAVE_TIME",
        "leave_start must be earlier than leave_end.",
        { exitCode: 2 },
      );
    }
    assertUnusedTimeFields(input.kind, { clockIn, clockOut, breakStart, breakEnd });
    return {
      kind: input.kind,
      date,
      reason,
      leaveType,
      leaveStart,
      leaveEnd,
      clockIn: null,
      clockOut: null,
      breakStart: null,
      breakEnd: null,
    };
  }

  if (input.kind === "work-time-correction") {
    if (!isClockTime(clockIn) || !isClockTime(clockOut)) {
      throw new CliError(
        "INVALID_PERSONAL_APPLICATION_TIME",
        "A work-time correction requires clock_in and clock_out in HH:MM format.",
        { exitCode: 2 },
      );
    }
    if ((breakStart === null) !== (breakEnd === null)
        || (breakStart !== null && (!isClockTime(breakStart) || !isClockTime(breakEnd)))) {
      throw new CliError(
        "INVALID_PERSONAL_APPLICATION_BREAK",
        "break_start and break_end must either both be omitted or both use HH:MM format.",
        { exitCode: 2 },
      );
    }
    if (leaveType) {
      throw new CliError(
        "INVALID_PERSONAL_APPLICATION_FIELDS",
        "leave_type is valid only for a leave application.",
        { exitCode: 2 },
      );
    }
    if (leaveStart || leaveEnd) {
      throw new CliError(
        "INVALID_PERSONAL_APPLICATION_FIELDS",
        "leave_start and leave_end are valid only for a leave application.",
        { exitCode: 2 },
      );
    }
    return {
      kind: input.kind,
      date,
      reason,
      leaveType: null,
      leaveStart: null,
      leaveEnd: null,
      clockIn,
      clockOut,
      breakStart,
      breakEnd,
    };
  }

  if (input.kind === "overtime") {
    if (leaveType || leaveStart || leaveEnd || clockIn || clockOut || breakStart || breakEnd) {
      throw new CliError(
        "INVALID_PERSONAL_APPLICATION_FIELDS",
        "The current overtime capability check does not accept leave or work-time fields.",
        { exitCode: 2 },
      );
    }
    return {
      kind: input.kind,
      date,
      reason,
      leaveType: null,
      leaveStart: null,
      leaveEnd: null,
      clockIn: null,
      clockOut: null,
      breakStart: null,
      breakEnd: null,
    };
  }

  throw new CliError(
    "INVALID_PERSONAL_APPLICATION_KIND",
    "The personal application kind is not supported.",
    { exitCode: 2 },
  );
}

export function createPersonalApplicationCreateFingerprint(
  preview: BrowserPersonalApplicationCreatePreview,
): string {
  return hash({ version: 1, action: "create", preview });
}

export function createPersonalApplicationWithdrawFingerprint(
  preview: BrowserPersonalApplicationDetail,
): string {
  return hash({ version: 1, action: "withdraw", preview });
}

export function createPersonalApplicationListFingerprint(ids: string[]): string {
  return hash({ version: 1, ids });
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function normalizeOptional(value: string | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized === "" ? null : normalized;
}

function isClockTime(value: string | null): value is string {
  if (value === null || !/^\d{2}:\d{2}$/.test(value)) {
    return false;
  }
  const [hour, minute] = value.split(":").map(Number);
  return hour! >= 0 && hour! <= 23 && minute! >= 0 && minute! <= 59;
}

function toMinutes(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return hour! * 60 + minute!;
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month! - 1
    && date.getUTCDate() === day;
}

function assertUnusedTimeFields(
  kind: BrowserPersonalApplicationKind,
  fields: {
    clockIn: string | null;
    clockOut: string | null;
    breakStart: string | null;
    breakEnd: string | null;
  },
): void {
  if (Object.values(fields).some((value) => value !== null)) {
    throw new CliError(
      "INVALID_PERSONAL_APPLICATION_FIELDS",
      `Time fields are not valid for a '${kind}' application.`,
      { exitCode: 2 },
    );
  }
}
