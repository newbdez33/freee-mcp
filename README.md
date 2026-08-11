# freee MCP + CLI + Agent Skill

本项目为 Codex 和 Claude Code 提供安全、可测试的 freee 勤怠操作能力。业务逻辑集中在同一个 Core Service，上层同时提供本地 STDIO MCP Server、CLI 和 Agent Skill；底层支持两个互斥后端：Public API 或受控 Playwright。

## 已确认的方向

- `FREEE_BACKEND=api|playwright` 显式选择所有业务操作使用的后端；`auto` 才按 API 配置是否存在自动判断。
- 任一后端失败时都直接报错，不回退到另一个后端。
- MCP 是 Codex 和 Claude Code 的主要业务操作入口，提供标准工具发现、输入 Schema、只读标记和写操作审批提示。
- CLI 保留为确定性的人工入口，并负责 OAuth、System Keychain、1Password 迁移等本地初始化工作。
- MCP 与 CLI 调用同一个 `FreeeService`，不重复实现认证、业务规则或后端选择。
- 同一份 Agent Skill 指导 Codex 和 Claude Code 优先使用 MCP，并在 MCP 不可用时安全使用 CLI；失败后不得切换入口绕过限制。
- Playwright 分支把 freee 登录账号和密码保存在 System Keychain，只在预期的 freee 登录页自动填写。
- 参考旧 `freee-checkin` 的 Playwright 登录和选择器经验，但不复用其 `.env` 密码、强制点击、环境变量日志和无确认定时写入。

## 快速开始

```bash
npm install
npm run build
npm test
```

项目已包含两个项目级 MCP 配置：

- Codex：`.codex/config.toml`
- Claude Code：`.mcp.json`

它们都以 `node dist/mcp-entry.js` 启动本地 STDIO Server，因此首次使用前必须完成构建，并从本项目根目录打开 Codex 或 Claude Code。Codex 重新打开任务后会读取项目配置；Claude Code 首次发现 `.mcp.json` 时会要求用户批准该项目 Server。

Codex 配置采用 `default_tools_approval_mode = "writes"`：只读工具可以直接使用，两个 commit 工具仍会触发客户端审批。无论客户端是否弹窗，服务端都还会检查 `confirm: true`、预览指纹和 freee 当前状态。

## MCP 工具

| MCP 工具 | 类型 | 用途 |
| --- | --- | --- |
| `freee_backend_status` | 只读 | 查看当前独占后端 |
| `freee_auth_status` | 只读 | 验证认证状态，不返回凭据 |
| `freee_me` | 只读 | API 后端读取本人和公司身份 |
| `freee_clock_status` | 只读 | 查看当前允许的打卡动作 |
| `freee_clock_prepare_action` | 只读预览 | 生成打卡预览和指纹 |
| `freee_clock_commit_action` | 写入 | 复核指纹后执行一次真实打卡 |
| `freee_team_status` | 只读 | 查询部门或当前网页管理范围的月度简况 |
| `freee_approvals_list` | 只读 | 查询待处理、已承认、已差戻し或全部申请 |
| `freee_approval_detail` | 只读 | 查询单件申请完整详情 |
| `freee_approval_prepare_action` | 只读预览 | 生成承认或差戻し预览和指纹 |
| `freee_approval_commit_action` | 写入 | 复核指纹后执行单件承认或差戻し |

MCP Server 也可以手动启动：

```bash
npm run mcp
```

这是 STDIO 协议进程，正常使用时由客户端启动，不需要单独保持终端窗口。

## CLI 命令

```bash
# 只读
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

# 凭据迁移（会写入 System Keychain）
npm run freee -- auth migrate-to-system --confirm
npm run freee -- browser migrate-from-1password --confirm

# 没有 1Password 时，在本地交互终端隐藏配置 Playwright 账号密码
npm run freee -- browser configure --confirm

# 真实写入：只有用户明确要求对应动作时才可使用 --confirm
npm run freee -- clock in --confirm
npm run freee -- clock break-start --confirm
npm run freee -- clock break-end --confirm
npm run freee -- clock out --confirm

# 员工申请：先生成只读预览；只有用户核对并明确要求后，才执行第二条写命令
npm run freee -- approvals prepare-action --id APPLICATION_NO --action approve|return
npm run freee -- approvals commit-action --id APPLICATION_NO \
  --action approve|return --fingerprint PREVIEW_SHA256 --confirm
```

