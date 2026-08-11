import assert from "node:assert/strict";
import test from "node:test";

import { migrateBrowserCredentialsFromOnePassword } from "../dist/browser-credential-migrate.js";

test("Browser credential migration requires confirmation before reading 1Password", async () => {
  let sourceCreated = false;
  let targetCreated = false;

  await assert.rejects(
    migrateBrowserCredentialsFromOnePassword(
      { confirm: false },
      {
        createSource() {
          sourceCreated = true;
          throw new Error("must not create source");
        },
        createTarget() {
          targetCreated = true;
          throw new Error("must not create target");
        },
      },
    ),
    (error) => error.code === "CONFIRMATION_REQUIRED",
  );
  assert.equal(sourceCreated, false);
  assert.equal(targetCreated, false);
});

test("Browser credential migration writes and verifies without returning secrets", async () => {
  const sourceCredentials = {
    username: "member@example.com",
    password: "private-password",
  };
  let persisted = null;

  const result = await migrateBrowserCredentialsFromOnePassword(
    { confirm: true, vault: "Work", item: "freee login", service: "freee-web-test" },
    {
      createSource(vault, item) {
        assert.equal(vault, "Work");
        assert.equal(item, "freee login");
        return { async getCredentials() { return sourceCredentials; } };
      },
      createTarget(service) {
        assert.equal(service, "freee-web-test");
        return {
          async writeCredentials(credentials) { persisted = { ...credentials }; },
          async getCredentials() { return persisted; },
        };
      },
    },
  );

  assert.deepEqual(persisted, sourceCredentials);
  assert.deepEqual(result, {
    migrated: true,
    source: "1password",
    destination: "system",
    service: "freee-web-test",
  });
  assert.equal(JSON.stringify(result).includes("member@example.com"), false);
  assert.equal(JSON.stringify(result).includes("private-password"), false);
});

test("Browser credential migration fails when Keychain readback differs", async () => {
  await assert.rejects(
    migrateBrowserCredentialsFromOnePassword(
      { confirm: true },
      {
        createSource() {
          return {
            async getCredentials() {
              return { username: "member@example.com", password: "source-password" };
            },
          };
        },
        createTarget() {
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
