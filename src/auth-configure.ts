import type { ReadStream, WriteStream } from "node:tty";

import {
  writeOAuthConfig,
  type OAuthRuntimeConfig,
  type SecretStoreKind,
  type TokenStoreKind,
} from "./auth-config.js";
import { CliError } from "./errors.js";
import { SystemCredentialStore } from "./secret-store.js";
import { OnePasswordOAuthClientCredentialsProvider } from "./token-store.js";

export interface ConfigureAuthInput {
  secretStore: SecretStoreKind;
  confirm: boolean;
  redirectUri: string;
  clientId?: string;
  service?: string;
  vault?: string;
  clientItem?: string;
  tokenItem?: string;
  tokenStore?: TokenStoreKind;
}

interface ConfigureAuthDependencies {
  env?: NodeJS.ProcessEnv;
  readClientSecret?: () => Promise<string>;
  createSystemStore?: (clientId: string, service: string) => SystemCredentialStore;
  createOnePasswordCredentials?: (
    vault: string,
    clientItem: string,
  ) => OnePasswordOAuthClientCredentialsProvider;
  saveConfig?: (config: OAuthRuntimeConfig, env: NodeJS.ProcessEnv) => Promise<void>;
}

export async function configureAuthentication(
  input: ConfigureAuthInput,
  dependencies: ConfigureAuthDependencies = {},
): Promise<{ secretStore: SecretStoreKind; tokenStore?: TokenStoreKind; redirectUri: string }> {
  if (!input.confirm) {
    throw new CliError(
      "CONFIRMATION_REQUIRED",
      "Authentication configuration writes local settings and may store a Client Secret. Re-run with `--confirm`.",
      { exitCode: 2 },
    );
  }

  const env = dependencies.env ?? process.env;
  const saveConfig = dependencies.saveConfig ?? writeOAuthConfig;
  let config: OAuthRuntimeConfig;

  if (input.secretStore === "system") {
    const clientId = input.clientId?.trim() || env.FREEE_CLIENT_ID?.trim();
    if (!clientId) {
      throw new CliError(
        "CLIENT_ID_REQUIRED",
        "Provide `--client-id` or set FREEE_CLIENT_ID for this one configuration command.",
        { exitCode: 2 },
      );
    }
    const clientSecret = env.FREEE_CLIENT_SECRET?.trim()
      || await (dependencies.readClientSecret ?? readHiddenClientSecret)();
    const service = input.service?.trim() || "freee-agent";
    const store = (dependencies.createSystemStore ?? ((id, name) => new SystemCredentialStore(id, name)))(
      clientId,
      service,
    );
    await store.writeClientSecret(clientSecret);
    config = {
      version: 1,
      mode: "oauth",
      secretStore: "system",
      tokenStore: "system",
      redirectUri: input.redirectUri,
      clientId,
      service,
    };
  } else if (input.secretStore === "1password") {
    const vault = input.vault?.trim() || "Private";
    const clientItem = input.clientItem?.trim() || "freee";
    const tokenStore = input.tokenStore ?? "system";
    const tokenItem = input.tokenItem?.trim() || "freee OAuth Tokens";
    const service = input.service?.trim() || "freee-agent";
    const provider = (
      dependencies.createOnePasswordCredentials
      ?? ((configuredVault, configuredItem) =>
        new OnePasswordOAuthClientCredentialsProvider(configuredVault, configuredItem))
    )(vault, clientItem);
    await provider.getCredentials();
    config = {
      version: 1,
      mode: "oauth",
      secretStore: "1password",
      tokenStore,
      redirectUri: input.redirectUri,
      vault,
      clientItem,
      ...(tokenStore === "1password" ? { tokenItem } : { service }),
    };
  } else {
    if (!env.FREEE_ACCESS_TOKEN?.trim()) {
      throw new CliError(
        "CREDENTIAL_UNAVAILABLE",
        "Environment mode requires FREEE_ACCESS_TOKEN in the current process.",
        { exitCode: 2 },
      );
    }
    config = {
      version: 1,
      mode: "oauth",
      secretStore: "environment",
      redirectUri: input.redirectUri,
    };
  }

  await saveConfig(config, env);
  return {
    secretStore: config.secretStore,
    ...(config.tokenStore ? { tokenStore: config.tokenStore } : {}),
    redirectUri: config.redirectUri,
  };
}

async function readHiddenClientSecret(): Promise<string> {
  const input = process.stdin as ReadStream;
  const output = process.stderr as WriteStream;
  if (!input.isTTY || typeof input.setRawMode !== "function") {
    throw new CliError(
      "CLIENT_SECRET_REQUIRED",
      "Set FREEE_CLIENT_SECRET for this one configuration command or run it in an interactive terminal.",
      { exitCode: 2 },
    );
  }

  output.write("Client Secret (input hidden): ");
  const wasRaw = input.isRaw;
  input.setRawMode(true);
  input.resume();
  return new Promise<string>((resolve, reject) => {
    let secret = "";
    const cleanup = (): void => {
      input.off("data", onData);
      input.setRawMode(Boolean(wasRaw));
      input.pause();
      output.write("\n");
    };
    const onData = (chunk: Buffer): void => {
      for (const byte of chunk) {
        if (byte === 3) {
          cleanup();
          reject(new CliError("CONFIGURATION_CANCELLED", "Authentication configuration was cancelled.", { exitCode: 2 }));
          return;
        }
        if (byte === 10 || byte === 13) {
          cleanup();
          if (!secret) {
            reject(new CliError("CLIENT_SECRET_REQUIRED", "Client Secret must not be empty.", { exitCode: 2 }));
          } else {
            resolve(secret);
          }
          return;
        }
        if (byte === 8 || byte === 127) {
          secret = secret.slice(0, -1);
        } else if (byte >= 32) {
          secret += String.fromCharCode(byte);
        }
      }
    };
    input.on("data", onData);
  });
}
