import { spawn } from "node:child_process";

import { CliError } from "./errors.js";
import type { OAuthClientCredentials, StoredOAuthTokens } from "./oauth.js";
import type {
  FreeeWebCredentials,
  OAuthClientCredentialsProvider,
  OAuthTokenStore,
  WebCredentialProvider,
} from "./secret-store.js";

export type OpRunner = (args: readonly string[], input?: string) => Promise<string>;

interface OpField {
  id?: string;
  label?: string;
  type?: string;
  purpose?: string;
  value?: string;
}

interface OpItem {
  id?: string;
  title?: string;
  category?: string;
  fields?: OpField[];
  [key: string]: unknown;
}

export class OnePasswordOAuthClientCredentialsProvider implements OAuthClientCredentialsProvider {
  constructor(
    private readonly vault = "Private",
    private readonly item = "freee",
    private readonly runOp: OpRunner = createOpRunner(),
  ) {}

  async getCredentials(): Promise<OAuthClientCredentials> {
    try {
      const output = await this.runOp([
        "item",
        "get",
        this.item,
        "--vault",
        this.vault,
        "--fields",
        "label=client id,label=Client Secret",
        "--format",
        "json",
        "--reveal",
      ]);
      const fields = JSON.parse(output) as OpField[];
      const clientId = findFieldValue(fields, "client id");
      const clientSecret = findFieldValue(fields, "Client Secret");
      if (!clientId || !clientSecret) {
        throw new Error("missing fields");
      }
      return { clientId, clientSecret };
    } catch {
      throw new CliError(
        "OAUTH_CLIENT_CREDENTIALS_UNAVAILABLE",
        "Could not read Client ID and Client Secret from the configured 1Password item.",
        { exitCode: 2 },
      );
    }
  }
}

export class OnePasswordWebCredentialProvider implements WebCredentialProvider {
  constructor(
    readonly vault = "Private",
    readonly item = "freee",
    private readonly runOp: OpRunner = createOpRunner(),
  ) {}

  async getCredentials(): Promise<FreeeWebCredentials> {
    try {
      const output = await this.runOp([
        "item",
        "get",
        this.item,
        "--vault",
        this.vault,
        "--format",
        "json",
        "--reveal",
      ]);
      const item = JSON.parse(output) as OpItem;
      const fields = item.fields ?? [];
      const username = findWebCredentialField(fields, "USERNAME", [
        "username",
        "user name",
        "email",
        "login",
        "login id",
        "account",
      ]);
      const password = findWebCredentialField(fields, "PASSWORD", ["password"]);
      if (!username || !password) {
        throw new Error("missing web credential fields");
      }
      return { username, password };
    } catch {
      throw new CliError(
        "WEB_CREDENTIALS_UNAVAILABLE",
        "Could not read the freee username and password from the configured 1Password item.",
        { exitCode: 2 },
      );
    }
  }
}

export class OnePasswordOAuthTokenStore implements OAuthTokenStore {
  readonly writable = true;
  constructor(
    readonly vault = "Private",
    readonly item = "freee OAuth Tokens",
    private readonly runOp: OpRunner = createOpRunner(),
  ) {}

  async read(): Promise<StoredOAuthTokens | null> {
    const item = await this.getItem();
    if (!item) {
      return null;
    }
    const fields = item.fields ?? [];
    const accessToken = findFieldValue(fields, "Access Token");
    const refreshToken = findFieldValue(fields, "Refresh Token");
    const expiresAt = findFieldValue(fields, "Expires At");
    if (!accessToken || !refreshToken || !expiresAt) {
      throw new CliError("INVALID_TOKEN_STORE", "The freee OAuth Token item is incomplete.", {
        exitCode: 2,
      });
    }
    return {
      accessToken,
      refreshToken,
      expiresAt,
      scope: findFieldValue(fields, "Scope"),
    };
  }

