import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { RefreshingCredentialProvider } from "../dist/oauth-credentials.js";

test("an expiring token is refreshed, persisted, and cached", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "freee-oauth-test-"));
  const lockPath = join(temporaryDirectory, "refresh.lock");
  let stored = {
    accessToken: "old-access",
    refreshToken: "old-refresh",
    expiresAt: "2000-01-01T00:00:00.000Z",
    scope: "read write",
  };
  let refreshCount = 0;
  const provider = new RefreshingCredentialProvider(
    { source: "system", async getAccessToken() { return "fallback"; } },
    {
      async read() { return { ...stored }; },
      async write(tokens) { stored = { ...tokens }; },
    },
    { async getCredentials() { return { clientId: "id", clientSecret: "secret" }; } },
    {
      async refresh(input) {
        refreshCount += 1;
        assert.equal(input.refreshToken, "old-refresh");
        return {
          accessToken: "new-access",
          refreshToken: "new-refresh",
          expiresIn: 21600,
          tokenType: "bearer",
          scope: "read write",
        };
      },
    },
    5 * 60 * 1000,
    lockPath,
  );

  try {
    assert.equal(await provider.getAccessToken(), "new-access");
    assert.equal(await provider.getAccessToken(), "new-access");
    assert.equal(refreshCount, 1);
    assert.equal(stored.refreshToken, "new-refresh");
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("two processes sharing a lock consume a one-time Refresh Token only once", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "freee-oauth-race-test-"));
  const lockPath = join(temporaryDirectory, "refresh.lock");
  let stored = {
    accessToken: "old-access",
    refreshToken: "old-refresh",
    expiresAt: "2000-01-01T00:00:00.000Z",
    scope: null,
  };
  let refreshCount = 0;
  const store = {
    async read() { return { ...stored }; },
    async write(tokens) { stored = { ...tokens }; },
  };
  const credentials = { async getCredentials() { return { clientId: "id", clientSecret: "secret" }; } };
  const oauth = {
    async refresh() {
      refreshCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 30));
      return {
        accessToken: "new-access",
        refreshToken: "new-refresh",
        expiresIn: 21600,
        tokenType: "bearer",
        scope: null,
      };
    },
  };
  const fallback = { source: "system", async getAccessToken() { return "fallback"; } };
  const first = new RefreshingCredentialProvider(fallback, store, credentials, oauth, 0, lockPath);
  const second = new RefreshingCredentialProvider(fallback, store, credentials, oauth, 0, lockPath);

  try {
    const results = await Promise.all([first.refreshAccessToken(), second.refreshAccessToken()]);
    assert.deepEqual(results, ["new-access", "new-access"]);
    assert.equal(refreshCount, 1);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
