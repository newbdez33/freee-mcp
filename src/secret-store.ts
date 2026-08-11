import type { OAuthRuntimeConfig } from "./auth-config.js";
import { CliError } from "./errors.js";
import type { OAuthClientCredentials, StoredOAuthTokens } from "./oauth.js";

export interface OAuthClientCredentialsProvider {
  getCredentials(): Promise<OAuthClientCredentials>;
}

export interface OAuthTokenStore {
  readonly writable?: boolean;
  read(): Promise<StoredOAuthTokens | null>;
  write(tokens: StoredOAuthTokens): Promise<void>;
}

export interface KeyringAdapter {
  getPassword(service: string, account: string): Promise<string | null | undefined>;
  setPassword(service: string, account: string, password: string): Promise<void>;
}

export interface FreeeWebCredentials {
  username: string;
  password: string;
}

export interface WebCredentialProvider {
  getCredentials(): Promise<FreeeWebCredentials>;
}

export interface WebCredentialStore extends WebCredentialProvider {
  writeCredentials(credentials: FreeeWebCredentials): Promise<void>;
}

export interface OAuthBackends {
  clientCredentials: OAuthClientCredentialsProvider;
  tokenStore: OAuthTokenStore;
}

const defaultKeyring: KeyringAdapter = {
  async getPassword(service, account) {
    const { AsyncEntry } = await loadSystemKeyring();
    return new AsyncEntry(service, account).getPassword(AbortSignal.timeout(60_000));
  },
  async setPassword(service, account, password) {
    const { AsyncEntry } = await loadSystemKeyring();
    await new AsyncEntry(service, account).setPassword(password, AbortSignal.timeout(60_000));
  },
};

export class SystemWebCredentialStore implements WebCredentialStore {
  constructor(
    readonly service = "freee-agent-web",
    private readonly keyring: KeyringAdapter = defaultKeyring,
  ) {}

  async getCredentials(): Promise<FreeeWebCredentials> {
    let serialized: string | null | undefined;
    try {
      serialized = await this.keyring.getPassword(this.service, "web-login");
    } catch {
      throw new CliError(
        "SYSTEM_KEYRING_UNAVAILABLE",
        "Could not read freee web credentials from the operating system credential store.",
        { exitCode: 2 },
      );
    }
    if (!serialized) {
      throw new CliError(
        "WEB_CREDENTIALS_UNAVAILABLE",
        "freee web credentials are not configured. Run `npm run freee -- browser configure --confirm` directly in a local interactive terminal.",
        {
          details: {
            configured: false,
            credentialStore: "system",
            setupCommand: "npm run freee -- browser configure --confirm",
          },
          exitCode: 2,
        },
      );
    }
    try {
      const parsed = JSON.parse(serialized) as Partial<FreeeWebCredentials>;
      if (
        typeof parsed.username !== "string"
        || parsed.username.length === 0
        || typeof parsed.password !== "string"
        || parsed.password.length === 0
      ) {
        throw new Error("incomplete web credentials");
      }
      return { username: parsed.username, password: parsed.password };
    } catch {
      throw new CliError(
        "INVALID_WEB_CREDENTIAL_STORE",
        "The System Keychain freee web credential entry is invalid.",
        { exitCode: 2 },
      );
    }
  }

  async writeCredentials(credentials: FreeeWebCredentials): Promise<void> {
    if (!credentials.username || !credentials.password) {
      throw new CliError(
        "WEB_CREDENTIALS_REQUIRED",
        "Both the freee username and password are required.",
        { exitCode: 2 },
      );
    }
    try {
      await this.keyring.setPassword(
        this.service,
        "web-login",
        JSON.stringify(credentials),
      );
    } catch {
      throw new CliError(
        "WEB_CREDENTIALS_PERSIST_FAILED",
        "Could not save freee web credentials to the operating system credential store.",
        { exitCode: 2 },
      );
    }
  }
}

async function loadSystemKeyring(): Promise<typeof import("@napi-rs/keyring")> {
  try {
    return await import("@napi-rs/keyring");
  } catch {
    throw new CliError(
      "SYSTEM_KEYRING_UNAVAILABLE",
      "The native operating system credential-store component is unavailable on this platform.",
      { exitCode: 2 },
    );
  }
}

export class SystemCredentialStore
  implements OAuthClientCredentialsProvider, OAuthTokenStore
{
  readonly writable = true;

  constructor(
    private readonly clientId: string,
    private readonly service = "freee-agent",
    private readonly keyring: KeyringAdapter = defaultKeyring,
  ) {}

  async writeClientSecret(clientSecret: string): Promise<void> {
    if (!clientSecret) {
      throw new CliError("CLIENT_SECRET_REQUIRED", "Client Secret must not be empty.", {
        exitCode: 2,
      });
    }
    try {
      await this.keyring.setPassword(this.service, "oauth-client-secret", clientSecret);
    } catch {
      throw new CliError(
        "SYSTEM_KEYRING_UNAVAILABLE",
        "Could not save the Client Secret to the operating system credential store.",
        { exitCode: 2 },
      );
    }
  }

  async getCredentials(): Promise<OAuthClientCredentials> {
    try {
      const clientSecret = await this.keyring.getPassword(this.service, "oauth-client-secret");
      if (!clientSecret) {
        throw new Error("missing secret");
      }
      return { clientId: this.clientId, clientSecret };
    } catch {
      throw new CliError(
        "OAUTH_CLIENT_CREDENTIALS_UNAVAILABLE",
        "Could not read the Client Secret from the operating system credential store.",
        { exitCode: 2 },
      );
    }
  }

  async read(): Promise<StoredOAuthTokens | null> {
    let serialized: string | null | undefined;
    try {
      serialized = await this.keyring.getPassword(this.service, "oauth-tokens");
    } catch {
      throw new CliError(
        "SYSTEM_KEYRING_UNAVAILABLE",
        "Could not read freee OAuth Tokens from the operating system credential store.",
        { exitCode: 2 },
      );
    }
    if (!serialized) {
      return null;
    }
    try {
      const parsed = JSON.parse(serialized) as Partial<StoredOAuthTokens>;
      if (!parsed.accessToken || !parsed.refreshToken || !parsed.expiresAt) {
        throw new Error("incomplete tokens");
      }
      return {
        accessToken: parsed.accessToken,
        refreshToken: parsed.refreshToken,
        expiresAt: parsed.expiresAt,
        scope: typeof parsed.scope === "string" ? parsed.scope : null,
      };
    } catch {
      throw new CliError("INVALID_TOKEN_STORE", "The system freee OAuth Token entry is invalid.", {
        exitCode: 2,
      });
    }
  }

  async write(tokens: StoredOAuthTokens): Promise<void> {
    try {
      await this.keyring.setPassword(this.service, "oauth-tokens", JSON.stringify(tokens));
    } catch {
      throw new CliError(
        "TOKEN_PERSIST_FAILED",
        "The new freee OAuth Tokens could not be saved to the operating system credential store. A fresh authorization may be required.",
      );
    }
  }
}

export function createOAuthBackends(
  config: OAuthRuntimeConfig,
): OAuthBackends {
  if (config.secretStore === "system") {
    const store = new SystemCredentialStore(config.clientId ?? "", config.service ?? "freee-agent");
    return { clientCredentials: store, tokenStore: store };
  }
  throw new CliError(
    "ENVIRONMENT_STORE_READ_ONLY",
    "Environment mode accepts an injected Access Token but cannot persist rotating Refresh Tokens.",
    { details: { requiredVariable: "FREEE_ACCESS_TOKEN" }, exitCode: 2 },
  );
}
