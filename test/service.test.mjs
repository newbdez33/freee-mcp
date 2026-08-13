import assert from "node:assert/strict";
import test from "node:test";

import { FreeeService } from "../dist/service.js";

test("backend status reports the running package version", async () => {
  const result = await new FreeeService("playwright").getBackendStatus();
  assert.match(result.version, /^\d+\.\d+\.\d+$/);
  assert.equal(result.backend, "playwright");
});

function clockStatus(actions = ["in"]) {
  return {
    backend: "playwright",
    context: null,
    status: {
      available_actions: actions,
      available_types: actions.includes("in") ? ["clock_in"] : [],
      base_date: null,
    },
  };
}

test("shared service binds a clock commit to the prepared state and action", async () => {
  const service = new FreeeService("playwright");
  let writes = 0;
  service.getClockStatus = async () => clockStatus(["in"]);
  service.performClockAction = async (action, options) => {
    writes += 1;
    return { backend: "playwright", action, confirmed: options.confirm };
  };

  const prepared = await service.prepareClockAction("in");
  assert.match(prepared.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(writes, 0);

  await assert.rejects(
    service.commitClockAction("out", prepared.fingerprint, true),
    (error) => error.code === "CLOCK_PREVIEW_CHANGED",
  );
  assert.equal(writes, 0);

  const result = await service.commitClockAction("in", prepared.fingerprint, true);
  assert.equal(result.confirmed, true);
  assert.equal(writes, 1);
});

test("shared service clock commit requires confirmation before reading live state", async () => {
  const service = new FreeeService("playwright");
  let reads = 0;
  service.getClockStatus = async () => {
    reads += 1;
    return clockStatus(["in"]);
  };

  await assert.rejects(
    service.commitClockAction("in", "0".repeat(64), false),
    (error) => error.code === "CONFIRMATION_REQUIRED",
  );
  assert.equal(reads, 0);
});

test("shared service monthly commit requires confirmation before launching a browser", async () => {
  const service = new FreeeService("playwright");
  let launches = 0;
  service.withBrowser = async () => {
    launches += 1;
    return {};
  };

  await assert.rejects(
    service.commitMonthlyAction("submit", "0".repeat(64), false, "2026-08"),
    (error) => error.code === "CONFIRMATION_REQUIRED",
  );
  assert.equal(launches, 0);
});

test("shared service personal application commits require confirmation before launching a browser", async () => {
  const service = new FreeeService("playwright");
  let launches = 0;
  service.withBrowser = async () => {
    launches += 1;
    return {};
  };

  await assert.rejects(
    service.commitPersonalApplicationCreate({
      kind: "leave",
      date: "2026-08-14",
      leaveType: "有休",
    }, "0".repeat(64), false),
    (error) => error.code === "CONFIRMATION_REQUIRED",
  );
  await assert.rejects(
    service.commitPersonalApplicationWithdraw("100", "0".repeat(64), false),
    (error) => error.code === "CONFIRMATION_REQUIRED",
  );
  assert.equal(launches, 0);
});
