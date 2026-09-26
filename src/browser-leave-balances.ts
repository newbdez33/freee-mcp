import { CliError } from "./errors.js";

export interface LeaveBalanceSnapshot {
  employeeName: string | null;
  summary: Array<{ label: string; body: string }>;
  sections: Array<{ title: string; headers: string[]; rows: string[][] }>;
}

export interface LeaveBalanceGrant {
  validFrom: string | null;
  validTo: string | null;
  grantedDays: number | null;
  usedDays: number | null;
  remainingDays: number | null;
}

export interface SpecialLeaveBalance extends LeaveBalanceGrant {
  label: string;
}

export interface CompensatoryLeaveBalance {
  label: string;
  validFrom: string | null;
  validTo: string | null;
  remainingDays: number | null;
}

export interface PaidHolidayBalance {
  label: string;
  grantedDays: number | null;
  usedDays: number | null;
  remainingDays: number | null;
  grants: LeaveBalanceGrant[];
}

export interface BrowserLeaveBalances {
  employeeName: string | null;
  paidHoliday: PaidHolidayBalance;
  specialHolidays: SpecialLeaveBalance[];
  compensatoryHolidays: CompensatoryLeaveBalance[];
  summary: {
    paidHolidayUsed: string | null;
    paidHolidayRemaining: string | null;
    compensatoryRemaining: string | null;
  };
}

const paidHolidayHeaders = ["有効期間", "付与日数", "消化数", "残数"];
const specialHolidayHeaders = ["休暇名称", "有効期間", "付与日数", "消化数", "残数"];
const compensatoryHolidayHeaders = ["未取得の代休", "有効期間", "残数"];

export function parseLeaveBalanceSnapshot(snapshot: LeaveBalanceSnapshot): BrowserLeaveBalances {
  const summary = new Map<string, string>();
  for (const item of snapshot.summary) {
    const label = normalize(item.label);
    if (label && !summary.has(label)) {
      summary.set(label, normalize(item.body) ?? "");
    }
  }
  if (!summary.has("有休残数")) {
    throw new CliError(
      "BROWSER_LEAVE_BALANCE_PAGE_UNEXPECTED",
      "The freee employee attendance page did not expose the expected paid-holiday balance summary.",
      { exitCode: 2 },
    );
  }

  const grants = parseSection(snapshot, "年次有給休暇", paidHolidayHeaders)
    .map((row) => parseGrant(row));
  const specialHolidays = parseSection(snapshot, "特別休暇", specialHolidayHeaders)
    .map((row) => ({
      label: normalize(row[0]) ?? "",
      ...parseGrant(row.slice(1)),
    }))
    .filter((leave) => leave.label !== "");
  const compensatoryHolidays = parseSection(snapshot, "代休", compensatoryHolidayHeaders)
    .map((row) => {
      const period = parseValidPeriod(normalize(row[1]) ?? "");
      return {
        label: normalize(row[0]) ?? "",
        validFrom: period.validFrom,
        validTo: period.validTo,
        remainingDays: parseDays(normalize(row[2]) ?? ""),
      };
    })
    .filter((leave) => leave.label !== "");

  return {
    employeeName: normalize(snapshot.employeeName),
    paidHoliday: {
      label: "年次有給休暇",
      grantedDays: sumDays(grants.map((grant) => grant.grantedDays)),
      usedDays: sumDays(grants.map((grant) => grant.usedDays)),
      remainingDays: parseDays(summary.get("有休残数") ?? ""),
      grants,
    },
    specialHolidays,
    compensatoryHolidays,
    summary: {
      paidHolidayUsed: summary.get("有休取得数") ?? null,
      paidHolidayRemaining: summary.get("有休残数") ?? null,
      compensatoryRemaining: summary.get("代休残日数") ?? null,
    },
  };
}

function parseSection(
  snapshot: LeaveBalanceSnapshot,
  title: string,
  expectedHeaders: string[],
): string[][] {
  const section = snapshot.sections.find((candidate) => normalize(candidate.title) === title);
  if (!section) {
    return [];
  }
  const headers = section.headers.map((header) => normalize(header) ?? "");
  if (headers.length !== expectedHeaders.length
      || !expectedHeaders.every((header, index) => headers[index] === header)) {
    throw new CliError(
      "BROWSER_LEAVE_BALANCE_PAGE_UNEXPECTED",
      `The freee ${title} table headers no longer match the supported schema.`,
      { details: { title, headers: section.headers }, exitCode: 2 },
    );
  }
  return section.rows.map((row) => row.slice(0, expectedHeaders.length));
}

function parseGrant(row: string[]): LeaveBalanceGrant {
  const period = parseValidPeriod(normalize(row[0]) ?? "");
  return {
    validFrom: period.validFrom,
    validTo: period.validTo,
    grantedDays: parseDays(normalize(row[1]) ?? ""),
    usedDays: parseDays(normalize(row[2]) ?? ""),
    remainingDays: parseDays(normalize(row[3]) ?? ""),
  };
}

function parseValidPeriod(value: string): { validFrom: string | null; validTo: string | null } {
  const [from, to] = value.split(/[〜～~]/).map((part) => part.trim());
  return {
    validFrom: parseJapaneseDate(from),
    validTo: to === undefined ? null : parseJapaneseDate(to),
  };
}

function parseJapaneseDate(value: string | undefined): string | null {
  const match = value?.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日$/);
  if (!match) {
    return null;
  }
  const [, year, month, day] = match;
  return `${year}-${month!.padStart(2, "0")}-${day!.padStart(2, "0")}`;
}

function parseDays(value: string): number | null {
  const match = value.match(/^(\d+(?:\.\d+)?)日$/);
  if (!match) {
    return null;
  }
  const days = Number(match[1]);
  return Number.isFinite(days) ? days : null;
}

function sumDays(values: Array<number | null>): number | null {
  if (values.length === 0) {
    return null;
  }
  let total = 0;
  for (const value of values) {
    if (value === null) {
      return null;
    }
    total += value;
  }
  return total;
}

function normalize(value: string | null | undefined): string | null {
  const normalized = value?.trim().replace(/\s+/g, " ") ?? "";
  return normalized === "" ? null : normalized;
}
