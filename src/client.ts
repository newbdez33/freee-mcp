import { CliError } from "./errors.js";
import type { CredentialProvider } from "./credentials.js";
import type {
  AvailableTimeClockTypes,
  CreateTimeClockResponse,
  EmployeeGroupMembership,
  EmployeeGroupMembershipsPage,
  EmployeeTimeClock,
  FreeeUserMe,
  TimeClockType,
} from "./types.js";

export interface FreeeApi {
  getCurrentUser(): Promise<FreeeUserMe>;
  getAvailableTimeClockTypes(
    employeeId: number,
    companyId: number,
    date?: string,
  ): Promise<AvailableTimeClockTypes>;
  createTimeClock(
    employeeId: number,
    input: { companyId: number; type: TimeClockType; baseDate?: string },
  ): Promise<CreateTimeClockResponse>;
  listEmployeeGroupMemberships(
    companyId: number,
    baseDate: string,
  ): Promise<EmployeeGroupMembership[]>;
  listEmployeeTimeClocks(
    employeeId: number,
    companyId: number,
    fromDate: string,
    toDate: string,
  ): Promise<EmployeeTimeClock[]>;
}

type Fetch = typeof globalThis.fetch;

export class FreeeClient implements FreeeApi {
  private readonly credentials: CredentialProvider;

  constructor(
    credentials: CredentialProvider | string,
    private readonly baseUrl = "https://api.freee.co.jp/hr/api/v1",
    private readonly fetchImplementation: Fetch = globalThis.fetch,
  ) {
    this.credentials =
      typeof credentials === "string"
        ? {
            source: "environment",
            getAccessToken: async () => credentials,
          }
        : credentials;
  }

  getCurrentUser(): Promise<FreeeUserMe> {
    return this.request<FreeeUserMe>("GET", "/users/me");
  }

  getAvailableTimeClockTypes(
    employeeId: number,
    companyId: number,
    date?: string,
  ): Promise<AvailableTimeClockTypes> {
    const query = new URLSearchParams({ company_id: String(companyId) });
    if (date) {
      query.set("date", date);
    }
    return this.request<AvailableTimeClockTypes>(
      "GET",
      `/employees/${employeeId}/time_clocks/available_types?${query.toString()}`,
    );
  }

  createTimeClock(
    employeeId: number,
    input: { companyId: number; type: TimeClockType; baseDate?: string },
  ): Promise<CreateTimeClockResponse> {
    return this.request<CreateTimeClockResponse>("POST", `/employees/${employeeId}/time_clocks`, {
      company_id: input.companyId,
      type: input.type,
      ...(input.baseDate ? { base_date: input.baseDate } : {}),
    });
  }

  async listEmployeeGroupMemberships(
    companyId: number,
    baseDate: string,
  ): Promise<EmployeeGroupMembership[]> {
    const memberships: EmployeeGroupMembership[] = [];
    let offset = 0;

    while (true) {
      const query = new URLSearchParams({
        company_id: String(companyId),
        base_date: baseDate,
        with_no_payroll_calculation: "true",
        limit: "100",
        offset: String(offset),
      });
      const page = await this.request<EmployeeGroupMembershipsPage>(
        "GET",
        `/employee_group_memberships?${query.toString()}`,
      );
      const items = page.employee_group_memberships ?? [];
      memberships.push(...items);

      const reachedEnd =
        typeof page.total_count === "number"
          ? memberships.length >= page.total_count
          : items.length < 100;
      if (items.length === 0 || reachedEnd) {
        return memberships;
      }
      offset += items.length;
    }
  }

  async listEmployeeTimeClocks(
    employeeId: number,
    companyId: number,
    fromDate: string,
    toDate: string,
  ): Promise<EmployeeTimeClock[]> {
    const timeClocks: EmployeeTimeClock[] = [];
    let offset = 0;

    while (true) {
      const query = new URLSearchParams({
        company_id: String(companyId),
        from_date: fromDate,
        to_date: toDate,
        limit: "100",
        offset: String(offset),
      });
      const page = await this.request<EmployeeTimeClock[]>(
        "GET",
        `/employees/${employeeId}/time_clocks?${query.toString()}`,
      );
      timeClocks.push(...page);

      if (page.length < 100) {
        return timeClocks;
      }
      offset += page.length;
    }
  }

  private async request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const accessToken = await this.credentials.getAccessToken();
    let response = await this.send(method, path, accessToken, body);
    if (response.status === 401 && this.credentials.refreshAccessToken) {
      const refreshedAccessToken = await this.credentials.refreshAccessToken();
      response = await this.send(method, path, refreshedAccessToken, body);
    }

    const responseText = await response.text();
    let responseBody: unknown;
    try {
      responseBody = responseText.length === 0 ? {} : JSON.parse(responseText);
    } catch {
      responseBody = undefined;
    }

    if (!response.ok) {
      throw new CliError("FREEE_API_ERROR", `freee API returned HTTP ${response.status}.`, {
        details: extractSafeApiError(responseBody),
      });
    }

    return responseBody as T;
  }

  private send(method: "GET" | "POST", path: string, accessToken: string, body?: unknown): Promise<Response> {
    return this.fetchImplementation(`${this.baseUrl.replace(/\/$/, "")}${path}`, {
      method,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15_000),
    });
  }
}

function extractSafeApiError(body: unknown): unknown {
  if (!body || typeof body !== "object") {
    return undefined;
  }

  const record = body as Record<string, unknown>;
  const safeFields = ["status", "title", "detail", "message", "code", "errors"];
  const safe: Record<string, unknown> = {};
  for (const key of safeFields) {
    if (record[key] !== undefined) {
      safe[key] = record[key];
    }
  }
  return Object.keys(safe).length === 0 ? undefined : safe;
}
