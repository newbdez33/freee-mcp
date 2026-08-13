---
name: freee
description: "Safely operate freee HR attendance through local MCP tools or the companion CLI, backed by one explicitly selected Public API or controlled Playwright backend. Use for backend selection, authentication setup, System Keychain credentials, identity, punch status/actions, personal leave and attendance-correction applications, department attendance and monthly issue summaries, submissions, employees, and approvals."
---

# freee Attendance

Prefer the installed `freee` MCP tools for business operations. Use the companion CLI only for local interactive authentication setup, diagnostics when MCP cannot start, or source development. Both entry points call the same `FreeeService`. Select one backend before any business operation and keep it for the whole process or command. `FREEE_BACKEND=api|playwright` is authoritative; unset or `auto` selects API when API configuration exists and Playwright otherwise. Never fall back to another backend or switch from MCP to CLI after an operation error. Never assume that Claude Code was started from the source repository.

## Choose the workflow

1. If MCP tools are available, call `freee_backend_status`; otherwise run CLI `backend status`. An explicit `.env` or process `FREEE_BACKEND` wins over credential detection. If it is `auto`, API configuration present means `api`; absent means `playwright`. Use the selected execution surface for the rest of that operation.
2. In the API branch, use only API-backed commands. Cross-employee operations require the API role to allow them; `attendance_manager` is known not to support API `team status`.
3. In the Playwright branch, use the corresponding MCP clock, monthly, personal-application, team, and approval tools. `freee_monthly_status` reads the personal month currently selected in freee; `freee_personal_applications_list` and `freee_personal_application_detail` read the employee-side `申請` workflow; `freee_team_status` returns the management view's visible members, closing application state, attendance issues, and work totals. `freee_approvals_list` and `freee_approval_detail` read the manager-side `承認` workflow. Never directly run the legacy project or ad-hoc browser actions.
4. For API setup, run `auth configure` only after explicit approval. Prefer `system`, which stores Client Secret and Tokens in the System Keyring. In an installed plugin or agent package, use its resolved CLI path and persistent data directory; never invent a repository-relative command.
5. For Playwright first-time setup, call `freee_auth_status` and show the exact `setupCommand` returned with `WEB_CREDENTIALS_UNAVAILABLE`. Instruct the user to run it directly in a local interactive terminal. The CLI hides username, password, and confirmation input, stores them in System Keychain, and returns no credential value. Never run it through a non-interactive Agent shell or accept credentials in chat. Use `browser credentials-status` only in a source-development checkout.
6. For a real punch, call `freee_clock_prepare_action`, present its preview and fingerprint, and wait. Call `freee_clock_commit_action` with the unchanged values and `confirm: true` only when the current user message explicitly approves that exact action. With CLI-only hosts, use the equivalent status plus dedicated `clock ... --confirm` command.
7. For a personal monthly attendance submission or withdrawal, call `freee_monthly_status` first. Its optional `period` is a guard and must match the month selected in freee. Present every returned calendar warning. If `warnings` is non-empty, stop before commit until the user resolves or explicitly reviews the listed problem in freee; do not infer safety from a separate department summary. Use `freee_monthly_prepare_action` for a read-only preview and fingerprint. Call `freee_monthly_commit_action` with `confirm: true` only when the current user message explicitly approves that exact period and action after seeing the preview. If the fingerprint changes, prepare and present a fresh preview instead of writing.
8. For the current employee's leave or work-time correction, call `freee_personal_application_options` first, including the date for leave. Use the exact returned leave label. If the selected leave form exposes a time range, provide the exact `leave_start` and `leave_end`; never accept or submit default `00:00` values. Read existing applications with `freee_personal_applications_list` or `freee_personal_application_detail`. Use the matching personal-application prepare tool, present its full preview and fingerprint, and wait. Call a personal-application commit tool with unchanged values and `confirm: true` only when the current user message explicitly approves that exact create or withdrawal after seeing the preview. Overtime is unavailable until the options tool reports it as both available and supported; never bypass company configuration.
9. For an employee application requiring manager action, call `freee_approvals_list` and `freee_approval_detail` first. List results are paginated; start at page 1 and follow `pageCount` only as needed. Use `freee_approval_prepare_action` for a read-only preview and fingerprint. Call `freee_approval_commit_action` with `confirm: true` only when the current user message explicitly approves that exact application No. and action after seeing the preview. If the fingerprint changes, prepare and present a fresh preview instead of writing.
10. For any other request or CLI syntax, check [references/commands.md](references/commands.md). Do not improvise an API, MCP, or browser workflow that lacks a dedicated tool or command.

