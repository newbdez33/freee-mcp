import assert from "node:assert/strict";
import test from "node:test";

import {
  createApprovalFingerprint,
  parseApprovalPageInfo,
  parseApprovalListSnapshot,
} from "../dist/browser-approvals.js";

const headers = [
  "ステータス",
  "No.",
  "種別",
  "対象日",
  "申請内容",
  "申請理由",
  "申請日",
  "現在の承認者",
  "チェック結果",
];

test("approval list parser maps the supported freee table schema", () => {
  const result = parseApprovalListSnapshot({
    headers,
    pageCount: 1,
    rows: [[
      "申請中",
      "1234",
      "休暇",
      "2026/08/12",
      "有休 全休",
      "私用",
      "2026/08/11",
      "承認者 A",
      "問題なし",
      "",
    ]],
  });

  assert.equal(result.pageCount, 1);
  assert.deepEqual(result.applications, [{
    id: "1234",
    status: "申請中",
    applicant: null,
    type: "休暇",
    targetDate: "2026/08/12",
    content: "有休 全休",
    reason: "私用",
    appliedAt: "2026/08/11",
    currentApprover: "承認者 A",
    checkResult: "問題なし",
  }]);
});

test("approval list parser preserves manager-only columns and blank table columns", () => {
  const result = parseApprovalListSnapshot({
    headers: [
      "ステータス",
      "No.",
      "申請者（代理申請者）",
      "種別",
      "対象日",
      "申請内容",
      "申請理由",
      "申請日",
      "現在の承認者",
      "チェック結果",
    ],
    rows: [[
      "",
      "未承認",
      "9876",
      "申請者 A",
      "休暇",
      "2026/08/14",
      "有休 全休",
      "私用",
      "2026/08/13",
      "承認者 B",
      "問題なし",
      "",
    ]],
  });

  assert.deepEqual(result.applications, [{
    id: "9876",
    status: "未承認",
    applicant: "申請者 A",
    type: "休暇",
    targetDate: "2026/08/14",
    content: "有休 全休",
    reason: "私用",
    appliedAt: "2026/08/13",
    currentApprover: "承認者 B",
    checkResult: "問題なし",
  }]);
});

test("approval list parser accepts an empty pending list", () => {
  assert.deepEqual(
    parseApprovalListSnapshot({ headers, rows: [] }),
    { pageCount: 1, applications: [] },
  );
});

test("approval response metadata binds DOM synchronization to one exact page", () => {
  assert.deepEqual(parseApprovalPageInfo({
    approval_requests: Array.from({ length: 50 }, (_, index) => ({ request_code: index + 1 })),
    meta: {
      current_page: 1,
      total_pages: 16,
      total_count: 766,
      per: 50,
    },
  }), {
    page: 1,
    pageCount: 16,
    totalCount: 766,
    perPage: 50,
    rowCount: 50,
    requestCodes: Array.from({ length: 50 }, (_, index) => String(index + 1)),
  });
  assert.throws(
    () => parseApprovalPageInfo({ approval_requests: [], meta: { current_page: 1 } }),
    (error) => error.code === "BROWSER_APPROVAL_PAGE_UNEXPECTED",
  );
});

test("approval list parser stops on a changed schema or invalid application No.", () => {
  assert.throws(
    () => parseApprovalListSnapshot({ headers: ["No."], rows: [] }),
    (error) => error.code === "BROWSER_APPROVAL_PAGE_UNEXPECTED",
  );
  assert.throws(
    () => parseApprovalListSnapshot({
      headers,
      rows: [["申請中", "not-an-id", "休暇", "", "", "", "", "", ""]],
    }),
    (error) => error.code === "BROWSER_APPROVAL_PAGE_UNEXPECTED",
  );
});

test("approval preview fingerprint binds the exact action and detail content", () => {
  const detail = {
    application: {
      id: "1234",
      status: "申請中",
      applicant: "申請者 A",
      type: "休暇",
      targetDate: "2026/08/12",
      content: "有休 全休",
      reason: "私用",
      appliedAt: "2026/08/11",
      currentApprover: "承認者 A",
      checkResult: "問題なし",
    },
    fields: [],
    tables: [],
    detailLines: ["申請者 Aさんの休暇申請", "残数は4日です。"],
    availableActions: ["approve", "return"],
  };

  const approve = createApprovalFingerprint(detail, "approve");
  assert.match(approve, /^[a-f0-9]{64}$/);
  assert.equal(approve, createApprovalFingerprint(detail, "approve"));
  assert.notEqual(approve, createApprovalFingerprint(detail, "return"));
  assert.notEqual(
    approve,
    createApprovalFingerprint({ ...detail, detailLines: [...detail.detailLines, "new comment"] }, "approve"),
  );
});
