import {
  clockActionMap,
  getClockStatus,
  performClockAction,
  type ClockAction,
} from "./attendance.js";
import { readOAuthConfig } from "./auth-config.js";
import type {
  BrowserApprovalAction,
  BrowserApprovalDetail,
  BrowserApprovalListStatus,
} from "./browser-approvals.js";
import { FreeeBrowserClient } from "./browser.js";
import { createClockActionFingerprint } from "./clock-preview.js";
import { FreeeClient } from "./client.js";
import { createCredentialProvider, type CredentialProvider } from "./credentials.js";
import { CliError } from "./errors.js";
import { resolveBackend, type FreeeBackend } from "./backend.js";
import { getTeamStatus, type TeamStatusOptions } from "./team.js";
import type { EmployeeContext, TimeClockType } from "./types.js";

export interface UnifiedClockStatus {
  backend: FreeeBackend;
  context: EmployeeContext | null;
  status: {
    available_actions: ClockAction[];
    available_types: TimeClockType[];
    base_date: string | null;
  };
}

export interface FreeeOperations {
  readonly backend: FreeeBackend;
  getBackendStatus(): Promise<{ backend: FreeeBackend }>;
  getAuthStatus(): Promise<Record<string, unknown>>;
  getMe(): Promise<Record<string, unknown>>;
  getClockStatus(options?: { companyId?: number; date?: string }): Promise<UnifiedClockStatus>;
  prepareClockAction(action: ClockAction, options?: { companyId?: number }): Promise<Record<string, unknown>>;
  commitClockAction(
    action: ClockAction,
    fingerprint: string,
    confirm: boolean,
    options?: { companyId?: number },
  ): Promise<Record<string, unknown>>;
  getTeamStatus(options?: TeamStatusOptions): Promise<Record<string, unknown>>;
  getApprovals(status?: BrowserApprovalListStatus): Promise<Record<string, unknown>>;
  getApprovalDetail(id: string): Promise<Record<string, unknown>>;
  prepareApprovalAction(id: string, action: BrowserApprovalAction): Promise<Record<string, unknown>>;
  commitApprovalAction(
    id: string,
    action: BrowserApprovalAction,
    fingerprint: string,
    confirm: boolean,
  ): Promise<Record<string, unknown>>;
}

export class FreeeService implements FreeeOperations {
  private apiRuntime?: Promise<{ provider: CredentialProvider; api: FreeeClient }>;
  private browserQueue: Promise<void> = Promise.resolve();

  private constructor(readonly backend: FreeeBackend) {}

  static async create(): Promise<FreeeService> {
    return new FreeeService(await resolveBackend());
  }

  async getBackendStatus(): Promise<{ backend: FreeeBackend }> {
    return { backend: this.backend };
  }

  async getAuthStatus(): Promise<Record<string, unknown>> {
    if (this.backend === "playwright") {
      const clock = await this.withBrowser((client) => client.getClockStatus());
      return {
        backend: this.backend,
        authenticated: true,
        credentialStore: "system",
        clock,
      };
    }
    const { provider, api } = await this.getApiRuntime();
    const me = await api.getCurrentUser();
    const config = await readOAuthConfig();
    return {
      backend: this.backend,
      authenticated: true,
      credentialSource: provider.source,
      tokenStore: config?.tokenStore ?? null,
      refreshConfigured: provider.refreshAccessToken !== undefined,
      userId: me.id,
      companyCount: me.companies.length,
    };
  }

  async refreshAuthentication(): Promise<Record<string, unknown>> {
    this.requireBackend("api", "OAuth refresh");
    const { provider } = await this.getApiRuntime();
    if (!provider.refreshAccessToken) {
      throw new CliError(
        "TOKEN_REFRESH_UNAVAILABLE",
        "OAuth refresh is not configured. Run `auth login --confirm` first.",
        { exitCode: 2 },
      );
    }
    await provider.refreshAccessToken();
    return { backend: this.backend, refreshed: true };
  }

