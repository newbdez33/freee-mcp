import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { CliError } from "./errors.js";
import { readOAuthConfig } from "./auth-config.js";
import { FreeeOAuthClient } from "./oauth.js";
import { RefreshingCredentialProvider } from "./oauth-credentials.js";
import { createOAuthBackends } from "./secret-store.js";

const execFileAsync = promisify(execFile);

export interface CredentialProvider {
  readonly source: "environment" | "1password" | "system";
  getAccessToken(): Promise<string>;
  refreshAccessToken?(): Promise<string>;
}

type ReadSecret = (executable: string, args: readonly string[]) => Promise<string>;

async function defaultReadSecret(executable: string, args: readonly string[]): Promise<string> {
  const result = await execFileAsync(executable, [...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024,
    timeout: 60_000,
  });
  return result.stdout;
}

export class OnePasswordCredentialProvider implements CredentialProvider {
  readonly source = "1password" as const;

  constructor(
    private readonly reference: string,
    private readonly executable = "op",
    private readonly readSecret: ReadSecret = defaultReadSecret,
  ) {}

  async getAccessToken(): Promise<string> {
    try {
      const token = (await this.readSecret(this.executable, ["read", this.reference])).trim();
      if (token.length === 0) {
        throw new Error("empty credential");
      }
      return token;
    } catch {
      throw new CliError(
        "CREDENTIAL_UNAVAILABLE",
        "Could not read the freee Access Token from 1Password. Unlock 1Password, approve any desktop prompt, and ensure `op` is signed in.",
        { exitCode: 2 },
      );
    }
  }
}

class EnvironmentCredentialProvider implements CredentialProvider {
  readonly source = "environment" as const;

  constructor(private readonly token: string) {}

  async getAccessToken(): Promise<string> {
    return this.token;
  }
}

class MissingCredentialProvider implements CredentialProvider {
  constructor(readonly source: "1password" | "system") {}

  async getAccessToken(): Promise<string> {
    throw new CliError(
      "CREDENTIAL_UNAVAILABLE",
      "No freee OAuth Tokens are configured. Run `auth login --confirm` first.",
      { exitCode: 2 },
    );
  }
}

export async function createCredentialProvider(
  env: NodeJS.ProcessEnv = process.env,
): Promise<CredentialProvider> {
  const environmentToken = env.FREEE_ACCESS_TOKEN?.trim();
  if (environmentToken) {
    return new EnvironmentCredentialProvider(environmentToken);
  }

  const fallback = new OnePasswordCredentialProvider(
    env.FREEE_ACCESS_TOKEN_OP_REF ?? "op://Private/freee/API KEY",
    env.FREEE_OP_BIN ?? "op",
  );
  const oauthConfig = await readOAuthConfig(env);
  if (!oauthConfig) {
    return fallback;
  }

  if (oauthConfig.secretStore === "environment") {
    throw new CliError(
      "CREDENTIAL_UNAVAILABLE",
      "Environment mode requires FREEE_ACCESS_TOKEN in the current process.",
      { exitCode: 2 },
    );
  }

  const backends = createOAuthBackends(oauthConfig, env);
  const configuredFallback =
    oauthConfig.secretStore === "1password"
      ? fallback
      : new MissingCredentialProvider("system");

  return new RefreshingCredentialProvider(
    configuredFallback,
    backends.tokenStore,
    backends.clientCredentials,
    new FreeeOAuthClient(env.FREEE_OAUTH_TOKEN_URL),
    5 * 60 * 1000,
    undefined,
    oauthConfig.secretStore,
  );
}
