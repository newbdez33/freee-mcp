# Live Validation Checklist

This checklist tracks capabilities that are implemented and covered by automated tests, but have not yet completed a recorded end-to-end validation against real freee state or a real supported Agent installation.

Baseline date: 2026-08-13.

The ordered, reversible workflow for the Playwright application and attendance-management cases that the maintainer will execute with a personal account is documented in [`personal-account-live-test-plan.md`](personal-account-live-test-plan.md). Public API validation and real clock commits remain tracked here but are explicitly outside that plan.

The checklist intentionally excludes features that are not implemented, including overtime creation, multiple work segments or breaks, general employee daily detail outside the monthly-approval review, recursive child-department aggregation, deletes, batch actions, and audit logs.

## Recorded live validation baseline

The following areas already have recorded real-environment evidence and do not need to be repeated unless their implementation changes:

- Public API OAuth authorization, System Keyring storage, identity lookup, authentication status, and clock-status reads.
- The expected Public API permission denial for department reads under the current `attendance_manager` role.
- Playwright System Keychain login, persistent headless profile, backend/version status, and personal clock-status reads.
- Playwright department attendance summary for the currently selected freee month.
- Manager-side application filters, pagination, detail lookup, and the approval path, including post-action verification of application No. `10023` as `承認済`.
- Personal application capability discovery, empty pending/returned filters, approved/all list reads, approved detail reads, and read-only form preparation for full-day leave and one-segment work-time correction with and without one break.
- Claude Code plugin installation/update through `0.3.3`, MCP discovery, and read-only MCP calls.

Partial validation runs are recorded separately:

- [2026-08-13 Playwright personal-account validation](live-validation-run-2026-08-13.md): automated baseline, Playwright read baseline, missing-confirmation rejection for monthly submission and personal creation, and read-only form/date variants. No freee write was performed.

## Priority 0: real business-write paths

Every item below requires a dedicated test case, a reviewed prepare result, and explicit confirmation immediately before commit. Never run these as a batch.

- [ ] **LV-W01 — Public API clock commit.** Prepare and commit one legitimate punch during a normal workday, then verify that the returned action disappears and the real freee clock state changes once.
- [ ] **LV-W02 — Playwright clock commit.** On a different legitimate punch transition, prepare and commit through the Playwright backend and verify the changed state without retrying.
- [ ] **LV-W03 — Monthly submission commit.** During an eligible unsubmitted month, prepare the exact `月次勤怠締め` submission, review period/route/checks, commit once, and verify `pending` or `approved` with one matching application.
- [ ] **LV-W04 — Monthly withdrawal.** Only if LV-W03 remains pending, prepare the exact withdrawal, commit once, and verify the month and application become `returned`. Skip rather than improvise if the submission is auto-approved.
- [x] **LV-W05 — Personal leave creation.** Use an agreed future test date and exact leave label, commit once, and verify exactly one new pending or approved application with matching detail. Validated on 2026-08-13 with timed half-day application No. `10032` for `2026-08-14`.
- [ ] **LV-W06 — Personal work-time correction creation.** Use an agreed test record that will not alter payroll unexpectedly, commit once, and verify exactly one matching application. Prefer returning or withdrawing the request before approval when the test goal is only workflow validation.
- [x] **LV-W07 — Personal application withdrawal.** While a dedicated test application is still pending, prepare and commit `申請を取り下げる`, then verify the same No. is `差戻し` and no longer exposes `withdraw`. Validated with application No. `10032` on 2026-08-13.
- [x] **LV-W08 — Manager return action.** Create a dedicated pending test application, prepare `return`, commit once, and verify the same No. becomes `差戻し`. Validated on 2026-08-13 with full-day leave application No. `10035`; the exact employee-side detail and audit comment independently confirmed the returned state without retrying the write.
- [ ] **LV-W09 — Approved personal application cancellation.** On an approved application that genuinely needs cancellation, prepare the exact `取消申請`, review the original No./status/type/date/content, cancellation reason, route, and fingerprint, then commit once and verify exactly one new cancellation application. Approve that new No. only through a separate manager preview and explicit confirmation, then verify the original leave is cancelled.
- [ ] **LV-W10 — Manager monthly attendance approval/return.** For one legitimate `月次勤怠締め` application, complete the dedicated review, inspect the applicant's monthly summary, daily attendance, alerts, and automatic checks, prepare one approve or return action, commit once after explicit confirmation, and verify the exact final state. Do not create a synthetic employee submission solely for this test.

## Priority 1: real read and state variants

These validations are read-only or stop before a business write.

