#!/usr/bin/env node

import { createHash } from "node:crypto";
import { parseArgs } from "node:util";

import { type ClockAction, clockActionMap } from "./attendance.js";
import { readOAuthConfig, type SecretStoreKind } from "./auth-config.js";
import { configureAuthentication } from "./auth-configure.js";
import { configureBrowserCredentials } from "./browser-credential-configure.js";
import type {
  BrowserApprovalAction,
  BrowserApprovalListStatus,
} from "./browser-approvals.js";
import { CliError, toPublicError } from "./errors.js";
import { FreeeOAuthClient, toStoredOAuthTokens } from "./oauth.js";
import { receiveAuthorizationCode } from "./oauth-login.js";
import { loadProjectEnvironment } from "./project-env.js";
import { createOAuthBackends, SystemWebCredentialStore } from "./secret-store.js";
import { FreeeService } from "./service.js";

const version = "0.2.0";

async function main(argv: string[]): Promise<void> {
  loadProjectEnvironment();
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    return;
  }
  if (argv.length === 1 && (argv[0] === "--version" || argv[0] === "-v")) {
    process.stdout.write(`${version}\n`);
    return;
  }

  const [group, command, ...rest] = argv;
  if (group === "auth" && command === "configure") {
    await runAuthConfigure(rest);
    return;
  }
  if (group === "auth" && command === "login") {
    await runOAuthLogin(rest);
    return;
  }
  if (group === "auth" && command === "client") {
    assertNoArguments(rest);
    const config = await readOAuthConfig();
    if (!config) {
      throw new CliError("AUTH_NOT_CONFIGURED", "Run `auth configure` before inspecting the OAuth client.", {
        exitCode: 2,
      });
    }
    if (config.secretStore === "environment") {
      throw new CliError(
        "ENVIRONMENT_STORE_READ_ONLY",
        "Environment mode does not configure a persistent OAuth client.",
        { exitCode: 2 },
      );
    }
    const credentials = await createOAuthBackends(config).clientCredentials.getCredentials();
    printSuccess("auth client", {
      credentialStore: config.secretStore,
      tokenStore: config.tokenStore ?? config.secretStore,
      clientFingerprint: createHash("sha256").update(credentials.clientId).digest("hex").slice(0, 12),
      redirectUri: config.redirectUri,
    });
    return;
  }
  if (group === "browser" && command === "configure") {
    await runBrowserCredentialConfiguration(rest);
    return;
  }
  if (group === "browser" && command === "credentials-status") {
    const service = parseBrowserCredentialStatusOptions(rest);
    await new SystemWebCredentialStore(service).getCredentials();
    printSuccess("browser credentials-status", {
      configured: true,
      credentialStore: "system",
      service,
    });
    return;
  }

  const service = await FreeeService.create();
  const backend = service.backend;
  if (group === "backend" && command === "status") {
    assertNoArguments(rest);
    printSuccess("backend status", await service.getBackendStatus());
    return;
  }

  if (group === "auth" && command === "status") {
    assertNoArguments(rest);
    printSuccess("auth status", await service.getAuthStatus());
    return;
  }

  if (group === "auth" && command === "refresh") {
    assertNoArguments(rest);
    printSuccess("auth refresh", await service.refreshAuthentication());
    return;
  }

  if (group === "browser" && command === "status") {
    assertNoArguments(rest);
    printSuccess("browser status", await service.getBrowserStatus());
    return;
  }

  if (group === "me" && command === undefined) {
    assertNoArguments(rest);
    printSuccess("me", await service.getMe());
    return;
  }

  if (group === "clock" && command === "status") {
    const options = parseClockOptions(rest, { allowDate: true, allowConfirm: false });
    printSuccess("clock status", await service.getClockStatus(options));
    return;
  }

  if (group === "clock" && isClockAction(command)) {
    const options = parseClockOptions(rest, { allowDate: false, allowConfirm: true });
    const result = await service.performClockAction(command, {
      companyId: options.companyId,
      confirm: options.confirm ?? false,
    });
    printSuccess(`clock ${command}`, result);
    return;
  }

  if (group === "team" && command === "status") {
    const options = parseTeamOptions(rest);
    printSuccess("team status", await service.getTeamStatus(options));
    return;
  }

  if (group === "approvals" && command === "list") {
    const options = parseApprovalListOptions(rest);
    printSuccess("approvals list", await service.getApprovals(options.status));
    return;
  }

  if (group === "approvals" && command === "detail") {
    const options = parseApprovalTargetOptions(rest, { allowAction: false, allowCommit: false });
    printSuccess("approvals detail", await service.getApprovalDetail(options.id));
    return;
  }

  if (group === "approvals" && command === "prepare-action") {
    const options = parseApprovalTargetOptions(rest, { allowAction: true, allowCommit: false });
    printSuccess(
      "approvals prepare-action",
      await service.prepareApprovalAction(options.id, options.action!),
    );
    return;
  }

  if (group === "approvals" && command === "commit-action") {
    const options = parseApprovalTargetOptions(rest, { allowAction: true, allowCommit: true });
    printSuccess(
      "approvals commit-action",
      await service.commitApprovalAction(
        options.id,
        options.action!,
        options.fingerprint!,
        options.confirm ?? false,
      ),
    );
    return;
  }

  throw new CliError("UNKNOWN_COMMAND", "Unknown command. Run with `--help` to list available commands.", {
    exitCode: 2,
  });
}

