import { access, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export async function loadBuiltEntry(relativeEntry, argv) {
  const entry = resolve(pluginRoot, relativeEntry);
  try {
    await access(entry);
  } catch {
    await buildPlugin();
  }

  process.chdir(pluginRoot);
  process.argv = [process.execPath, entry, ...argv];
  await import(pathToFileURL(entry).href);
}

function configurePluginRuntime(dataDirectory) {
  process.env.FREEE_PLUGIN_ROOT ??= pluginRoot;
  if (!dataDirectory) {
    return;
  }
  process.env.FREEE_PLUGIN_DATA = dataDirectory;
  process.env.FREEE_CONFIG_PATH ??= resolve(dataDirectory, "oauth.json");
}

export async function loadPluginMcp() {
  configurePluginRuntime(process.env.FREEE_PLUGIN_DATA);
  await loadBuiltEntry("dist/mcp-entry.js", []);
}

export async function loadPluginCli(argv) {
  const { dataDirectory, cliArguments } = parseCliArguments(argv);
  configurePluginRuntime(dataDirectory);
  await loadBuiltEntry("dist/cli.js", cliArguments);
}

async function buildPlugin() {
  const compiler = resolve(pluginRoot, "node_modules", "typescript", "bin", "tsc");
  try {
    await access(compiler);
  } catch {
    throw new Error(
      "freee plugin dependencies are unavailable. Update or reinstall the Claude Code plugin.",
    );
  }

  await rm(resolve(pluginRoot, "dist"), { recursive: true, force: true });
  const { spawn } = await import("node:child_process");
  await new Promise((resolveBuild, rejectBuild) => {
    const child = spawn(process.execPath, [compiler, "-p", resolve(pluginRoot, "tsconfig.json")], {
      cwd: pluginRoot,
      stdio: "inherit",
    });
    child.once("error", rejectBuild);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolveBuild();
        return;
      }
      rejectBuild(new Error(`freee plugin build failed (${signal ?? code ?? "unknown"}).`));
    });
  });
}

function parseCliArguments(argv) {
  if (argv[0] !== "--plugin-data" || !argv[1]) {
    return { dataDirectory: process.env.FREEE_PLUGIN_DATA, cliArguments: argv };
  }
  return { dataDirectory: argv[1], cliArguments: argv.slice(2) };
}