For MCP, read `structuredContent` and report the meaningful result in the user's language. When an installed MCP CLI command is necessary, use the exact command returned by MCP. In a Claude plugin, its resolved form is `node "${CLAUDE_PLUGIN_ROOT}/scripts/plugin-cli.mjs" --plugin-data "${CLAUDE_PLUGIN_DATA}" <arguments>`. In a Pi-managed package without MCP support, resolve the package root from this Skill and run `node <package-root>/scripts/standalone-cli.mjs <arguments>`. For source development only, run `npm run freee -- <arguments>` from the repository root. Read the JSON envelope from stdout or stderr.

If a commit tool or command returns no parseable JSON, treat the write result as unknown even when the browser appeared to show success. Never repeat the commit. On the same execution surface, use only the matching read-only status, list, or detail operation to find one exact result that matches the prepared target and content. Report a recovered success only when that independent read is unambiguous; otherwise stop and ask the user to inspect freee. A read-only command with missing output may be retried once.

## Enforce safety

- Treat MCP `confirm: true` and CLI `--confirm` as assertions that the user explicitly requested that exact real action in the current message. Never infer approval from an earlier message, a schedule, or a general request to set up automation.
- Never run a punch command merely to test it. Use `auth status` and `clock status` for verification.
- Never print, inspect, copy, or pass an Access Token, Client Secret, or Refresh Token. Do not invoke keyring commands yourself; the CLI owns credential access.
- Never ask the user to paste a Client Secret or Token into chat. For System Keyring setup, have the user enter the Client Secret in the CLI's hidden terminal prompt.
- In the Playwright branch, store the freee username and password only in System Keychain. Allow the CLI to auto-fill them only after verifying the official freee login URL. Never read the legacy `freee-checkin` `.env`.
- After `browser configure`, show the exact `nextStep` returned by the CLI for the first visible login. Let the CLI auto-fill only on the official freee login page; require the user to complete MFA, CAPTCHA, or abnormal-login checks in the visible browser.
- Keep the persistent browser profile, Cookie state, HTML and diagnostic screenshots outside the repository with private permissions. Do not print them or employee-sensitive page content in logs.
- Allow main-frame browser navigation only to `accounts.secure.freee.co.jp`, `p.secure.freee.co.jp`, and `ep.secure.freee.co.jp`. Stop if the URL, selector, employee, period, or page state is ambiguous. Never force-click a business action.
- Treat `environment` as a read-only Access Token source. Never run OAuth login or refresh in that mode because it cannot persist freee's rotating Refresh Token.
- Treat OAuth setup as a credential write. Never run `auth login --confirm` from a general setup request or merely to test it. The CLI may open freee's official consent page; do not automate account-password entry.
- Treat saving the developer-app callback as an external configuration write. Before saving, verify the intended app and exact callback URL; do not change the app name, publication status, permissions, or any unrelated setting.
- Let automatic refresh run normally. Never retry `auth refresh` concurrently or reuse an old Refresh Token; freee rotates it after every refresh.
- Never add `datetime` or alter the system clock to backdate a punch. The initial CLI supports current-time punches only.
- If multiple employee identities exist, stop and ask the user to choose one of the company IDs returned by the CLI. Do not guess.
- Do not switch backends after `team status` or another command fails. Change `FREEE_BACKEND` only when the user explicitly asks to select a different complete backend.
- Do not switch from a failed MCP tool to the CLI, or from a failed CLI command to MCP, to bypass validation, permissions, ambiguity, or confirmation. Diagnose the original error on the same surface.
- If freee says the action is unavailable, report the returned available types and stop. Do not retry a different write action.
- Missing, truncated, or malformed output after a write is an unknown result, not a failed write. Never retry it automatically; independently read the exact target before deciding what happened.
- Never use an approval commit tool or command directly. First prepare, present the application identity, type, target date, content, reason, automatic checks, requested action, and fingerprint, and wait for explicit approval in a new current message.
- A general request to implement, test, inspect, continue, handle applications, or approve applications is not approval of a specific real application. Never run a real approval write while developing or testing.
- Never use a monthly commit tool or command directly. First prepare, present the exact period, current state, target month, route, approval steps, checks, requested action, and fingerprint, then wait for explicit approval in a new current message.
- Never use a personal-application commit tool or command directly. For creation, present kind, date, leave type or work times, optional break, reason, route, and fingerprint. For withdrawal, present the exact application No., status, type, date, content, reason, and fingerprint. Wait for explicit approval in a new current message.
- Treat `PERSONAL_APPLICATION_TYPE_UNAVAILABLE` and `PERSONAL_APPLICATION_TYPE_UNSUPPORTED` as final capability results. Do not open hidden routes, broaden selectors, or imitate an unverified form.
- Do not delete, batch-approve, or batch-change anything until a dedicated CLI command with preview and confirmation exists.

