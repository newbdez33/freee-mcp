# freee MCP + CLI + Agent Skill

This project gives Codex and Claude Code safe, testable access to freee HR attendance workflows. Business logic lives in one shared core service, exposed through a local STDIO MCP server, a CLI, and a shared Agent Skill. The core supports two mutually exclusive backends: the freee Public API or controlled Playwright browser automation.

## Install with your AI agent

Already use Claude Code? Copy this prompt into it:

```text
Install the freee Claude Code plugin from the private GitHub repository https://github.com/newbdez33/freee-mcp. Follow its README: add its marketplace, install freee@freee-tools at user scope, reload plugins, and verify that its MCP server and Skill are available. Do not clone it into my current project or add project-scoped MCP configuration. Never ask me to paste a freee username, password, Client Secret, or Token into chat or command arguments. If credentials are missing, show the exact local System Keychain setup command returned by the MCP. Do not perform a real punch or approval action while installing or verifying it.
```

The repository is currently private, so Claude Code must be able to authenticate with GitHub through the user's existing Git credentials. The equivalent manual installation is:

```bash
claude plugin marketplace add https://github.com/newbdez33/freee-mcp.git
claude plugin install freee@freee-tools --scope user
```

Run `/reload-plugins` in an existing Claude Code session, or start a new session from any directory. The plugin loads both the local STDIO MCP server and the freee Skill at user scope; users never need to open Claude Code from this repository. Run `/mcp` to inspect the connection.

For first-time Playwright authentication, ask Claude to check freee authentication. If credentials are missing, it returns an installation-specific command. Run that exact command yourself in a local interactive terminal. The command hides the username and password while saving them to System Keychain. MCP installation and approval never receive freee credentials.

### Update an existing installation

For this private marketplace, explicit updates are the reliable default. Copy this prompt into Claude Code when an update is wanted:

```text
Update my installed freee@freee-tools Claude Code plugin and its private marketplace, then reload plugins and verify the freee MCP connection. Preserve plugin data, System Keychain credentials, and the external Playwright profile. Do not clone the source repository into my current project and do not perform any real freee punch or approval action.
```

The equivalent manual update is:

```bash
claude plugin marketplace update freee-tools
claude plugin update freee@freee-tools --scope user
```

Then run `/reload-plugins`. Claude Code switches the MCP and Skill to the new cached plugin version without requiring a repository checkout or a new MCP registration. System Keychain entries, persistent plugin data, and the external `~/.freee-agent/playwright-profile` survive normal plugin updates.

Plugin releases use semantic versions. Maintainers must bump `package.json` and `.claude-plugin/plugin.json` together; the test suite enforces that they match. Users remain on the last installed version until an explicit update succeeds.

## Design decisions

- `FREEE_BACKEND=api|playwright` explicitly selects the backend for every business operation. Only `auto` selects a backend by detecting an existing API configuration.
- A backend failure is final for that operation. The system never falls back to the other backend.
- MCP is the primary business-operation interface for Codex and Claude Code, providing tool discovery, input schemas, read-only annotations, and client-side write approval prompts.
- The CLI remains the deterministic local interface for OAuth setup, System Keychain configuration, and troubleshooting.
- MCP and CLI call the same `FreeeService`; authentication, business rules, and backend selection are not duplicated.
- One shared Agent Skill directs Codex and Claude Code to prefer MCP and use the CLI only when MCP is unavailable or local setup is required. An error must never be bypassed by switching interfaces.
- The Playwright backend stores the freee username and password in System Keychain and fills them only on the expected official freee login page.
- The legacy `freee-checkin` project informed the login flow and selectors, but this project does not reuse its `.env` password, force clicks, environment-variable logging, or unconfirmed scheduled writes.

## Development quick start

```bash
npm ci
npm test
```

End users do not use this checkout at runtime. For local plugin development, load the repository explicitly for one Claude Code session:

```bash
claude --plugin-dir /absolute/path/to/freee-mcp
```

