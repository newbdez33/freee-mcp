import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import {
  configureBrowserCredentials,
  readHiddenBrowserCredentials,
} from "../dist/browser-credential-configure.js";

class FakeTtyInput extends EventEmitter {
  isTTY = true;
  isRaw = false;
  setRawMode(value) { this.isRaw = value; }
  resume() {}
  pause() {}
}

class FakeTtyOutput {
  text = "";
  write(value) { this.text += value; }
}

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

test("Browser credential configuration requires confirmation before prompting or opening Keychain", async () => {
  let prompted = false;
  let storeCreated = false;
  await assert.rejects(
    configureBrowserCredentials(
      { confirm: false },
      {
        async readCredentials() {
          prompted = true;
          throw new Error("must not prompt");
        },
        createStore() {
          storeCreated = true;
          throw new Error("must not create store");
        },
      },
    ),
    (error) => error.code === "CONFIRMATION_REQUIRED",
  );
  assert.equal(prompted, false);
  assert.equal(storeCreated, false);
});

test("Interactive browser credential prompts never echo entered values", async () => {
  const input = new FakeTtyInput();
  const output = new FakeTtyOutput();
  const resultPromise = readHiddenBrowserCredentials(input, output);
  await nextTurn();
  input.emit("data", Buffer.from("member@example.com\r"));
  await nextTurn();
  input.emit("data", Buffer.from("private-password\r"));
  await nextTurn();
  input.emit("data", Buffer.from("private-password\r"));

  assert.deepEqual(await resultPromise, {
    username: "member@example.com",
    password: "private-password",
  });
  assert.match(output.text, /username\/email \(input hidden\)/);
  assert.match(output.text, /Confirm freee password/);
  assert.equal(output.text.includes("member@example.com"), false);
  assert.equal(output.text.includes("private-password"), false);
  assert.equal(input.isRaw, false);
});

test("Browser credential configuration writes and verifies without returning secrets", async () => {
  const source = { username: " member@example.com ", password: "private-password" };
  let persisted = null;
  const result = await configureBrowserCredentials(
    { confirm: true, service: "freee-web-test" },
    {
      async readCredentials() { return source; },
      createStore(service) {
        assert.equal(service, "freee-web-test");
        return {
          async writeCredentials(credentials) { persisted = { ...credentials }; },
          async getCredentials() { return persisted; },
        };
      },
    },
  );

  assert.deepEqual(persisted, {
    username: "member@example.com",
    password: "private-password",
  });
  assert.equal(result.configured, true);
  assert.equal(result.credentialStore, "system");
  assert.equal(JSON.stringify(result).includes("member@example.com"), false);
  assert.equal(JSON.stringify(result).includes("private-password"), false);
});

test("Browser credential configuration stops when Keychain verification differs", async () => {
  await assert.rejects(
    configureBrowserCredentials(
      { confirm: true },
      {
        async readCredentials() {
          return { username: "member@example.com", password: "source-password" };
        },
        createStore() {
          return {
            async writeCredentials() {},
            async getCredentials() {
              return { username: "member@example.com", password: "different-password" };
            },
          };
        },
      },
    ),
    (error) => error.code === "WEB_CREDENTIAL_VERIFY_FAILED",
  );
});

test("Browser credential configuration rejects empty values before writing", async () => {
  let wrote = false;
  await assert.rejects(
    configureBrowserCredentials(
      { confirm: true },
      {
        async readCredentials() { return { username: " ", password: "secret" }; },
        createStore() {
          return {
            async writeCredentials() { wrote = true; },
            async getCredentials() { throw new Error("must not read"); },
          };
        },
      },
    ),
    (error) => error.code === "WEB_CREDENTIALS_REQUIRED",
  );
  assert.equal(wrote, false);
});
