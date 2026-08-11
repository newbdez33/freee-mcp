import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { CliError } from "./errors.js";

export type SecretStoreKind = "system" | "1password" | "environment";
export type TokenStoreKind = "system" | "1password";

export interface OAuthRuntimeConfig {
  version: 1;
  mode: "oauth";
  secretStore: SecretStoreKind;
  tokenStore?: TokenStoreKind;
  redirectUri: string;
  clientId?: string;
  service?: string;
  vault?: string;
  clientItem?: string;
  tokenItem?: string;
}

export function getOAuthConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.FREEE_CONFIG_PATH ?? join(process.cwd(), ".freee", "oauth.json");
}

export async function readOAuthConfig(
  env: NodeJS.ProcessEnv = process.env,
): Promise<OAuthRuntimeConfig | null> {
  if (env.FREEE_SECRET_STORE) {
    return configFromEnvironment(env);
  }

  try {
    const parsed = JSON.parse(await readFile(getOAuthConfigPath(env), "utf8")) as Record<string, unknown>;
    return normalizeConfig(parsed);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    if (error instanceof CliError) {
      throw error;
    }
    throw invalidConfigError();
  }
}

export async function writeOAuthConfig(
  config: OAuthRuntimeConfig,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  validateConfig(config);
  const configPath = getOAuthConfigPath(env);
  const configDirectory = dirname(configPath);
  const temporaryPath = `${configPath}.${process.pid}.tmp`;
  await mkdir(configDirectory, { recursive: true, mode: 0o700 });
  await writeFile(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await rename(temporaryPath, configPath);
}

function configFromEnvironment(env: NodeJS.ProcessEnv): OAuthRuntimeConfig {
  const secretStore = parseSecretStore(env.FREEE_SECRET_STORE);
  return normalizeConfig({
    version: 1,
    mode: "oauth",
    secretStore,
    redirectUri: env.FREEE_OAUTH_REDIRECT_URI ?? "http://127.0.0.1:48181/callback",
    clientId: env.FREEE_CLIENT_ID,
    service: env.FREEE_SYSTEM_KEYRING_SERVICE,
    vault: env.FREEE_OP_VAULT,
    clientItem: env.FREEE_OP_CLIENT_ITEM,
    tokenItem: env.FREEE_OAUTH_TOKEN_ITEM,
    tokenStore: env.FREEE_OAUTH_TOKEN_STORE,
  });
}

function normalizeConfig(parsed: Record<string, unknown>): OAuthRuntimeConfig {
  // Migrate the first project-only format, which always used 1Password.
  if (parsed.mode === "oauth" && typeof parsed.vault === "string" && typeof parsed.tokenItem === "string" && !parsed.secretStore) {
    return {
      version: 1,
      mode: "oauth",
      secretStore: "1password",
      tokenStore: "1password",
      redirectUri: "http://127.0.0.1:48181/callback",
      vault: parsed.vault,
      clientItem: "freee",
      tokenItem: parsed.tokenItem,
    };
  }

  const secretStore = parseSecretStore(parsed.secretStore);
  const config: OAuthRuntimeConfig = {
    version: 1,
    mode: "oauth",
    secretStore,
    ...(secretStore === "environment"
      ? {}
      : { tokenStore: parseTokenStore(parsed.tokenStore, secretStore) }),
    redirectUri:
      typeof parsed.redirectUri === "string"
        ? parsed.redirectUri
        : "http://127.0.0.1:48181/callback",
    ...(typeof parsed.clientId === "string" ? { clientId: parsed.clientId } : {}),
    ...(typeof parsed.service === "string" ? { service: parsed.service } : {}),
    ...(typeof parsed.vault === "string" ? { vault: parsed.vault } : {}),
    ...(typeof parsed.clientItem === "string" ? { clientItem: parsed.clientItem } : {}),
    ...(typeof parsed.tokenItem === "string" ? { tokenItem: parsed.tokenItem } : {}),
  };
  validateConfig(config);
  return config;
}

function validateConfig(config: OAuthRuntimeConfig): void {
  if (config.version !== 1 || config.mode !== "oauth" || !config.redirectUri) {
    throw invalidConfigError();
  }
  if (config.secretStore === "system" && !config.clientId) {
    throw invalidConfigError();
  }
  if (config.secretStore === "system" && config.tokenStore !== "system") {
    throw invalidConfigError();
  }
  if (config.secretStore === "1password") {
    if (!config.vault || !config.clientItem) {
      throw invalidConfigError();
    }
    if (config.tokenStore === "1password" && !config.tokenItem) {
      throw invalidConfigError();
    }
    if (config.tokenStore === "system" && !config.service) {
      throw invalidConfigError();
    }
  }
}

function parseSecretStore(value: unknown): SecretStoreKind {
  if (value === "system" || value === "1password" || value === "environment") {
    return value;
  }
  throw invalidConfigError();
}

function parseTokenStore(value: unknown, secretStore: Exclude<SecretStoreKind, "environment">): TokenStoreKind {
  if (value === "system" || value === "1password") {
    return value;
  }
  if (value === undefined) {
    return secretStore === "system" ? "system" : "1password";
  }
  throw invalidConfigError();
}

function invalidConfigError(): CliError {
  return new CliError("INVALID_AUTH_CONFIG", "The local OAuth configuration is invalid.", {
    exitCode: 2,
  });
}
