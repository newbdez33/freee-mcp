import assert from "node:assert/strict";
import test from "node:test";

import {
  EnvironmentOAuthClientCredentialsProvider,
  SystemCredentialStore,
  SystemWebCredentialStore,
} from "../dist/secret-store.js";

function createMemoryKeyring() {
  const values = new Map();
  return {
    values,
    async getPassword(service, account) {
      return values.get(`${service}:${account}`) ?? null;
    },
    async setPassword(service, account, password) {
      values.set(`${service}:${account}`, password);
    },
  };
}

test("System Credential Store keeps Client ID outside and Client Secret inside the keyring", async () => {
  const keyring = createMemoryKeyring();
  const store = new SystemCredentialStore("public-client-id", "freee-test", keyring);

  await store.writeClientSecret("private-client-secret");
  assert.deepEqual(await store.getCredentials(), {
    clientId: "public-client-id",
    clientSecret: "private-client-secret",
  });
  assert.equal(
    keyring.values.get("freee-test:oauth-client-secret"),
    "private-client-secret",
  );
  assert.equal([...keyring.values.values()].includes("public-client-id"), false);
});

test("System Credential Store rotates Access and Refresh Tokens as one keyring value", async () => {
  const keyring = createMemoryKeyring();
  const store = new SystemCredentialStore("client-id", "freee-test", keyring);
  const tokens = {
    accessToken: "access",
    refreshToken: "refresh",
    expiresAt: "2026-08-10T18:00:00.000Z",
    scope: "read write",
  };

  assert.equal(await store.read(), null);
  await store.write(tokens);
  assert.deepEqual(await store.read(), tokens);
  const serialized = keyring.values.get("freee-test:oauth-tokens");
  assert.equal(typeof serialized, "string");
  assert.equal(JSON.parse(serialized).refreshToken, "refresh");
});

test("Environment credentials require both OAuth values", async () => {
  const provider = new EnvironmentOAuthClientCredentialsProvider({
    FREEE_CLIENT_ID: "client-id",
    FREEE_CLIENT_SECRET: "client-secret",
  });
  assert.deepEqual(await provider.getCredentials(), {
    clientId: "client-id",
    clientSecret: "client-secret",
  });

  await assert.rejects(
    new EnvironmentOAuthClientCredentialsProvider({ FREEE_CLIENT_ID: "client-id" }).getCredentials(),
    (error) => error.code === "OAUTH_CLIENT_CREDENTIALS_UNAVAILABLE",
  );
});

test("System Web Credential Store saves username and password as one keyring value", async () => {
  const keyring = createMemoryKeyring();
  const store = new SystemWebCredentialStore("freee-agent-web-test", keyring);

  await store.writeCredentials({ username: "member@example.com", password: "private-password" });
  assert.deepEqual(await store.getCredentials(), {
    username: "member@example.com",
    password: "private-password",
  });
  const serialized = keyring.values.get("freee-agent-web-test:web-login");
  assert.deepEqual(JSON.parse(serialized), {
    username: "member@example.com",
    password: "private-password",
  });
});

test("System Web Credential Store reports missing and invalid entries safely", async () => {
  const keyring = createMemoryKeyring();
  const store = new SystemWebCredentialStore("freee-agent-web-test", keyring);

  await assert.rejects(
    store.getCredentials(),
    (error) => {
      assert.equal(error.code, "WEB_CREDENTIALS_UNAVAILABLE");
      assert.equal(error.details.configured, false);
      assert.match(error.details.setupCommand, /browser configure --confirm/);
      return true;
    },
  );
  keyring.values.set("freee-agent-web-test:web-login", "not-json");
  await assert.rejects(
    store.getCredentials(),
    (error) => error.code === "INVALID_WEB_CREDENTIAL_STORE",
  );
});