## Map explicit punch requests

- 上班、出勤、clock in: MCP action `in`; CLI `clock in`
- 休息开始、休憩開始、start break: MCP action `break-start`; CLI `clock break-start`
- 休息结束、休憩終了、end break: MCP action `break-end`; CLI `clock break-end`
- 下班、退勤、clock out: MCP action `out`; CLI `clock out`

Always consult [references/commands.md](references/commands.md) for exact syntax and error behavior before executing a real punch.

## Map application requests

- 待审批、未承认、pending applications: `freee_approvals_list` with `status: pending`
- 已处理或全部申请: `freee_approvals_list` with `status: returned|approved|all`; use `page` and returned `pageCount` for older results
- 申请详情: `freee_approval_detail` with numeric `id`
- 承认、批准: prepare with `--action approve`, then commit only after explicit confirmation
- 差戻し、退回修改: prepare with `--action return`, then commit only after explicit confirmation

Always consult [references/commands.md](references/commands.md) before preparing or committing an application action. freee's supported operation is 差戻し (return to applicant), not an irreversible rejection.

## Map personal application requests

- 我的申请、本人申請、申請履历: `freee_personal_applications_list`; use `status` and `pageCount` as needed
- 我的申请详情: `freee_personal_application_detail` with numeric `id`
- 休假、有休、特別休暇: call `freee_personal_application_options` with the date, then prepare creation with kind `leave` and one exact returned `leave_type`; when freee exposes a leave time range, include the exact `leave_start` and `leave_end`
- 勤務時間修正、修正出退勤: prepare creation with kind `work-time-correction`, `clock_in`, `clock_out`, and an optional complete `break_start`/`break_end` pair
- 加班、残業: report the options result; this version must stop unless overtime is both available and supported
- 撤回我的未批准申请、申請を取り下げる: read detail, prepare withdrawal, present it, then commit only after explicit confirmation

Always consult [references/commands.md](references/commands.md) before preparing or committing a personal application. A successful withdrawal must become `差戻し`; an unknown create or withdrawal result is never retried automatically.

## Map monthly attendance requests

- 月次勤怠状态、締め申請状态: `freee_monthly_status`; include `period: YYYY-MM` when the user named a month
- 提交月次勤怠、月次勤怠締め申請: prepare and then commit with action `submit`
- 撤回未批准的月次申请、申請を取り下げる: prepare and then commit with action `withdraw`

Always consult [references/commands.md](references/commands.md) before preparing or committing a monthly action. `withdraw` is available only for the current user's pending application and maps to freee's `申請を取り下げる`; it is not an administrator approval cancellation or a delete.
