import { createHash } from "node:crypto";

import type {
  BrowserApprovalAction,
  BrowserApprovalDetail,
  BrowserApprovalSummary,
} from "./browser-approvals.js";
import type { BrowserTeamMemberStatus } from "./browser-team.js";
import { CliError } from "./errors.js";

const monthlyApprovalTypes = new Set(["月次勤怠締め", "月次勤怠締め申請"]);

export interface MonthlyAttendanceTableSnapshot {
  selectedPeriod: string | null;
  tables: Array<{ headers: string[]; rows: string[][] }>;
  warnings: string[];
}

export interface AttendancePeriodContext {
  workPeriod: string;
  paymentPeriod: string;
}

export interface BrowserMonthlyAttendanceDay {
  date: string;
  fields: Array<{ label: string; value: string }>;
  alerts: string[];
}

export interface BrowserMonthlyAttendanceReview {
  period: string;
  selectedPeriod: string;
  headers: string[];
  dayCount: number;
  alertDayCount: number;
  warnings: string[];
  days: BrowserMonthlyAttendanceDay[];
}

export interface BrowserMonthlyApprovalReview {
  application: BrowserApprovalDetail;
  period: string;
  attendanceSummary: BrowserTeamMemberStatus;
  attendance: BrowserMonthlyAttendanceReview;
  automaticChecks: string[];
}

export function isMonthlyApproval(application: BrowserApprovalSummary): boolean {
  return monthlyApprovalTypes.has(application.type.trim());
}

export function parseAttendancePeriodContext(pageText: string): AttendancePeriodContext {
  const normalized = pageText.trim().replace(/\s+/g, " ");
  const wrappedPeriodLabels = Array.from(normalized.matchAll(
    /(20\d{2})年(\d{1,2})月\d{1,2}日払い\s*[（(]\s*(20\d{2})年(\d{1,2})月\d{1,2}日\s*[〜～-]\s*20\d{2}年\d{1,2}月\d{1,2}日\s*勤務分\s*[）)]/g,
  ));
  const plainPeriodLabels = Array.from(normalized.matchAll(
    /(20\d{2})年(\d{1,2})月\d{1,2}日払い\s+(20\d{2})年(\d{1,2})月\d{1,2}日\s*[〜～-]\s*20\d{2}年\d{1,2}月\d{1,2}日\s*勤務分/g,
  ));
  const periodLabels = [...wrappedPeriodLabels, ...plainPeriodLabels];
  const contexts = Array.from(new Map(periodLabels.map((label) => {
    const context = {
      paymentPeriod: normalizePeriod(Number(label[1]), Number(label[2])),
      workPeriod: normalizePeriod(Number(label[3]), Number(label[4])),
    };
    return [`${context.paymentPeriod}:${context.workPeriod}`, context] as const;
  })).values());
  if (contexts.length !== 1 || !contexts[0]) {
    throw new CliError(
      "ATTENDANCE_PERIOD_NAVIGATION_UNEXPECTED",
      "The freee attendance page did not expose one payment month and work month for safe navigation.",
      { details: { periodContextCount: contexts.length }, exitCode: 2 },
    );
  }
  return contexts[0];
}

export function targetPaymentPeriodForWorkPeriod(
  current: AttendancePeriodContext,
  targetWorkPeriod: string,
): string {
  const currentWorkIndex = periodIndex(current.workPeriod);
  const currentPaymentIndex = periodIndex(current.paymentPeriod);
  const targetWorkIndex = periodIndex(targetWorkPeriod);
  return periodFromIndex(currentPaymentIndex + targetWorkIndex - currentWorkIndex);
}

export function requireMonthlyApproval(detail: BrowserApprovalDetail): string {
  if (!isMonthlyApproval(detail.application)) {
    throw new CliError(
      "MONTHLY_APPROVAL_TYPE_MISMATCH",
      "The requested application is not a supported monthly attendance closing application.",
      {
        details: { id: detail.application.id, type: detail.application.type },
        exitCode: 2,
      },
    );
  }
  const match = detail.application.targetDate?.match(/^(20\d{2})\/(\d{2})\/01$/);
  if (!match) {
    throw new CliError(
      "MONTHLY_APPROVAL_PERIOD_UNEXPECTED",
      "The monthly attendance application did not expose one supported work month.",
      {
        details: {
          id: detail.application.id,
          targetDate: detail.application.targetDate,
        },
        exitCode: 2,
      },
    );
  }
  return `${match[1]}-${match[2]}`;
}