function parseTeamOptions(args: string[]): { companyId?: number; groupId?: number; date?: string } {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args,
      options: {
        "company-id": { type: "string" },
        "group-id": { type: "string" },
        date: { type: "string" },
      },
      strict: true,
      allowPositionals: false,
    });
  } catch {
    throw new CliError("INVALID_ARGUMENTS", "Invalid team status options. Run with `--help` for usage.", {
      exitCode: 2,
    });
  }

  const companyId = parsePositiveIntegerOption(
    typeof parsed.values["company-id"] === "string" ? parsed.values["company-id"] : undefined,
    "company-id",
  );
  const groupId = parsePositiveIntegerOption(
    typeof parsed.values["group-id"] === "string" ? parsed.values["group-id"] : undefined,
    "group-id",
  );
  const date = parsed.values.date;
  if (typeof date === "string" && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new CliError("INVALID_DATE", "`--date` must use YYYY-MM-DD.", { exitCode: 2 });
  }

  return {
    ...(companyId === undefined ? {} : { companyId }),
    ...(groupId === undefined ? {} : { groupId }),
    ...(typeof date === "string" ? { date } : {}),
  };
}

function parseApprovalListOptions(args: string[]): { status: BrowserApprovalListStatus } {
  try {
    const parsed = parseArgs({
      args,
      options: { status: { type: "string", default: "pending" } },
      strict: true,
      allowPositionals: false,
    });
    const status = parsed.values.status;
    if (status !== "pending" && status !== "returned" && status !== "approved" && status !== "all") {
      throw new Error("invalid status");
    }
    return { status };
  } catch {
    throw new CliError(
      "INVALID_ARGUMENTS",
      "`approvals list` accepts `--status pending|returned|approved|all`.",
      { exitCode: 2 },
    );
  }
}

function parseApprovalTargetOptions(
  args: string[],
  policy: { allowAction: boolean; allowCommit: boolean },
): {
  id: string;
  action?: BrowserApprovalAction;
  fingerprint?: string;
  confirm?: boolean;
} {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args,
      options: {
        id: { type: "string" },
        ...(policy.allowAction ? { action: { type: "string" as const } } : {}),
        ...(policy.allowCommit ? {
          fingerprint: { type: "string" as const },
          confirm: { type: "boolean" as const, default: false },
        } : {}),
      },
      strict: true,
      allowPositionals: false,
    });
  } catch {
    throw new CliError("INVALID_ARGUMENTS", "Invalid approval command options.", { exitCode: 2 });
  }
  const id = parsed.values.id;
  if (typeof id !== "string" || !/^\d+$/.test(id)) {
    throw new CliError("INVALID_APPROVAL_ID", "`--id` must be the numeric freee application No.", {
      exitCode: 2,
    });
  }
  const action = parsed.values.action;
  if (policy.allowAction && action !== "approve" && action !== "return") {
    throw new CliError("INVALID_APPROVAL_ACTION", "`--action` must be approve or return.", {
      exitCode: 2,
    });
  }
  const fingerprint = parsed.values.fingerprint;
  if (policy.allowCommit && (typeof fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(fingerprint))) {
    throw new CliError(
      "INVALID_APPROVAL_FINGERPRINT",
      "`--fingerprint` must be the 64-character value returned by `approvals prepare-action`.",
      { exitCode: 2 },
    );
  }
  return {
    id,
    ...(action === "approve" || action === "return" ? { action } : {}),
    ...(typeof fingerprint === "string" ? { fingerprint } : {}),
    ...(typeof parsed.values.confirm === "boolean" ? { confirm: parsed.values.confirm } : {}),
  };
}

