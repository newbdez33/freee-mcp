# freee MCP and CLI reference

## MCP tools

Prefer these tools for business operations when the host has loaded the installed MCP Server:

| Purpose | Tool | Write behavior |
| --- | --- | --- |
| MCP version and selected backend | `freee_backend_status` | Read-only |
| Authentication check | `freee_auth_status` | Read-only; never returns credentials |
| API identity | `freee_me` | Read-only; API backend only |
| Current punch state | `freee_clock_status` | Read-only |
| Punch preview | `freee_clock_prepare_action` | Read-only; returns fingerprint |
| Punch execution | `freee_clock_commit_action` | Real write; exact preview, current-message approval, and `confirm: true` required |
| Department/month status | `freee_team_status` | Read-only |
| Personal monthly status | `freee_monthly_status` | Read-only |
| Monthly submit/withdraw preview | `freee_monthly_prepare_action` | Read-only; returns fingerprint |
| Monthly submit/withdraw execution | `freee_monthly_commit_action` | Real write; exact preview, current-message approval, and `confirm: true` required |
| Personal application capabilities | `freee_personal_application_options` | Read-only; include a date to read exact leave types |
| Current employee application list | `freee_personal_applications_list` | Read-only; defaults to pending |
| Current employee application detail | `freee_personal_application_detail` | Read-only; reports pending withdrawal and approved cancellation availability |
| Leave/correction creation preview | `freee_personal_application_prepare_create` | Read-only form validation; `work_time_action=delete` selects exact `勤務時間を削除`; returns fingerprint |
| Leave/correction submission | `freee_personal_application_commit_create` | Real application write; exact preview, current-message approval, and `confirm: true` required; deletion is an approval request, not a raw-record delete |
| Approved-application cancellation preview | `freee_personal_application_prepare_cancel` | Read-only form validation; binds the original application and returns a fingerprint |
| Approved-application cancellation submission | `freee_personal_application_commit_cancel` | Real write; creates a new cancellation request after exact preview and current-message approval |
| Personal withdrawal preview | `freee_personal_application_prepare_withdraw` | Read-only; returns fingerprint |
| Personal withdrawal execution | `freee_personal_application_commit_withdraw` | Real write; exact preview, current-message approval, and `confirm: true` required |
| Application list | `freee_approvals_list` | Read-only; defaults to pending |
| Monthly approval list | `freee_monthly_approvals_list` | Read-only; filters one source page to 月次勤怠締め and returns explicit payment/work periods |
| Monthly approval review | `freee_monthly_approval_review` | Read-only; verifies the payment/work mapping, exact member summary, daily attendance, alerts, and checks |
| Monthly approval/return preview | `freee_monthly_approval_prepare_action` | Read-only; binds both mapped periods and the complete monthly review into a fingerprint |
| Monthly approval/return execution | `freee_monthly_approval_commit_action` | Real single-item write; rechecks the mapping and exact review; exact individual confirmation or an active confirmed manager-approval policy, matching fingerprint, and `confirm: true` required |
| Application detail | `freee_approval_detail` | Read-only |
| Approval/return preview | `freee_approval_prepare_action` | Read-only; returns fingerprint |
| Approval/return execution | `freee_approval_commit_action` | Real single-item write; exact individual confirmation or an active confirmed policy run, matching fingerprint, and `confirm: true` required |

Use `structuredContent.data` on success. Treat `structuredContent.error` as final for the selected execution surface. Do not call a CLI equivalent after an MCP error to bypass permissions, state checks, ambiguity, or confirmation. Authentication configuration is intentionally local and interactive. In a Claude plugin installation, never assume a repository working directory: use the exact `setupCommand` returned by MCP or the plugin-resolved CLI form below.

## CLI commands

Claude plugin CLI prefix:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/plugin-cli.mjs" \
  --plugin-data "${CLAUDE_PLUGIN_DATA}"
