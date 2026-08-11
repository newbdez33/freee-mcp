import {
  readOAuthConfig,
  writeOAuthConfig,
  type OAuthRuntimeConfig,
} from "./auth-config.js";
import { CliError } from "./errors.js";
import {
  createOAuthBackends,
  SystemCredentialStore,
  type OAuthBackends,
  type OAuthClientCredentialsProvider,
  type OAuthTokenStore,
} from "./secret-store.js";

interface TargetSystemStore extends OAuthClientCredentialsProvider, OAuthTokenStore {
  writeClientSecret(clientSecret: string): Promise<void>;
}

interface MigrationDependencies {
  env?: NodeJS.ProcessEnv;
  readConfig?: (env: NodeJS.ProcessEnv) => Promise<OAuthRuntimeConfig | null>;
  saveConfig?: (config: OAuthRuntimeConfig, env: NodeJS.ProcessEnv) => Promise<void>;
  createCurrentBackends?: (config: OAuthRuntimeConfig, env: NodeJS.ProcessEnv) => OAuthBackends;
  createSystemStore?: (clientId: string, service: string) => TargetSystemStore;
}

export async function migrateAuthenticationToSystem(
  confirm: boolean,
  dependencies: MigrationDependencies = {},
): Promise<{
  migrated: boolean;
  credentialStore: "system";
  tokenStore: "system";
  redirectUri: string;
  copiedOAuthTokens: boolean;
}> {
  if (!confirm) {
    throw new CliError(
      "CONFIRMATION_REQUIRED",
      "This migration reads the configured OAuth client credential and writes it to the System Keyring. Re-run with `--confirm`.",
      { exitCode: 2 },
    );
  }

  const env = dependencies.env ?? process.env;
  const readConfig = dependencies.readConfig ?? readOAuthConfig;
  const saveConfig = dependencies.saveConfig ?? writeOAuthConfig;
  const createCurrentBackends = dependencies.createCurrentBackends ?? createOAuthBackends;
  const createSystemStore =
    dependencies.createSystemStore
    ?? ((clientId, service) => new SystemCredentialStore(clientId, service));
  const config = await readConfig(env);

  if (!config) {
    throw new CliError("AUTH_NOT_CONFIGURED", "Run `auth configure` before migrating credentials.", {
      exitCode: 2,
    });
  }
  if (config.secretStore === "environment") {
    throw new CliError(
      "ENVIRONMENT_STORE_READ_ONLY",
      "Environment credentials cannot be migrated because no persistent Client Secret is configured.",
      { exitCode: 2 },
    );
  }

  if (config.secretStore === "system") {
    await createCurrentBackends(config, env).clientCredentials.getCredentials();
    return {
      migrated: false,
      credentialStore: "system",
      tokenStore: "system",
      redirectUri: config.redirectUri,
      copiedOAuthTokens: false,
    };
  }

  const currentBackends = createCurrentBackends(config, env);
  const credentials = await currentBackends.clientCredentials.getCredentials();
  const service = config.service?.trim() || "freee-agent";
  const target = createSystemStore(credentials.clientId, service);
  const tokensToCopy = config.tokenStore === "system" ? null : await currentBackends.tokenStore.read();

  await target.writeClientSecret(credentials.clientSecret);
  if (tokensToCopy) {
    await target.write(tokensToCopy);
  }

  const verifiedCredentials = await target.getCredentials();
  if (
    verifiedCredentials.clientId !== credentials.clientId
    || verifiedCredentials.clientSecret !== credentials.clientSecret
  ) {
    throw new CliError(
      "SYSTEM_KEYRING_VERIFY_FAILED",
      "The OAuth client credential could not be verified after writing it to the System Keyring.",
      { exitCode: 2 },
    );
  }
  if (tokensToCopy) {
    const verifiedTokens = await target.read();
    if (
      !verifiedTokens
      || verifiedTokens.accessToken !== tokensToCopy.accessToken
      || verifiedTokens.refreshToken !== tokensToCopy.refreshToken
      || verifiedTokens.expiresAt !== tokensToCopy.expiresAt
    ) {
      throw new CliError(
        "SYSTEM_KEYRING_VERIFY_FAILED",
        "The OAuth Tokens could not be verified after writing them to the System Keyring.",
        { exitCode: 2 },
      );
    }
  }

  await saveConfig(
    {
      version: 1,
      mode: "oauth",
      secretStore: "system",
      tokenStore: "system",
      redirectUri: config.redirectUri,
      clientId: credentials.clientId,
      service,
    },
    env,
  );

  return {
    migrated: true,
    credentialStore: "system",
    tokenStore: "system",
    redirectUri: config.redirectUri,
    copiedOAuthTokens: tokensToCopy !== null,
  };
}
