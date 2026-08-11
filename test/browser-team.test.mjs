import assert from "node:assert/strict";
import test from "node:test";

import { parseAttendanceMonitorSnapshot } from "../dist/browser-team.js";

const headers = [
  "締め申請",
  "氏名",
  "部門",
  "勤怠不備",
  "未登録",
  "退勤打刻漏れ",
  "休憩不足",
  "総労働",
];

function memberRow(overrides = {}) {
  const cells = Array(35).fill("");
  cells[2] = "未申請";
  cells[3] = "山田 太郎";
  cells[8] = "開発部";
  cells[9] = "正社員";
  cells[11] = "0件";
  cells[12] = "0件";
  cells[13] = "0件";
  cells[14] = "0件";
  cells[15] = "0件";
  cells[16] = "0件";
  cells[17] = "5日";
  cells[18] = "40:00";
  for (const [index, value] of Object.entries(overrides)) {
    cells[Number(index)] = value;
  }
  return cells;
}

test("attendance monitor parser maps member identity, issues, and monthly work", () => {
  const result = parseAttendanceMonitorSnapshot({
    headers,
    periodCandidates: ["2026年8月"],
    rows: [memberRow({ 11: "0日" }), memberRow({ 3: "鈴木 花子", 12: "1件" })],
  });

  assert.equal(result.period, "2026年8月");
  assert.equal(result.memberCount, 2);
  assert.equal(result.issueMemberCount, 1);
  assert.deepEqual(result.members[0].issues.missingClockOut, "0件");
  assert.equal(result.members[1].name, "鈴木 花子");
  assert.equal(result.members[1].hasIssue, true);
});

test("attendance monitor parser stops on a changed schema or mismatched month", () => {
  assert.throws(
    () => parseAttendanceMonitorSnapshot({ headers: ["氏名"], rows: [], periodCandidates: ["2026年8月"] }),
    (error) => error.code === "BROWSER_TEAM_PAGE_UNEXPECTED",
  );
  assert.throws(
    () => parseAttendanceMonitorSnapshot(
      { headers, rows: [memberRow()], periodCandidates: ["2026年8月"] },
      "2026-07-31",
    ),
    (error) => error.code === "BROWSER_DATE_UNSUPPORTED",
  );
});
