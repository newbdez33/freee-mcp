import { mkdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CredentialProvider } from "./credentials.js";
import { CliError } from "./errors.js";
import { FreeeOAuthClient, toStoredOAuthTokens, type StoredOAuthTokens } from "./oauth.js";
import type { OAuthClientCredentialsProvider, OAuthTokenStore } from "./secret-store.js";

export class RefreshingCredentialProvider implements CredentialProvider {
  readonly source: CredentialProvider["source"];
  private cached: StoredOAuthTokens | null = null;

  constructor(
    private readonly fallback: CredentialProvider,
    private readonly tokenStore: OAuthTokenStore,
    private readonly clientCredentials: OAuthClientCredentialsProvider,
    private readonly oauthClient = new FreeeOAuthClient(),
    private readonly refreshSkewMs = 5 * 60 * 1000,
    private readonly refreshLockPath = join(
      tmpdir(),
      `freee-agent-oauth-${typeof process.getuid === "function" ? process.getuid() : "user"}.lock`,
    ),
    source: CredentialProvider["source"] = fallback.source,
  ) {
    this.source = source;
  }

  async getAccessToken(): Promise<string> {
    if (this.cached && !isExpiring(this.cached, this.refreshSkewMs)) {
      return this.cached.accessToken;
    }

    const stored = await this.tokenStore.read();
    if (!stored) {
      return this.fallback.getAccessToken();
    }
    this.cached = stored;
    if (isExpiring(stored, this.refreshSkewMs)) {
      if (this.tokenStore.writable === false) {
        throw refreshUnavailableError();
      }
      return this.refreshAccessToken();
    }
    return stored.accessToken;
  }

  async refreshAccessToken(): Promise<string> {
    if (this.tokenStore.writable === false) {
      throw refreshUnavailableError();
    }
    const observed = await this.tokenStore.read();
    if (!observed) {
      throw new CliError(
        "TOKEN_REFRESH_UNAVAILABLE",
        "No Refresh Token is configured. Run `auth login` before automatic refresh can be used.",
        { exitCode: 2 },
      );
    }

    return withDirectoryLock(this.refreshLockPath, async () => {
      const current = await this.tokenStore.read();
      if (!current) {
        throw new CliError("TOKEN_REFRESH_UNAVAILABLE", "The OAuth Token item disappeared.", {
          exitCode: 2,
        });
      }

      if (current.refreshToken !== observed.refreshToken) {
        this.cached = current;
        return current.accessToken;
      }

      const credentials = await this.clientCredentials.getCredentials();
      const response = await this.oauthClient.refresh({
        credentials,
        refreshToken: current.refreshToken,
      });
      const updated = toStoredOAuthTokens(response);
      await this.tokenStore.write(updated);
      this.cached = updated;
      return updated.accessToken;
    });
  }
}

function refreshUnavailableError(): CliError {
  return new CliError(
    "TOKEN_REFRESH_UNAVAILABLE",
    "The configured credential backend cannot persist rotating Refresh Tokens.",
    { exitCode: 2 },
  );
}

function isExpiring(tokens: StoredOAuthTokens, skewMs: number): boolean {
  const expiresAt = Date.parse(tokens.expiresAt);
  return !Number.isFinite(expiresAt) || expiresAt <= Date.now() + skewMs;
}

async function withDirectoryLock<T>(lockPath: string, task: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + 30_000;
  while (true) {
    try {
      await mkdir(lockPath, { mode: 0o700 });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
      try {
        const lockStat = await stat(lockPath);
        if (Date.now() - lockStat.mtimeMs > 2 * 60_000) {
          await rm(lockPath, { recursive: true, force: true });
          continue;
        }
      } catch {
        continue;
      }
      if (Date.now() >= deadline) {
        throw new CliError("TOKEN_REFRESH_BUSY", "Another freee token refresh is still running.", {
          exitCode: 2,
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  try {
    return await task();
  } finally {
    await rm(lockPath, { recursive: true, force: true });
  }
}
