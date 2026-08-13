# freee MCP and CLI reference

## MCP tools

Prefer these tools for business operations when the host has loaded the installed MCP Server:

| Purpose | Tool | Write behavior |
| --- | --- | --- |
| Selected backend | `freee_backend_status` | Read-only |
| Authentication check | `freee_auth_status` | Read-only; never returns credentials |
| API identity | `freee_me` | Read-only; API backend only |
| Current punch state | `freee_clock_status` | Read-only |
| Punch preview | `freee_clock_prepare_action` | Read-only; returns fingerprint |
| Punch execution | `freee_clock_commit_action` | Real write; exact preview, current-message approval, and `confirm: true` required |
| Department/month status | `freee_team_status` | Read-only |
| Application list | `freee_approvals_list` | Read-only; defaults to pending |
| Application detail | `freee_approval_detail` | Read-only |
| Approval/return preview | `freee_approval_prepare_action` | Read-only; returns fingerprint |
| Approval/return execution | `freee_approval_commit_action` | Real write; exact preview, current-message approval, and `confirm: true` required |

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
npm run freee -- approvals list
npm run freee -- approvals list --status all
npm run freee -- approvals list --status approved --page 2
npm run freee -- approvals detail --id 1234
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
```

`team status --date` currently accepts a date only when its month matches the month selected by freee. `--company-id` and `--group-id` are not accepted in the Playwright branch; the CLI uses the company and visible management range already selected by freee and never guesses another one. `me` is not implemented for Playwright.

`approvals list` explicitly selects the current account's manager-side `承認` tab and defaults to its pending (`未承認`) queue. It never treats the default employee-side `申請` tab as an approval queue. The optional positive `page` defaults to 1. Read `pageCount` and request later pages only when needed; `totalCount` is the complete filter count, while `applicationCount` and `applications` describe the returned page. Each item includes the freee application No., applicant, status, type, target date, content, reason, application date, current approver, and automatic-check summary. The browser binds each read to the matching freee response and rendered row count instead of relying on a fixed delay. `approvals detail` searches all pages for exactly one numeric No. and returns its full visible fields, approval route, department, comment history, automatic-check messages, and currently available actions. These commands are Playwright-only and never fall back to API.

## Employee application actions

Application writes use two separate commands. First generate a read-only preview:

```bash
npm run freee -- approvals prepare-action \
  --id APPLICATION_NO --action approve|return
```

The command succeeds only when that exact action is currently available. It returns the complete detail preview and a SHA-256 `fingerprint`; no business button is clicked. Present the applicant identity, type, target date, content, reason, freee automatic checks, requested action, and fingerprint to the user.

Only after the current user message explicitly approves that exact No. and action, use the unchanged values:

```bash
npm run freee -- approvals commit-action \
  --id APPLICATION_NO --action approve|return \
  --fingerprint PREVIEW_SHA256 --confirm
```

The CLI reopens the application and recomputes the fingerprint before locating one exact visible, enabled freee button. Any changed detail, new comment, changed availability, missing confirmation, or ambiguous control stops before the click. A post-click state is read again across the synchronized paginated workflow and must match `承認済` for approve or `差戻し` for return. A missing or different state is reported as unknown and must be inspected before any further write. Never retry an unknown result. `return` maps to freee's `申請者へ差し戻す`; do not describe it as an irreversible rejection. Batch approval is not implemented.

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
- `INVALID_APPROVAL_PAGE`: use a positive page no greater than the returned `pageCount`.
- `APPROVAL_NOT_FOUND`: the numeric application No. was absent after every manager-workflow page was read; do not substitute a similar item.
- `APPROVAL_ACTION_UNAVAILABLE`: the application is already processed or the current account cannot perform that action; stop.
- `APPROVAL_PREVIEW_CHANGED`: no action occurred. Run `prepare-action` again, present the new preview, and obtain new explicit approval.
- `APPROVAL_ACTION_RESULT_UNKNOWN`: do not retry. Read the application detail and report its state before considering another write.
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

Implemented and usable: local STDIO MCP tools; the companion CLI; shared exclusive backend selection; System Keyring and temporary environment API configuration; OAuth login/automatic refresh; API identity lookup; API and Playwright personal punch status/actions; System Keychain web credentials; persistent controlled browser login; Playwright monthly department attendance-monitor summaries; and synchronized paginated Playwright employee application list/detail plus fingerprint-bound single-item approval/return.

Implemented but unavailable to the current API role: API-backed direct department member daily punch status. Do not fall back.

Not implemented yet: Playwright `me`, date-specific department clock details, child-department selection, employee-created applications/corrections, monthly submissions/withdrawals, deletes, audit logs, and batch changes. Keep these on `TODO.md`; do not directly run the legacy Playwright project.
