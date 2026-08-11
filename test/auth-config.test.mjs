import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { readOAuthConfig, writeOAuthConfig } from "../dist/auth-config.js";

test("OAuth config persists only non-secret System Keyring metadata with restricted permissions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "freee-config-test-"));
  const configPath = join(directory, "oauth.json");
  const env = { FREEE_CONFIG_PATH: configPath };
  const config = {
    version: 1,
    mode: "oauth",
    secretStore: "system",
    tokenStore: "system",
    redirectUri: "http://127.0.0.1:48181/callback",
    clientId: "client-id",
    service: "freee-agent",
  };

  try {
    await writeOAuthConfig(config, env);
    assert.deepEqual(await readOAuthConfig(env), config);
    assert.equal((await stat(configPath)).mode & 0o777, 0o600);
    const serialized = await readFile(configPath, "utf8");
    assert.equal(serialized.includes("clientSecret"), false);
    assert.equal(serialized.includes("refreshToken"), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the original 1Password OAuth config format migrates in memory", async () => {
  const directory = await mkdtemp(join(tmpdir(), "freee-config-migration-test-"));
  const configPath = join(directory, "oauth.json");
  try {
    await writeFile(
      configPath,
      JSON.stringify({ mode: "oauth", vault: "Private", tokenItem: "freee OAuth Tokens" }),
      { mode: 0o600 },
    );
    assert.deepEqual(await readOAuthConfig({ FREEE_CONFIG_PATH: configPath }), {
      version: 1,
      mode: "oauth",
      secretStore: "1password",
      tokenStore: "1password",
      redirectUri: "http://127.0.0.1:48181/callback",
      vault: "Private",
      clientItem: "freee",
      tokenItem: "freee OAuth Tokens",
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