function parsePositiveIntegerOption(value: string | undefined, name: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new CliError(
      `INVALID_${name.replaceAll("-", "_").toUpperCase()}`,
      `\`--${name}\` must be a positive integer.`,
      { exitCode: 2 },
    );
  }
  return parsed;
}

async function runAuthConfigure(args: string[]): Promise<void> {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args,
      options: {
        store: { type: "string", default: "system" },
        "client-id": { type: "string" },
        "redirect-uri": { type: "string", default: "http://127.0.0.1:48181/callback" },
        service: { type: "string", default: "freee-agent" },
        confirm: { type: "boolean", default: false },
      },
      strict: true,
      allowPositionals: false,
    });
  } catch {
    throw new CliError("INVALID_ARGUMENTS", "Invalid authentication configuration options.", {
      exitCode: 2,
    });
  }

  const store = parsed.values.store;
  if (store !== "system" && store !== "environment") {
    throw new CliError("INVALID_SECRET_STORE", "`--store` must be system or environment.", {
      exitCode: 2,
    });
  }
  const result = await configureAuthentication({
    secretStore: store as SecretStoreKind,
    confirm: parsed.values.confirm === true,
    redirectUri: String(parsed.values["redirect-uri"]),
    ...(typeof parsed.values["client-id"] === "string"
      ? { clientId: parsed.values["client-id"] }
      : {}),
    service: String(parsed.values.service),
  });
  printSuccess("auth configure", { configured: true, ...result });
}

async function runOAuthLogin(args: string[]): Promise<void> {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args,
      options: {
        confirm: { type: "boolean", default: false },
      },
      strict: true,
      allowPositionals: false,
    });
  } catch {
    throw new CliError("INVALID_ARGUMENTS", "Invalid OAuth login options.", { exitCode: 2 });
  }

  if (!parsed.values.confirm) {
    throw new CliError(
      "CONFIRMATION_REQUIRED",
      "OAuth login opens freee authorization and writes OAuth Tokens to the configured secure store. Re-run with `--confirm`.",
      { exitCode: 2 },
    );
  }

  const config = await readOAuthConfig();
  if (!config) {
    throw new CliError(
      "AUTH_NOT_CONFIGURED",
      "Run `auth configure --store system --client-id ID --confirm` before OAuth login.",
      { exitCode: 2 },
    );
  }
  if (config.secretStore === "environment") {
    throw new CliError(
      "ENVIRONMENT_STORE_READ_ONLY",
      "Environment mode cannot persist rotating OAuth Tokens. Use an injected FREEE_ACCESS_TOKEN.",
      { exitCode: 2 },
    );
  }

  const backends = createOAuthBackends(config);
  const oauthClient = new FreeeOAuthClient(process.env.FREEE_OAUTH_TOKEN_URL);
  const credentials = await backends.clientCredentials.getCredentials();
  const code = await receiveAuthorizationCode({
    clientId: credentials.clientId,
    redirectUri: config.redirectUri,
    oauthClient,
  });
  const response = await oauthClient.exchangeAuthorizationCode({
    credentials,
    code,
    redirectUri: config.redirectUri,
  });
  const stored = toStoredOAuthTokens(response);
  await backends.tokenStore.write(stored);
  printSuccess("auth login", {
    authorized: true,
    credentialStore: config.secretStore,
    tokenStore: config.tokenStore ?? config.secretStore,
    expiresAt: stored.expiresAt,
    scope: stored.scope,
  });
}

async function runBrowserCredentialConfiguration(args: string[]): Promise<void> {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args,
      options: {
        service: { type: "string", default: "freee-agent-web" },
        confirm: { type: "boolean", default: false },
      },
      strict: true,
      allowPositionals: false,
    });
  } catch {
    throw new CliError(
      "INVALID_ARGUMENTS",
      "This command accepts only `--service NAME` and `--confirm`. Credentials must be entered through the local hidden prompts.",
      { exitCode: 2 },
    );
  }

  const result = await configureBrowserCredentials({
    confirm: parsed.values.confirm === true,
    service: String(parsed.values.service),
  });
  printSuccess("browser configure", result);
}

