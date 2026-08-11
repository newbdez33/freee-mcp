import type { FreeeApi } from "./client.js";
import { CliError } from "./errors.js";
import type {
  AvailableTimeClockTypes,
  EmployeeContext,
  FreeeUserMe,
  TimeClockType,
} from "./types.js";

export const clockActionMap = {
  in: "clock_in",
  "break-start": "break_begin",
  "break-end": "break_end",
  out: "clock_out",
} as const satisfies Record<string, TimeClockType>;

export type ClockAction = keyof typeof clockActionMap;

export function resolveEmployeeContext(me: FreeeUserMe, requestedCompanyId?: number): EmployeeContext {
  const employeeCompanies = me.companies.filter(
    (company): company is typeof company & { employee_id: number } =>
      Number.isInteger(company.employee_id) && Number(company.employee_id) > 0,
  );

  if (requestedCompanyId !== undefined) {
    const selected = employeeCompanies.find((company) => company.id === requestedCompanyId);
    if (!selected) {
      throw new CliError(
        "EMPLOYEE_CONTEXT_NOT_FOUND",
        "The selected company is not linked to an employee identity for this user.",
        { details: { companyId: requestedCompanyId }, exitCode: 2 },
      );
    }
    return toEmployeeContext(selected);
  }

  if (employeeCompanies.length === 0) {
    throw new CliError(
      "EMPLOYEE_CONTEXT_NOT_FOUND",
      "No employee identity is linked to the authenticated freee user.",
      { exitCode: 2 },
    );
  }

  if (employeeCompanies.length > 1) {
    throw new CliError(
      "COMPANY_REQUIRED",
      "More than one employee identity is available. Select one with `--company-id`.",
      {
        details: {
          companies: employeeCompanies.map((company) => ({ id: company.id, name: company.name ?? null })),
        },
        exitCode: 2,
      },
    );
  }

  const company = employeeCompanies[0];
  if (!company) {
    throw new CliError("EMPLOYEE_CONTEXT_NOT_FOUND", "No employee identity is available.");
  }
  return toEmployeeContext(company);
}

function toEmployeeContext(company: FreeeUserMe["companies"][number] & { employee_id: number }): EmployeeContext {
  return {
    companyId: company.id,
    companyName: company.name ?? null,
    role: company.role ?? null,
    employeeId: company.employee_id,
    displayName: company.display_name ?? null,
  };
}

export async function getClockStatus(
  api: FreeeApi,
  options: { companyId?: number; date?: string } = {},
): Promise<{ context: EmployeeContext; status: AvailableTimeClockTypes }> {
  const me = await api.getCurrentUser();
  const context = resolveEmployeeContext(me, options.companyId);
  const status = await api.getAvailableTimeClockTypes(context.employeeId, context.companyId, options.date);
  return { context, status };
}

export async function performClockAction(
  api: FreeeApi,
  action: ClockAction,
  options: { companyId?: number; confirm: boolean },
): Promise<unknown> {
  const type = clockActionMap[action];
  const { context, status } = await getClockStatus(api, { companyId: options.companyId });

  if (!status.available_types.includes(type)) {
    throw new CliError("CLOCK_ACTION_UNAVAILABLE", `The requested action '${action}' is not currently available.`, {
      details: {
        requestedAction: action,
        requestedType: type,
        availableTypes: status.available_types,
        baseDate: status.base_date ?? null,
        context,
      },
      exitCode: 2,
    });
  }

  if (!options.confirm) {
    throw new CliError(
      "CONFIRMATION_REQUIRED",
      "This command would create a real freee time clock entry. Re-run only after explicit user approval with `--confirm`.",
      {
        details: {
          requestedAction: action,
          requestedType: type,
          baseDate: status.base_date ?? null,
          context,
        },
        exitCode: 2,
      },
    );
  }

  const result = await api.createTimeClock(context.employeeId, {
    companyId: context.companyId,
    type,
    ...(status.base_date ? { baseDate: status.base_date } : {}),
  });

  return {
    action,
    type,
    context,
    timeClock: result.employee_time_clock ?? null,
  };
}
