import { createRequire } from "node:module";

const packageJson = createRequire(import.meta.url)("../package.json") as { version?: unknown };

if (typeof packageJson.version !== "string" || packageJson.version.length === 0) {
  throw new Error("package.json does not contain a valid version.");
}

export const version = packageJson.version;
