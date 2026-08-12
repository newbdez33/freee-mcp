import type { ReadStream, WriteStream } from "node:tty";

import { CliError } from "./errors.js";
import {
  SystemWebCredentialStore,
  type FreeeWebCredentials,
  type WebCredentialStore,
} from "./secret-store.js";
import { visibleBrowserLoginCommand } from "./setup-guidance.js";

interface BrowserCredentialConfigurationOptions {
  confirm: boolean;
  service?: string;
}

interface BrowserCredentialConfigurationDependencies {
  readCredentials?: () => Promise<FreeeWebCredentials>;
  createStore?: (service: string) => WebCredentialStore;
}

export async function configureBrowserCredentials(
  options: BrowserCredentialConfigurationOptions,
  dependencies: BrowserCredentialConfigurationDependencies = {},
): Promise<{
  configured: true;
  credentialStore: "system";
  service: string;
  nextStep: string;
}> {
  if (!options.confirm) {
    throw new CliError(
      "CONFIRMATION_REQUIRED",
      "This command securely prompts for the freee web login and writes it to System Keychain. Re-run in a local interactive terminal with `--confirm`.",
      { exitCode: 2 },
    );
  }

  const service = options.service?.trim() || "freee-agent-web";
  const readCredentials = dependencies.readCredentials ?? readHiddenBrowserCredentials;
  const createStore = dependencies.createStore
    ?? ((targetService) => new SystemWebCredentialStore(targetService));
  const entered = await readCredentials();
  const credentials = {
    username: entered.username.trim(),
    password: entered.password,
  };
  if (!credentials.username || !credentials.password) {
    throw new CliError(
      "WEB_CREDENTIALS_REQUIRED",
      "Both the freee username and password are required.",
      { exitCode: 2 },
    );
  }

  const store = createStore(service);
  await store.writeCredentials(credentials);
  const verified = await store.getCredentials();
  if (verified.username !== credentials.username || verified.password !== credentials.password) {
    throw new CliError(
      "WEB_CREDENTIAL_VERIFY_FAILED",
      "The freee web credentials could not be verified after writing them to System Keychain.",
      { exitCode: 2 },
    );
  }

  return {
    configured: true,
    credentialStore: "system",
    service,
    nextStep: `Run \`${visibleBrowserLoginCommand().command}\` locally to complete freee login or MFA in a visible browser.`,
  };
}

export async function readHiddenBrowserCredentials(
  input = process.stdin as ReadStream,
  output = process.stderr as WriteStream,
): Promise<FreeeWebCredentials> {
  const username = (await readHiddenLine("freee username/email (input hidden): ", input, output)).trim();
  if (!username) {
    throw new CliError("WEB_CREDENTIALS_REQUIRED", "freee username must not be empty.", {
      exitCode: 2,
    });
  }
  const password = await readHiddenLine("freee password (input hidden): ", input, output);
  if (!password) {
    throw new CliError("WEB_CREDENTIALS_REQUIRED", "freee password must not be empty.", {
      exitCode: 2,
    });
  }
  const confirmation = await readHiddenLine("Confirm freee password (input hidden): ", input, output);
  if (confirmation !== password) {
    throw new CliError(
      "WEB_CREDENTIAL_CONFIRMATION_MISMATCH",
      "The two password entries did not match. No credential was saved.",
      { exitCode: 2 },
    );
  }
  return { username, password };
}

async function readHiddenLine(
  label: string,
  input: ReadStream,
  output: WriteStream,
): Promise<string> {
  if (!input.isTTY || typeof input.setRawMode !== "function") {
    throw new CliError(
      "INTERACTIVE_TERMINAL_REQUIRED",
      "Run this command directly in a local interactive terminal. Never pass freee web credentials through chat, MCP arguments, environment variables, or command-line options.",
      { exitCode: 2 },
    );
  }

  output.write(label);
  const wasRaw = input.isRaw;
  input.setRawMode(true);
  input.resume();
  return new Promise<string>((resolve, reject) => {
    let value = "";
    const cleanup = (): void => {
      input.off("data", onData);
      input.setRawMode(Boolean(wasRaw));
      input.pause();
      output.write("\n");
    };
    const onData = (chunk: Buffer | string): void => {
      for (const character of chunk.toString()) {
        if (character === "\u0003" || character === "\u0004") {
          cleanup();
          reject(new CliError(
            "CONFIGURATION_CANCELLED",
            "Browser credential configuration was cancelled. No credential was saved.",
            { exitCode: 2 },
          ));
          return;
        }
        if (character === "\r" || character === "\n") {
          cleanup();
          resolve(value);
          return;
        }
        if (character === "\b" || character === "\u007f") {
          value = Array.from(value).slice(0, -1).join("");
        } else if (character >= " ") {
          value += character;
        }
      }
    };
    input.on("data", onData);
  });
}
