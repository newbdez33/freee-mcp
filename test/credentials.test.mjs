import assert from "node:assert/strict";
import test from "node:test";

import { OnePasswordCredentialProvider } from "../dist/credentials.js";

test("1Password provider trims the secret without changing it", async () => {
  const calls = [];
  const provider = new OnePasswordCredentialProvider(
    "op://Private/freee/API KEY",
    "op",
    async (executable, args) => {
      calls.push({ executable, args });
      return "access-token-value\n";
    },
  );

  assert.equal(await provider.getAccessToken(), "access-token-value");
  assert.deepEqual(calls, [
    { executable: "op", args: ["read", "op://Private/freee/API KEY"] },
  ]);
});

test("1Password errors never contain subprocess output", async () => {
  const provider = new OnePasswordCredentialProvider(
    "op://Private/freee/API KEY",
    "op",
    async () => {
      throw new Error("stderr accidentally contains access-token-value");
    },
  );

  await assert.rejects(provider.getAccessToken(), (error) => {
    assert.equal(error.code, "CREDENTIAL_UNAVAILABLE");
    assert.equal(error.message.includes("access-token-value"), false);
    return true;
  });
});