```

Claude Code resolves the placeholders above when this Skill is installed through the plugin. Normal business operations should remain on MCP. The following `npm run freee --` examples are a source-development fallback and must be run from the `freee-mcp` repository root:

```bash
npm run freee -- auth status
npm run freee -- auth client
npm run freee -- backend status
npm run freee -- browser status
npm run freee -- me
npm run freee -- clock status
npm run freee -- team status
npm run freee -- monthly status --period 2026-08
npm run freee -- requests options --date 2026-08-14
npm run freee -- requests list --status all --page 1
npm run freee -- requests detail --id 1234
npm run freee -- approvals list
npm run freee -- approvals list --status all
npm run freee -- approvals list --status approved --page 2
npm run freee -- approvals detail --id 1234
npm run freee -- monthly-approvals list --status pending --page 1
npm run freee -- monthly-approvals review --id 1234
npm run freee -- clock status --company-id 123
npm run freee -- clock status --date 2026-08-10
```

The identity and status commands above are read-only.

## Backend selection

- `FREEE_BACKEND=api`: every business command uses API and ignores browser credentials.
- `FREEE_BACKEND=playwright`: every business command uses Playwright and ignores existing API configuration.
- Unset or `auto`: API configuration present selects API; absent selects Playwright.
- Any selected-backend failure is final for that command; never fall back.

The API implementation of `team status` is not operational for `attendance_manager`. In the API branch, report that limitation. In the Playwright branch, it reads the current visible attendance-monitor month and returns member identity, department, closing application status, issue metrics, and monthly work totals.

Select Playwright with a non-secret project `.env` value:

```dotenv
FREEE_BACKEND=playwright
FREEE_BROWSER_HEADLESS=true
```

Use `FREEE_BROWSER_HEADLESS=false` only when freee requires MFA, CAPTCHA, or another interactive step. Never place credentials in `.env`.

Implemented Playwright credential commands are:

```bash
npm run freee -- browser configure --confirm
npm run freee -- browser credentials-status
```

`browser configure` must be run directly by the user in a local interactive terminal. For a plugin installation, call `freee_auth_status` and show its exact `setupCommand`; do not rewrite it as a repository-relative command. It accepts no username/password options and does not read them from environment variables. It hides the username/email, password, and password-confirmation prompts; writes both values as one System Keychain credential; verifies the readback; and returns only configuration status. Show the returned `nextStep` so the user can complete first login, MFA, CAPTCHA, or abnormal-login confirmation in a visible browser.

`browser credentials-status` is read-only and never returns a username or password. Never pass web credentials through chat, `.env`, command arguments, or logs.

Playwright read-only commands are:

```bash
npm run freee -- browser status
npm run freee -- clock status
npm run freee -- team status
npm run freee -- team status --date YYYY-MM-DD
npm run freee -- approvals list
npm run freee -- approvals list --status pending|returned|approved|all --page PAGE
npm run freee -- approvals detail --id APPLICATION_NO
npm run freee -- monthly-approvals list --status pending|returned|approved|all --page PAGE
npm run freee -- monthly-approvals review --id APPLICATION_NO
npm run freee -- monthly status [--period YYYY-MM]
npm run freee -- requests options [--date YYYY-MM-DD]
npm run freee -- requests list [--status pending|returned|approved|all] [--page PAGE]
npm run freee -- requests detail --id APPLICATION_NO
```

`team status --date` currently accepts a date only when its month matches the month selected by freee. `--company-id` and `--group-id` are not accepted in the Playwright branch; the CLI uses the company and visible management range already selected by freee and never guesses another one. `me` is not implemented for Playwright.

`monthly status --period` selects and reads that personal work month in freee's attendance calendar. Playwright derives the matching payment month from freee's currently displayed payment-month/work-month pair, uses the bounded official year/month navigator, and verifies both resulting months before parsing. Omitting `--period` reads the currently selected month. It returns `unsubmitted`, `pending`, `approved`, or `returned`, preserves the corresponding freee label, identifies the exact matching monthly application when present, lists only currently available actions, and returns visible calendar warnings. Present every warning and stop before commit while warnings remain unless the user has resolved or explicitly reviewed them in freee.

## Monthly attendance actions

Generate a read-only preview first:

```bash
npm run freee -- monthly prepare-action \
  --action submit|withdraw [--period YYYY-MM]