命令统一输出 JSON 并标记实际业务后端。真实打卡前会通过同一后端再次检查可用动作；员工申请处理还会重新读取完整详情，并要求与只读预览一致的 SHA-256 指纹。动作不允许、详情变化、页面不明确或缺少 `--confirm` 时，CLI 会在 API POST 或网页点击前停止。

MCP 与 CLI 的写操作具有同一安全语义。任何真实动作都必须先调用 prepare 工具/命令，把对象、动作、内容和指纹展示给用户；只有用户在新的当前消息中明确批准该精确动作后，才能调用 commit。开发、测试、“继续”、“处理一下”或历史消息中的授权都不算确认。未知写入结果不得自动重试。

现有 API 版 `team status` 已完成代码和测试，但在株式会社GCU的 `attendance_manager` 角色下无法读取员工所属。API 分支会明确返回权限错误，不会回退到 Playwright。

Playwright 已实现 System Keychain 凭据、持久登录、个人打卡状态/动作、部门月度勤怠汇总，以及员工申请的列表、详情、承认和差戻し。它通过 freee 首页进入 Employee Portal 读取本人打刻按钮，通过“勤怠一覧”读取当前可见管理范围内的成员、締め申請、不备和月度工时，并通过“申请 → 承认”处理当前账号有权处理的申请。浏览器 profile 位于仓库外。

## 员工申请处理

`approvals list` 默认只返回当前待处理申请；`--status returned|approved|all` 可读取其他状态。`approvals detail --id` 会返回列表摘要、申请字段、承认路径、所属部门、评论和 freee 自动检查结果。列表和详情都是只读命令。

单件写操作分为两个独立步骤：

1. `approvals prepare-action` 读取当下完整详情，确认对应按钮确实可用，并返回预览与内容指纹，不点击任何业务按钮。
2. 用户核对申请人、种别、对象日期、内容、理由和自动检查结果，并在当前消息中明确要求承认或差戻し后，Agent 才可把同一个编号、动作和指纹交给 `approvals commit-action ... --confirm`。

执行前 CLI 会重新读取详情。指纹不一致、按钮消失、申请已被其他人处理或详情含新评论时都会停止并要求重新预览。当前不支持批量承认，也不会在开发测试中执行真实承认或差戻し。

## 后端选择

后端按以下优先级一次性确定，运行中不混用：

1. `FREEE_BACKEND=api`：只使用 API。
2. `FREEE_BACKEND=playwright`：只使用 Playwright，即使本地仍有 API 配置也忽略它。
3. 未设置或 `FREEE_BACKEND=auto`：存在 API 配置时选 `api`，否则选 `playwright`。

当前项目的 `.env` 已设置为：

```dotenv
FREEE_BACKEND=playwright
FREEE_BROWSER_HEADLESS=true
```

`.env` 只能保存这类非敏感开关，不能保存账号、密码、Token 或 Client Secret。

## API 分支凭据

CLI 支持三种凭据后端：

- `system`：默认推荐，Client Secret 与 OAuth Token 都使用 macOS Keychain、Windows Credential Manager 或 Linux 系统 keyring。
- `1password`：可选的 Client Secret 来源；OAuth Token 默认仍写入 System Keyring，减少桌面授权提示。
- `environment`：用于 CI、服务器或临时 Access Token；不自动轮换 Refresh Token。

普通配置保存在 `.freee/oauth.json`，其中只包含 Client ID、回调地址和后端类型，不包含 Client Secret 或 Token。

### System Keyring（推荐）

```bash
npm run freee -- auth configure --store system --client-id YOUR_CLIENT_ID --confirm
```

命令会在交互式终端中隐藏输入 Client Secret。Client Secret 和整组 OAuth Token 保存到操作系统凭据库；Access Token 与一次性 Refresh Token 作为一个值更新。

### 1Password（可选）

准备包含 `client id` 和 `Client Secret` 字段的项目，然后运行。只有 Client Secret 从 1Password 读取，OAuth Token 写入 System Keyring：

```bash
npm run freee -- auth configure --store 1password \
  --token-store system --service freee-agent \
  --vault Private --client-item freee --confirm
```

此模式的普通 API 调用只读取 Keychain；只有 OAuth 登录或 Token 刷新需要再次读取 1Password Client Secret。没有 1Password 的用户直接使用上面的 System Keyring 模式即可。

已采用 1Password Client Secret + System Keyring Token 的用户，可以执行一次无明文迁移：

```bash
npm run freee -- auth migrate-to-system --confirm
```

