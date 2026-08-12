#!/usr/bin/env node

import { loadPluginCli } from "./plugin-runtime.mjs";

await loadPluginCli(process.argv.slice(2));
