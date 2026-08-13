---
name: freee
description: "Safely operate freee HR attendance through local MCP tools or the companion CLI, backed by one explicitly selected Public API or controlled Playwright backend. Use for backend selection, authentication setup, System Keychain credentials, identity, punch status/actions, department attendance and monthly issue summaries, submissions, employees, and approvals."
---

# freee Attendance

Prefer the installed `freee` MCP tools for business operations. Use the companion CLI only for local interactive authentication setup, diagnostics when MCP cannot start, or source development. Both entry points call the same `FreeeService`. Select one backend before any business operation and keep it for the whole process or command. `FREEE_BACKEND=api|playwright` is authoritative; unset or `auto` selects API when API configuration exists and Playwright otherwise. Never fall back to another backend or switch from MCP to CLI after an operation error. Never assume that Claude Code was started from the source repository.

## Choose the workflow

1. If MCP tools are available, call `freee_backend_status`; otherwise run CLI `backend status`. An explicit `.env` or process `FREEE_BACKEND` wins over credential detection. If it is `auto`, API configuration present means `api`; absent means `playwright`. Use the selected execution surface for the rest of that operation.
2. In the API branch, use only API-backed commands. Cross-employee operations require the API role to allow them; `attendance_manager` is known not to support API `team status`.
3. In the Playwright branch, use the corresponding MCP clock, team, and approval tools. `freee_team_status` returns the selected month's visible members, closing application state, attendance issues, and work totals. `freee_approvals_list` and `freee_approval_detail` read the current account's approval workflow. Never directly run the legacy project or ad-hoc browser actions.
4. For API setup, run `auth configure` only after explicit approval. Prefer `system`, which stores Client Secret and Tokens in the System Keyring. In an installed plugin or agent package, use its resolved CLI path and persistent data directory; never invent a repository-relative command.
5. For Playwright first-time setup, call `freee_auth_status` and show the exact `setupCommand` returned with `WEB_CREDENTIALS_UNAVAILABLE`. Instruct the user to run it directly in a local interactive terminal. The CLI hides username, password, and confirmation input, stores them in System Keychain, and returns no credential value. Never run it through a non-interactive Agent shell or accept credentials in chat. Use `browser credentials-status` only in a source-development checkout.
6. For a real punch, call `freee_clock_prepare_action`, present its preview and fingerprint, and wait. Call `freee_clock_commit_action` with the unchanged values and `confirm: true` only when the current user message explicitly approves that exact action. With CLI-only hosts, use the equivalent status plus dedicated `clock ... --confirm` command.
7. For an employee application, call `freee_approvals_list` and `freee_approval_detail` first. List results are paginated; start at page 1 and follow `pageCount` only as needed. Use `freee_approval_prepare_action` for a read-only preview and fingerprint. Call `freee_approval_commit_action` with `confirm: true` only when the current user message explicitly approves that exact application No. and action after seeing the preview. If the fingerprint changes, prepare and present a fresh preview instead of writing.
8. For any other request or CLI syntax, check [references/commands.md](references/commands.md). Do not improvise an API, MCP, or browser workflow that lacks a dedicated tool or command.

For MCP, read `structuredContent` and report the meaningful result in the user's language. When an installed MCP CLI command is necessary, use the exact command returned by MCP. In a Claude plugin, its resolved form is `node "${CLAUDE_PLUGIN_ROOT}/scripts/plugin-cli.mjs" --plugin-data "${CLAUDE_PLUGIN_DATA}" <arguments>`. In a Pi-managed package without MCP support, resolve the package root from this Skill and run `node <package-root>/scripts/standalone-cli.mjs <arguments>`. For source development only, run `npm run freee -- <arguments>` from the repository root. Read the JSON envelope from stdout or stderr.

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
- Never use an approval commit tool or command directly. First prepare, present the application identity, type, target date, content, reason, automatic checks, requested action, and fingerprint, and wait for explicit approval in a new current message.
- A general request to implement, test, inspect, continue, handle applications, or approve applications is not approval of a specific real application. Never run a real approval write while developing or testing.
- Do not submit, delete, batch-approve, or batch-change anything until a dedicated CLI command with preview and confirmation exists.

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
