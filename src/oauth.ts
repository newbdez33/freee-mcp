import { CliError } from "./errors.js";

export interface OAuthClientCredentials {
  clientId: string;
  clientSecret: string;
}

export interface OAuthTokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: string;
  scope: string | null;
}

export interface StoredOAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  scope: string | null;
}

type Fetch = typeof globalThis.fetch;

export class FreeeOAuthClient {
  constructor(
    private readonly tokenUrl = "https://accounts.secure.freee.co.jp/public_api/token",
    private readonly fetchImplementation: Fetch = globalThis.fetch,
  ) {}

  buildAuthorizationUrl(input: {
    clientId: string;
    redirectUri: string;
    state: string;
    selectCompany?: boolean;
  }): string {
    const url = new URL("https://accounts.secure.freee.co.jp/public_api/authorize");
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", input.clientId);
    url.searchParams.set("redirect_uri", input.redirectUri);
    url.searchParams.set("state", input.state);
    if (input.selectCompany !== false) {
      url.searchParams.set("prompt", "select_company");
    }
    return url.toString();
  }

  exchangeAuthorizationCode(input: {
    credentials: OAuthClientCredentials;
    code: string;
    redirectUri: string;
  }): Promise<OAuthTokenResponse> {
    return this.requestToken({
      grant_type: "authorization_code",
      client_id: input.credentials.clientId,
      client_secret: input.credentials.clientSecret,
      code: input.code,
      redirect_uri: input.redirectUri,
    });
  }

  refresh(input: {
    credentials: OAuthClientCredentials;
    refreshToken: string;
  }): Promise<OAuthTokenResponse> {
    return this.requestToken({
      grant_type: "refresh_token",
      client_id: input.credentials.clientId,
      client_secret: input.credentials.clientSecret,
      refresh_token: input.refreshToken,
    });
  }

  private async requestToken(form: Record<string, string>): Promise<OAuthTokenResponse> {
    const response = await this.fetchImplementation(this.tokenUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(15_000),
    });
    const responseText = await response.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(responseText);
    } catch {
      parsed = undefined;
    }

    if (!response.ok) {
      throw new CliError("OAUTH_TOKEN_ERROR", `freee OAuth returned HTTP ${response.status}.`, {
        exitCode: 2,
      });
    }

    if (!parsed || typeof parsed !== "object") {
      throw new CliError("INVALID_OAUTH_RESPONSE", "freee returned an invalid OAuth response.");
    }
    const record = parsed as Record<string, unknown>;
    if (
      typeof record.access_token !== "string" ||
      typeof record.refresh_token !== "string" ||
      typeof record.expires_in !== "number" ||
      typeof record.token_type !== "string"
    ) {
      throw new CliError("INVALID_OAUTH_RESPONSE", "freee returned an incomplete OAuth response.");
    }

    return {
      accessToken: record.access_token,
      refreshToken: record.refresh_token,
      expiresIn: record.expires_in,
      tokenType: record.token_type,
      scope: typeof record.scope === "string" ? record.scope : null,
    };
  }
}

export function toStoredOAuthTokens(
  response: OAuthTokenResponse,
  now = Date.now(),
): StoredOAuthTokens {
  return {
    accessToken: response.accessToken,
    refreshToken: response.refreshToken,
    expiresAt: new Date(now + response.expiresIn * 1000).toISOString(),
    scope: response.scope,
  };
}
