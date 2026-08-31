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
  const [packageJson, plugin, marketplace, readme, skill, commands, codexConfig] = await Promise.all([
    readJson("package.json"),
    readJson(".claude-plugin/plugin.json"),
    readJson(".claude-plugin/marketplace.json"),
    readFile("README.md", "utf8"),
    readFile("skills/freee/SKILL.md", "utf8"),
    readFile("skills/freee/references/commands.md", "utf8"),
    readFile(".codex/config.toml", "utf8"),
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
  assert.match(skill, /Authorize manager approval batch automation/);
  assert.match(skill, /user does not need to copy, repeat, or personally compare a raw SHA-256 value/);
  assert.match(skill, /Stop the whole run only/);
  assert.match(skill, /general or dedicated monthly `approve` or `return` prepare\/commit calls/);
  assert.match(skill, /Do not require a fixed candidate snapshot/);
  assert.match(skill, /repeated scans until no matching item remains/);
  assert.match(skill, /semantic judgment to full detail/);
  assert.match(skill, /`APPROVAL_PREVIEW_CHANGED` and `MONTHLY_APPROVAL_PREVIEW_CHANGED` explicitly mean no business action occurred/);
  assert.match(skill, /MONTHLY_APPROVAL_PERIOD_MAPPING_UNCONFIRMED/);
  assert.match(skill, /Never substitute a fixed one-month offset/);
  assert.match(skill, /LEAVE_APPROVAL_BLOCKED_BY_WORK_TIME_CORRECTION/);
  assert.match(skill, /supports condition-based batch approval/);
  assert.doesNotMatch(skill, /Do not delete, batch-approve, or batch-change anything/);
  assert.doesNotMatch(skill, /Batch actions are not supported/);
  assert.match(commands, /supported condition-based batch approval workflow/);
  assert.match(commands, /general or dedicated monthly `approve` and `return` actions/);
  assert.match(commands, /fixed candidate snapshot, full No\. enumeration, and precomputed fingerprints are not required/);
  assert.match(commands, /independent matches may continue/);
  assert.match(commands, /returns `paymentPeriod` plus work `period`/);
  assert.match(commands, /never hardcodes a one-month subtraction/);
  assert.doesNotMatch(commands, /There is no batch approval command/);
  assert.match(readme, /Condition-based manager approval batches/);
  assert.match(codexConfig, /default_tools_approval_mode = "writes"/);
  assert.match(codexConfig, /\[mcp_servers\.freee\.tools\.freee_approval_commit_action\]\napproval_mode = "approve"/);
  assert.match(codexConfig, /\[mcp_servers\.freee\.tools\.freee_monthly_approval_commit_action\]\napproval_mode = "approve"/);
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