export function selectMonthlyApprovalMember(
  detail: BrowserApprovalDetail,
  members: BrowserTeamMemberStatus[],
): BrowserTeamMemberStatus {
  const applicant = detail.application.applicant?.trim();
  if (!applicant) {
    throw new CliError(
      "MONTHLY_APPROVAL_APPLICANT_UNEXPECTED",
      "The monthly attendance application did not expose one applicant.",
      { details: { id: detail.application.id }, exitCode: 2 },
    );
  }
  let candidates = members.filter((member) => member.name === applicant);
  if (candidates.length > 1) {
    const department = detail.fields
      .find((field) => /部門/.test(field.label))?.value.trim();
    if (department) {
      candidates = candidates.filter((member) => member.department === department);
    }
  }
  if (candidates.length !== 1 || !candidates[0]) {
    throw new CliError(
      "MONTHLY_APPROVAL_MEMBER_AMBIGUOUS",
      "The monthly attendance applicant did not map to one unique visible attendance member.",
      {
        details: {
          id: detail.application.id,
          applicant,
          matchCount: candidates.length,
        },
        exitCode: 2,
      },
    );
  }
  return candidates[0];
}

export function parseMonthlyAttendanceTableSnapshot(
  snapshot: MonthlyAttendanceTableSnapshot,
  period: string,
): BrowserMonthlyAttendanceReview {
  const [yearText, monthText] = period.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new CliError(
      "MONTHLY_APPROVAL_PERIOD_UNEXPECTED",
      "The monthly attendance review period must use YYYY-MM.",
      { details: { period }, exitCode: 2 },
    );
  }
  const selectedPeriod = `${year}年${month}月`;
  if (snapshot.selectedPeriod !== selectedPeriod) {
    throw new CliError(
      "MONTHLY_APPROVAL_PERIOD_UNSUPPORTED",
      "The employee attendance calendar did not show the application work month.",
      {
        details: { requestedPeriod: period, selectedPeriod: snapshot.selectedPeriod },
        exitCode: 2,
      },
    );
  }

  const candidates = snapshot.tables
    .map((table) => ({ table, parsed: parseDailyTable(table, year, month) }))
    .filter((candidate) => candidate.parsed !== null);
  if (candidates.length !== 1 || !candidates[0]?.parsed) {
    throw new CliError(
      "MONTHLY_APPROVAL_ATTENDANCE_UNEXPECTED",
      "The employee attendance page did not expose one unique supported daily attendance table.",
      {
        details: {
          period,
          candidateCount: candidates.length,
          tableHeaders: snapshot.tables.map((table) => table.headers),
        },
        exitCode: 2,
      },
    );
  }
  const days = candidates[0].parsed;
  return {
    period,
    selectedPeriod,
    headers: candidates[0].table.headers,
    dayCount: days.length,
    alertDayCount: days.filter((day) => day.alerts.length > 0).length,
    warnings: normalizeUnique(snapshot.warnings),
    days,
  };
}

export function collectMonthlyAutomaticChecks(
  detail: BrowserApprovalDetail,
  attendance: BrowserMonthlyAttendanceReview,
): string[] {
  const values = [
    detail.application.checkResult,
    ...detail.fields
      .filter((field) => /チェック|アラート|警告/.test(field.label))
      .map((field) => `${field.label}: ${field.value}`),
    ...detail.detailLines.filter((line) => /チェック|アラート|警告|問題/.test(line)),
    ...attendance.warnings,
    ...attendance.days.flatMap((day) => day.alerts.map((alert) => `${day.date}: ${alert}`)),
  ].filter((value): value is string => Boolean(value?.trim()));
  return normalizeUnique(values);
}

