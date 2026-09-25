import assert from "node:assert/strict";
import test from "node:test";

import { parseLeaveBalanceSnapshot } from "../dist/browser-leave-balances.js";

function snapshot(overrides = {}) {
  return {
    employeeName: "Member A",
    summary: [
      { label: "労働日数", body: "15日" },
      { label: "有休取得数", body: "0日" },
      { label: "有休残数", body: "23日" },
      { label: "代休残日数", body: "2日" },
    ],
    sections: [
      {
        title: "年次有給休暇",
        headers: ["有効期間", "付与日数", "消化数", "残数"],
        rows: [
          ["2025年2月1日〜2027年1月31日", "14日", "7日", "7日", ""],
          ["2026年2月1日〜2028年1月31日", "16日", "0日", "16日", ""],
        ],
      },
      {
        title: "特別休暇",
        headers: ["休暇名称", "有効期間", "付与日数", "消化数", "残数"],
        rows: [["夏季休暇", "2026年7月1日〜2026年10月31日", "3日", "3日", "0日", ""]],
      },
      {
        title: "代休",
        headers: ["未取得の代休", "有効期間", "残数"],
        rows: [
          ["2025年8月23日出勤分", "2025年8月24日〜2027年8月23日", "1.0日", ""],
          ["2025年8月30日出勤分", "2025年8月31日〜2027年8月30日", "1.0日", ""],
        ],
      },
    ],
    ...overrides,
  };
}

test("leave balance parser reads paid, special, and compensatory balances", () => {
  const result = parseLeaveBalanceSnapshot(snapshot());

  assert.equal(result.employeeName, "Member A");
  assert.equal(result.paidHoliday.remainingDays, 23);
  assert.equal(result.paidHoliday.grantedDays, 30);
  assert.equal(result.paidHoliday.usedDays, 7);
  assert.deepEqual(result.paidHoliday.grants[0], {
    validFrom: "2025-02-01",
    validTo: "2027-01-31",
    grantedDays: 14,
    usedDays: 7,
    remainingDays: 7,
  });
  assert.deepEqual(result.specialHolidays, [{
    label: "夏季休暇",
    validFrom: "2026-07-01",
    validTo: "2026-10-31",
    grantedDays: 3,
    usedDays: 3,
    remainingDays: 0,
  }]);
  assert.deepEqual(result.compensatoryHolidays, [
    { label: "2025年8月23日出勤分", validFrom: "2025-08-24", validTo: "2027-08-23", remainingDays: 1 },
    { label: "2025年8月30日出勤分", validFrom: "2025-08-31", validTo: "2027-08-30", remainingDays: 1 },
  ]);
  assert.deepEqual(result.summary, {
    paidHolidayUsed: "0日",
    paidHolidayRemaining: "23日",
    compensatoryRemaining: "2日",
  });
});

test("leave balance parser tolerates a missing special or compensatory section", () => {
  const result = parseLeaveBalanceSnapshot(snapshot({
    sections: [snapshot().sections[0]],
  }));

  assert.equal(result.paidHoliday.remainingDays, 23);
  assert.deepEqual(result.specialHolidays, []);
  assert.deepEqual(result.compensatoryHolidays, []);
});

test("leave balance parser keeps unavailable values explicit instead of guessing", () => {
  const result = parseLeaveBalanceSnapshot(snapshot({
    summary: [{ label: "有休残数", body: "－" }],
    sections: [],
  }));

  assert.equal(result.paidHoliday.remainingDays, null);
  assert.equal(result.paidHoliday.grantedDays, null);
  assert.equal(result.summary.paidHolidayRemaining, "－");
});

test("leave balance parser stops on a changed page or table schema", () => {
  assert.throws(
    () => parseLeaveBalanceSnapshot(snapshot({ summary: [{ label: "労働日数", body: "15日" }] })),
    (error) => error.code === "BROWSER_LEAVE_BALANCE_PAGE_UNEXPECTED",
  );
  assert.throws(
    () => parseLeaveBalanceSnapshot(snapshot({
      sections: [{
        title: "年次有給休暇",
        headers: ["有効期間", "残数"],
        rows: [],
      }],
    })),
    (error) => error.code === "BROWSER_LEAVE_BALANCE_PAGE_UNEXPECTED",
  );
});
