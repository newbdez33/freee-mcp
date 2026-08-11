import { CliError } from "./errors.js";
import {
  SystemWebCredentialStore,
  type WebCredentialProvider,
  type WebCredentialStore,
} from "./secret-store.js";
import { OnePasswordWebCredentialProvider } from "./token-store.js";

interface BrowserCredentialMigrationOptions {
  confirm: boolean;
  vault?: string;
  item?: string;
  service?: string;
}

interface BrowserCredentialMigrationDependencies {
  createSource?: (vault: string, item: string) => WebCredentialProvider;
  createTarget?: (service: string) => WebCredentialStore;
}

export async function migrateBrowserCredentialsFromOnePassword(
  options: BrowserCredentialMigrationOptions,
  dependencies: BrowserCredentialMigrationDependencies = {},
): Promise<{
  migrated: true;
  source: "1password";
  destination: "system";
  service: string;
}> {
  if (!options.confirm) {
    throw new CliError(
      "CONFIRMATION_REQUIRED",
      "This migration reads the freee web login from 1Password and writes it to System Keychain. Re-run with `--confirm`.",
      { exitCode: 2 },
    );
  }

  const vault = options.vault?.trim() || "Private";
  const item = options.item?.trim() || "freee";
  const service = options.service?.trim() || "freee-agent-web";
  const createSource = dependencies.createSource
    ?? ((sourceVault, sourceItem) => new OnePasswordWebCredentialProvider(sourceVault, sourceItem));
  const createTarget = dependencies.createTarget
    ?? ((targetService) => new SystemWebCredentialStore(targetService));

  const credentials = await createSource(vault, item).getCredentials();
  const target = createTarget(service);
  await target.writeCredentials(credentials);
  const verified = await target.getCredentials();
  if (verified.username !== credentials.username || verified.password !== credentials.password) {
    throw new CliError(
      "WEB_CREDENTIAL_VERIFY_FAILED",
      "The freee web credentials could not be verified after writing them to System Keychain.",
      { exitCode: 2 },
    );
  }

  return {
    migrated: true,
    source: "1password",
    destination: "system",
    service,
  };
}
