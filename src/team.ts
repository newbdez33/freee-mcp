import type { FreeeApi } from "./client.js";
import { resolveEmployeeContext } from "./attendance.js";
import { CliError } from "./errors.js";
import type {
  EmployeeGroupMembership,
  EmployeeTimeClock,
  GroupMembership,
  TeamMemberAttendanceState,
  TimeClockType,
} from "./types.js";

const japanTimeZone = "Asia/Tokyo";
const timeClockOrder: Record<TimeClockType, number> = {
  clock_in: 0,
  break_begin: 1,
  break_end: 2,
  clock_out: 3,
};

export interface TeamStatusOptions {
  companyId?: number;
  groupId?: number;
  date?: string;
}

export interface TeamStatusResult {
  context: ReturnType<typeof resolveEmployeeContext>;
  date: string;
  group: {
    id: number;
    code: string | null;
    name: string | null;
  };
  summary: Record<TeamMemberAttendanceState, number> & { memberCount: number };
  members: TeamMemberStatus[];
}

export interface TeamMemberStatus {
  employeeId: number;
  displayName: string | null;
  isSelf: boolean;
  positionName: string | null;
  state: TeamMemberAttendanceState;
  firstClockInAt: string | null;
  lastClockOutAt: string | null;
  latestEvent: { type: TimeClockType; datetime: string | null } | null;
  events: Array<{ type: TimeClockType; datetime: string | null }>;
  issues: string[];
}

export async function getTeamStatus(
  api: FreeeApi,
  options: TeamStatusOptions = {},
): Promise<TeamStatusResult> {
  const me = await api.getCurrentUser();
  const context = resolveEmployeeContext(me, options.companyId);
  const date = options.date ?? currentDateInJapan();
  assertCalendarDate(date);

  const employees = await api.listEmployeeGroupMemberships(context.companyId, date);
  const selectedGroup = selectGroup(employees, context.employeeId, options.groupId);
  const members = employees
    .map((employee) => {
      const membership = employee.group_memberships?.find(
        (candidate) => candidate.group_id === selectedGroup.group_id,
      );
      return membership ? { employee, membership } : null;
    })
    .filter(
      (candidate): candidate is { employee: EmployeeGroupMembership; membership: GroupMembership } =>
        candidate !== null,
    )
    .sort((left, right) => compareEmployees(left.employee, right.employee));

  const memberStatuses = await mapWithConcurrency(members, 4, async ({ employee, membership }) => {
    const timeClocks = await api.listEmployeeTimeClocks(
      employee.id,
      context.companyId,
      date,
      date,
    );
    return summarizeMember(employee, membership, context.employeeId, timeClocks);
  });

  const summary: TeamStatusResult["summary"] = {
    memberCount: memberStatuses.length,
    not_clocked_in: 0,
    working: 0,
    on_break: 0,
    clocked_out: 0,
    irregular: 0,
  };
  for (const member of memberStatuses) {
    summary[member.state] += 1;
  }

  return {
    context,
    date,
    group: {
      id: selectedGroup.group_id,
      code: selectedGroup.group_code ?? null,
      name: selectedGroup.group_name ?? null,
    },
    summary,
    members: memberStatuses,
  };
}

function selectGroup(
  employees: EmployeeGroupMembership[],
  currentEmployeeId: number,
  requestedGroupId?: number,
): GroupMembership & { group_id: number } {
  const allGroups = uniqueGroups(employees.flatMap((employee) => employee.group_memberships ?? []));

  if (requestedGroupId !== undefined) {
    const selected = allGroups.find((membership) => membership.group_id === requestedGroupId);
    if (!selected) {
      throw new CliError(
        "GROUP_NOT_FOUND",
        "The selected group has no employee membership on the requested date.",
        { details: { groupId: requestedGroupId }, exitCode: 2 },
      );
    }
    return selected;
  }

  const currentEmployee = employees.find((employee) => employee.id === currentEmployeeId);
  const assignedGroups = uniqueGroups(currentEmployee?.group_memberships ?? []);
  const mainDutyGroups = assignedGroups.filter((membership) => membership.main_duty === "main_duty");
  const candidates = mainDutyGroups.length === 1 ? mainDutyGroups : assignedGroups;

  if (candidates.length === 1) {
    const selected = candidates[0];
    if (selected) {
      return selected;
    }
  }

  throw new CliError(
    "GROUP_REQUIRED",
    assignedGroups.length === 0
      ? "The current employee has no department membership on the requested date. Select one with `--group-id`."
      : "More than one department is available. Select one with `--group-id`.",
    {
      details: {
        groups: (assignedGroups.length === 0 ? allGroups : assignedGroups).map(toGroupChoice),
      },
      exitCode: 2,
    },
  );
}

