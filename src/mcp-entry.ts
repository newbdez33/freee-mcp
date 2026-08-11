#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { toPublicError } from "./errors.js";
import { createFreeeMcpServer } from "./mcp-server.js";
import { loadProjectEnvironment } from "./project-env.js";
import { FreeeService } from "./service.js";

async function main(): Promise<void> {
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  loadProjectEnvironment(projectRoot);
  const service = await FreeeService.create();
  const server = createFreeeMcpServer(service);
  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  const publicError = toPublicError(error);
  const { exitCode, ...safeError } = publicError;
  process.stderr.write(`${JSON.stringify({ ok: false, error: safeError })}\n`);
  process.exitCode = exitCode;
});