```

For `submit`, the preview opens the creation form and returns the selected work period, target pay month, application route, approval steps, checks, and SHA-256 fingerprint without clicking the final `申請` button. For `withdraw`, it opens the exact pending monthly application and verifies one enabled `申請を取り下げる` button without clicking it.

Only after the current user message explicitly approves that exact period and action, use the unchanged values:

```bash
npm run freee -- monthly commit-action \
  --action submit|withdraw --period YYYY-MM \
  --fingerprint PREVIEW_SHA256 --confirm
```

The commit rereads the complete preview before one click. A changed period, state, route, approval step, form check, calendar warning, action availability, or fingerprint stops before the click. A successful submit must be visible as `pending` or `approved` with one application; a successful withdrawal must be visible as `returned`. An unknown result is never retried automatically.

## Personal attendance applications

Start with the enabled application types. Include a date when creating leave so freee can return the company's exact date-specific leave labels:

```bash
npm run freee -- requests options [--date YYYY-MM-DD]
```

This version safely supports `leave` and `work-time-correction`. A replacement correction accepts one work segment and one optional complete break pair. A deletion correction uses `work_time_action=delete`, forbids every clock and break field, and selects only the exact `勤務時間を削除` form option. It creates a `勤務時間修正` application for approval; it is not a direct API deletion of the day's raw work record. The tested company does not enable `残業`; overtime remains unsupported until an enabled form can be inspected and tested. Never use a hidden route or guess its fields.

Read the current employee's application workflow with:

```bash
npm run freee -- requests list \
  [--status pending|returned|approved|all] [--page PAGE]
npm run freee -- requests detail --id APPLICATION_NO
```

These commands select the employee-side `申請` tab. The list binds `申請中`, `差戻し`, `承認済`, or `全て` to the exact matching freee response and rendered rows. Detail searches all pages for the exact No. and reports `withdraw` when one enabled `申請を取り下げる` button exists or `cancel` when an approved application exposes an exact official `取消申請` link.

Prepare leave creation without submitting:

```bash
npm run freee -- requests prepare-create \
  --kind leave --date YYYY-MM-DD \
  --leave-type "EXACT_LABEL_FROM_OPTIONS" \
  [--leave-start HH:MM --leave-end HH:MM] [--reason "REASON"]
```

Prepare one-segment work-time correction without submitting:

```bash
npm run freee -- requests prepare-create \
  --kind work-time-correction --date YYYY-MM-DD \
  --clock-in HH:MM --clock-out HH:MM \
  [--break-start HH:MM --break-end HH:MM] [--reason "REASON"]
```

Prepare deletion of the registered work time for one exact date without submitting:

```bash
npm run freee -- requests prepare-create \
  --kind work-time-correction --date YYYY-MM-DD \
  --work-time-action delete [--reason "REASON"]
```

The preview fills the official form, selects values through freee controls, verifies the approval route, and returns a fingerprint without clicking `申請`. For deletion, it requires exactly one visible, enabled radio or checkbox named `勤務時間を削除`, selects it, and binds `workTimeAction: "delete"` into the preview. Missing, disabled, or ambiguous controls stop without submission. When the selected leave type exposes a time range, both `--leave-start` and `--leave-end` are required and are bound into the preview; default `00:00` values are never accepted. Only after the current user message approves that exact preview, repeat every unchanged field with `commit-create`, its fingerprint, and `--confirm`.

```bash
npm run freee -- requests commit-create \
  --kind work-time-correction --date YYYY-MM-DD \
  --work-time-action delete [--reason "REASON"] \
  --fingerprint PREVIEW_SHA256 --confirm
```

Deletion commit prepares the same form again, checks immediately before the click that `勤務時間を削除` is still selected, and then verifies exactly one new same-date `勤務時間修正` application whose content is exactly `勤務時間を削除`. The registered work time changes only through freee's approval workflow. A mismatched or incomplete result is unknown and must never be retried automatically.

Prepare and commit cancellation of an approved application separately:

```bash
npm run freee -- requests prepare-cancel \
  --id APPLICATION_NO [--reason "REASON"]
npm run freee -- requests commit-cancel \
  --id APPLICATION_NO [--reason "REASON"] \
  --fingerprint PREVIEW_SHA256 --confirm
