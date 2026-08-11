import { CliError } from "./errors.js";
import { readOAuthConfig } from "./auth-config.js";
import { FreeeOAuthClient } from "./oauth.js";
import { RefreshingCredentialProvider } from "./oauth-credentials.js";
import { createOAuthBackends } from "./secret-store.js";

export interface CredentialProvider {
  readonly source: "environment" | "system";
  getAccessToken(): Promise<string>;
  refreshAccessToken?(): Promise<string>;
}

class EnvironmentCredentialProvider implements CredentialProvider {
  readonly source = "environment" as const;

  constructor(private readonly token: string) {}

  async getAccessToken(): Promise<string> {
    return this.token;
  }
}

class MissingCredentialProvider implements CredentialProvider {
  readonly source = "system" as const;

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

  const oauthConfig = await readOAuthConfig(env);
  if (!oauthConfig) {
    return new MissingCredentialProvider();
  }

  if (oauthConfig.secretStore === "environment") {
    throw new CliError(
      "CREDENTIAL_UNAVAILABLE",
      "Environment mode requires FREEE_ACCESS_TOKEN in the current process.",
      { exitCode: 2 },
    );
  }

  const backends = createOAuthBackends(oauthConfig);

  return new RefreshingCredentialProvider(
    new MissingCredentialProvider(),
    backends.tokenStore,
    backends.clientCredentials,
    new FreeeOAuthClient(env.FREEE_OAUTH_TOKEN_URL),
    5 * 60 * 1000,
    undefined,
    "system",
  );
}
