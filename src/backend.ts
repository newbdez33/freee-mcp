import { readOAuthConfig } from "./auth-config.js";
import { CliError } from "./errors.js";

export type FreeeBackend = "api" | "playwright";

export async function resolveBackend(
  env: NodeJS.ProcessEnv = process.env,
  hasApiConfig: (env: NodeJS.ProcessEnv) => Promise<boolean> = async (runtimeEnv) =>
    (await readOAuthConfig(runtimeEnv)) !== null,
): Promise<FreeeBackend> {
  const configured = env.FREEE_BACKEND?.trim().toLowerCase();
  if (configured === "api" || configured === "playwright") {
    return configured;
  }
  if (configured && configured !== "auto") {
    throw new CliError(
      "INVALID_BACKEND",
      "FREEE_BACKEND must be api, playwright, or auto.",
      { exitCode: 2 },
    );
  }
  return (await hasApiConfig(env)) ? "api" : "playwright";
}
