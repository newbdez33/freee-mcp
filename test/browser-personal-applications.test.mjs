import assert from "node:assert/strict";
import test from "node:test";

import {
  createPersonalApplicationCreateFingerprint,
  createPersonalApplicationWithdrawFingerprint,
  normalizePersonalApplicationCreateInput,
} from "../dist/browser-personal-applications.js";

test("personal leave input requires a real date and exact leave type", () => {
  assert.deepEqual(normalizePersonalApplicationCreateInput({
    kind: "leave",
    date: "2026-08-14",
    leaveType: " 有休 ",
    reason: " 私用 ",
  }), {
    kind: "leave",
    date: "2026-08-14",
    leaveType: "有休",
    reason: "私用",
    clockIn: null,
    clockOut: null,
    breakStart: null,
    breakEnd: null,
    leaveStart: null,
    leaveEnd: null,
  });
  assert.throws(
    () => normalizePersonalApplicationCreateInput({
      kind: "leave",
      date: "2026-02-30",
      leaveType: "有休",
    }),
    (error) => error.code === "INVALID_PERSONAL_APPLICATION_DATE",
  );
  assert.throws(
    () => normalizePersonalApplicationCreateInput({
      kind: "leave",
      date: "2026-08-14",
    }),
    (error) => error.code === "INVALID_PERSONAL_APPLICATION_LEAVE_TYPE",
  );
  assert.deepEqual(normalizePersonalApplicationCreateInput({
    kind: "leave",
    date: "2026-08-14",
    leaveType: "有休（半休）",
    leaveStart: "13:00",
    leaveEnd: "18:00",
  }), {
    kind: "leave",
    date: "2026-08-14",
    leaveType: "有休（半休）",
    leaveStart: "13:00",
    leaveEnd: "18:00",
    reason: "",
    clockIn: null,
    clockOut: null,
    breakStart: null,
    breakEnd: null,
  });
  assert.throws(
    () => normalizePersonalApplicationCreateInput({
      kind: "leave",
      date: "2026-08-14",
      leaveType: "有休（半休）",
      leaveStart: "18:00",
      leaveEnd: "13:00",
    }),
    (error) => error.code === "INVALID_PERSONAL_APPLICATION_LEAVE_TIME",
  );
});

test("work-time correction accepts one optional break pair and rejects partial pairs", () => {
  assert.deepEqual(normalizePersonalApplicationCreateInput({
    kind: "work-time-correction",
    date: "2026-08-14",
    clockIn: "09:00",
    clockOut: "18:00",
    breakStart: "12:00",
    breakEnd: "13:00",
  }), {
    kind: "work-time-correction",
    date: "2026-08-14",
    reason: "",
    leaveType: null,
    leaveStart: null,
    leaveEnd: null,
    clockIn: "09:00",
    clockOut: "18:00",
    breakStart: "12:00",
    breakEnd: "13:00",
  });
  assert.throws(
    () => normalizePersonalApplicationCreateInput({
      kind: "work-time-correction",
      date: "2026-08-14",
      clockIn: "09:00",
      clockOut: "18:00",
      breakStart: "12:00",
    }),
    (error) => error.code === "INVALID_PERSONAL_APPLICATION_BREAK",
  );
});

test("personal application fingerprints bind create and withdrawal previews", () => {
  const preview = {
    application: normalizePersonalApplicationCreateInput({
      kind: "leave",
      date: "2026-08-14",
      leaveType: "有休",
    }),
    typeLabel: "休暇",
    route: "勤怠申請",
    existingFirstPage: { count: 1, fingerprint: "f".repeat(64) },
  };
  const fingerprint = createPersonalApplicationCreateFingerprint(preview);
  assert.match(fingerprint, /^[a-f0-9]{64}$/);
  assert.notEqual(
    fingerprint,
    createPersonalApplicationCreateFingerprint({ ...preview, route: "別経路" }),
  );

  const detail = {
    application: {
      id: "100",
      status: "申請中",
      applicant: null,
      type: "休暇",
      targetDate: "2026/08/14",
      content: "有休",
      reason: null,
      appliedAt: "2026/08/13",
      currentApprover: "承認者",
      checkResult: null,
    },
    fields: [],
    tables: [],
    detailLines: [],
    availableActions: ["withdraw"],
  };
  assert.notEqual(
    createPersonalApplicationWithdrawFingerprint(detail),
    createPersonalApplicationWithdrawFingerprint({
      ...detail,
      application: { ...detail.application, status: "差戻し" },
      availableActions: [],
    }),
  );
});
