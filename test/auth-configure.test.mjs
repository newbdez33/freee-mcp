import assert from "node:assert/strict";
import test from "node:test";

import { configureAuthentication } from "../dist/auth-configure.js";

test("system configuration stores the secret but writes only non-secret settings", async () => {
  let savedConfig;
  let storedSecret;
  const result = await configureAuthentication(
    {
      secretStore: "system",
      confirm: true,
      redirectUri: "http://127.0.0.1:48181/callback",
      clientId: "client-id",
      service: "freee-test",
    },
    {
      env: {},
      readClientSecret: async () => "client-secret",
      createSystemStore: () => ({
        async writeClientSecret(secret) { storedSecret = secret; },
      }),
      saveConfig: async (config) => { savedConfig = config; },
    },
  );

  assert.equal(storedSecret, "client-secret");
  assert.equal(savedConfig.clientId, "client-id");
  assert.equal(savedConfig.secretStore, "system");
  assert.equal(JSON.stringify(savedConfig).includes("client-secret"), false);
  assert.deepEqual(result, {
    secretStore: "system",
    tokenStore: "system",
    redirectUri: "http://127.0.0.1:48181/callback",
  });
});

test("missing confirmation stops before reading or storing any secret", async () => {
  let secretRead = false;
  await assert.rejects(
    configureAuthentication(
      {
        secretStore: "system",
        confirm: false,
        redirectUri: "http://127.0.0.1:48181/callback",
        clientId: "client-id",
      },
      {
        readClientSecret: async () => {
          secretRead = true;
          return "secret";
        },
      },
    ),
    (error) => error.code === "CONFIRMATION_REQUIRED",
  );
  assert.equal(secretRead, false);
});

test("environment mode is accepted only when an Access Token is injected", async () => {
  let savedConfig;
  await configureAuthentication(
    {
      secretStore: "environment",
      confirm: true,
      redirectUri: "http://127.0.0.1:48181/callback",
    },
    {
      env: { FREEE_ACCESS_TOKEN: "temporary-token" },
      saveConfig: async (config) => { savedConfig = config; },
    },
  );
  assert.equal(savedConfig.secretStore, "environment");

  await assert.rejects(
    configureAuthentication(
      {
        secretStore: "environment",
        confirm: true,
        redirectUri: "http://127.0.0.1:48181/callback",
      },
      { env: {} },
    ),
    (error) => error.code === "CREDENTIAL_UNAVAILABLE",
  );
});