  async write(tokens: StoredOAuthTokens): Promise<void> {
    const existing = await this.getItem();
    const fields = existing?.fields ?? [];
    upsertField(fields, "Access Token", "CONCEALED", tokens.accessToken, "credential");
    upsertField(fields, "Refresh Token", "CONCEALED", tokens.refreshToken, "refresh_token");
    upsertField(fields, "Expires At", "STRING", tokens.expiresAt, "expires_at");
    upsertField(fields, "Scope", "STRING", tokens.scope ?? "", "scope");
    upsertField(
      fields,
      "notesPlain",
      "STRING",
      "Managed automatically by freee-agent. Do not edit individual token fields while a command is running.",
      "notesPlain",
      "NOTES",
    );

    const item: OpItem = existing ?? {
      title: this.item,
      category: "API_CREDENTIAL",
    };
    item.title = this.item;
    item.category = "API_CREDENTIAL";
    item.fields = fields;

    try {
      if (existing?.id) {
        await this.runOp(
          ["item", "edit", existing.id, "--vault", this.vault],
          JSON.stringify(item),
        );
      } else {
        await this.runOp(
          ["item", "create", "--vault", this.vault],
          JSON.stringify(item),
        );
      }
      const persisted = await this.getItem();
      const persistedFields = persisted?.fields ?? [];
      if (
        findFieldValue(persistedFields, "Access Token") !== tokens.accessToken
        || findFieldValue(persistedFields, "Refresh Token") !== tokens.refreshToken
        || findFieldValue(persistedFields, "Expires At") !== tokens.expiresAt
        || findFieldValue(persistedFields, "Scope") !== (tokens.scope || null)
      ) {
        throw new Error("1Password did not persist all OAuth token fields");
      }
    } catch {
      throw new CliError(
        "TOKEN_PERSIST_FAILED",
        "The new freee OAuth tokens could not be saved to 1Password. A fresh authorization may be required.",
      );
    }
  }

  private async getItem(): Promise<OpItem | null> {
    try {
      const output = await this.runOp([
        "item",
        "get",
        this.item,
        "--vault",
        this.vault,
        "--format",
        "json",
        "--reveal",
      ]);
      return JSON.parse(output) as OpItem;
    } catch {
      return null;
    }
  }
}

function findFieldValue(fields: OpField[], label: string): string | null {
  const field = fields.find((candidate) => candidate.label?.toLowerCase() === label.toLowerCase());
  return typeof field?.value === "string" && field.value.length > 0 ? field.value : null;
}

function findWebCredentialField(
  fields: OpField[],
  purpose: "USERNAME" | "PASSWORD",
  labels: readonly string[],
): string | null {
  const byPurpose = fields.find((field) => field.purpose?.toUpperCase() === purpose);
  const candidate = byPurpose ?? fields.find((field) => {
    const normalized = field.label?.trim().toLowerCase();
    return normalized !== undefined && labels.includes(normalized);
  });
  return typeof candidate?.value === "string" && candidate.value.length > 0
    ? candidate.value
    : null;
}

function upsertField(
  fields: OpField[],
  label: string,
  type: string,
  value: string,
  id: string,
  purpose?: string,
): void {
  const existing = fields.find((field) => field.label?.toLowerCase() === label.toLowerCase());
  if (existing) {
    existing.type = type;
    existing.value = value;
    if (purpose) {
      existing.purpose = purpose;
    }
    return;
  }
  fields.push({ id, label, type, value, ...(purpose ? { purpose } : {}) });
}

export function createOpRunner(executable = process.env.FREEE_OP_BIN ?? "op"): OpRunner {
  return (args, input) =>
    new Promise<string>((resolve, reject) => {
      const child = spawn(executable, [...args], { stdio: ["pipe", "pipe", "pipe"] });
      const stdout: Buffer[] = [];
      let stdoutLength = 0;
      let settled = false;
      const timer = setTimeout(() => child.kill("SIGTERM"), 60_000);

      child.stdout.on("data", (chunk: Buffer) => {
        stdoutLength += chunk.length;
        if (stdoutLength > 1024 * 1024) {
          child.kill("SIGTERM");
          return;
        }
        stdout.push(chunk);
      });
      child.stderr.resume();
      child.on("error", (error) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(error);
        }
      });
      child.on("close", (code, signal) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        if (code !== 0 || signal || stdoutLength > 1024 * 1024) {
          reject(new Error("1Password command failed"));
          return;
        }
        resolve(Buffer.concat(stdout).toString("utf8"));
      });
      child.stdin.end(input);
    });
}
