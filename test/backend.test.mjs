import assert from "node:assert/strict";
import test from "node:test";

import { resolveBackend } from "../dist/backend.js";

test("explicit playwright backend overrides an existing API configuration", async () => {
  let inspectedApiConfig = false;
  const backend = await resolveBackend(
    { FREEE_BACKEND: "playwright" },
    async () => {
      inspectedApiConfig = true;
      return true;
    },
  );

  assert.equal(backend, "playwright");
  assert.equal(inspectedApiConfig, false);
});

test("auto backend uses API only when API configuration exists", async () => {
  assert.equal(await resolveBackend({ FREEE_BACKEND: "auto" }, async () => true), "api");
  assert.equal(await resolveBackend({}, async () => false), "playwright");
});

test("invalid backend is rejected without inspecting credentials", async () => {
  let inspectedApiConfig = false;
  await assert.rejects(
    resolveBackend(
      { FREEE_BACKEND: "mixed" },
      async () => {
        inspectedApiConfig = true;
        return true;
      },
    ),
    (error) => error.code === "INVALID_BACKEND",
  );
  assert.equal(inspectedApiConfig, false);
});