CLI 会在内部读取现有 Client ID/Secret，写入并回读验证 System Keyring，最后才切换普通配置。现有 System Keyring Token 不会重写；若旧 Token 也在 1Password，则会先复制并验证。旧 1Password 项不会自动删除，迁移过程中也不会输出凭据。

旧版 `op://Private/freee/API KEY` Access Token 读取方式仍保留用于迁移，但不再是新用户的默认要求。

### Environment（CI / 临时模式）

由 CI Secret、容器 Secret 或父进程注入 `FREEE_ACCESS_TOKEN`，然后运行：

```bash
npm run freee -- auth configure --store environment --confirm
```

环境变量后端不能安全持久化 freee 每次返回的新 Refresh Token，因此不提供 OAuth 登录或自动刷新。不要把真实 Token 写进仓库中的 `.env`。

如果 1Password CLI 等待桌面授权，请先解锁 1Password 并允许命令行集成。

## OAuth 自动续期

先在 freee 开发应用的回调 URL 中设置与命令完全一致的地址：

```text
http://127.0.0.1:48181/callback
```

然后在用户本人在场、明确同意授权时运行：

```bash
npm run freee -- auth configure --store system --client-id YOUR_CLIENT_ID --confirm
npm run freee -- auth login --confirm
npm run freee -- auth status
```

`auth login` 会打开 freee 的官方授权页面、验证本机回调的随机 `state`，然后把 Token 写入 System Keyring。

授权完成后，CLI 会在 Access Token 即将过期时自动刷新；API 返回 401 时也只刷新并重试一次。freee 的 Refresh Token 是一次性的，每次刷新后会把新 Access Token 和新 Refresh Token 一起保存。跨进程锁防止两个 Agent 同时消费同一枚 Refresh Token。

本地 `.freee/oauth.json` 不含任何 Token 或 Secret，并已被 Git 忽略。

## Playwright 分支凭据

如果账号密码已经在标准 1Password Login 项目中，可直接进行一次内部迁移：

```bash
npm run freee -- browser migrate-from-1password \
  --vault Private --item freee --confirm
npm run freee -- browser credentials-status
```

CLI 只提取 Login 项目的 username/password 字段，作为一个值写入 `freee-agent-web` System Keychain 条目并回读验证。终端不会输出账号或密码，源 1Password 项不会被修改或删除。

没有 1Password 的用户可以直接在本地交互终端运行：

```bash
npm run freee -- browser configure --confirm
```

命令会隐藏读取账号、密码和第二次密码确认，作为一个凭据写入并回读验证 System Keychain；输出不包含账号或密码。它不接受账号密码命令行参数，也不从 `.env`、MCP 或聊天读取凭据。

配置完成后进行一次可见浏览器登录：

```bash
FREEE_BROWSER_HEADLESS=false npm run freee -- browser status
```

Playwright 只在验证为 `accounts.secure.freee.co.jp` 后自动填写，并只允许主页面进入 `p.secure.freee.co.jp` 与 `ep.secure.freee.co.jp`。MFA、CAPTCHA 和异常登录确认由用户在这个可见浏览器中完成。成功后的 Session 保存到仓库外的持久 profile，后续可以恢复 `FREEE_BROWSER_HEADLESS=true`。

如果 MCP 在首次查询时发现没有网页凭据，`freee_auth_status` 或其他工具会返回上述本地配置命令。Agent 只能把命令展示给用户执行，不得在对话中询问或代收账号密码。

持久浏览器 profile 默认位于 `~/.freee-agent/playwright-profile`，权限为当前用户独享；配置到仓库内部会被 CLI 拒绝。

## Agent Skill

Skill 的唯一来源位于 `skills/freee`：

- Codex：`.agents/skills/freee` 链接到同一份 Skill。
- Claude Code：`.claude/skills/freee` 链接到同一份 Skill。

这样两个客户端共享相同的 MCP 工具映射、CLI 初始化说明和安全规则。业务操作优先通过 MCP 完成；认证配置、凭据迁移和 MCP 故障诊断继续使用 CLI。

## 文档

- [架构决策：使用 CLI + Agent Skill（历史基础）](docs/decisions/0001-cli-and-agent-skill.md)
- [架构决策：API 或 Playwright 互斥双后端](docs/decisions/0002-api-or-playwright-exclusive-backends.md)
- [架构决策：增加本地 MCP 适配层](docs/decisions/0003-local-mcp-adapter.md)
- [freee 人事労務 API 能力清单](docs/freee-hr-api-capabilities.md)
- [后续开发清单](TODO.md)
