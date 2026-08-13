# freee MCP + CLI + Agent Skill

This project gives Claude Code, Codex, OpenCode, Pi, and other local coding agents safe, testable access to freee HR attendance workflows. Business logic lives in one shared core service, exposed through a local STDIO MCP server, a CLI, and a shared Agent Skill. The core supports two mutually exclusive backends: the freee Public API or controlled Playwright browser automation.

## Install with your coding agent

Use Claude Code, Codex, Pi, OpenCode, or another local coding agent? Copy this prompt into it:

```text
Install freee MCP and its Agent Skill from https://github.com/newbdez33/freee-mcp for the coding agent you are currently running. Detect whether this is Claude Code, Codex, Pi, OpenCode, or another agent and follow the matching user-scoped installation path in the README. Prefer the agent's native plugin or package manager; otherwise register the documented portable STDIO MCP command and install skills/freee in the agent's global Skill location. Do not ask me to clone the repository, start the agent from that repository, or add project-scoped configuration. Never ask me to paste a freee username, password, Client Secret, or Token into chat or command arguments. If credentials are missing, show the exact local System Keychain setup command returned by the MCP or companion CLI. Verify only read-only authentication and tool discovery; do not perform a real punch or approval action while installing.
```

The repository is public. Users do not need a GitHub account or a working copy: the selected agent manages the plugin, package, or npm cache internally. The installed tools and Skill are user-scoped and work from any project directory.

### Claude Code

Claude Code installs both MCP and the Skill through the native plugin marketplace:

```bash
claude plugin marketplace add https://github.com/newbdez33/freee-mcp.git
claude plugin install freee@freee-tools --scope user
```

Run `/reload-plugins` in an existing Claude Code session, or start a new session from any directory. The plugin loads both the local STDIO MCP server and the freee Skill at user scope; users never need to open Claude Code from this repository. Run `/mcp` to inspect the connection.

For first-time Playwright authentication, ask Claude to check freee authentication. If credentials are missing, it returns an installation-specific command. Run that exact command yourself in a local interactive terminal. The command hides the username and password while saving them to System Keychain. MCP installation and approval never receive freee credentials.

#### Update Claude Code

Updates remain explicit by default so attendance code does not change without the user's knowledge. Copy this prompt into Claude Code when an update is wanted:

```text
Update my installed freee@freee-tools Claude Code plugin and its marketplace, then reload plugins and verify the freee MCP connection. Preserve plugin data, System Keychain credentials, and the external Playwright profile. Do not manually clone the source repository and do not perform any real freee punch or approval action.
```

The equivalent manual update is:

```bash
claude plugin marketplace update freee-tools
claude plugin update freee@freee-tools --scope user
```

Then run `/reload-plugins`. Claude Code switches the MCP and Skill to the new cached plugin version without requiring a repository checkout or a new MCP registration. System Keychain entries, persistent plugin data, and the external `~/.freee-agent/playwright-profile` survive normal plugin updates.

Plugin releases use semantic versions. Maintainers must bump `package.json` and `.claude-plugin/plugin.json` together; the test suite enforces that they match. Users remain on the last installed version until an explicit update succeeds.

### Codex

Codex installs `skills/freee` with its Skill installer and registers this pinned, portable STDIO command at user scope:

```bash
codex mcp add freee -- npx --yes --package='github:newbdez33/freee-mcp#v0.3.3' freee-mcp
```

The opening installation prompt asks Codex to perform both steps. Restart Codex if the newly installed Skill is not discovered immediately, then use `/mcp` to verify the server connection.

### OpenCode and other MCP clients

Register this as a user-level STDIO MCP command using the client's settings or MCP installer:

```bash
npx --yes --package='github:newbdez33/freee-mcp#v0.3.3' freee-mcp
```