function uniqueGroups(memberships: GroupMembership[]): Array<GroupMembership & { group_id: number }> {
  const groups = new Map<number, GroupMembership & { group_id: number }>();
  for (const membership of memberships) {
    if (Number.isInteger(membership.group_id) && Number(membership.group_id) > 0) {
      const groupId = Number(membership.group_id);
      const existing = groups.get(groupId);
      if (!existing || membership.main_duty === "main_duty") {
        groups.set(groupId, { ...membership, group_id: groupId });
      }
    }
  }
  return [...groups.values()];
}

function toGroupChoice(group: GroupMembership & { group_id: number }): {
  id: number;
  code: string | null;
  name: string | null;
  mainDuty: string | null;
} {
  return {
    id: group.group_id,
    code: group.group_code ?? null,
    name: group.group_name ?? null,
    mainDuty: group.main_duty ?? null,
  };
}

function summarizeMember(
  employee: EmployeeGroupMembership,
  membership: GroupMembership,
  currentEmployeeId: number,
  timeClocks: EmployeeTimeClock[],
): TeamMemberStatus {
  const clocks = timeClocks
    .filter((clock): clock is EmployeeTimeClock & { type: TimeClockType } =>
      clock.type !== undefined && Object.hasOwn(timeClockOrder, clock.type),
    )
    .sort(compareTimeClocks);
  const issues: string[] = [];
  let phase: "idle" | "working" | "break" | "clocked_out" = "idle";

  for (const clock of clocks) {
    switch (clock.type) {
      case "clock_in":
        if (phase === "working" || phase === "break") {
          issues.push("clock_in_before_previous_clock_out");
        }
        phase = "working";
        break;
      case "break_begin":
        if (phase !== "working") {
          issues.push("break_begin_without_active_work");
        }
        phase = "break";
        break;
      case "break_end":
        if (phase !== "break") {
          issues.push("break_end_without_active_break");
        }
        phase = "working";
        break;
      case "clock_out":
        if (phase !== "working") {
          issues.push("clock_out_without_active_work");
        }
        phase = "clocked_out";
        break;
    }
  }

  let state: TeamMemberAttendanceState;
  if (issues.length > 0) {
    state = "irregular";
  } else if (clocks.length === 0) {
    state = "not_clocked_in";
  } else {
    state = phase === "idle" ? "irregular" : phase === "break" ? "on_break" : phase;
  }

  const firstClockIn = clocks.find((clock) => clock.type === "clock_in");
  const lastClockOut = clocks.findLast((clock) => clock.type === "clock_out");
  const latest = clocks.at(-1);

  return {
    employeeId: employee.id,
    displayName: employee.display_name ?? null,
    isSelf: employee.id === currentEmployeeId,
    positionName: membership.position_name ?? null,
    state,
    firstClockInAt: firstClockIn?.datetime ?? null,
    lastClockOutAt: lastClockOut?.datetime ?? null,
    latestEvent: latest ? { type: latest.type, datetime: latest.datetime ?? null } : null,
    events: clocks.map((clock) => ({ type: clock.type, datetime: clock.datetime ?? null })),
    issues,
  };
}

function compareEmployees(left: EmployeeGroupMembership, right: EmployeeGroupMembership): number {
  const leftName = left.display_name ?? "";
  const rightName = right.display_name ?? "";
  return leftName.localeCompare(rightName, "ja") || left.id - right.id;
}

function compareTimeClocks(left: EmployeeTimeClock, right: EmployeeTimeClock): number {
  const byDatetime = (left.datetime ?? "").localeCompare(right.datetime ?? "");
  if (byDatetime !== 0) {
    return byDatetime;
  }
  const leftType = left.type ? timeClockOrder[left.type] : Number.MAX_SAFE_INTEGER;
  const rightType = right.type ? timeClockOrder[right.type] : Number.MAX_SAFE_INTEGER;
  return leftType - rightType || (left.id ?? 0) - (right.id ?? 0);
}

function currentDateInJapan(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: japanTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function assertCalendarDate(date: string): void {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) {
    throw new CliError("INVALID_DATE", "`--date` must use YYYY-MM-DD.", { exitCode: 2 });
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new CliError("INVALID_DATE", "`--date` must be a real calendar date.", { exitCode: 2 });
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      const item = items[index];
      if (item !== undefined) {
        results[index] = await worker(item);
      }
    }
  });
  await Promise.all(runners);
  return results;
}
