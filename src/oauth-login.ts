import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { promisify } from "node:util";

import { CliError } from "./errors.js";
import { FreeeOAuthClient } from "./oauth.js";

const execFileAsync = promisify(execFile);

export async function receiveAuthorizationCode(input: {
  clientId: string;
  redirectUri: string;
  oauthClient: FreeeOAuthClient;
  openBrowser?: (url: string) => Promise<void>;
  timeoutMs?: number;
}): Promise<string> {
  const redirectUrl = validateLoopbackRedirect(input.redirectUri);
  const state = randomBytes(32).toString("base64url");
  const authorizationUrl = input.oauthClient.buildAuthorizationUrl({
    clientId: input.clientId,
    redirectUri: redirectUrl.toString(),
    state,
  });
  const openBrowser = input.openBrowser ?? defaultOpenBrowser;
  const timeoutMs = input.timeoutMs ?? 3 * 60_000;

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, code?: string): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      server.close();
      if (error) {
        reject(error);
      } else if (code) {
        resolve(code);
      }
    };

    const server = createServer((request, response) => {
      const requestUrl = new URL(request.url ?? "/", redirectUrl.origin);
      if (requestUrl.pathname !== redirectUrl.pathname) {
        response.writeHead(404).end("Not found");
        return;
      }
      const returnedState = requestUrl.searchParams.get("state");
      const code = requestUrl.searchParams.get("code");
      const oauthError = requestUrl.searchParams.get("error");
      if (oauthError) {
        response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("freee authorization was not completed. You can close this page.");
        finish(new CliError("OAUTH_AUTHORIZATION_DENIED", "freee authorization was denied.", { exitCode: 2 }));
        return;
      }
      if (returnedState !== state || !code) {
        response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Invalid OAuth callback. You can close this page.");
        finish(new CliError("INVALID_OAUTH_CALLBACK", "OAuth state validation failed.", { exitCode: 2 }));
        return;
      }
      response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("freee authorization succeeded. You can close this page and return to the terminal.");
      finish(undefined, code);
    });

    const timer = setTimeout(() => {
      finish(new CliError("OAUTH_CALLBACK_TIMEOUT", "Timed out waiting for freee authorization.", {
        exitCode: 2,
      }));
    }, timeoutMs);

    server.on("error", () => {
      finish(new CliError("OAUTH_CALLBACK_SERVER_ERROR", "Could not start the local OAuth callback server.", {
        exitCode: 2,
      }));
    });

    server.listen(Number(redirectUrl.port), "127.0.0.1", () => {
      void openBrowser(authorizationUrl).catch(() => {
        finish(new CliError("BROWSER_OPEN_FAILED", "Could not open the freee authorization page.", {
          details: { authorizationUrl },
          exitCode: 2,
        }));
      });
    });
  });
}

function validateLoopbackRedirect(redirectUri: string): URL {
  let url: URL;
  try {
    url = new URL(redirectUri);
  } catch {
    throw new CliError("INVALID_REDIRECT_URI", "The OAuth redirect URI is invalid.", { exitCode: 2 });
  }
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port || url.search || url.hash) {
    throw new CliError(
      "INVALID_REDIRECT_URI",
      "Use an exact loopback redirect such as http://127.0.0.1:48181/callback.",
      { exitCode: 2 },
    );
  }
  return url;
}

async function defaultOpenBrowser(url: string): Promise<void> {
  await execFileAsync("open", [url], { timeout: 15_000 });
}