Install `skills/freee` from this repository in the client's global Agent Skills location. OpenCode recognizes `~/.agents/skills/freee`; other Agent Skills-compatible clients may use a different user-level directory. The opening installation prompt lets the running agent select the correct location without creating project files.

### Pi

Install the repository as a user-level Pi package:

```bash
pi install git:github.com/newbdez33/freee-mcp
```

Pi loads the bundled `skills/freee` directory. If the installed Pi environment has no MCP extension, the Skill uses the package's companion CLI, which calls the same core service and enforces the same write confirmations.

### Update an existing installation

Copy this prompt into the agent that owns the installation:

```text
Update my user-scoped freee installation from https://github.com/newbdez33/freee-mcp using the update mechanism for the coding agent you are currently running. For Claude Code, update freee-tools and freee@freee-tools, then reload plugins. For Codex, OpenCode, or another portable MCP installation, update the pinned GitHub release tag in the MCP command and refresh the global skills/freee installation. For Pi, update the installed Pi package. Preserve ~/.freee-agent, Claude plugin data, System Keychain credentials, and the external Playwright profile. Restart or reload the agent and verify only the read-only MCP connection or CLI status. Do not manually clone the repository and do not perform any real freee punch or approval action.
```

For Pi, the equivalent manual update is `pi update`. Portable MCP installations deliberately pin a release tag; updating replaces only the code version in the MCP registration and Skill, while credentials and browser state remain outside the package cache.

## Design decisions

- `FREEE_BACKEND=api|playwright` explicitly selects the backend for every business operation. Only `auto` selects a backend by detecting an existing API configuration.
- A backend failure is final for that operation. The system never falls back to the other backend.
- MCP is the primary business-operation interface for MCP-capable agents, providing tool discovery, input schemas, read-only annotations, and client-side write approval prompts.
- The CLI remains the deterministic local interface for OAuth setup, System Keychain configuration, and troubleshooting.
- MCP and CLI call the same `FreeeService`; authentication, business rules, and backend selection are not duplicated.
- One shared Agent Skill directs supported agents to prefer MCP and use the CLI only when MCP is unavailable or local setup is required. An error must never be bypassed by switching interfaces.
- The Playwright backend stores the freee username and password in System Keychain and fills them only on the expected official freee login page.
- The legacy `freee-checkin` project informed the login flow and selectors, but this project does not reuse its `.env` password, force clicks, environment-variable logging, or unconfirmed scheduled writes.

## Development quick start

```bash
npm ci
npm test
npm run validate
npm run package:smoke
```

End users do not use this checkout at runtime. For local plugin development, load the repository explicitly for one Claude Code session:

```bash
claude --plugin-dir /absolute/path/to/freee-mcp
```

The repository keeps `.codex/config.toml` for Codex development. The Claude plugin manifest is `.claude-plugin/plugin.json`; its marketplace is `.claude-plugin/marketplace.json`. The plugin resolves its own cached path and persistent data directory, so neither Claude Code nor MCP depends on the user's current working directory.

The Codex configuration uses `default_tools_approval_mode = "writes"`: read-only tools can run directly, while commit tools still trigger client approval. Independently of the client prompt, the server validates `confirm: true`, the preview fingerprint, and the current freee state.

### Maintainer release workflow

Every pull request and push to `main` runs tests, validates the Claude plugin and canonical Agent Skill, scans Git history for secrets, and starts the packed CLI and MCP from an isolated npm cache. GitHub Action dependencies are pinned to full commit SHAs.

Releases are explicit and run only from the repository's `main` branch:

1. Update `package.json`, `package-lock.json`, `.claude-plugin/plugin.json`, and the portable `#v...` commands in this README to the same SemVer version.
2. Merge that version change after CI passes.
3. In GitHub Actions, run the `Release` workflow from `main` and enter the version without the `v` prefix.

The workflow repeats all validation, creates or verifies an annotated `vVERSION` tag at the current `main` commit, generates English release notes from merged work, and attaches the portable package with its SHA-256 checksum. It never publishes to npm and receives no freee credentials.