export function createMonthlyApprovalFingerprint(
  review: BrowserMonthlyApprovalReview,
  action: BrowserApprovalAction,
): string {
  return createHash("sha256")
    .update(JSON.stringify({ version: 1, action, review }))
    .digest("hex");
}

function parseDailyTable(
  table: { headers: string[]; rows: string[][] },
  year: number,
  month: number,
): BrowserMonthlyAttendanceDay[] | null {
  const headers = table.headers.map((header) => header.trim().replace(/\s+/g, " "));
  const dateIndex = headers.findIndex((header) =>
    /^(?:日付(?:\s*[（(]?曜日[）)]?)?|日)$/.test(header));
  if (dateIndex < 0 || !headers.some((header) =>
    /出勤|退勤|勤務|労働|休憩|アラート|申請/.test(header))) {
    return null;
  }
  const days: BrowserMonthlyAttendanceDay[] = [];
  for (const row of table.rows) {
    if (row.length !== headers.length) {
      continue;
    }
    const date = normalizeDailyDate(row[dateIndex], year, month);
    if (!date) {
      continue;
    }
    const fields = headers.map((label, index) => ({
      label,
      value: row[index]?.trim().replace(/\s+/g, " ") ?? "",
    }));
    const alerts = fields
      .filter((field) => /アラート|警告/.test(field.label))
      .map((field) => field.value)
      .filter((value) => value !== "" && value !== "-" && value !== "—");
    days.push({ date, fields, alerts: normalizeUnique(alerts) });
  }
  if (days.length === 0 || new Set(days.map((day) => day.date)).size !== days.length) {
    return null;
  }
  return days;
}

function normalizeDailyDate(value: string | undefined, year: number, month: number): string | null {
  const normalized = value?.trim().replace(/\s+/g, " ") ?? "";
  const full = normalized.match(/^(20\d{2})[\/-](\d{1,2})[\/-](\d{1,2})/);
  const short = normalized.match(/^(\d{1,2})[\/-](\d{1,2})/);
  const fullJapanese = normalized.match(/^(20\d{2})年(\d{1,2})月(\d{1,2})日/);
  const shortJapanese = normalized.match(/^(\d{1,2})月(\d{1,2})日/);
  const dayOnly = normalized.match(/^(\d{1,2})日/);
  const parsedYear = full ? Number(full[1]) : fullJapanese ? Number(fullJapanese[1]) : year;
  const parsedMonth = full
    ? Number(full[2])
    : fullJapanese
      ? Number(fullJapanese[2])
      : short
        ? Number(short[1])
        : shortJapanese
          ? Number(shortJapanese[1])
          : month;
  const day = full
    ? Number(full[3])
    : fullJapanese
      ? Number(fullJapanese[3])
      : short
        ? Number(short[2])
        : shortJapanese
          ? Number(shortJapanese[2])
          : dayOnly
            ? Number(dayOnly[1])
            : NaN;
  if (parsedYear !== year || parsedMonth !== month || !Number.isInteger(day)) {
    return null;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function normalizeUnique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim().replace(/\s+/g, " "))))
    .filter((value) => value.length > 0);
}

function periodIndex(period: string): number {
  const match = period.match(/^(20\d{2})-(0[1-9]|1[0-2])$/);
  if (!match) {
    throw new CliError(
      "ATTENDANCE_PERIOD_NAVIGATION_UNEXPECTED",
      "The attendance period must use YYYY-MM.",
      { details: { period }, exitCode: 2 },
    );
  }
  return Number(match[1]) * 12 + Number(match[2]) - 1;
}

function periodFromIndex(index: number): string {
  const year = Math.floor(index / 12);
  const month = index % 12 + 1;
  return normalizePeriod(year, month);
}

function normalizePeriod(year: number, month: number): string {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new CliError(
      "ATTENDANCE_PERIOD_NAVIGATION_UNEXPECTED",
      "freee exposed an invalid attendance period.",
      { details: { year, month }, exitCode: 2 },
    );
  }
  return `${year}-${String(month).padStart(2, "0")}`;
}