```

Cancellation prepare requires the exact approved detail to expose `cancel`, validates that `取消申請` points to the official `ApprovalRequest::Revoke` form for the same original No., fills the optional reason, verifies the approval route, and binds the recent application list into the fingerprint. Cancellation commit submits once and must identify exactly one new `申請中`, `未承認`, or `承認済` cancellation application. The result application No. belongs to the new cancellation request, not the original leave. If it remains pending, approving it is a separate manager write requiring its own approval preview and current-message confirmation. Do not report the original leave as cancelled merely because the cancellation request was created.

Prepare and commit a withdrawal separately:

```bash
npm run freee -- requests prepare-withdraw --id APPLICATION_NO
npm run freee -- requests commit-withdraw \
  --id APPLICATION_NO --fingerprint PREVIEW_SHA256 --confirm
```

Withdrawal reopens and fingerprints the exact detail, clicks `申請を取り下げる` once, and must verify the same application as `差戻し`. Creation must identify exactly one new `申請中`, `未承認`, or `承認済` application. A changed preview stops before the click, and an unknown result is never retried automatically.

`approvals list` explicitly selects the current account's manager-side `承認` tab and defaults to its pending (`未承認`) queue. It never treats the default employee-side `申請` tab as an approval queue. The optional positive `page` defaults to 1. Read `pageCount` and request later pages only when needed; `totalCount` is the complete filter count, while `applicationCount` and `applications` describe the returned page. Each item includes the freee application No., applicant, status, type, target date, content, reason, application date, current approver, and automatic-check summary. The browser binds each read to the matching freee response and rendered row count instead of relying on a fixed delay. `approvals detail` searches all pages for exactly one numeric No. and returns its full visible fields, approval route, department, comment history, automatic-check messages, and currently available actions. For a supported `勤務時間修正`, it also returns `workTimeChange.before` and `workTimeChange.after` with `clockIn`, `clockOut`, `breakStart`, and `breakEnd`; a null time means freee displayed `未入力`. If freee's detail no longer exposes one unambiguous pair, `workTimeChange` is null rather than inferred from the flattened list content. These commands are Playwright-only and never fall back to API.

## Manager monthly attendance review and actions

Use the dedicated monthly workflow for `月次勤怠締め` instead of the general action commands:

```bash
npm run freee -- monthly-approvals list \
  [--status pending|returned|approved|all] [--page PAGE]
npm run freee -- monthly-approvals review --id APPLICATION_NO
npm run freee -- monthly-approvals prepare-action \
  --id APPLICATION_NO --action approve|return
```

The list filters each synchronized source approval page to monthly closing applications. For every result, it parses one explicit payment month from application text such as `2026年09月の支払分`, reads freee's displayed payment-month/work-month relationship, verifies the resulting pair through the official navigator, and returns `paymentPeriod` plus work `period`. It never treats `対象日` or the payment month as the work month and never hardcodes a one-month subtraction. Follow `pageCount` when more source pages exist; `sourceTotalCount` is the unfiltered source count, and `applicationCount` is the monthly count on that page.

The review requires the application type to be exactly `月次勤怠締め` or `月次勤怠締め申請` and the application content to identify one payment month consistent with its `対象日`. It derives the work month from freee's currently displayed payment/work pair, then selects and verifies the exact target pair on the attendance monitor, maps the applicant and department to one unique visible member, opens the official employee attendance link, verifies the same pair again, and parses one unique daily attendance table. It returns `paymentPeriod`, work `period`, application detail, member monthly summary, every daily row, per-day alerts, page warnings, and consolidated automatic checks. `MONTHLY_APPROVAL_PERIOD_MAPPING_UNCONFIRMED`, ambiguous or failed period navigation, a duplicate member, a missing official link, or an ambiguous table stops without a review fingerprint or write.

The prepare fingerprint binds the entire review and requested action. For an individual action, commit once only after the current user message explicitly approves that exact preview. A confirmed condition-based manager-approval policy may instead authorize each matching monthly item without per-item confirmation; the Agent must still prepare, retain, and validate every fingerprint separately:

```bash
npm run freee -- monthly-approvals commit-action \
  --id APPLICATION_NO --action approve|return \
  --fingerprint PREVIEW_SHA256 --confirm