## MCP tools

| MCP tool | Type | Purpose |
| --- | --- | --- |
| `freee_backend_status` | Read-only | Show the MCP version and exclusively selected backend |
| `freee_auth_status` | Read-only | Verify authentication without returning credentials |
| `freee_me` | Read-only | Read the current user and company identities on the API backend |
| `freee_clock_status` | Read-only | Show currently available punch actions |
| `freee_clock_prepare_action` | Read-only preview | Generate a punch preview and fingerprint |
| `freee_clock_commit_action` | Write | Revalidate the fingerprint and create one real punch |
| `freee_team_status` | Read-only | Read a department or current web-management monthly summary |
| `freee_monthly_status` | Read-only | Read the selected month's personal 月次勤怠締め status |
| `freee_monthly_prepare_action` | Read-only preview | Generate a monthly submit or withdrawal preview and fingerprint |
| `freee_monthly_commit_action` | Write | Revalidate the fingerprint and submit or withdraw one monthly application |
| `freee_personal_application_options` | Read-only | Show enabled personal application types and date-specific leave types |
| `freee_personal_applications_list` | Read-only | List the current employee's pending, returned, approved, or all applications |
| `freee_personal_application_detail` | Read-only | Read one current-employee application and its available actions |
| `freee_personal_application_prepare_create` | Read-only preview | Fill and validate a leave or work-time correction form and generate a fingerprint |
| `freee_personal_application_commit_create` | Write | Revalidate and submit one personal application |
| `freee_personal_application_prepare_withdraw` | Read-only preview | Generate a withdrawal preview and fingerprint for one pending application |
| `freee_personal_application_commit_withdraw` | Write | Revalidate and withdraw one pending personal application |
| `freee_approvals_list` | Read-only | List pending, approved, returned, or all applications |
| `freee_approval_detail` | Read-only | Read the full details of one application |
| `freee_approval_prepare_action` | Read-only preview | Generate an approval or return preview and fingerprint |
| `freee_approval_commit_action` | Write | Revalidate the fingerprint and approve or return one application |

The MCP server can also be started manually:

```bash
npm run mcp
```

It is a STDIO protocol process. Under normal use, the client starts it automatically; no separate terminal window needs to remain open.

## Source-development CLI commands

Installed users should use MCP from any directory when their agent supports it. When local interactive setup is required, the MCP or installed Skill provides an absolute package-resolved command. The `npm run freee --` commands below are for maintainers working in a source checkout.

```bash
# Read-only
npm run freee -- backend status
npm run freee -- auth status
npm run freee -- me
npm run freee -- clock status
npm run freee -- team status
npm run freee -- monthly status --period YYYY-MM
npm run freee -- requests options --date YYYY-MM-DD
npm run freee -- requests list --status pending|returned|approved|all --page 1
npm run freee -- requests detail --id APPLICATION_NO
npm run freee -- approvals list
npm run freee -- approvals list --status all
npm run freee -- approvals list --status approved --page 2
npm run freee -- approvals detail --id APPLICATION_NO
npm run freee -- browser status
npm run freee -- browser credentials-status

# Configure Playwright credentials securely in System Keychain
npm run freee -- browser configure --confirm

# Real writes: use --confirm only when the user explicitly requested the exact action
npm run freee -- clock in --confirm
npm run freee -- clock break-start --confirm
npm run freee -- clock break-end --confirm
npm run freee -- clock out --confirm

# Monthly attendance: prepare first, then commit only after explicit review and approval
npm run freee -- monthly prepare-action --action submit|withdraw --period YYYY-MM
npm run freee -- monthly commit-action --action submit|withdraw \
  --period YYYY-MM --fingerprint PREVIEW_SHA256 --confirm

# Current employee applications: inspect options, prepare, review, then commit
npm run freee -- requests prepare-create --kind leave --date YYYY-MM-DD \
  --leave-type "EXACT_FREEE_LABEL" \
  [--leave-start HH:MM --leave-end HH:MM] --reason "REASON"
npm run freee -- requests commit-create --kind leave --date YYYY-MM-DD \
  --leave-type "EXACT_FREEE_LABEL" \
  [--leave-start HH:MM --leave-end HH:MM] --reason "REASON" \
  --fingerprint PREVIEW_SHA256 --confirm
npm run freee -- requests prepare-create --kind work-time-correction \
  --date YYYY-MM-DD --clock-in HH:MM --clock-out HH:MM \
  [--break-start HH:MM --break-end HH:MM] [--reason "REASON"]
npm run freee -- requests prepare-withdraw --id APPLICATION_NO
npm run freee -- requests commit-withdraw --id APPLICATION_NO \
  --fingerprint PREVIEW_SHA256 --confirm

# Employee applications: prepare first, then commit only after explicit review and approval
npm run freee -- approvals prepare-action --id APPLICATION_NO --action approve|return
npm run freee -- approvals commit-action --id APPLICATION_NO \
  --action approve|return --fingerprint PREVIEW_SHA256 --confirm
```

