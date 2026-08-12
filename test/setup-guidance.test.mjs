import assert from "node:assert/strict";
import test from "node:test";

import {
  browserCredentialSetupCommand,
  visibleBrowserLoginCommand,
} from "../dist/setup-guidance.js";

test("plugin credential setup guidance works outside the source checkout", () => {
  const setup = browserCredentialSetupCommand({
    FREEE_PLUGIN_ROOT: "/plugin cache/freee",
    FREEE_PLUGIN_DATA: "/plugin data/freee",
  });

  assert.equal(setup.executable, "node");
  assert.deepEqual(setup.arguments, [
    "/plugin cache/freee/scripts/plugin-cli.mjs",
    "--plugin-data",
    "/plugin data/freee",
    "browser",
    "configure",
    "--confirm",
  ]);
  assert.match(setup.command, /plugin-cli\.mjs/);
  assert.doesNotMatch(setup.command, /npm run/);
});

test("visible plugin login guidance selects an interactive browser", () => {
  const setup = visibleBrowserLoginCommand({
    FREEE_PLUGIN_ROOT: "/plugin/freee",
    FREEE_PLUGIN_DATA: "/data/freee",
  });

  assert.match(setup.command, /^FREEE_BROWSER_HEADLESS=false /);
  assert.deepEqual(setup.arguments.slice(-2), ["browser", "status"]);
});
