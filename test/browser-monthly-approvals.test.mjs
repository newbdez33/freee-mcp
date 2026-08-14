import assert from "node:assert/strict";
import test from "node:test";

import {
  collectMonthlyAutomaticChecks,
  createMonthlyApprovalFingerprint,
  isMonthlyApproval,
  parseAttendancePeriodContext,
  parseMonthlyAttendanceTableSnapshot,
  requireMonthlyApproval,
  selectMonthlyApprovalMember,
  targetPaymentPeriodForWorkPeriod,
} from "../dist/browser-monthly-approvals.js";

function monthlyDetail() {
  return {
    application: {
      id: "1234",
      status: "未承認",
      applicant: "Member A",
      type: "月次勤怠締め",
      targetDate: "2026/08/01",
      content: "2026年8月勤務分",
      reason: null,
      appliedAt: "2026/09/01",
      currentApprover: "Manager B",
      checkResult: "要確認 1件",
    },
    fields: [{ label: "部門", value: "Engineering" }],
    tables: [],
    detailLines: ["自動チェック: 1件の警告があります"],
    availableActions: ["approve", "return"],
  };
}

function member(overrides = {}) {
  return {
    name: "Member A",
    department: "Engineering",
    employmentType: "正社員",
    closingApplication: "申請中",
    issues: {
      unregistered: "0件",
      missingClockOut: "0件",
      suspectedMissingClockOut: "0件",
      insufficientBreak: "0件",
      applicationRequired: "1件",
      inconsistent: "0件",
    },
    work: {
      workDays: "20日",
      total: "160:00",
      scheduled: "160:00",
      statutoryOvertime: "0:00",
      overtime: "0:00",
      statutoryHoliday: "0:00",
      night: "0:00",
      absence: "0日",
      late: "0回",
      earlyLeave: "0回",
      scheduledDifference: "0:00",
    },
    hasIssue: true,
    ...overrides,
  };
}

test("monthly approval guards the exact application type and period", () => {
  const detail = monthlyDetail();
  assert.equal(isMonthlyApproval(detail.application), true);
  assert.equal(requireMonthlyApproval(detail), "2026-08");
  assert.throws(
    () => requireMonthlyApproval({
      ...detail,
      application: { ...detail.application, type: "休暇" },
    }),
    (error) => error.code === "MONTHLY_APPROVAL_TYPE_MISMATCH",
  );
});

test("attendance period navigation preserves the payment/work-month offset", () => {
  const current = parseAttendancePeriodContext(
    "2026年9月25日払い （2026年8月1日 〜 2026年8月31日 勤務分）",
  );
  assert.deepEqual(current, { paymentPeriod: "2026-09", workPeriod: "2026-08" });
  assert.deepEqual(
    parseAttendancePeriodContext(
      "2026年9月25日払い 2026年8月1日〜2026年8月31日勤務分",
    ),
    { paymentPeriod: "2026-09", workPeriod: "2026-08" },
  );
  assert.equal(targetPaymentPeriodForWorkPeriod(current, "2026-07"), "2026-08");
  assert.equal(targetPaymentPeriodForWorkPeriod(current, "2025-12"), "2026-01");
  assert.throws(
    () => parseAttendancePeriodContext("2026年8月"),
    (error) => error.code === "ATTENDANCE_PERIOD_NAVIGATION_UNEXPECTED",
  );
  assert.throws(
    () => parseAttendancePeriodContext(
      "2026年9月25日払い （2026年8月1日 〜 2026年8月31日 勤務分） "
      + "2026年8月25日払い （2026年7月1日 〜 2026年7月31日 勤務分）",
    ),
    (error) => error.code === "ATTENDANCE_PERIOD_NAVIGATION_UNEXPECTED",
  );
});

