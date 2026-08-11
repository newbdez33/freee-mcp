import assert from "node:assert/strict";
import test from "node:test";

import {
  OnePasswordOAuthClientCredentialsProvider,
  OnePasswordOAuthTokenStore,
  OnePasswordWebCredentialProvider,
} from "../dist/token-store.js";

test("OAuth client credentials read only the two configured 1Password fields", async () => {
  let capturedArgs;
  const provider = new OnePasswordOAuthClientCredentialsProvider("Private", "freee", async (args) => {
    capturedArgs = args;
    return JSON.stringify([
      { label: "client id", type: "STRING", value: "client-id" },
      { label: "Client Secret", type: "CONCEALED", value: "client-secret" },
    ]);
  });

  assert.deepEqual(await provider.getCredentials(), {
    clientId: "client-id",
    clientSecret: "client-secret",
  });
  assert.deepEqual(capturedArgs, [
    "item",
    "get",
    "freee",
    "--vault",
    "Private",
    "--fields",
    "label=client id,label=Client Secret",
    "--format",
    "json",
    "--reveal",
  ]);
});

test("Token Store edits through stdin and rotates both tokens together", async () => {
  const calls = [];
  let existing = {
    id: "token-item-id",
    title: "freee OAuth Tokens",
    category: "API_CREDENTIAL",
    fields: [
      { id: "credential", label: "Access Token", type: "CONCEALED", value: "old-access" },
      { id: "refresh_token", label: "Refresh Token", type: "CONCEALED", value: "old-refresh" },
      { id: "expires_at", label: "Expires At", type: "STRING", value: "2026-01-01T00:00:00.000Z" },
    ],
  };
  const runner = async (args, input) => {
    calls.push({ args, input });
    if (args[1] === "get") {
      return JSON.stringify(existing);
    }
    if (args[1] === "edit") {
      existing = JSON.parse(input);
      return "{}";
    }
    return "{}";
  };
  const store = new OnePasswordOAuthTokenStore("Private", "freee OAuth Tokens", runner);

  await store.write({
    accessToken: "new-access",
    refreshToken: "new-refresh",
    expiresAt: "2026-08-10T18:00:00.000Z",
    scope: "read write",
  });

  const editCall = calls.find((call) => call.args[1] === "edit");
  assert.deepEqual(editCall.args, ["item", "edit", "token-item-id", "--vault", "Private"]);
  const edited = JSON.parse(editCall.input);
  assert.equal(edited.fields.find((field) => field.label === "Access Token").value, "new-access");
  assert.equal(edited.fields.find((field) => field.label === "Refresh Token").value, "new-refresh");
  assert.equal(editCall.args.join(" ").includes("new-refresh"), false);
});

test("Token Store creates a dedicated API Credential item when none exists", async () => {
  const calls = [];
  let createdItem = null;
  const runner = async (args, input) => {
    calls.push({ args, input });
    if (args[1] === "get") {
      if (!createdItem) {
        throw new Error("not found");
      }
      return JSON.stringify(createdItem);
    }
    if (args[1] === "create") {
      createdItem = { id: "created-token-item", ...JSON.parse(input) };
      return "{}";
    }
    return "{}";
  };
  const store = new OnePasswordOAuthTokenStore("Private", "freee OAuth Tokens", runner);

  await store.write({
    accessToken: "access",
    refreshToken: "refresh",
    expiresAt: "2026-08-10T18:00:00.000Z",
    scope: null,
  });

  const createCall = calls.find((call) => call.args[1] === "create");
  assert.deepEqual(createCall.args, ["item", "create", "--vault", "Private"]);
  const created = JSON.parse(createCall.input);
  assert.equal(created.category, "API_CREDENTIAL");
  assert.equal(created.fields.find((field) => field.label === "Refresh Token").type, "CONCEALED");
});

test("Token Store rejects a successful command when 1Password ignores field updates", async () => {
  const existing = {
    id: "token-item-id",
    title: "OAuth Tokens - FreeeBot",
    category: "API_CREDENTIAL",
    fields: [
      { id: "access", label: "Access Token", type: "CONCEALED", value: "" },
      { id: "refresh", label: "Refresh Token", type: "CONCEALED", value: "" },
      { id: "expires", label: "Expires At", type: "STRING", value: "" },
      { id: "scope", label: "Scope", type: "STRING", value: "" },
    ],
  };
  const runner = async (args) => {
    if (args[1] === "get") {
      return JSON.stringify(existing);
    }
    return "{}";
  };
  const store = new OnePasswordOAuthTokenStore("Private", "OAuth Tokens - FreeeBot", runner);

  await assert.rejects(
    store.write({
      accessToken: "access",
      refreshToken: "refresh",
      expiresAt: "2026-08-10T18:00:00.000Z",
      scope: "read write",
    }),
    (error) => error.code === "TOKEN_PERSIST_FAILED",
  );
});

test("Web credentials use standard 1Password login field purposes", async () => {
  let capturedArgs;
  const provider = new OnePasswordWebCredentialProvider("Private", "freee", async (args) => {
    capturedArgs = args;
    return JSON.stringify({
      title: "freee",
      category: "LOGIN",
      fields: [
        { label: "email address", purpose: "USERNAME", value: "member@example.com" },
        { label: "passphrase", purpose: "PASSWORD", value: "private-password" },
      ],
    });
  });

  assert.deepEqual(await provider.getCredentials(), {
    username: "member@example.com",
    password: "private-password",
  });
  assert.deepEqual(capturedArgs, [
    "item",
    "get",
    "freee",
    "--vault",
    "Private",
    "--format",
    "json",
    "--reveal",
  ]);
});

test("Web credential failures never expose 1Password output", async () => {
  const provider = new OnePasswordWebCredentialProvider("Private", "freee", async () => {
    throw new Error("private-password");
  });

  await assert.rejects(provider.getCredentials(), (error) => {
    assert.equal(error.code, "WEB_CREDENTIALS_UNAVAILABLE");
    assert.equal(error.message.includes("private-password"), false);
    return true;
  });
});