```

Commit reconstructs the complete review, including the same explicit payment month and freee-verified work month, reopens the exact application, requires unchanged detail and action availability, clicks one `承認` or `申請者へ差し戻す` button, and verifies `承認済` or `差戻し`. A changed or ambiguous mapping stops before the click. Never use the general approval commit to bypass a monthly review failure. Never retry an unknown result. Condition-based batch monthly approval is supported through these sequential single-item review, prepare, commit, and verification calls.

## Employee application actions

Application writes use two separate commands. First generate a read-only preview:

```bash
npm run freee -- approvals prepare-action \
  --id APPLICATION_NO --action approve|return
```

The command succeeds only when that exact action is currently available. Before an `approve` action for type `休暇`, it reads every pending manager-approval page and requires no pending `勤務時間修正` with the exact same applicant and target date. A matching correction blocks without a fingerprint even when its structured `workTimeChange` is null. A missing reliable leave applicant or target date also stops fail-closed. It returns the complete detail preview and a SHA-256 `fingerprint`; no business button is clicked. Present the applicant identity, type, target date, content, reason, freee automatic checks, and requested action. Retain and bind the fingerprint to that exact human-readable preview; the user does not need to copy, repeat, or personally compare the raw SHA-256 value.

For an individual action, only after the current user message explicitly authorizes that exact No. and action, use the unchanged values:

```bash
npm run freee -- approvals commit-action \
  --id APPLICATION_NO --action approve|return \
  --fingerprint PREVIEW_SHA256 --confirm
