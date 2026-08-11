export const timeClockTypes = ["clock_in", "break_begin", "break_end", "clock_out"] as const;
export type TimeClockType = (typeof timeClockTypes)[number];

export interface FreeeCompany {
  id: number;
  name?: string;
  role?: string;
  external_cid?: string;
  employee_id?: number | null;
  display_name?: string | null;
}

export interface FreeeUserMe {
  id: number;
  companies: FreeeCompany[];
}

export interface AvailableTimeClockTypes {
  available_types: TimeClockType[];
  base_date?: string;
}

export interface EmployeeTimeClock {
  id?: number;
  date?: string;
  type?: TimeClockType;
  datetime?: string;
  original_datetime?: string;
  note?: string;
}

export type GroupMainDuty = "unspecified" | "sub_duty" | "main_duty";

export interface GroupMembership {
  id?: number;
  start_date?: string;
  end_date?: string | null;
  boss_id?: number | null;
  main_duty?: GroupMainDuty;
  group_id?: number;
  group_code?: string | null;
  group_name?: string | null;
  level?: number;
  position_id?: number | null;
  position_code?: string | null;
  position_name?: string | null;
  parent_group_id?: number | null;
  parent_group_code?: string | null;
  parent_group_name?: string | null;
}

export interface EmployeeGroupMembership {
  id: number;
  num?: string | null;
  display_name?: string | null;
  payroll_calculation?: boolean;
  group_memberships?: GroupMembership[];
}

export interface EmployeeGroupMembershipsPage {
  employee_group_memberships?: EmployeeGroupMembership[];
  total_count?: number;
}

export interface CreateTimeClockResponse {
  employee_time_clock?: EmployeeTimeClock;
}

export interface EmployeeContext {
  companyId: number;
  companyName: string | null;
  role: string | null;
  employeeId: number;
  displayName: string | null;
}

export type TeamMemberAttendanceState =
  | "not_clocked_in"
  | "working"
  | "on_break"
  | "clocked_out"
  | "irregular";
