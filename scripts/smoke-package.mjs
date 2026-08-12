#!/usr/bin/env node

import { spawn } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoot = await mkdtemp(resolve(tmpdir(), "freee-package-smoke-"));

function run(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += chunk; });
    child.stderr?.on("data", (chunk) => { stderr += chunk; });
    child.once("error", rejectRun);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolveRun({ stdout, stderr });
        return;
      }
      rejectRun(new Error(`${command} failed (${signal ?? code ?? "unknown"}): ${stderr || stdout}`));
    });
  });
}

try {
  const packageJson = JSON.parse(await readFile(resolve(projectRoot, "package.json"), "utf8"));
  const packResult = await run("npm", ["pack", "--json", "--pack-destination", temporaryRoot]);
  const packMetadata = JSON.parse(packResult.stdout)[0];
  const packagePath = resolve(temporaryRoot, packMetadata.filename);
  const packagedPaths = new Set(packMetadata.files.map((file) => file.path));

  for (const requiredPath of [
    "LICENSE",
    "README.md",
    "dist/mcp-entry.js",
    "scripts/plugin-cli.mjs",
    "scripts/standalone-cli.mjs",
    "scripts/standalone-mcp.mjs",
    "skills/freee/SKILL.md",
  ]) {
    if (!packagedPaths.has(requiredPath)) {
      throw new Error(`Packed artifact is missing ${requiredPath}.`);
    }
  }

  const dataDirectory = resolve(temporaryRoot, "data");
  await chmod(temporaryRoot, 0o700);
  const environment = {
    ...process.env,
    FREEE_AGENT_DATA: dataDirectory,
    FREEE_BACKEND: "playwright",
  };
  const cliResult = await run("npm", [
    "exec",
    "--yes",
    `--package=${packagePath}`,
    "--",
    "freee-agent",
    "--version",
  ], { env: environment });
  if (cliResult.stdout.trim() !== packageJson.version) {
    throw new Error(`Packed CLI reported ${JSON.stringify(cliResult.stdout.trim())}, expected ${packageJson.version}.`);
  }

  const transport = new StdioClientTransport({
    command: "npm",
    args: ["exec", "--yes", `--package=${packagePath}`, "--", "freee-mcp"],
    cwd: temporaryRoot,
    env: environment,
    stderr: "pipe",
  });
  const client = new Client({ name: "freee-package-smoke", version: packageJson.version });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    for (const requiredTool of [
      "freee_auth_status",
      "freee_clock_status",
      "freee_clock_prepare_action",
      "freee_clock_commit_action",
      "freee_team_status",
      "freee_approvals_list",
    ]) {
      if (!tools.tools.some((tool) => tool.name === requiredTool)) {
        throw new Error(`Packed MCP did not expose ${requiredTool}.`);
      }
    }
  } finally {
    await client.close();
  }

  if (((await stat(dataDirectory)).mode & 0o777) !== 0o700) {
    throw new Error("Packed runtime did not protect its persistent data directory with mode 0700.");
  }

  process.stdout.write(`Packed freee-agent ${packageJson.version} CLI and MCP started successfully.\n`);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