```

One user confirmation may instead authorize a condition-based policy run of general or dedicated monthly `approve` and `return` actions. Before the first write, the Agent restates the interpreted selection conditions, action mapping, scope and termination, dependency order, and per-item error handling, then asks for explicit confirmation. The scope may be one complete pending-queue pass, repeated scans until no match remains, a date/employee/type/payment-period/work-period range, a maximum count, or an explicitly configured recurring automation. A fixed candidate snapshot, full No. enumeration, and precomputed fingerprints are not required. The confirmation remains valid for the stated run and may cover later-discovered applications only when its scope explicitly does so.

During the authorized run, read every pending source page on each scan. For a general candidate, reread the full detail and use the general prepare/commit tools. For a monthly candidate, read the complete dedicated review and use the monthly prepare/commit tools. Apply the confirmed rule to exact structured identity, date, type, status, payment period, and work period fields when precision matters; semantic judgment over full reasons, comments, alerts, or automatic checks is allowed when the user delegated it. Skip and report one ambiguous or nonmatching item while continuing with independent matches. Prepare each match, retain and compare the fingerprint on the user's behalf, and invoke the corresponding single-item commit command. The user does not need to copy, repeat, or personally compare the SHA-256 value. This is the supported condition-based batch approval workflow, implemented through sequential single-item calls.

The CLI reopens the application and recomputes the fingerprint before locating one exact visible, enabled freee button. For a `休暇` approval, it repeats the complete pending-page dependency check, then reopens the exact target again and requires unchanged detail, action availability, and fingerprint. If a same-applicant, same-date `勤務時間修正` blocks the leave, process the correction first when the active policy authorizes it, then reread and prepare the leave; otherwise skip that leave. For a monthly approval, it rederives the payment/work mapping, reconstructs the complete review, and reopens the exact application before any click. A known pre-click error such as `APPROVAL_PREVIEW_CHANGED` or `MONTHLY_APPROVAL_PREVIEW_CHANGED` means no business action occurred and may be followed by a fresh read, policy evaluation, prepare, and commit under the same active authorization. An unavailable or already-processed item is skipped. A post-click state is read again across the synchronized paginated workflow and must match `承認済` for approve or `差戻し` for return. Never retry an unknown write; independently read that exact target and quarantine it plus any dependent leave chain, while independent matches may continue. Stop the whole run only when its authorization expires or becomes unclear, the backend or identity changes, pagination or page state is untrustworthy, or another systemic failure makes subsequent decisions unsafe. Report every approved, returned, skipped, blocked, failed, and unknown No. If a self-application leaves the manager history after return, the exact employee-side No., type, target date, content, reason, and application date may verify the final state. `return` maps to freee's `申請者へ差し戻す`; do not describe it as an irreversible rejection. The leave dependency rule does not apply to `return`, to approving a `勤務時間修正`, or to the dedicated monthly approval workflow. Policy-run authorization covers general and dedicated monthly manager approvals only; it does not cover punches, personal monthly writes, or personal-application writes.

`auth client` reports only a short SHA-256 fingerprint of the configured Client ID plus the callback URL. Use it to match a configured credential to a freee developer app without printing the Client ID or Client Secret.

Authentication setup is a credential write. Prefer the operating system credential store:

```bash
npm run freee -- auth configure --store system --client-id YOUR_CLIENT_ID --confirm
```

Have the user enter Client Secret in the CLI's hidden prompt; never request it in chat. System Keyring is the only persistent OAuth credential store supported for normal users.

For CI or an externally injected short-lived Access Token only:

```bash
npm run freee -- auth configure --store environment --confirm
```

Environment mode requires `FREEE_ACCESS_TOKEN` in every process. Do not run OAuth login or refresh in this mode.

For OAuth-capable backends, configure this exact callback URL in the freee development app:

```text
http://127.0.0.1:48181/callback
```

When the user explicitly requests it, browser UI may be used for this developer-app value and official OAuth consent. That belongs to API setup and does not select the Playwright business backend.

Only after explicit current-message approval, run:

```bash
npm run freee -- auth login --confirm
```

The CLI opens freee's consent page, validates the callback state, writes Tokens to the configured secure backend, and enables automatic refresh. Do not automate freee password entry. A manual refresh is available for diagnosis:

```bash
npm run freee -- auth refresh
```

Each freee Refresh Token is single-use. The CLI serializes refreshes and atomically stores the newly returned Access Token and Refresh Token. Do not run alternative token commands or retry with an old token.

Real punch commands are:

```bash
npm run freee -- clock in --confirm
npm run freee -- clock break-start --confirm
npm run freee -- clock break-end --confirm
npm run freee -- clock out --confirm
```

In the API branch, add `--company-id 123` only when the user has selected that company or there is exactly one clearly requested company. The Playwright branch does not accept it. Never add `--confirm` unless the current user message explicitly requests that exact action.

## Result envelope

Success is emitted on stdout:

```json
{
  "ok": true,
  "command": "clock status",
  "data": {}
}
```

Errors are emitted on stderr and return a non-zero exit code:

```json
{
  "ok": false,
  "error": {
    "code": "CONFIRMATION_REQUIRED",
    "message": "...",
    "details": {}
  }
}
```

If neither stream contains one complete JSON envelope, handle the command as a transport failure. A read-only command may be retried once. After any commit command, do not repeat the write: use the corresponding read-only status, list, or detail command to verify the exact prepared target. Only report a recovered success when one unique record matches the expected identifier or period, action, content, and resulting state. If that cannot be proven, report the result as unknown and ask the user to inspect freee.

Important error codes:

- `CREDENTIAL_UNAVAILABLE`: check the configured backend. Never request that the user paste a Token into chat.
- `SYSTEM_KEYRING_UNAVAILABLE`: ask the user to unlock or enable the operating system credential store. Environment mode is only for an externally injected temporary Access Token.
- `ENVIRONMENT_STORE_READ_ONLY`: use an injected Access Token only, or reconfigure to System Keyring for OAuth.
- `FREEE_API_ERROR`: report the HTTP status and safe API message. The CLI already attempts one refresh and one retry for a 401; report the final failure without looping.
- `OAUTH_CLIENT_CREDENTIALS_UNAVAILABLE`: rerun System Keyring configuration locally; never request the Client Secret in chat.
- `WEB_CREDENTIALS_UNAVAILABLE`: show the exact returned `setupCommand` and instruct the user to run it directly in a local interactive terminal. Never request the credentials in chat and never substitute a repository-relative command in a plugin installation.
- `INTERACTIVE_TERMINAL_REQUIRED`: the configuration command was launched through a non-interactive Agent process. Stop and have the user run the displayed command themselves in a local terminal.
- `WEB_CREDENTIAL_CONFIRMATION_MISMATCH`: no credential was saved. Let the user rerun the local command; never ask for either password entry.
- `INVALID_WEB_CREDENTIAL_STORE`: stop and replace the local System Keychain web credential by rerunning `browser configure --confirm` in a local interactive terminal.
- `WEB_CREDENTIAL_VERIFY_FAILED`: stop; the System Keychain write did not verify, and success was not reported.
- `BACKEND_MISMATCH`: the command belongs to the other complete backend; do not fall back. Report the configured backend.
- `BROWSER_INTERACTION_REQUIRED`: set headless false and retry only while the user is present to complete the official freee interaction.
- `BROWSER_NAVIGATION_BLOCKED` or `BROWSER_PAGE_AMBIGUOUS`: stop. Do not broaden selectors, allow a new host, or force a click without reviewing the current freee page structure.
- `BROWSER_TEAM_PAGE_UNEXPECTED`: freee changed the attendance-monitor table schema; stop rather than returning misaligned employee data.
- `BROWSER_APPROVAL_PAGE_UNEXPECTED` or `BROWSER_APPROVAL_DETAIL_UNEXPECTED`: freee changed the supported application list/detail view; stop without writing.
- `BROWSER_MONTHLY_PAGE_UNEXPECTED` or `BROWSER_MONTHLY_PERIOD_AMBIGUOUS`: freee changed or ambiguously rendered the monthly workflow; stop without writing.
- `ATTENDANCE_PERIOD_NAVIGATION_UNEXPECTED`: freee did not expose one unambiguous payment-month/work-month label or official year/month navigator; stop without reading or writing another month.
- `ATTENDANCE_PERIOD_NAVIGATION_UNSUPPORTED`: the requested month is outside the bounded navigation range; stop rather than clicking an unbounded number of times.
- `ATTENDANCE_PERIOD_NAVIGATION_FAILED`: freee did not reach and verify the requested work month; stop without returning data from the displayed month.
- `MONTHLY_APPROVAL_PERIOD_MAPPING_UNCONFIRMED`: a manager monthly application did not expose one explicit payment month consistent with `対象日`, or freee did not expose and verify one payment-month/work-month relationship. No review fingerprint or action is allowed; never substitute the payment month or a fixed offset.
- `BROWSER_MONTHLY_PERIOD_UNSUPPORTED`: the final monthly snapshot still did not match the requested work month; stop without continuing against another period.
- `MONTHLY_ACTION_UNAVAILABLE`: report the current monthly state and available actions; do not substitute another write.
- `MONTHLY_PREVIEW_CHANGED`: no personal monthly action occurred. Prepare again, present the new preview, and obtain new explicit approval.
- `MONTHLY_APPROVAL_PREVIEW_CHANGED`: no manager monthly approval action occurred. For an individual action, prepare again and obtain new explicit approval. In an active manager-approval policy run, reread the complete review, re-evaluate the confirmed rule, prepare again, and continue without another user confirmation when it still matches.
- `MONTHLY_ACTION_RESULT_UNKNOWN`: do not retry. Read monthly status and inspect freee before considering another write.
- `INVALID_PERSONAL_APPLICATION_PAGE`: use a positive page no greater than the returned employee-side `pageCount`.
- `PERSONAL_APPLICATION_NOT_FOUND`: the numeric application No. was absent after every employee-side page was read; do not substitute a similar item.
- `PERSONAL_APPLICATION_TYPE_UNAVAILABLE`: the company or employee does not enable that application type; stop and report the options result.
- `PERSONAL_APPLICATION_TYPE_UNSUPPORTED`: the form has not been verified safely in this MCP version; do not navigate to hidden routes or guess fields.
- `INVALID_PERSONAL_APPLICATION_WORK_TIME_ACTION`: use only `replace` or `delete`; `delete` is valid only for a work-time correction and must omit every clock and break field.
- `PERSONAL_APPLICATION_WORK_TIME_DELETE_UNAVAILABLE`: the exact `勤務時間を削除` option was hidden, disabled, or did not remain selected. No application was submitted; do not broaden the selector or substitute a raw-record delete.
- `PERSONAL_APPLICATION_LEAVE_TYPE_UNAVAILABLE`: rerun options with the same date and use one exact returned label.
- `PERSONAL_APPLICATION_PREVIEW_CHANGED`: no action occurred. Prepare again, present the new preview, and obtain new explicit approval.
- `PERSONAL_APPLICATION_ACTION_RESULT_UNKNOWN`: do not retry. Read the personal application list/detail and inspect freee before considering another write, including both the original and any new cancellation application.
- `INVALID_APPROVAL_PAGE`: use a positive page no greater than the returned `pageCount`.
- `APPROVAL_NOT_FOUND`: the numeric application No. was absent after every manager-workflow page was read; do not substitute a similar item.
- `APPROVAL_ACTION_UNAVAILABLE`: the application is already processed or the current account cannot perform that action. Stop an individual action; in an active policy run, skip it and continue with independent matches.
- `LEAVE_APPROVAL_BLOCKED_BY_WORK_TIME_CORRECTION`: no leave fingerprint or approval click was produced. Process every listed pending same-applicant, same-date `勤務時間修正` first. In an active policy run, do so automatically when the rule authorizes those corrections, then reread and prepare the leave; otherwise skip the leave and continue with independent items.
- `LEAVE_APPROVAL_DEPENDENCY_UNCONFIRMED`: the `休暇` applicant or target date was unavailable, so the dependency could not be matched reliably. Do not infer identity or date from surrounding text or list order. Stop an individual approval; in an active policy run, skip this leave and continue with independent items.
- `APPROVAL_PREVIEW_CHANGED`: no action occurred. For an individual approval, run `prepare-action` again, present the new preview, and obtain new explicit approval. In an active policy run, reread the detail, re-evaluate the confirmed rule, prepare again, and continue without another user confirmation when it still matches.
- `APPROVAL_ACTION_RESULT_UNKNOWN`: do not retry that target. Read its detail and quarantine it plus any dependent leave chain; an active policy run may continue with independent matches.
- `TOKEN_REFRESH_UNAVAILABLE`: OAuth setup has not completed; do not request tokens in chat.
- `TOKEN_PERSIST_FAILED`: stop. Because freee rotates Refresh Tokens, a fresh authorization may be required.
- `TOKEN_REFRESH_BUSY`: another Agent is refreshing. Wait for that command to finish, then retry the original read once.
- `COMPANY_REQUIRED`: show the returned company choices and ask the user to select one.
- `GROUP_REQUIRED`: show the returned department choices and ask the user to select one; do not infer a department.
- `GROUP_NOT_FOUND`: the requested department has no employee membership on that date; verify the date and group ID.
- `CLOCK_ACTION_UNAVAILABLE`: report `availableTypes` and do not write anything.
- `CLOCK_PREVIEW_CHANGED`: no action occurred. Prepare again, show the new preview and fingerprint, and obtain new explicit approval.
- `CONFIRMATION_REQUIRED`: no write occurred. Only re-run with `--confirm` if the current user message explicitly requested that exact real punch.

## Current scope

Implemented and usable: local STDIO MCP tools; the companion CLI; shared exclusive backend selection; System Keyring and temporary environment API configuration; OAuth login/automatic refresh; API identity lookup; API and Playwright personal punch status/actions; System Keychain web credentials; persistent controlled browser login; Playwright personal monthly status plus fingerprint-bound submit/withdraw and verified work-month navigation; synchronized employee-side personal application list/detail plus fingerprint-bound leave/work-time-correction creation (including exact `勤務時間を削除` requests), approved-application cancellation, and pending withdrawal; Playwright monthly department attendance-monitor summaries; synchronized paginated manager-side application list/detail plus fingerprint-bound single-item approval/return; and dedicated monthly closing review/approval/return with verified navigation to the applicant's work month.

Implemented but unavailable to the current API role: API-backed direct department member daily punch status. Do not fall back.

Not implemented yet: Playwright `me`, date-specific department clock details, child-department selection, overtime creation, multiple work segments/breaks, returned/draft personal application deletion, persistent batch-policy state, and audit logs. Condition-based general and dedicated monthly approval batches are implemented through verified sequential single-item operations. Keep remaining work on `TODO.md`; do not directly run the legacy Playwright project.