function parseBrowserCredentialStatusOptions(args: string[]): string {
  try {
    const parsed = parseArgs({
      args,
      options: { service: { type: "string", default: "freee-agent-web" } },
      strict: true,
      allowPositionals: false,
    });
    return String(parsed.values.service);
  } catch {
    throw new CliError(
      "INVALID_ARGUMENTS",
      "Invalid browser credential status options.",
      { exitCode: 2 },
    );
  }
}

function parseClockOptions(
  args: string[],
  policy: { allowDate: boolean; allowConfirm: boolean },
): { companyId?: number; date?: string; confirm?: boolean } {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args,
      options: {
        "company-id": { type: "string" },
        ...(policy.allowDate ? { date: { type: "string" as const } } : {}),
        ...(policy.allowConfirm ? { confirm: { type: "boolean" as const } } : {}),
      },
      strict: true,
      allowPositionals: false,
    });
  } catch {
    throw new CliError("INVALID_ARGUMENTS", "Invalid command options. Run with `--help` for usage.", {
      exitCode: 2,
    });
  }

  const companyIdText = parsed.values["company-id"];
  const companyId = companyIdText === undefined ? undefined : Number(companyIdText);
  if (companyId !== undefined && (!Number.isInteger(companyId) || companyId <= 0)) {
    throw new CliError("INVALID_COMPANY_ID", "`--company-id` must be a positive integer.", { exitCode: 2 });
  }

  const date = parsed.values.date;
  if (typeof date === "string" && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new CliError("INVALID_DATE", "`--date` must use YYYY-MM-DD.", { exitCode: 2 });
  }

  return {
    ...(companyId === undefined ? {} : { companyId }),
    ...(typeof date === "string" ? { date } : {}),
    ...(typeof parsed.values.confirm === "boolean" ? { confirm: parsed.values.confirm } : {}),
  };
}

function assertNoArguments(args: string[]): void {
  if (args.length !== 0) {
    throw new CliError("INVALID_ARGUMENTS", "This command does not accept additional arguments.", {
      exitCode: 2,
    });
  }
}

function isClockAction(command: string | undefined): command is ClockAction {
  return command !== undefined && Object.hasOwn(clockActionMap, command);
}

function printSuccess(command: string, data: unknown): void {
  process.stdout.write(`${JSON.stringify({ ok: true, command, data }, null, 2)}\n`);
}

function printHelp(): void {
  process.stdout.write(`freee-agent ${version}\n\n`);
  process.stdout.write("Usage:\n");
  process.stdout.write("  freee-agent auth status\n");
  process.stdout.write("  freee-agent auth configure --store system|environment [options] --confirm\n");
  process.stdout.write("  freee-agent auth client\n");
  process.stdout.write("  freee-agent auth login --confirm\n");
  process.stdout.write("  freee-agent auth refresh\n");
  process.stdout.write("  freee-agent backend status\n");
  process.stdout.write("  freee-agent browser configure [--service NAME] --confirm\n");
  process.stdout.write("  freee-agent browser credentials-status [--service NAME]\n");
  process.stdout.write("  freee-agent browser status\n");
  process.stdout.write("  freee-agent me\n");
  process.stdout.write("  freee-agent clock status [--company-id ID] [--date YYYY-MM-DD]\n");
  process.stdout.write("  freee-agent team status [--company-id ID] [--group-id ID] [--date YYYY-MM-DD]\n");
  process.stdout.write("  freee-agent approvals list [--status pending|returned|approved|all]\n");
  process.stdout.write("  freee-agent approvals detail --id NO\n");
  process.stdout.write("  freee-agent approvals prepare-action --id NO --action approve|return\n");
  process.stdout.write("  freee-agent approvals commit-action --id NO --action approve|return --fingerprint SHA256 --confirm\n");
  process.stdout.write("  freee-agent clock in|break-start|break-end|out [--company-id ID] --confirm\n\n");
  process.stdout.write("Real clock entries and application changes are never made without --confirm.\n");
  process.stdout.write("Select a complete backend with FREEE_BACKEND=api|playwright|auto.\n");
}

main(process.argv.slice(2)).catch((error: unknown) => {
  const publicError = toPublicError(error);
  const { exitCode, ...errorBody } = publicError;
  process.stderr.write(`${JSON.stringify({ ok: false, error: errorBody }, null, 2)}\n`);
  process.exitCode = exitCode;
});
