import assert from "node:assert/strict";
import test from "node:test";

import {
  getClockStatus,
  performClockAction,
  resolveEmployeeContext,
} from "../dist/attendance.js";

function createFakeApi(overrides = {}) {
  const calls = [];
  return {
    calls,
    async getCurrentUser() {
      calls.push({ method: "getCurrentUser" });
      return {
        id: 1,
        companies: [
          { id: 10, name: "No employee", employee_id: null },
          { id: 20, name: "Work", employee_id: 30, display_name: "Test User" },
        ],
      };
    },
    async getAvailableTimeClockTypes(employeeId, companyId, date) {
      calls.push({ method: "getAvailableTimeClockTypes", employeeId, companyId, date });
      return { available_types: ["clock_in"], base_date: "2026-08-10" };
    },
    async createTimeClock(employeeId, input) {
      calls.push({ method: "createTimeClock", employeeId, input });
      return { employee_time_clock: { id: 99, type: input.type } };
    },
    ...overrides,
  };
}

test("a unique employee identity is selected even when the user has other companies", () => {
  const context = resolveEmployeeContext({
    id: 1,
    companies: [
      { id: 10, employee_id: null },
      { id: 20, name: "Work", employee_id: 30 },
    ],
  });

  assert.deepEqual(context, {
    companyId: 20,
    companyName: "Work",
    role: null,
    employeeId: 30,
    displayName: null,
  });
});

test("multiple employee identities require an explicit company", () => {
  assert.throws(
    () =>
      resolveEmployeeContext({
        id: 1,
        companies: [
          { id: 10, name: "A", employee_id: 100 },
          { id: 20, name: "B", employee_id: 200 },
        ],
      }),
    (error) => error.code === "COMPANY_REQUIRED",
  );
});

test("status resolves context before querying available types", async () => {
  const api = createFakeApi();
  const result = await getClockStatus(api);

  assert.equal(result.context.companyId, 20);
  assert.deepEqual(result.status.available_types, ["clock_in"]);
  assert.deepEqual(api.calls.map((call) => call.method), [
    "getCurrentUser",
    "getAvailableTimeClockTypes",
  ]);
});

test("a clock action without confirm never calls the write endpoint", async () => {
  const api = createFakeApi();

  await assert.rejects(
    performClockAction(api, "in", { confirm: false }),
    (error) => error.code === "CONFIRMATION_REQUIRED",
  );
  assert.equal(api.calls.some((call) => call.method === "createTimeClock"), false);
});

test("an unavailable action never calls the write endpoint, even with confirm", async () => {
  const api = createFakeApi();

  await assert.rejects(
    performClockAction(api, "out", { confirm: true }),
    (error) => error.code === "CLOCK_ACTION_UNAVAILABLE",
  );
  assert.equal(api.calls.some((call) => call.method === "createTimeClock"), false);
});

test("a confirmed available action uses the base date returned by freee", async () => {
  const api = createFakeApi();
  const result = await performClockAction(api, "in", { confirm: true });

  assert.equal(result.timeClock.id, 99);
  assert.deepEqual(api.calls.at(-1), {
    method: "createTimeClock",
    employeeId: 30,
    input: { companyId: 20, type: "clock_in", baseDate: "2026-08-10" },
  });
});
