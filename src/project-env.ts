import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";

import { CliError } from "./errors.js";

export function loadProjectEnvironment(cwd = process.cwd()): void {
  const path = resolve(cwd, ".env");
  if (!existsSync(path)) {
    return;
  }
  try {
    loadEnvFile(path);
  } catch {
    throw new CliError(
      "INVALID_ENV_FILE",
      "The project .env file could not be loaded.",
      { exitCode: 2 },
    );
  }
}