- [x] **LV-R01 — Non-empty personal pending list and detail.** With a dedicated request pending, verify the `申請中` filter, exact No. lookup, detail fields, and `withdraw` availability. Validated with application No. `10032` on 2026-08-13.
- [x] **LV-R02 — Non-empty personal returned list and detail.** After LV-W07 or LV-W08, verify the `差戻し` filter and exact detail. Validated with application No. `10032` on 2026-08-13.
- [ ] **LV-R03 — Personal application pagination beyond page 1.** Validate page 2 when the employee history exceeds one freee page. The current account has only 40 items, so this path is fixture-tested only.
- [ ] **LV-R04 — Monthly state transitions.** Record `unsubmitted`, `pending`, `approved`, and `returned` reads as those states become naturally available. Do not create artificial payroll state merely to fill the matrix.
- [x] **LV-R05 — Half-day and special-leave form variants.** Prepare, but do not submit, each enabled label such as `有休（半休）` and `夏季休暇（有給）`; verify whether freee adds fields that the current generic leave form must capture. Validated on 2026-08-13 without submitting; `有休（半休）` exposes and now binds an explicit leave time range.
- [x] **LV-R06 — Cross-month calendar navigation.** Prepare a leave or correction date outside the initially displayed month and verify the requested date is selected exactly, without submitting. Validated on 2026-08-13 without submitting.
- [x] **LV-R07 — Team-status date guard.** Read one date inside the selected freee month and verify that a date in another month stops with the documented mismatch instead of silently navigating. Validated on 2026-08-13; the other-month guard returned `BROWSER_DATE_UNSUPPORTED`.
- [ ] **LV-R08 — Public API team-status success path.** Validate only with a separate account that actually has the required API role, such as `company_admin`. The current account's real permission denial is already confirmed and must not be bypassed.
- [ ] **LV-R09 — Multiple-company API selection.** With an account that exposes multiple employee identities, verify the unambiguous company path and the `COMPANY_REQUIRED` stop case without creating a punch.
- [x] **LV-R10 — Approved personal cancellation form.** From an exact approved employee-side detail, verify `cancel` availability, the official `取消申請` route, original No. binding, optional reason field, approval route, and read-only fingerprint generation without submitting. Validated on 2026-08-14 with original application No. `10034`, Playwright backend, and fingerprint prefix `1a6f921f8988`.
- [ ] **LV-R11 — Manager monthly attendance review.** With a naturally pending `月次勤怠締め` application in the currently selected attendance-monitor month, verify monthly-only filtering, exact applicant mapping, one daily attendance table, all visible alerts/checks, and stable read-only fingerprint generation. Stop before commit.

## Priority 2: authentication and distribution reliability

- [ ] **LV-I01 — Real token-expiry refresh.** Allow a System Keyring OAuth Access Token to expire naturally, run a read, and verify one refresh stores the rotated token pair and the original read succeeds.
- [ ] **LV-I02 — Real 401 refresh-and-retry.** When a legitimate expired/revoked Access Token produces a 401, verify the client refreshes and retries the read exactly once. Do not manufacture this by exposing or editing tokens manually.
- [ ] **LV-I03 — Cross-process refresh serialization.** Start the same safe read concurrently from two real Agent processes near token expiry and verify only one process consumes the rotating Refresh Token.
- [ ] **LV-I04 — Visible-browser interactive fallback.** When freee naturally requires MFA, CAPTCHA, or abnormal-login confirmation, run with headless disabled, complete the official interaction, and verify the persistent profile resumes normal reads.
- [ ] **LV-I05 — Credential recovery guidance.** Using a disposable Keychain service name, validate missing and invalid web-credential setup guidance end to end without touching the working credential.
- [ ] **LV-I06 — Portable Agent installation and update.** Perform user-scoped install, read-only MCP discovery, update, and rollback checks in Codex, OpenCode, and Pi. Claude Code is already live-validated.
- [ ] **LV-I07 — Environment Access Token mode.** In a disposable process with a short-lived externally injected token, verify read-only authentication and confirm that login/refresh persistence remains unavailable.

## Safety rejection checks

These checks may use real read state but must stop before any business click or API write.

- [ ] **LV-S01 — Missing confirmation.** Call each commit family without confirmation and verify it is rejected before browser launch or API write.
- [ ] **LV-S02 — Stale fingerprint.** For clock, monthly, personal creation/cancellation/withdrawal, and manager approval/return, change one prepared value or pass a stale fingerprint and verify `*_PREVIEW_CHANGED` with no write.
- [ ] **LV-S03 — Backend exclusivity.** Select `api` and `playwright` in separate processes, call a capability belonging only to the other backend, and verify `BACKEND_MISMATCH` without fallback.

Do not deliberately create a network failure after a business click to test unknown-result handling. `*_RESULT_UNKNOWN` remains covered by controlled automated tests because inducing it against production could create an action whose final state cannot be safely determined.

## Evidence to record

For each completed item, record only:

- date, package/MCP version, backend, and Agent host;
- application No. or work period when needed for later verification;
- prepare fingerprint prefix (first 12 characters only);
- final normalized state or exact safe error code;
- whether any cleanup or follow-up remains.

Never store credentials, tokens, cookies, browser profiles, raw employee tables, full screenshots, or unrelated personal data in this file or an issue.
