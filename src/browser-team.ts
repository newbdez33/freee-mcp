import { CliError } from "./errors.js";

export interface AttendanceMonitorSnapshot {
  headers: string[];
  rows: string[][];
  periodCandidates: string[];
  selectedPeriod?: string | null;
  periodDescriptors?: Array<{
    value: string;
    tag: string;
    className: string;
    testId: string | null;
    ariaCurrent: string | null;
  }>;
}

export interface BrowserTeamMemberStatus {
  name: string;
  department: string | null;
  employmentType: string | null;
  closingApplication: string | null;
  issues: {
    unregistered: string | null;
    missingClockOut: string | null;
    suspectedMissingClockOut: string | null;
    insufficientBreak: string | null;
    applicationRequired: string | null;
    inconsistent: string | null;
  };
  work: {
    workDays: string | null;
    total: string | null;
    scheduled: string | null;
    statutoryOvertime: string | null;
    overtime: string | null;
    statutoryHoliday: string | null;
    night: string | null;
    absence: string | null;
    late: string | null;
    earlyLeave: string | null;
    scheduledDifference: string | null;
  };
  hasIssue: boolean;
}

export function parseAttendanceMonitorSnapshot(
  snapshot: AttendanceMonitorSnapshot,
  requestedDate?: string,
): {
  period: string;
  memberCount: number;
  issueMemberCount: number;
  members: BrowserTeamMemberStatus[];
} {
  const requiredHeaders = [
    "締め申請",
    "氏名",
    "部門",
    "勤怠不備",
    "未登録",
    "退勤打刻漏れ",
    "休憩不足",
    "総労働",
  ];
  if (!requiredHeaders.every((header) => snapshot.headers.includes(header))) {
    throw new CliError(
      "BROWSER_TEAM_PAGE_UNEXPECTED",
      "The freee attendance monitor headers no longer match the supported schema.",
      { exitCode: 2 },
    );
  }
  const periods = snapshot.selectedPeriod
    ? [snapshot.selectedPeriod]
    : [...new Set(snapshot.periodCandidates)];
  if (periods.length !== 1 || !periods[0]) {
    throw new CliError(
      "BROWSER_TEAM_PERIOD_AMBIGUOUS",
      "The freee attendance monitor did not expose one unambiguous monthly period.",
      { details: { periods, descriptors: snapshot.periodDescriptors ?? [] }, exitCode: 2 },
    );
  }
  const period = periods[0];
  if (requestedDate) {
    const [year, month] = requestedDate.split("-");
    const requestedPeriod = `${year}年${Number(month)}月`;
    if (period !== requestedPeriod) {
      throw new CliError(
        "BROWSER_DATE_UNSUPPORTED",
        "The Playwright attendance monitor currently supports only its selected month.",
        { details: { selectedPeriod: period, requestedPeriod }, exitCode: 2 },
      );
    }
  }

  const members = snapshot.rows.map((cells) => parseMemberRow(cells));
  return {
    period,
    memberCount: members.length,
    issueMemberCount: members.filter((member) => member.hasIssue).length,
    members,
  };
}

function parseMemberRow(cells: string[]): BrowserTeamMemberStatus {
  if (cells.length < 35) {
    throw new CliError(
      "BROWSER_TEAM_PAGE_UNEXPECTED",
      "A freee attendance monitor member row had fewer columns than expected.",
      { exitCode: 2 },
    );
  }
  const name = normalize(cells[3]);
  if (!name) {
    throw new CliError(
      "BROWSER_TEAM_PAGE_UNEXPECTED",
      "A freee attendance monitor member row did not contain a name.",
      { exitCode: 2 },
    );
  }
  const issueValues = cells.slice(11, 17).map(normalize);
  return {
    name,
    department: normalize(cells[8]),
    employmentType: normalize(cells[9]),
    closingApplication: normalize(cells[2]),
    issues: {
      unregistered: issueValues[0] ?? null,
      missingClockOut: issueValues[1] ?? null,
      suspectedMissingClockOut: issueValues[2] ?? null,
      insufficientBreak: issueValues[3] ?? null,
      applicationRequired: issueValues[4] ?? null,
      inconsistent: issueValues[5] ?? null,
    },
    work: {
      workDays: normalize(cells[17]),
      total: normalize(cells[18]),
      scheduled: normalize(cells[19]),
      statutoryOvertime: normalize(cells[20]),
      overtime: normalize(cells[21]),
      statutoryHoliday: normalize(cells[22]),
      night: normalize(cells[23]),
      absence: normalize(cells[24]),
      late: normalize(cells[25]),
      earlyLeave: normalize(cells[26]),
      scheduledDifference: normalize(cells[27]),
    },
    hasIssue: issueValues.some(isIssueValue),
  };
}

function normalize(value: string | undefined): string | null {
  const normalized = value?.trim().replace(/\s+/g, " ") ?? "";
  return normalized === "" ? null : normalized;
}

function isIssueValue(value: string | null): boolean {
  return value !== null
    && !new Set(["-", "—"]).has(value)
    && !/^0(?:件|日|回|時間|分|:00)?$/.test(value);
}