test("monthly approval applicant maps to one exact attendance member", () => {
  const detail = monthlyDetail();
  assert.equal(selectMonthlyApprovalMember(detail, [member()]).name, "Member A");
  assert.equal(selectMonthlyApprovalMember(detail, [
    member({ department: "Sales" }),
    member(),
  ]).department, "Engineering");
  assert.throws(
    () => selectMonthlyApprovalMember(detail, [member(), member()]),
    (error) => error.code === "MONTHLY_APPROVAL_MEMBER_AMBIGUOUS",
  );
});

test("monthly attendance review parses one exact daily table and alerts", () => {
  const attendance = parseMonthlyAttendanceTableSnapshot({
    selectedPeriod: "2026年8月",
    warnings: ["申請または修正が必要な勤怠が1日あります。"],
    tables: [{
      headers: ["日付（曜日）", "勤務日種別", "出勤", "退勤", "労働時間", "アラート"],
      rows: [
        ["2026/08/01", "所定労働日", "09:00", "18:00", "8:00", "-"],
        ["8月2日（日）", "所定労働日", "09:15", "18:00", "7:45", "遅刻申請が必要です"],
      ],
    }],
  }, "2026-08");

  assert.equal(attendance.dayCount, 2);
  assert.equal(attendance.alertDayCount, 1);
  assert.equal(attendance.days[1].date, "2026-08-02");
  assert.deepEqual(attendance.days[1].alerts, ["遅刻申請が必要です"]);
  const checks = collectMonthlyAutomaticChecks(monthlyDetail(), attendance);
  assert.ok(checks.some((check) => check.includes("2026-08-02")));
});

test("monthly attendance review preserves blank edge columns from the live table layout", () => {
  const attendance = parseMonthlyAttendanceTableSnapshot({
    selectedPeriod: "2026年8月",
    warnings: [],
    tables: [{
      headers: ["", "日付", "申請", "出勤", "退勤", "休憩", ""],
      rows: [["", "8/01", "", "09:00", "18:00", "01:00", ""]],
    }],
  }, "2026-08");

  assert.equal(attendance.dayCount, 1);
  assert.equal(attendance.days[0].date, "2026-08-01");
  assert.equal(attendance.days[0].fields.length, 7);
});

test("monthly attendance review stops on another month or ambiguous daily tables", () => {
  const table = {
    headers: ["日付", "出勤", "退勤"],
    rows: [["8/01", "09:00", "18:00"]],
  };
  assert.throws(
    () => parseMonthlyAttendanceTableSnapshot({
      selectedPeriod: "2026年7月",
      warnings: [],
      tables: [table],
    }, "2026-08"),
    (error) => error.code === "MONTHLY_APPROVAL_PERIOD_UNSUPPORTED",
  );
  assert.throws(
    () => parseMonthlyAttendanceTableSnapshot({
      selectedPeriod: "2026年8月",
      warnings: [],
      tables: [table, table],
    }, "2026-08"),
    (error) => error.code === "MONTHLY_APPROVAL_ATTENDANCE_UNEXPECTED",
  );
});

test("monthly approval fingerprint binds attendance and requested action", () => {
  const detail = monthlyDetail();
  const attendance = parseMonthlyAttendanceTableSnapshot({
    selectedPeriod: "2026年8月",
    warnings: [],
    tables: [{
      headers: ["日付", "出勤", "退勤"],
      rows: [["8/01", "09:00", "18:00"]],
    }],
  }, "2026-08");
  const review = {
    application: detail,
    period: "2026-08",
    attendanceSummary: member(),
    attendance,
    automaticChecks: collectMonthlyAutomaticChecks(detail, attendance),
  };
  const approve = createMonthlyApprovalFingerprint(review, "approve");
  assert.match(approve, /^[a-f0-9]{64}$/);
  assert.notEqual(approve, createMonthlyApprovalFingerprint(review, "return"));
  assert.notEqual(approve, createMonthlyApprovalFingerprint({
    ...review,
    attendance: {
      ...review.attendance,
      days: review.attendance.days.map((day) => ({
        ...day,
        fields: day.fields.map((field) =>
          field.label === "退勤" ? { ...field, value: "19:00" } : field),
      })),
    },
  }, "approve"));
});
