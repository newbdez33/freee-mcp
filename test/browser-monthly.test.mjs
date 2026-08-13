import assert from "node:assert/strict";
import test from "node:test";

import {
  createMonthlyFingerprint,
  parseMonthlyCalendarSnapshot,
  periodFromMonthlyTargetDate,
} from "../dist/browser-monthly.js";

const periodLabel = "2026年9月25日払い （2026年8月1日 〜 2026年8月31日 勤務分）";

test("monthly calendar parser maps an unsubmitted selected month", () => {
  assert.deepEqual(parseMonthlyCalendarSnapshot({
    periodLabels: [periodLabel],
    statusLabels: ["未申請"],
    createActionCount: 1,
  }), {
    period: "2026-08",
    periodLabel,
    state: "unsubmitted",
    statusLabel: "未申請",
    availableActions: ["submit"],
  });
});

test("monthly calendar parser exposes withdraw only for a pending month", () => {
  assert.deepEqual(parseMonthlyCalendarSnapshot({
    periodLabels: [periodLabel],
    statusLabels: ["未承認"],
    createActionCount: 0,
  }).availableActions, ["withdraw"]);
  assert.deepEqual(parseMonthlyCalendarSnapshot({
    periodLabels: [periodLabel],
    statusLabels: ["承認済"],
    createActionCount: 0,
  }).availableActions, []);
});

test("monthly calendar parser rejects another requested month and ambiguous state", () => {
  assert.throws(
    () => parseMonthlyCalendarSnapshot({
      periodLabels: [periodLabel],
      statusLabels: ["未申請"],
      createActionCount: 1,
    }, "2026-07"),
    (error) => error.code === "BROWSER_MONTHLY_PERIOD_UNSUPPORTED",
  );
  assert.throws(
    () => parseMonthlyCalendarSnapshot({
      periodLabels: [periodLabel],
      statusLabels: ["未申請", "承認済"],
      createActionCount: 1,
    }),
    (error) => error.code === "BROWSER_MONTHLY_PAGE_UNEXPECTED",
  );
});

test("monthly target dates map to their work month", () => {
  assert.equal(periodFromMonthlyTargetDate("2026/09/01"), "2026-09");
  assert.equal(periodFromMonthlyTargetDate("2026/01/01"), "2026-01");
  assert.equal(periodFromMonthlyTargetDate("2026/09/02"), null);
});

test("monthly preview fingerprint binds the action and preview content", () => {
  const preview = {
    status: {
      period: "2026-08",
      periodLabel,
      state: "unsubmitted",
      statusLabel: "未申請",
      application: null,
      availableActions: ["submit"],
    },
    submitForm: {
      targetMonth: "2026年8月",
      route: "Monthly route",
      routeOptions: ["Monthly route"],
      approvalSteps: [],
      checks: [],
    },
  };
  const submit = createMonthlyFingerprint(preview, "submit");
  assert.match(submit, /^[a-f0-9]{64}$/);
  assert.equal(submit, createMonthlyFingerprint(preview, "submit"));
  assert.notEqual(submit, createMonthlyFingerprint(preview, "withdraw"));
});