Commands emit JSON and identify the selected business backend. Before a real punch, the service rechecks the available action using the same backend. Before an application action, it rereads the complete detail and requires the SHA-256 fingerprint to match the read-only preview. An unavailable action, changed detail, ambiguous page, or missing confirmation stops before an API POST or browser click.

MCP and CLI writes follow the same safety model. Every real action must start with a prepare tool or command that shows the target, action, content, and fingerprint. A commit is allowed only after the user approves that exact action in a new current message. Development requests, testing, messages such as “continue” or “handle it,” and approval from an earlier message do not count. An unknown write result is never retried automatically.

The API implementation of `team status` is complete and tested, but the `attendance_manager` role used at GCU cannot read employee memberships through the Public API. The API backend returns the permission error and does not fall back to Playwright.

The Playwright backend supports System Keychain credentials, persistent login, personal punch status and actions, personal monthly attendance submit/withdraw, personal application list/detail/leave/work-time-correction/withdraw, department monthly attendance summaries, and employee application list/detail/approval/return. It enters the Employee Portal from the freee home page, reads personal punch controls, reads visible members, closing applications, attendance issues, and monthly work totals from the attendance list, and processes authorized applications through the application workflow. The browser profile stays outside the repository.

## Monthly attendance applications

`monthly status` reads the month currently selected in freee's attendance calendar and returns its normalized state, freee status label, matching application when present, and available actions. An optional `--period YYYY-MM` is a guard: it must match the selected month and does not silently navigate to another period.

Monthly writes use the same two-step safety model as other writes. `monthly prepare-action --action submit` opens the creation form, reads the target month, application route, approval steps, and checks, but does not click the final `申請` button. `--action withdraw` reads the exact pending application and verifies that `申請を取り下げる` is available. The commit command rereads the complete preview, requires the unchanged fingerprint and explicit current-message confirmation, performs one click, and verifies the resulting monthly state. An ambiguous or unknown result is never retried automatically.

## Personal attendance applications

`requests list` explicitly selects the employee-side `申請` tab and synchronizes each `申請中`, `差戻し`, `承認済`, or `全て` filter with the matching freee response before parsing. `requests detail` searches every employee-side page for one exact application No. and reports `withdraw` only when one visible, enabled `申請を取り下げる` button is present.

Call `requests options` before creating an application. With `--date`, it reads the exact leave types configured by the company for that date. Leave and one-segment work-time correction forms are supported; a work-time correction may include one optional break pair. The current test company does not enable `残業`, so the capability result reports overtime as unavailable and this version does not guess or bypass an unverified overtime form.

