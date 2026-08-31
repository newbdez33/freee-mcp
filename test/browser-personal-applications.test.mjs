import assert from "node:assert/strict";
import test from "node:test";

import {
  createPersonalApplicationCancelFingerprint,
  createPersonalApplicationCreateFingerprint,
  createPersonalApplicationWithdrawFingerprint,
  isVerifiedCreatedWorkTimeDeletion,
  normalizePersonalApplicationCreateInput,
  normalizePersonalApplicationReason,
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
    workTimeAction: null,
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
    workTimeAction: null,
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
    workTimeAction: "replace",
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

test("work-time deletion is explicit, forbids replacement times, and binds verification", () => {
  const deletion = normalizePersonalApplicationCreateInput({
    kind: "work-time-correction",
    date: "2026-08-17",
    workTimeAction: "delete",
    reason: "Duplicate registered work time",
  });
  assert.deepEqual(deletion, {
    kind: "work-time-correction",
    date: "2026-08-17",
    reason: "Duplicate registered work time",
    workTimeAction: "delete",
    leaveType: null,
    leaveStart: null,
    leaveEnd: null,
    clockIn: null,
    clockOut: null,
    breakStart: null,
    breakEnd: null,
  });
  assert.throws(
    () => normalizePersonalApplicationCreateInput({
      kind: "work-time-correction",
      date: "2026-08-17",
      workTimeAction: "delete",
      clockIn: "09:00",
    }),
    (error) => error.code === "INVALID_PERSONAL_APPLICATION_FIELDS",
  );
  assert.equal(isVerifiedCreatedWorkTimeDeletion(deletion, {
    type: "勤務時間修正",
    targetDate: "2026/08/17",
    content: "勤務時間を削除",
  }), true);
  assert.equal(isVerifiedCreatedWorkTimeDeletion(deletion, {
    type: "勤務時間修正",
    targetDate: "2026/08/18",
    content: "勤務時間を削除",
  }), false);
  assert.equal(isVerifiedCreatedWorkTimeDeletion(deletion, {
    type: "勤務時間修正",
    targetDate: "2026/08/17",
    content: "勤務時間を修正",
  }), false);
});

test("create fingerprints distinguish replacement from deletion", () => {
  const common = {
    typeLabel: "勤務時間修正",
    route: "勤怠申請",
    existingFirstPage: { count: 0, fingerprint: "f".repeat(64) },
  };
  const replacement = normalizePersonalApplicationCreateInput({
    kind: "work-time-correction",
    date: "2026-08-17",
    clockIn: "09:00",
    clockOut: "18:00",
  });
  const deletion = normalizePersonalApplicationCreateInput({
    kind: "work-time-correction",
    date: "2026-08-17",
    workTimeAction: "delete",
  });
  assert.notEqual(
    createPersonalApplicationCreateFingerprint({ ...common, application: replacement }),
    createPersonalApplicationCreateFingerprint({ ...common, application: deletion }),
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

  const cancellation = {
    original: {
      ...detail,
      application: { ...detail.application, status: "承認済" },
      availableActions: ["cancel"],
    },
    reason: normalizePersonalApplicationReason(" 予定変更 "),
    route: "勤怠申請",
    existingFirstPage: { count: 2, fingerprint: "a".repeat(64) },
  };
  const cancellationFingerprint = createPersonalApplicationCancelFingerprint(cancellation);
  assert.match(cancellationFingerprint, /^[a-f0-9]{64}$/);
  assert.notEqual(
    cancellationFingerprint,
    createPersonalApplicationCancelFingerprint({ ...cancellation, reason: "別の理由" }),
  );
});
