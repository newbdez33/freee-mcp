import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

test("Claude plugin bundles the MCP and Skill without a project working directory", async () => {
  const [packageJson, plugin, marketplace, readme] = await Promise.all([
    readJson("package.json"),
    readJson(".claude-plugin/plugin.json"),
    readJson(".claude-plugin/marketplace.json"),
    readFile("README.md", "utf8"),
  ]);

  assert.equal(plugin.version, packageJson.version);
  assert.equal(plugin.mcpServers.freee.command, "node");
  assert.deepEqual(plugin.mcpServers.freee.args, [
    "${CLAUDE_PLUGIN_ROOT}/scripts/plugin-mcp.mjs",
  ]);
  assert.equal(plugin.mcpServers.freee.env.FREEE_PLUGIN_DATA, "${CLAUDE_PLUGIN_DATA}");
  assert.equal(marketplace.plugins[0].source, ".");
  assert.equal(marketplace.plugins[0].name, "freee");
  assert.equal(packageJson.bin["freee-mcp"], "scripts/standalone-mcp.mjs");
  assert.match(readme, new RegExp(`#v${packageJson.version.replaceAll(".", "\\.")}`));
});

test("Claude plugin MCP starts from an unrelated working directory", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "freee-plugin-cwd-test-"));
  const environment = Object.fromEntries(
    Object.entries(process.env).filter((entry) => typeof entry[1] === "string"),
  );
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve("scripts/plugin-mcp.mjs")],
    cwd: directory,
    env: {
      ...environment,
      FREEE_BACKEND: "playwright",
      FREEE_PLUGIN_ROOT: process.cwd(),
      FREEE_PLUGIN_DATA: resolve(directory, "plugin-data"),
    },
    stderr: "pipe",
  });
  const client = new Client({ name: "freee-plugin-test", version: "1.0.0" });

  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.ok(tools.tools.some((tool) => tool.name === "freee_auth_status"));
  } finally {
    await client.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("portable MCP starts from an unrelated directory with private persistent data", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "freee-standalone-test-"));
  const home = resolve(directory, "home");
  const environment = Object.fromEntries(
    Object.entries(process.env).filter((entry) => typeof entry[1] === "string"),
  );
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve("scripts/standalone-mcp.mjs")],
    cwd: directory,
    env: {
      ...environment,
      HOME: home,
      FREEE_BACKEND: "playwright",
    },
    stderr: "pipe",
  });
  const client = new Client({ name: "freee-standalone-test", version: "1.0.0" });

  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.ok(tools.tools.some((tool) => tool.name === "freee_auth_status"));
    assert.equal((await stat(resolve(home, ".freee-agent"))).mode & 0o777, 0o700);
  } finally {
    await client.close();
    await rm(directory, { recursive: true, force: true });
  }
});
