#!/usr/bin/env node

import { chmod, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";

import { loadPluginCli } from "./plugin-runtime.mjs";

const dataDirectory = resolve(
  process.env.FREEE_PLUGIN_DATA?.trim() ||
    process.env.FREEE_AGENT_DATA?.trim() ||
    resolve(homedir(), ".freee-agent"),
);

await mkdir(dataDirectory, { recursive: true, mode: 0o700 });
await chmod(dataDirectory, 0o700);

await loadPluginCli(["--plugin-data", dataDirectory, ...process.argv.slice(2)]);
