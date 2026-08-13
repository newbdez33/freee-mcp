import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

test("the compiled CLI entry point is runnable without credentials for help", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  const result = await execFileAsync(process.execPath, ["dist/cli.js", "--help"], {
    encoding: "utf8",
  });

  assert.match(result.stdout, new RegExp(`freee-agent ${packageJson.version.replaceAll(".", "\\.")}`));
  assert.match(result.stdout, /clock in\|break-start\|break-end\|out/);
  assert.match(result.stdout, /team status/);
  assert.match(result.stdout, /monthly status/);
  assert.match(result.stdout, /monthly prepare-action/);
  assert.match(result.stdout, /monthly commit-action/);
  assert.match(result.stdout, /requests options/);
  assert.match(result.stdout, /requests prepare-create/);
  assert.match(result.stdout, /requests commit-withdraw/);
  assert.match(result.stdout, /approvals prepare-action/);
  assert.match(result.stdout, /approvals commit-action/);
  assert.doesNotMatch(result.stdout, /migrate/);
  assert.match(result.stdout, /browser configure/);
  assert.match(result.stdout, /browser credentials-status/);
  assert.match(result.stdout, /browser status/);
  assert.match(result.stdout, /backend status/);
  assert.equal(result.stderr, "");
});

test("Browser credential configuration stops before prompting when confirmation is missing", async () => {
  await assert.rejects(
    execFileAsync(process.execPath, ["dist/cli.js", "browser", "configure"], {
      encoding: "utf8",
    }),
    (error) => {
      assert.equal(error.code, 2);
      const parsed = JSON.parse(error.stderr);
      assert.equal(parsed.error.code, "CONFIRMATION_REQUIRED");
      return true;
    },
  );
});

test("Browser credential configuration never accepts credentials as command-line options", async () => {
  await assert.rejects(
    execFileAsync(process.execPath, [
      "dist/cli.js",
      "browser",
      "configure",
      "--username",
      "member@example.com",
      "--password",
      "must-not-be-accepted",
      "--confirm",
    ], { encoding: "utf8" }),
    (error) => {
      assert.equal(error.code, 2);
      const parsed = JSON.parse(error.stderr);
      assert.equal(parsed.error.code, "INVALID_ARGUMENTS");
      assert.equal(error.stderr.includes("member@example.com"), false);
      assert.equal(error.stderr.includes("must-not-be-accepted"), false);
      return true;
    },
  );
});

test("approval commit validates its preview fingerprint before launching a browser", async () => {
  await assert.rejects(
    execFileAsync(process.execPath, [
      "dist/cli.js",
      "approvals",
      "commit-action",
      "--id",
      "1234",
      "--action",
      "approve",
      "--fingerprint",
      "invalid",
      "--confirm",
    ], {
      encoding: "utf8",
      env: { ...process.env, FREEE_BACKEND: "playwright" },
    }),
    (error) => {
      assert.equal(error.code, 2);
      const parsed = JSON.parse(error.stderr);
      assert.equal(parsed.error.code, "INVALID_APPROVAL_FINGERPRINT");
      return true;
    },
  );
});

test("approval list validates its page before launching a browser", async () => {
  await assert.rejects(
    execFileAsync(process.execPath, [
      "dist/cli.js",
      "approvals",
      "list",
      "--page",
      "0",
    ], {
      encoding: "utf8",
      env: { ...process.env, FREEE_BACKEND: "playwright" },
    }),
    (error) => {
      assert.equal(error.code, 2);
      const parsed = JSON.parse(error.stderr);
      assert.equal(parsed.error.code, "INVALID_ARGUMENTS");
      return true;
    },
  );
});

test("personal application creation validates its fields before launching a browser", async () => {
  await assert.rejects(
    execFileAsync(process.execPath, [
      "dist/cli.js",
      "requests",
      "prepare-create",
      "--kind",
      "work-time-correction",
      "--date",
      "2026-08-14",
      "--clock-in",
      "9:00",
      "--clock-out",
      "18:00",
    ], {
      encoding: "utf8",
      env: { ...process.env, FREEE_BACKEND: "playwright" },
    }),
    (error) => {
      assert.equal(error.code, 2);
      const parsed = JSON.parse(error.stderr);
      assert.equal(parsed.error.code, "INVALID_PERSONAL_APPLICATION_TIME");
      return true;
    },
  );
});

test("OAuth login stops before credential-store access when confirm is missing", async () => {
  await assert.rejects(
    execFileAsync(process.execPath, ["dist/cli.js", "auth", "login"], {
      encoding: "utf8",
      env: process.env,
    }),
    (error) => {
      assert.equal(error.code, 2);
      const parsed = JSON.parse(error.stderr);
      assert.equal(parsed.error.code, "CONFIRMATION_REQUIRED");
      return true;
    },
  );
});
