import { resolve } from "node:path";

export interface LocalSetupCommand {
  command: string;
  executable: string;
  arguments: string[];
}

export function browserCredentialSetupCommand(
  env: NodeJS.ProcessEnv = process.env,
): LocalSetupCommand {
  return createCliCommand(["browser", "configure", "--confirm"], env);
}

export function visibleBrowserLoginCommand(
  env: NodeJS.ProcessEnv = process.env,
): LocalSetupCommand {
  return createCliCommand(
    ["browser", "status"],
    { ...env, FREEE_BROWSER_HEADLESS: "false" },
  );
}

function createCliCommand(
  cliArguments: string[],
  env: NodeJS.ProcessEnv,
): LocalSetupCommand {
  const pluginRoot = env.FREEE_PLUGIN_ROOT?.trim();
  const pluginData = env.FREEE_PLUGIN_DATA?.trim();
  if (pluginRoot && pluginData) {
    const executable = "node";
    const args = [
      resolve(pluginRoot, "scripts", "plugin-cli.mjs"),
      "--plugin-data",
      pluginData,
      ...cliArguments,
    ];
    const assignments = env.FREEE_BROWSER_HEADLESS === "false"
      ? ["FREEE_BROWSER_HEADLESS=false"]
      : [];
    return {
      command: [...assignments, executable, ...args.map(quoteForDisplay)].join(" "),
      executable,
      arguments: args,
    };
  }

  const command = ["npm", "run", "freee", "--", ...cliArguments];
  return {
    command: `${env.FREEE_BROWSER_HEADLESS === "false" ? "FREEE_BROWSER_HEADLESS=false " : ""}${command.join(" ")}`,
    executable: "npm",
    arguments: command.slice(1),
  };
}

function quoteForDisplay(value: string): string {
  if (/^[A-Za-z0-9_./:@+-]+$/.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}
