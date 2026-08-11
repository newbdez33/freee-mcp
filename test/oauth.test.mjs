import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { FreeeOAuthClient, toStoredOAuthTokens } from "../dist/oauth.js";
import { receiveAuthorizationCode } from "../dist/oauth-login.js";

test("authorization URLs include a random-state slot and company selection", () => {
  const client = new FreeeOAuthClient();
  const url = new URL(
    client.buildAuthorizationUrl({
      clientId: "client-id",
      redirectUri: "http://127.0.0.1:48181/callback",
      state: "state-value",
    }),
  );

  assert.equal(url.origin, "https://accounts.secure.freee.co.jp");
  assert.equal(url.pathname, "/public_api/authorize");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("client_id"), "client-id");
  assert.equal(url.searchParams.get("state"), "state-value");
  assert.equal(url.searchParams.get("prompt"), "select_company");
});

test("authorization-code exchange uses form encoding and returns rotating tokens", async () => {
  let captured;
  const fakeFetch = async (url, init) => {
    captured = { url, init };
    return new Response(
      JSON.stringify({
        access_token: "new-access",
        refresh_token: "new-refresh",
        expires_in: 21600,
        token_type: "bearer",
        scope: "read write",
      }),
      { status: 200 },
    );
  };
  const client = new FreeeOAuthClient("https://example.test/token", fakeFetch);
  const response = await client.exchangeAuthorizationCode({
    credentials: { clientId: "client-id", clientSecret: "client-secret" },
    code: "one-time-code",
    redirectUri: "http://127.0.0.1:48181/callback",
  });

  assert.equal(captured.url, "https://example.test/token");
  const body = new URLSearchParams(captured.init.body);
  assert.equal(body.get("grant_type"), "authorization_code");
  assert.equal(body.get("client_secret"), "client-secret");
  assert.equal(body.get("code"), "one-time-code");
  assert.equal(response.refreshToken, "new-refresh");
  assert.deepEqual(toStoredOAuthTokens(response, 0), {
    accessToken: "new-access",
    refreshToken: "new-refresh",
    expiresAt: "1970-01-01T06:00:00.000Z",
    scope: "read write",
  });
});

test("OAuth failures never include returned token-like values", async () => {
  const fakeFetch = async () =>
    new Response(JSON.stringify({ error: "bad", refresh_token: "must-not-leak" }), { status: 401 });
  const client = new FreeeOAuthClient("https://example.test/token", fakeFetch);

  await assert.rejects(
    client.refresh({
      credentials: { clientId: "client-id", clientSecret: "client-secret" },
      refreshToken: "old-refresh",
    }),
    (error) => {
      assert.equal(error.code, "OAUTH_TOKEN_ERROR");
      assert.equal(JSON.stringify(error).includes("must-not-leak"), false);
      assert.equal(JSON.stringify(error).includes("old-refresh"), false);
      return true;
    },
  );
});

test("the loopback callback accepts a matching state without exposing it to the caller", async () => {
  const port = await getFreePort();
  const code = await receiveAuthorizationCode({
    clientId: "client-id",
    redirectUri: `http://127.0.0.1:${port}/callback`,
    oauthClient: new FreeeOAuthClient(),
    timeoutMs: 2_000,
    openBrowser: async (authorizationUrl) => {
      const state = new URL(authorizationUrl).searchParams.get("state");
      const response = await fetch(
        `http://127.0.0.1:${port}/callback?code=one-time-code&state=${encodeURIComponent(state)}`,
      );
      assert.equal(response.status, 200);
    },
  });

  assert.equal(code, "one-time-code");
});

test("the loopback callback rejects a mismatched state", async () => {
  const port = await getFreePort();
  await assert.rejects(
    receiveAuthorizationCode({
      clientId: "client-id",
      redirectUri: `http://127.0.0.1:${port}/callback`,
      oauthClient: new FreeeOAuthClient(),
      timeoutMs: 2_000,
      openBrowser: async () => {
        await fetch(`http://127.0.0.1:${port}/callback?code=one-time-code&state=wrong`);
      },
    }),
    (error) => error.code === "INVALID_OAUTH_CALLBACK",
  );
});

async function getFreePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return port;
}