  async getBrowserStatus(): Promise<Record<string, unknown>> {
    this.requireBackend("playwright", "Browser status");
    return this.getAuthStatus();
  }

  async getMe(): Promise<Record<string, unknown>> {
    this.requireBackend("api", "Identity lookup");
    const { api } = await this.getApiRuntime();
    const me = await api.getCurrentUser();
    return {
      backend: this.backend,
      id: me.id,
      companies: me.companies.map((company) => ({
        id: company.id,
        name: company.name ?? null,
        role: company.role ?? null,
        employeeId: company.employee_id ?? null,
        displayName: company.display_name ?? null,
      })),
    };
  }

  async getClockStatus(
    options: { companyId?: number; date?: string } = {},
  ): Promise<UnifiedClockStatus> {
    if (this.backend === "playwright") {
      assertPlaywrightClockContext(options);
      const status = await this.withBrowser((client) => client.getClockStatus());
      return {
        backend: this.backend,
        context: null,
        status: {
          available_actions: status.availableActions,
          available_types: status.availableTypes,
          base_date: null,
        },
      };
    }
    const { api } = await this.getApiRuntime();
    const result = await getClockStatus(api, options);
    return {
      backend: this.backend,
      context: result.context,
      status: {
        available_actions: actionsForTypes(result.status.available_types),
        available_types: result.status.available_types,
        base_date: result.status.base_date ?? null,
      },
    };
  }

  async performClockAction(
    action: ClockAction,
    options: { companyId?: number; confirm: boolean },
  ): Promise<Record<string, unknown>> {
    if (this.backend === "playwright") {
      assertPlaywrightClockContext(options);
      return {
        backend: this.backend,
        ...await this.withBrowser((client) => client.performClockAction(action, options.confirm)),
      };
    }
    const { api } = await this.getApiRuntime();
    return {
      backend: this.backend,
      ...asRecord(await performClockAction(api, action, options)),
    };
  }

  async prepareClockAction(
    action: ClockAction,
    options: { companyId?: number } = {},
  ): Promise<Record<string, unknown>> {
    const preview = await this.getClockStatus(options);
    if (!preview.status.available_actions.includes(action)) {
      throw new CliError(
        "CLOCK_ACTION_UNAVAILABLE",
        `The requested action '${action}' is not currently available.`,
        {
          details: {
            requestedAction: action,
            requestedType: clockActionMap[action],
            availableActions: preview.status.available_actions,
            availableTypes: preview.status.available_types,
            context: preview.context,
          },
          exitCode: 2,
        },
      );
    }
    return {
      backend: this.backend,
      action,
      type: clockActionMap[action],
      fingerprint: createClockActionFingerprint(preview, action),
      preview,
    };
  }

  async commitClockAction(
    action: ClockAction,
    fingerprint: string,
    confirm: boolean,
    options: { companyId?: number } = {},
  ): Promise<Record<string, unknown>> {
    if (!confirm) {
      throw new CliError(
        "CONFIRMATION_REQUIRED",
        "This tool creates a real freee time clock entry. Prepare it first, obtain explicit current-message approval, then commit with the exact fingerprint and confirmation.",
        { details: { action }, exitCode: 2 },
      );
    }
    const current = await this.getClockStatus(options);
    const currentFingerprint = createClockActionFingerprint(current, action);
    if (fingerprint !== currentFingerprint) {
      throw new CliError(
        "CLOCK_PREVIEW_CHANGED",
        "The freee clock state changed after preview. No action was taken; prepare a new preview.",
        { details: { action, currentFingerprint }, exitCode: 2 },
      );
    }
    return this.performClockAction(action, { ...options, confirm: true });
  }