Creation and withdrawal use separate prepare and commit commands. Prepare fills the official form, verifies the selected date, values, leave type, and approval route, and returns a SHA-256 fingerprint without clicking `申請` or `申請を取り下げる`. Commit reconstructs the same preview, stops on any change, requires explicit current-message approval, clicks once, and verifies one new pending/approved application or the exact withdrawn application in `差戻し`. An unknown result is never retried automatically.

## Employee application handling

`approvals list` explicitly selects freee's manager-side `承認` tab and defaults to its pending `未承認` queue; it never reads the default employee-side `申請` tab as an approval queue. Each result includes the applicant. `--status returned|approved|all` reads other manager-side states, while `--page N` selects one page. Results report `page`, `pageCount`, `totalCount`, and the current page's `applicationCount`, so agents can continue without emitting an unbounded employee history. The browser waits for the exact freee response and matching rendered row count before parsing, preventing one filter's stale rows from being returned for another. `approvals detail --id` searches the complete paginated manager workflow and returns the application fields, approval route, department, comments, and freee automatic-check results. Both commands are read-only.

A single application write has two separate steps:

1. `approvals prepare-action` reads the current full detail, verifies that the requested button is available, and returns a preview and content fingerprint without clicking a business control.
2. The agent may call `approvals commit-action ... --confirm` with the same application number, action, and fingerprint only after the user reviews the applicant, type, target date, content, reason, and automatic checks and explicitly requests approval or return in the current message.

Before committing, the CLI rereads the detail. A fingerprint mismatch, missing button, application processed by someone else, or new comment stops the operation and requires a new preview. After the click, the application is reread through the synchronized paginated workflow and must expose the exact expected `承認済` or `差戻し` state. A disappeared or unverifiable result is reported as unknown and must never be retried automatically. Batch approval is not supported, and development tests never perform real approvals or returns.

## Backend selection

The backend is selected once using this priority and is never mixed during an operation:

1. `FREEE_BACKEND=api`: use only the Public API.
2. `FREEE_BACKEND=playwright`: use only Playwright, even if an API configuration still exists locally.
3. Unset or `FREEE_BACKEND=auto`: select API when an API configuration exists; otherwise select Playwright.

A source-development checkout can select:

```dotenv
FREEE_BACKEND=playwright
FREEE_BROWSER_HEADLESS=true
```

Only non-sensitive switches belong in `.env`. Never store a username, password, Token, or Client Secret there.

## API credentials

The CLI supports two credential modes:

- `system`: the normal and recommended mode. Client Secret and OAuth Tokens use macOS Keychain, Windows Credential Manager, or the Linux system keyring.
- `environment`: intended for CI, servers, or a temporary Access Token. It cannot rotate a Refresh Token automatically.

Configuration contains only the Client ID, callback address, and backend metadata; it never contains a Client Secret or Token. A source checkout uses `.freee/oauth.json`, while the Claude plugin keeps the same data in its persistent plugin data directory.

For an installed Claude plugin, ask Claude to configure the API backend. The installed Skill supplies a plugin-resolved CLI command and stores this non-secret configuration in persistent plugin data. The source-checkout commands below are for development.

### System Keyring (recommended)

```bash
npm run freee -- auth configure --store system --client-id YOUR_CLIENT_ID --confirm
```

The command reads the Client Secret through a hidden interactive prompt. It stores the Client Secret and OAuth Token set in the operating-system credential store. The Access Token and one-time Refresh Token are updated together.

### Environment mode (CI or temporary use)

Inject `FREEE_ACCESS_TOKEN` through a CI Secret, container Secret, or parent process, then run:

```bash
npm run freee -- auth configure --store environment --confirm
```

Environment mode cannot safely persist the new Refresh Token returned by freee, so it does not support OAuth login or automatic refresh. Never put a real Token in the repository `.env` file.

## OAuth renewal

Configure this exact callback URL in the freee development application:

```text
http://127.0.0.1:48181/callback
```