The repository keeps `.codex/config.toml` for Codex development. The Claude plugin manifest is `.claude-plugin/plugin.json`; its marketplace is `.claude-plugin/marketplace.json`. The plugin resolves its own cached path and persistent data directory, so neither Claude Code nor MCP depends on the user's current working directory.

The Codex configuration uses `default_tools_approval_mode = "writes"`: read-only tools can run directly, while the two commit tools still trigger client approval. Independently of the client prompt, the server validates `confirm: true`, the preview fingerprint, and the current freee state.

## MCP tools

| MCP tool | Type | Purpose |
| --- | --- | --- |
| `freee_backend_status` | Read-only | Show the exclusively selected backend |
| `freee_auth_status` | Read-only | Verify authentication without returning credentials |
| `freee_me` | Read-only | Read the current user and company identities on the API backend |
| `freee_clock_status` | Read-only | Show currently available punch actions |
| `freee_clock_prepare_action` | Read-only preview | Generate a punch preview and fingerprint |
| `freee_clock_commit_action` | Write | Revalidate the fingerprint and create one real punch |
| `freee_team_status` | Read-only | Read a department or current web-management monthly summary |
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

Installed Claude Code users should use MCP from any directory. When local interactive setup is required, the MCP or installed Skill provides an absolute plugin-resolved command. The `npm run freee --` commands below are for maintainers working in a source checkout.

```bash
# Read-only
npm run freee -- backend status
npm run freee -- auth status
npm run freee -- me
npm run freee -- clock status
npm run freee -- team status
npm run freee -- approvals list
npm run freee -- approvals list --status all
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

# Employee applications: prepare first, then commit only after explicit review and approval
npm run freee -- approvals prepare-action --id APPLICATION_NO --action approve|return
npm run freee -- approvals commit-action --id APPLICATION_NO \
  --action approve|return --fingerprint PREVIEW_SHA256 --confirm
```

Commands emit JSON and identify the selected business backend. Before a real punch, the service rechecks the available action using the same backend. Before an application action, it rereads the complete detail and requires the SHA-256 fingerprint to match the read-only preview. An unavailable action, changed detail, ambiguous page, or missing confirmation stops before an API POST or browser click.

MCP and CLI writes follow the same safety model. Every real action must start with a prepare tool or command that shows the target, action, content, and fingerprint. A commit is allowed only after the user approves that exact action in a new current message. Development requests, testing, messages such as “continue” or “handle it,” and approval from an earlier message do not count. An unknown write result is never retried automatically.

The API implementation of `team status` is complete and tested, but the `attendance_manager` role used at GCU cannot read employee memberships through the Public API. The API backend returns the permission error and does not fall back to Playwright.

The Playwright backend supports System Keychain credentials, persistent login, personal punch status and actions, department monthly attendance summaries, and employee application list/detail/approval/return. It enters the Employee Portal from the freee home page, reads personal punch controls, reads visible members, closing applications, attendance issues, and monthly work totals from the attendance list, and processes authorized applications through the application approval workflow. The browser profile stays outside the repository.

## Employee application handling

`approvals list` defaults to pending applications. `--status returned|approved|all` reads other states. `approvals detail --id` returns the list summary, application fields, approval route, department, comments, and freee automatic-check results. Both commands are read-only.

A single application write has two separate steps:

1. `approvals prepare-action` reads the current full detail, verifies that the requested button is available, and returns a preview and content fingerprint without clicking a business control.
2. The agent may call `approvals commit-action ... --confirm` with the same application number, action, and fingerprint only after the user reviews the applicant, type, target date, content, reason, and automatic checks and explicitly requests approval or return in the current message.

Before committing, the CLI rereads the detail. A fingerprint mismatch, missing button, application processed by someone else, or new comment stops the operation and requires a new preview. Batch approval is not supported, and development tests never perform real approvals or returns.

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

When MCP first discovers that web credentials are missing, `freee_auth_status` or another tool returns the local setup command. The agent may only show that command to the user; it must never request or collect the username or password in chat.

The persistent browser profile defaults to `~/.freee-agent/playwright-profile` and is restricted to the current user. The CLI rejects a profile configured inside the repository.

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