  async getTeamStatus(options: TeamStatusOptions = {}): Promise<Record<string, unknown>> {
    if (this.backend === "playwright") {
      if (options.companyId !== undefined || options.groupId !== undefined) {
        throw new CliError(
          "BROWSER_TEAM_FILTER_UNSUPPORTED",
          "The Playwright team status uses the company and department selected in freee.",
          { exitCode: 2 },
        );
      }
      return {
        backend: this.backend,
        ...asRecord(await this.withBrowser((client) => client.getTeamStatus({ date: options.date }))),
      };
    }
    const { api } = await this.getApiRuntime();
    return { backend: this.backend, ...await getTeamStatus(api, options) };
  }

  async getApprovals(
    status: BrowserApprovalListStatus = "pending",
  ): Promise<Record<string, unknown>> {
    this.requireBackend("playwright", "Approval workflow");
    return {
      backend: this.backend,
      ...asRecord(await this.withBrowser((client) => client.getApprovals(status))),
    };
  }

  async getApprovalDetail(id: string): Promise<Record<string, unknown>> {
    this.requireBackend("playwright", "Approval workflow");
    return {
      backend: this.backend,
      ...asRecord(await this.withBrowser((client) => client.getApprovalDetail(id))),
    };
  }

  async prepareApprovalAction(
    id: string,
    action: BrowserApprovalAction,
  ): Promise<Record<string, unknown>> {
    this.requireBackend("playwright", "Approval workflow");
    return {
      backend: this.backend,
      ...asRecord(await this.withBrowser((client) => client.prepareApprovalAction(id, action))),
    };
  }

  async commitApprovalAction(
    id: string,
    action: BrowserApprovalAction,
    fingerprint: string,
    confirm: boolean,
  ): Promise<Record<string, unknown>> {
    this.requireBackend("playwright", "Approval workflow");
    return {
      backend: this.backend,
      ...asRecord(await this.withBrowser(
        (client) => client.commitApprovalAction(id, action, fingerprint, confirm),
      )),
    };
  }

  private async getApiRuntime(): Promise<{ provider: CredentialProvider; api: FreeeClient }> {
    this.requireBackend("api", "API operation");
    this.apiRuntime ??= createCredentialProvider().then((provider) => ({
      provider,
      api: new FreeeClient(
        provider,
        process.env.FREEE_API_BASE_URL ?? "https://api.freee.co.jp/hr/api/v1",
      ),
    }));
    return this.apiRuntime;
  }

  private withBrowser<T>(operation: (client: FreeeBrowserClient) => Promise<T>): Promise<T> {
    this.requireBackend("playwright", "Browser operation");
    const result = this.browserQueue.then(async () => {
      const client = await FreeeBrowserClient.launch();
      try {
        return await operation(client);
      } finally {
        await client.close().catch(() => undefined);
      }
    });
    this.browserQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  private requireBackend(expected: FreeeBackend, operation: string): void {
    if (this.backend === expected) {
      return;
    }
    throw new CliError(
      "BACKEND_MISMATCH",
      `${operation} is unavailable while the selected backend is ${this.backend}. The service did not fall back.`,
      { details: { backend: this.backend, requiredBackend: expected }, exitCode: 2 },
    );
  }
}

function actionsForTypes(types: TimeClockType[]): ClockAction[] {
  return (Object.entries(clockActionMap) as Array<[ClockAction, TimeClockType]>)
    .filter(([, type]) => types.includes(type))
    .map(([action]) => action);
}

function assertPlaywrightClockContext(options: { companyId?: number; date?: string }): void {
  if (options.companyId !== undefined) {
    throw new CliError(
      "BROWSER_COMPANY_SELECTION_UNSUPPORTED",
      "The Playwright backend does not accept a company ID. Select the intended company in freee.",
      { exitCode: 2 },
    );
  }
  if (options.date !== undefined) {
    throw new CliError(
      "BROWSER_DATE_UNSUPPORTED",
      "The Playwright clock status supports the current freee state only.",
      { exitCode: 2 },
    );
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : { result: value };
}