Then, while the user is present and explicitly agrees to authorization, run:

```bash
npm run freee -- auth configure --store system --client-id YOUR_CLIENT_ID --confirm
npm run freee -- auth login --confirm
npm run freee -- auth status
```

`auth login` opens the official freee authorization page, validates a random local callback `state`, and writes the Tokens to System Keyring.

After authorization, the CLI refreshes an Access Token before it expires. A 401 response also triggers at most one refresh and one retry. Every freee Refresh Token is single-use, so each refresh stores the new Access Token and Refresh Token together. A cross-process lock prevents Codex and Claude Code from consuming the same Refresh Token concurrently.

The source-checkout `.freee/oauth.json` contains no Token or Secret and is ignored by Git. The plugin equivalent lives in persistent plugin data and survives normal plugin updates.

## Playwright credentials

With the installed plugin, ask Claude to check freee authentication, then run the exact `setupCommand` it returns directly in a local interactive terminal. For source development, the equivalent command is:

```bash
npm run freee -- browser configure --confirm
```

The command reads the username, password, and password confirmation through hidden prompts, writes them to System Keychain, and verifies the readback. Its output contains no credential values. Username and password options are not accepted, and credentials are never read from `.env`, MCP arguments, or chat.

Complete the first login using the exact `nextStep` returned by the configuration command. In a source checkout, the equivalent command is:

```bash
FREEE_BROWSER_HEADLESS=false npm run freee -- browser status
```

Playwright fills credentials only after validating `accounts.secure.freee.co.jp`, and main-frame navigation is limited to `p.secure.freee.co.jp` and `ep.secure.freee.co.jp`. The user completes MFA, CAPTCHA, or abnormal-login verification in the visible browser. A successful session is cached in the private persistent profile, while System Keychain credentials remain the recovery source when the session expires. Headless mode can then be restored.

In headless mode, the runtime derives the User-Agent from the selected local Chrome channel and removes only the `HeadlessChrome` product token before starting the persistent session. Playwright keeps the matching request header and User-Agent Client Hints. This is limited User-Agent normalization: `navigator.webdriver` remains enabled, no stealth or fingerprint-evasion package is used, and the project does not claim that a site cannot recognize browser automation.

When MCP first discovers that web credentials are missing, `freee_auth_status` or another tool returns the local setup command. The agent may only show that command to the user; it must never request or collect the username or password in chat.

The persistent browser profile defaults to `~/.freee-agent/playwright-profile` and is restricted to the current user. The CLI rejects a profile configured inside the repository.

For an explicitly supervised source-development diagnostic only, set `FREEE_BROWSER_DIAGNOSTIC_DIR` to a private temporary directory outside the repository. Personal-application preparation and submission then capture numbered full-page screenshots around the controlled form and submit steps. The directory and image files are restricted to the current user, are never enabled by default, and must never be committed or attached to a public issue without reviewing and redacting personal data.

## Agent Skill

The canonical Skill lives at `skills/freee`:

- Codex: `.agents/skills/freee` links to the canonical Skill.
- Claude Code: the user-level `freee@freee-tools` plugin loads the canonical Skill automatically in every project; `.claude/skills/freee` remains only for source development.

Both clients therefore share the same MCP mappings, CLI setup guidance, and safety rules. Business operations prefer MCP; authentication setup and MCP troubleshooting continue to use the CLI.

## Documentation

- [ADR-0001: CLI and Agent Skill foundation](docs/decisions/0001-cli-and-agent-skill.md)
- [ADR-0002: Exclusive API or Playwright backends](docs/decisions/0002-api-or-playwright-exclusive-backends.md)
- [ADR-0003: Local MCP adapter](docs/decisions/0003-local-mcp-adapter.md)
- [freee HR API capability inventory](docs/freee-hr-api-capabilities.md)
- [Development backlog](TODO.md)

## License

This project is available under the [MIT License](LICENSE).
