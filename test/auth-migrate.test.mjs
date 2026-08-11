import assert from "node:assert/strict";
import test from "node:test";

import { migrateAuthenticationToSystem } from "../dist/auth-migrate.js";

const onePasswordConfig = {
  version: 1,
  mode: "oauth",
  secretStore: "1password",
  tokenStore: "system",
  redirectUri: "http://127.0.0.1:48181/callback",
  vault: "Private",
  clientItem: "freee",
  service: "freee-test",
};

test("migration requires explicit confirmation before reading credentials", async () => {
  let configRead = false;
  await assert.rejects(
    migrateAuthenticationToSystem(false, {
      readConfig: async () => {
        configRead = true;
        return onePasswordConfig;
      },
    }),
    (error) => error.code === "CONFIRMATION_REQUIRED",
  );
  assert.equal(configRead, false);
});

test("hybrid 1Password credentials migrate without rewriting existing System Keyring tokens", async () => {
  let savedConfig;
  let writtenSecret;
  let tokenWriteCount = 0;
  const result = await migrateAuthenticationToSystem(true, {
    env: {},
    readConfig: async () => onePasswordConfig,
    createCurrentBackends: () => ({
      clientCredentials: {
        async getCredentials() {
          return { clientId: "client-id", clientSecret: "client-secret" };
        },
      },
      tokenStore: {
        async read() {
          throw new Error("existing System Keyring token must not be read or rewritten");
        },
        async write() {
          throw new Error("existing System Keyring token must not be rewritten");
        },
      },
    }),
    createSystemStore: (clientId, service) => ({
      async writeClientSecret(secret) {
        assert.equal(clientId, "client-id");
        assert.equal(service, "freee-test");
        writtenSecret = secret;
      },
      async getCredentials() {
        return { clientId, clientSecret: writtenSecret };
      },
      async read() {
        return null;
      },
      async write() {
        tokenWriteCount += 1;
      },
    }),
    saveConfig: async (config) => {
      savedConfig = config;
    },
  });

  assert.equal(writtenSecret, "client-secret");
  assert.equal(tokenWriteCount, 0);
  assert.equal(savedConfig.secretStore, "system");
  assert.equal(savedConfig.tokenStore, "system");
  assert.equal(savedConfig.clientId, "client-id");
  assert.equal(JSON.stringify(savedConfig).includes("client-secret"), false);
  assert.deepEqual(result, {
    migrated: true,
    credentialStore: "system",
    tokenStore: "system",
    redirectUri: "http://127.0.0.1:48181/callback",
    copiedOAuthTokens: false,
  });
});

test("legacy 1Password OAuth Tokens are copied and verified before config switches", async () => {
  const tokens = {
    accessToken: "access",
    refreshToken: "refresh",
    expiresAt: "2026-08-10T18:00:00.000Z",
    scope: "read",
  };
  let targetTokens = null;
  let saved = false;
  const result = await migrateAuthenticationToSystem(true, {
    env: {},
    readConfig: async () => ({ ...onePasswordConfig, tokenStore: "1password" }),
    createCurrentBackends: () => ({
      clientCredentials: {
        async getCredentials() {
          return { clientId: "client-id", clientSecret: "client-secret" };
        },
      },
      tokenStore: {
        async read() { return tokens; },
        async write() {},
      },
    }),
    createSystemStore: (clientId) => ({
      async writeClientSecret() {},
      async getCredentials() {
        return { clientId, clientSecret: "client-secret" };
      },
      async read() { return targetTokens; },
      async write(value) { targetTokens = value; },
    }),
    saveConfig: async () => { saved = true; },
  });

  assert.equal(saved, true);
  assert.deepEqual(targetTokens, tokens);
  assert.equal(result.copiedOAuthTokens, true);
});
