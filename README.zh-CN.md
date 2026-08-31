# freee MCP + CLI + Agent Skill

[English](README.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md)

本项目让 Claude Code、Codex、OpenCode、Pi 及其他本地编程 Agent 能够安全、可测试地操作 freee 人事劳务的考勤流程。业务逻辑集中在同一个核心服务中，并通过本地 STDIO MCP Server、CLI 和共享 Agent Skill 提供。核心支持两个互斥后端：freee Public API，或受控的 Playwright 浏览器自动化。

## 通过编程 Agent 安装

正在使用 Claude Code、Codex、Pi、OpenCode 或其他本地编程 Agent？请把下面这段提示复制给它：

```text
请从 https://github.com/newbdez33/freee-mcp 为你当前所在的编程 Agent 安装 freee MCP 及其 Agent Skill。先判断当前是 Claude Code、Codex、Pi、OpenCode 还是其他 Agent，再按照 README 中对应的用户级安装方式操作。优先使用 Agent 原生的插件或包管理器；否则注册文档中的可移植 STDIO MCP 命令，并把 skills/freee 安装到该 Agent 的全局 Skill 目录。不要要求我克隆仓库、从仓库目录启动 Agent，或添加项目级配置。绝不要让我在聊天或命令参数中粘贴 freee 用户名、密码、Client Secret 或 Token。缺少凭据时，只显示 MCP 或配套 CLI 返回的、用于本地 System Keychain 配置的准确命令。安装期间只验证只读认证和工具发现，不要执行真实打卡或审批。
```

本仓库是公开的。用户不需要 GitHub 账号或本地工作副本：所选 Agent 会自行管理插件、包或 npm 缓存。安装后的工具和 Skill 位于用户级作用域，可从任意项目目录使用。

### Claude Code

Claude Code 通过原生插件市场同时安装 MCP 和 Skill：

```bash
claude plugin marketplace add https://github.com/newbdez33/freee-mcp.git
claude plugin install freee@freee-tools --scope user
```

在已有 Claude Code 会话中执行 `/reload-plugins`，或从任意目录启动新会话。插件会在用户级加载本地 STDIO MCP Server 和 freee Skill；用户不需要从本仓库启动 Claude Code。可用 `/mcp` 检查连接。

首次进行 Playwright 认证时，让 Claude 检查 freee 认证状态。缺少凭据时，它会返回与当前安装方式匹配的命令。请自行在本地交互式终端直接运行该准确命令。命令会隐藏用户名和密码输入，并将其保存到 System Keychain；MCP 安装和批准流程不会接触 freee 凭据。

#### 更新 Claude Code

默认要求显式更新，避免用户不知情时更换考勤操作代码。需要更新时，把下面提示复制给 Claude Code：

```text
请更新我已安装的 freee@freee-tools Claude Code 插件及其 marketplace，然后重新加载插件并验证 freee MCP 连接。保留插件数据、System Keychain 凭据和外部 Playwright profile。不要手动克隆源码仓库，也不要执行任何真实 freee 打卡或审批。
```

等效的手动更新命令为：

```bash
claude plugin marketplace update freee-tools
claude plugin update freee@freee-tools --scope user
```

随后执行 `/reload-plugins`。Claude Code 会将 MCP 和 Skill 切换到新的缓存版本，无需仓库副本或重新注册 MCP。正常插件更新不会删除 System Keychain 条目、持久插件数据或外部 `~/.freee-agent/playwright-profile`。

插件发布采用语义化版本。维护者必须同时更新 `package.json` 和 `.claude-plugin/plugin.json`，测试套件会强制校验二者一致。显式更新成功前，用户会继续使用已安装的旧版本。

### Codex

Codex 使用 Skill installer 安装 `skills/freee`，并在用户级注册下面这个固定版本、可移植的 STDIO 命令：

```bash
codex mcp add freee -- npx --yes --package='github:newbdez33/freee-mcp#v0.4.2' freee-mcp
```

开头的安装提示会让 Codex 完成这两个步骤。如果新 Skill 没有立即被发现，请重启 Codex，然后通过 `/mcp` 验证 Server 连接。

### OpenCode 和其他 MCP 客户端

通过客户端设置或 MCP 安装器，把下面命令注册为用户级 STDIO MCP：

```bash
npx --yes --package='github:newbdez33/freee-mcp#v0.4.2' freee-mcp
```

将本仓库的 `skills/freee` 安装到客户端的全局 Agent Skills 目录。OpenCode 识别 `~/.agents/skills/freee`；其他兼容 Agent Skills 的客户端可能使用不同的用户级目录。开头的安装提示会让当前 Agent 选择正确位置，不会创建项目文件。

### Pi

把仓库安装为用户级 Pi package：

```bash
pi install git:github.com/newbdez33/freee-mcp
```

Pi 会加载包内的 `skills/freee`。如果当前 Pi 环境没有 MCP 扩展，Skill 会使用包内配套 CLI；它调用同一个核心服务，并执行相同的写操作确认规则。

### 更新已有安装

把下面提示复制给负责该安装的 Agent：

```text
请使用你当前所在编程 Agent 的更新机制，从 https://github.com/newbdez33/freee-mcp 更新我的用户级 freee 安装。Claude Code 需要更新 freee-tools 和 freee@freee-tools，然后重新加载插件。Codex、OpenCode 或其他可移植 MCP 安装需要更新 MCP 命令中固定的 GitHub Release tag，并刷新全局 skills/freee。Pi 需要更新已安装的 Pi package。保留 ~/.freee-agent、Claude 插件数据、System Keychain 凭据和外部 Playwright profile。重启或重新加载 Agent，只验证只读 MCP 连接或 CLI 状态。不要手动克隆源码仓库，也不要执行任何真实 freee 打卡或审批。
```

Pi 的等效手动更新命令是 `pi update`。可移植 MCP 安装会刻意固定 Release tag；更新只替换 MCP 注册和 Skill 中的代码版本，凭据与浏览器状态始终位于包缓存之外。

## 设计决策

- `FREEE_BACKEND=api|playwright` 为每次业务操作明确选择后端；只有 `auto` 会根据现有 API 配置自动选择。
- 后端失败就是该操作的最终结果，系统绝不会回退到另一个后端。
- 对支持 MCP 的 Agent，MCP 是主要业务入口，并提供工具发现、输入 Schema、只读标记及客户端写操作审批提示。
- CLI 保留为 OAuth 设置、System Keychain 配置和故障排查的确定性本地入口。
- MCP 与 CLI 调用同一个 `FreeeService`，认证、业务规则和后端选择不会重复实现。
- 共享 Agent Skill 要求支持的 Agent 优先使用 MCP；仅在 MCP 不可用或需要本地配置时使用 CLI。发生错误后不得切换入口绕过错误。
- Playwright 后端把 freee 用户名和密码保存在 System Keychain 中，并且只会在确认是 freee 官方登录页面后填写。
- 旧 `freee-checkin` 项目为登录流程和选择器提供了参考，但本项目不会复用其中的 `.env` 密码、强制点击、环境变量日志或未确认的定时写入。

## 业务能力状态

下表描述当前 `main` 分支。“已覆盖”表示行为和安全停止条件具备自动化单元或协议测试，并不代表已经对真实 freee 执行写操作。真实环境证据单独记录在[真实验收清单](docs/live-validation-checklist.md)，计划中的实现工作保留在 [TODO.md](TODO.md)。

| 业务能力 | 后端 | 实现状态 | 自动测试 | 真实 freee 验收 |
| --- | --- | --- | --- | --- |
| 后端选择与认证状态 | API + Playwright | 完成；一次操作只选择一个后端 | 已覆盖 | API OAuth/System Keyring 与 Playwright System Keychain/headless 登录已验证 |
| 当前用户与公司身份 | API | 完成；Playwright 身份查询未实现 | 已覆盖 | API 路径已验证 |
| 当前打卡状态和可用操作 | API + Playwright | 完成 | 已覆盖 | 两个只读路径均已验证 |
| 上班、休息开始/结束、下班 | API + Playwright | 完成；只支持当前时间打卡 | 已覆盖，包括确认与旧状态拒绝 | 真实写入待验收（`LV-W01`、`LV-W02`） |
| 本人月次状态、警告和勤務月导航 | Playwright | 完成 | 已覆盖 | 当前月份状态/警告和跨月导航已验证；其余状态变体待验收（`LV-R04`） |
| 独立的本人月度汇总及缺勤/迟到/早退详细异常 | API + Playwright | 未实现；日历警告和管理员汇总只提供部分信息 | — | — |
| 提交本人月次締め申请 | Playwright | 完成，使用 prepare/commit 指纹 | 已覆盖 | 待验收（`LV-W03`） |
| 撤回待处理的本人月次締め申请 | Playwright | 完成，使用 prepare/commit 指纹 | 已覆盖 | 待验收（`LV-W04`） |
| 探测已启用的本人申请与休假类型 | Playwright | 完成 | 已覆盖 | 全日、定时半休、特别休假及修正表单变体已验证 |
| 本人申请的列表、筛选、分页和详情 | Playwright | 完成 | 已覆盖 | pending/returned/approved/all 及准确详情已验证；第 2 页待验收（`LV-R03`） |
| 创建休假申请 | Playwright | 完成，包括显式的定时休假范围 | 已覆盖 | 已验证（`LV-W05`） |
| 创建勤務時間修正 | Playwright | 部分支持：一段工作时间和一组可选完整休息时间 | 已覆盖 | 只读表单变体已验证；真实写入待验收（`LV-W06`） |
| 创建加班申请 | Playwright | 未实现；未启用或未验证的表单会安全停止 | 安全拒绝路径已覆盖 | 当前验收账号未启用该表单 |
| 撤回待处理的本人申请 | Playwright | 完成，使用 prepare/commit 指纹 | 已覆盖 | 已验证（`LV-W07`） |
| 取消已批准的本人申请 | Playwright | 完成；会创建并验证一条独立的取消申请 | 已覆盖 | 已验证至最终批准（`LV-W09`） |
| 部门月度考勤和问题汇总 | Playwright | 完成，范围为当前页面可见的管理范围 | 已覆盖 | 当前月份汇总和日期不匹配停止条件已验证 |
| 通过 Public API 查询部门每日打卡状态 | API | 已实现，但受角色权限限制 | 已覆盖 | 已验证 `attendance_manager` 的预期拒绝；具备权限角色的成功路径待验收（`LV-R08`） |
| 指定日期的员工打卡明细 | Playwright | 未实现 | — | — |
| 递归汇总子部门 | Playwright | 未实现 | — | — |
| 管理员申请的列表、筛选、分页和详情 | Playwright | 完成 | 已覆盖 | 筛选、分页、准确详情和已处理历史均已验证 |
| 批准单条一般员工申请 | Playwright | 完成，使用 prepare/commit 指纹 | 已覆盖 | 已验证，包括写后详情复核 |
| 差戻し单条一般员工申请 | Playwright | 完成，使用 prepare/commit 指纹 | 已覆盖 | 已验证（`LV-W08`） |
| 月次締め申请列表与完整审阅 | Playwright | 完成，包括成员汇总、逐日记录、警告、检查及已验证的月份导航 | 已覆盖 | 已验证历史批准记录的完整审阅；自然待处理申请的跨月导航与 prepare 指纹仍待验收（`LV-R11`） |
| 批准或差戻し单条月次締め申请 | Playwright | 完成，使用绑定完整审阅内容的专用指纹 | 已覆盖 | 待验收（`LV-W10`） |
| 删除已退回或草稿状态的本人申请 | Playwright | 未实现 | — | — |
| 批量审批/修改和审计日志 | Playwright | 未实现 | — | — |

## 开发快速开始

```bash
npm ci
npm test
npm run validate
npm run package:smoke
```

最终用户运行时不使用本仓库副本。本地开发插件时，可为单次 Claude Code 会话显式加载仓库：

```bash
claude --plugin-dir /absolute/path/to/freee-mcp
```

仓库中的 `.codex/config.toml` 用于 Codex 开发配置。Claude 插件清单是 `.claude-plugin/plugin.json`，marketplace 是 `.claude-plugin/marketplace.json`。插件会自行解析缓存路径和持久数据目录，因此 Claude Code 与 MCP 都不依赖用户当前工作目录。

Codex 配置使用 `default_tools_approval_mode = "writes"`：只读工具可直接运行，commit 工具仍会触发客户端审批。无论客户端是否提示，Server 都会独立校验 `confirm: true`、预览指纹和当前 freee 状态。

### 维护者发布流程

每个 Pull Request 和对 `main` 的 push 都会运行测试、校验 Claude 插件与规范 Agent Skill、扫描 Git 历史中的 Secret，并从隔离 npm 缓存启动打包后的 CLI 和 MCP。GitHub Action 依赖固定到完整 commit SHA。

发布只能从仓库 `main` 分支显式触发：

1. 将 `package.json`、`package-lock.json`、`.claude-plugin/plugin.json` 和三份 README 中可移植命令的 `#v...` 更新为同一个语义化版本。
2. CI 通过后合并版本变更。
3. 在 GitHub Actions 中从 `main` 运行 `Release` workflow，并输入不带 `v` 的版本号。

该 workflow 会重复全部校验，在当前 `main` commit 创建或确认带注释的 `vVERSION` tag，根据已合并内容生成英文 Release notes，并附上可移植包及其 SHA-256 校验和。它不会发布到 npm，也不会接收任何 freee 凭据。

## MCP 工具

| MCP 工具 | 类型 | 用途 |
| --- | --- | --- |
| `freee_backend_status` | 只读 | 显示 MCP 版本和唯一选定的后端 |
| `freee_auth_status` | 只读 | 验证认证状态，不返回凭据 |
| `freee_me` | 只读 | 在 API 后端读取当前用户和公司身份 |
| `freee_clock_status` | 只读 | 显示当前可用打卡操作 |
| `freee_clock_prepare_action` | 只读预览 | 生成打卡预览和指纹 |
| `freee_clock_commit_action` | 写入 | 重新校验指纹并创建一次真实打卡 |
| `freee_team_status` | 只读 | 读取部门或当前网页管理范围的月度汇总 |
| `freee_monthly_status` | 只读 | 读取指定或当前选中的本人 `月次勤怠締め` 月份 |
| `freee_monthly_prepare_action` | 只读预览 | 生成月次提交或撤回的预览和指纹 |
| `freee_monthly_commit_action` | 写入 | 重新校验指纹并提交或撤回一条月次申请 |
| `freee_personal_application_options` | 只读 | 显示已启用的本人申请类型和指定日期休假类型 |
| `freee_personal_applications_list` | 只读 | 列出当前员工 pending、returned、approved 或全部申请 |
| `freee_personal_application_detail` | 只读 | 读取当前员工单条申请及其可用操作 |
| `freee_personal_application_prepare_create` | 只读预览 | 填写并验证休假或勤務時間修正表单，生成指纹 |
| `freee_personal_application_commit_create` | 写入 | 重新校验并提交一条本人申请 |
| `freee_personal_application_prepare_cancel` | 只读预览 | 验证对已批准本人申请的取消操作并生成指纹 |
| `freee_personal_application_commit_cancel` | 写入 | 重新校验并为已批准申请创建一条取消申请 |
| `freee_personal_application_prepare_withdraw` | 只读预览 | 为待处理本人申请生成撤回预览和指纹 |
| `freee_personal_application_commit_withdraw` | 写入 | 重新校验并撤回待处理本人申请 |
| `freee_approvals_list` | 只读 | 列出 pending、approved、returned 或全部申请 |
| `freee_monthly_approvals_list` | 只读 | 从单页管理员申请中只列出 `月次勤怠締め` |
| `freee_monthly_approval_review` | 只读 | 审阅单条月次申请及申请人的汇总、逐日考勤、警告和自动检查 |
| `freee_monthly_approval_prepare_action` | 只读预览 | 将完整月次审阅和批准/差戻し操作绑定为指纹 |
| `freee_monthly_approval_commit_action` | 写入 | 重新校验完整审阅并批准或差戻し单条月次申请 |
| `freee_approval_detail` | 只读 | 读取单条申请的完整详情，包括受支持勤務时间修正的修改前/后结构化对照 |
| `freee_approval_prepare_action` | 只读预览 | 生成批准或差戻し预览和指纹 |
| `freee_approval_commit_action` | 写入 | 重新校验指纹并批准或差戻し单条申请 |

MCP Server 也可以手动启动：

```bash
npm run mcp
```

它是 STDIO 协议进程。正常使用时由客户端自动启动，不需要单独保持一个终端窗口。

## 源码开发 CLI 命令

安装用户应在 Agent 支持 MCP 时从任意目录使用 MCP。需要本地交互配置时，MCP 或已安装 Skill 会提供按包解析的绝对命令。下面的 `npm run freee --` 仅供维护者在源码工作副本中使用。

```bash
# 只读
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
npm run freee -- monthly-approvals list --status pending|returned|approved|all --page 1
npm run freee -- monthly-approvals review --id APPLICATION_NO
npm run freee -- browser status
npm run freee -- browser credentials-status

# 在 System Keychain 中安全配置 Playwright 凭据
npm run freee -- browser configure --confirm

# 真实写入：只有用户明确要求该准确操作时才使用 --confirm
npm run freee -- clock in --confirm
npm run freee -- clock break-start --confirm
npm run freee -- clock break-end --confirm
npm run freee -- clock out --confirm

# 月次考勤：先 prepare，明确审阅并批准后才能 commit
npm run freee -- monthly prepare-action --action submit|withdraw --period YYYY-MM
npm run freee -- monthly commit-action --action submit|withdraw \
  --period YYYY-MM --fingerprint PREVIEW_SHA256 --confirm

# 当前员工申请：先检查选项，再 prepare、审阅和 commit
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
npm run freee -- requests prepare-cancel --id APPLICATION_NO [--reason "REASON"]
npm run freee -- requests commit-cancel --id APPLICATION_NO [--reason "REASON"] \
  --fingerprint PREVIEW_SHA256 --confirm
npm run freee -- requests prepare-withdraw --id APPLICATION_NO
npm run freee -- requests commit-withdraw --id APPLICATION_NO \
  --fingerprint PREVIEW_SHA256 --confirm

# 员工申请：先 prepare，明确审阅并批准后才能 commit
npm run freee -- approvals prepare-action --id APPLICATION_NO --action approve|return
npm run freee -- approvals commit-action --id APPLICATION_NO \
  --action approve|return --fingerprint PREVIEW_SHA256 --confirm

# 月次审批：先完整审阅，得到准确批准后才能 commit
npm run freee -- monthly-approvals prepare-action \
  --id APPLICATION_NO --action approve|return
npm run freee -- monthly-approvals commit-action \
  --id APPLICATION_NO --action approve|return \
  --fingerprint PREVIEW_SHA256 --confirm
```

命令输出 JSON，并标明选定的业务后端。真实打卡前，服务会使用同一后端重新检查可用操作；申请操作前，会重新读取完整详情并要求 SHA-256 指纹与只读预览一致。操作不可用、详情变化、页面有歧义或缺少确认时，都会在 API POST 或浏览器点击前停止。如果 commit 没有返回完整 JSON envelope，应把结果视为未知，绝不能重试写入；请通过对应的只读状态、列表或详情命令核验准确对象。

MCP 和 CLI 写操作遵循同一安全模型。每个真实操作都必须先用 prepare 工具或命令显示对象、动作、内容和指纹。只有用户在新的当前消息中批准该准确操作后才能 commit。开发、测试、“继续”“处理一下”等请求以及更早消息中的批准都不算有效确认。结果未知的写操作绝不能自动重试。

API 版 `team status` 已实现并通过自动测试，但 GCU 使用的 `attendance_manager` 角色无法通过 Public API 读取员工归属。API 后端会返回权限错误，不会回退到 Playwright。

Playwright 后端支持 System Keychain 凭据、持久登录、本人打卡状态与操作、本人月次提交/撤回、本人申请列表/详情/休假/勤務時間修正/撤回/已批准申请取消、部门月度汇总、一般员工申请处理以及专用月次审阅/批准/差戻し。它会从 freee 首页进入 Employee Portal，读取本人打卡控件、可见成员、締め申请、考勤问题、月度工时和单个申请人的准确逐日考勤表，并通过申请工作流处理已授权操作。浏览器 profile 位于仓库之外。

## 月次考勤申请

`monthly status` 读取指定勤務月；省略 `--period` 时读取 freee 当前选中的月份。提供 `--period YYYY-MM` 时，Playwright 后端读取 freee 当前的支付月/勤務月组合，保留两者偏移，使用有界的官方年月导航，并在解析状态前验证预期支付月和请求勤務月均已显示。导航不存在或有歧义、期间标签异常、导航后验证失败时都会安全停止。结果包含规范化状态、freee 状态标签、匹配申请、可用操作及“仍有日期需要申请或修正”等可见日历警告。Agent 必须展示所有非空警告；用户在 freee 中解决或明确审阅问题前，不得提交。

月次写操作使用与其他写操作相同的两阶段安全模型。`monthly prepare-action --action submit` 打开创建表单，读取对象月份、申请路径、审批步骤、表单检查和日历警告，但不点击最终 `申請`。日历警告会绑定进指纹。`--action withdraw` 读取准确的待处理申请，并确认 `申請を取り下げる` 可用。commit 会重新读取完整预览，要求指纹未变化且当前消息已明确确认，只点击一次并验证最终月次状态。歧义或结果未知时绝不自动重试。

## 本人考勤申请

`requests list` 会明确选择员工侧 `申請` 标签，并让 `申請中`、`差戻し`、`承認済`、`全て` 各筛选器与对应 freee 响应同步后再解析。`requests detail` 会搜索员工侧全部页面中的准确 No.；存在唯一可见且启用的 `申請を取り下げる` 时报告 `withdraw`，已批准项目提供准确官方 `取消申請` 链接时报告 `cancel`。

创建前先调用 `requests options`。提供 `--date` 时，它会读取公司为该日期配置的准确休假类型。本版本支持休假和单段勤務時間修正；修正可包含一组可选休息时间。当前测试公司没有启用 `残業`，因此能力结果会报告加班不可用，本版本不会猜测或绕过未经验证的加班表单。

创建、取消已批准申请、撤回待处理申请使用各自独立的 prepare/commit。取消预览会绑定原始已批准申请、可选取消理由、官方 `ApprovalRequest::Revoke` 表单、审批路径和最近申请列表；commit 会创建并验证唯一的新取消申请。新申请批准前，不会声称原休假已经取消。创建和取消的 prepare 不点击最终 `申請`，撤回的 prepare 不点击 `申請を取り下げる`。每次 commit 都重建相同预览，任何变化都会停止；它要求当前消息明确批准，只点击一次并验证结果。结果未知时绝不自动重试。

## 员工申请处理

`approvals list` 明确选择管理员侧 `承認` 标签，默认读取 `未承認` 队列，绝不会把默认员工侧 `申請` 当作审批队列。每条结果包含申请人。`--status returned|approved|all` 读取其他管理员状态，`--page N` 选择单页。结果返回 `page`、`pageCount`、`totalCount` 和当前页 `applicationCount`，Agent 无需一次输出无限历史。浏览器等待准确 freee 响应及匹配的渲染行数，避免把旧筛选器 DOM 返回给新筛选器。`approvals detail --id` 搜索完整分页管理员流程，并返回申请字段、审批路径、部门、评论和 freee 自动检查结果。对于受支持的 `勤務時間修正`，`workTimeChange` 会结构化返回上班、下班、休息开始和休息结束的 `before`/`after` 值；`null` 表示 freee 显示 `未入力`。承认预览及其安全指纹也会包含这组对照。这两个命令均为只读。

单条申请写操作分为两个阶段：

1. `approvals prepare-action` 读取当前完整详情，确认请求按钮可用，返回预览和内容指纹，不点击业务控件。
2. 只有用户审阅申请人、类型、对象日期、内容、理由和自动检查，并在当前消息中明确要求批准或差戻し后，Agent 才能使用同一个编号、操作和指纹调用 `approvals commit-action ... --confirm`。

commit 前 CLI 会重新读取详情。指纹不一致、按钮缺失、申请已被他人处理或出现新评论时都会停止，并要求重新预览。点击后会通过同步分页流程重新读取同一申请，最终状态必须准确为 `承認済` 或 `差戻し`。本人申请在差戻し后如果离开管理员历史，可以改用员工历史中相同 No. 和不可变对象字段进行验证。两个工作流都找不到或对象不匹配时报告未知，绝不能自动重试。当前不支持批量审批，开发测试也不会执行真实批准或差戻し。

## 月次考勤审批审阅

`monthly-approvals list` 从一页同步的管理员审批结果中筛选 `月次勤怠締め`。如需查看后续来源页，请使用 `pageCount`；`sourceTotalCount` 是类型筛选前总数，`applicationCount` 是当前页月次申请数量。

`monthly-approvals review --id` 先确认准确申请类型和勤務月，然后把考勤监控页导航到该勤務月，将申请人唯一映射为一名可见成员，打开其官方考勤页，并在读取逐日表格前再次验证同一勤務月。导航会保持 freee 显示的支付月/勤務月偏移并验证最终组合。导航有歧义、月份不一致、员工身份重复、缺少官方考勤链接或表格结构变化时会安全停止，不返回不完整审阅。成功结果包含月度汇总、唯一识别的逐日表、每日警告、页面警告、申请详情和统一自动检查。

月次管理员写操作前使用 `monthly-approvals prepare-action --id NO --action approve|return`。其指纹绑定完整申请、月度汇总、逐日记录、警告、检查和请求操作。只有用户在新的当前消息中确认该准确预览后，才允许 `monthly-approvals commit-action ... --confirm`。commit 会重建审阅、重新打开准确申请、点击一次，并执行与一般审批相同的写后验证。当前不支持批量操作，这条专用路径仍待真实 freee 验收。

## 后端选择

后端按照以下优先级选择一次，操作期间绝不混用：

1. `FREEE_BACKEND=api`：只使用 Public API。
2. `FREEE_BACKEND=playwright`：只使用 Playwright，即使本地仍有 API 配置。
3. 未设置或 `FREEE_BACKEND=auto`：存在 API 配置时选择 API，否则选择 Playwright。

源码工作副本可这样选择：

```dotenv
FREEE_BACKEND=playwright
FREEE_BROWSER_HEADLESS=true
```

`.env` 只能包含非敏感开关，绝不能保存用户名、密码、Token 或 Client Secret。

## API 凭据

CLI 支持两种凭据模式：

- `system`：正常且推荐的模式。Client Secret 与 OAuth Token 使用 macOS Keychain、Windows Credential Manager 或 Linux 系统 keyring。
- `environment`：面向 CI、Server 或临时 Access Token，无法自动轮换 Refresh Token。

配置仅包含 Client ID、回调地址和后端元数据，绝不包含 Client Secret 或 Token。源码工作副本使用 `.freee/oauth.json`，Claude 插件则把同样的非敏感数据保存在持久插件数据目录。

已安装 Claude 插件时，让 Claude 配置 API 后端。已安装 Skill 会提供按插件解析的 CLI 命令，并把非敏感配置保存到持久插件数据。下面的源码命令只用于开发。

### System Keyring（推荐）

```bash
npm run freee -- auth configure --store system --client-id YOUR_CLIENT_ID --confirm
```

命令通过隐藏的交互式提示读取 Client Secret，并将 Client Secret 和 OAuth Token 组保存在操作系统凭据库。Access Token 与一次性 Refresh Token 会一起更新。

### Environment 模式（CI 或临时使用）

通过 CI Secret、容器 Secret 或父进程注入 `FREEE_ACCESS_TOKEN`，然后运行：

```bash
npm run freee -- auth configure --store environment --confirm
```

Environment 模式无法安全保存 freee 返回的新 Refresh Token，因此不支持 OAuth 登录或自动刷新。绝不要把真实 Token 写进仓库 `.env`。

## OAuth 更新

在 freee 开发应用中配置这个准确回调 URL：

```text
http://127.0.0.1:48181/callback
```

然后，在用户在场并明确同意授权时运行：

```bash
npm run freee -- auth configure --store system --client-id YOUR_CLIENT_ID --confirm
npm run freee -- auth login --confirm
npm run freee -- auth status
```

`auth login` 会打开 freee 官方授权页、验证随机本地回调 `state`，并把 Token 写入 System Keyring。

授权后，CLI 会在 Access Token 过期前刷新。401 响应最多也只触发一次刷新和一次重试。每枚 freee Refresh Token 都只能使用一次，因此每次刷新都会同时保存新的 Access Token 和 Refresh Token。跨进程锁会防止 Codex 与 Claude Code 同时消费同一枚 Refresh Token。

源码工作副本的 `.freee/oauth.json` 不含 Token 或 Secret，并被 Git 忽略。插件中的等效数据位于持久插件数据目录，可在正常插件更新后保留。

## Playwright 凭据

使用已安装插件时，让 Claude 检查 freee 认证，然后在本地交互式终端直接运行它返回的准确 `setupCommand`。源码开发中的等效命令是：

```bash
npm run freee -- browser configure --confirm
```

命令通过隐藏提示读取用户名、密码和密码确认，将其写入 System Keychain 并验证回读。输出不包含任何凭据值；命令不接受用户名/密码选项，也不会从 `.env`、MCP 参数或聊天中读取凭据。

按照配置命令返回的准确 `nextStep` 完成首次登录。源码工作副本中的等效命令是：

```bash
FREEE_BROWSER_HEADLESS=false npm run freee -- browser status
```

Playwright 只有在确认 `accounts.secure.freee.co.jp` 后才会填写凭据，主 Frame 导航仅允许 `p.secure.freee.co.jp` 和 `ep.secure.freee.co.jp`。用户在可见浏览器中完成 MFA、CAPTCHA 或异常登录验证。成功 Session 会缓存到私有持久 profile；Session 过期时，System Keychain 凭据仍作为恢复来源。之后可恢复 headless 模式。

在 headless 模式中，运行时从所选本地 Chrome channel 派生 User-Agent，并且只在启动持久 Session 前移除 `HeadlessChrome` 产品标记。Playwright 会保持匹配的请求 Header 和 User-Agent Client Hints。这只是有限的 User-Agent 规范化：`navigator.webdriver` 仍会启用，不使用 stealth 或指纹规避包，本项目也不会声称网站无法识别浏览器自动化。

MCP 首次发现缺少网页凭据时，`freee_auth_status` 或其他工具会返回本地配置命令。Agent 只能把该命令展示给用户，绝不能在聊天中请求或收集用户名和密码。

持久浏览器 profile 默认为 `~/.freee-agent/playwright-profile`，权限限制为当前用户。CLI 会拒绝仓库内部的 profile 路径。

只有在明确监督的源码开发诊断中，才可将 `FREEE_BROWSER_DIAGNOSTIC_DIR` 设置为仓库外的私有临时目录。本人申请 prepare/submit 会在受控表单和提交步骤附近保存编号的全页截图，月次状态读取会保存选中的考勤日历状态。目录和图片仅当前用户可访问，默认绝不会启用；未审阅并脱敏个人信息前，绝不能提交到仓库或附加到公开 Issue。

## Agent Skill

规范 Skill 位于 `skills/freee`：

- Codex：`.agents/skills/freee` 链接到规范 Skill。
- Claude Code：用户级 `freee@freee-tools` 插件会在每个项目自动加载规范 Skill；`.claude/skills/freee` 仅保留给源码开发。

因此两个客户端共享相同的 MCP 映射、CLI 设置指导和安全规则。业务操作优先使用 MCP；认证设置和 MCP 故障排查继续使用 CLI。

## 文档

- [ADR-0001：CLI 与 Agent Skill 基础](docs/decisions/0001-cli-and-agent-skill.md)
- [ADR-0002：互斥的 API 或 Playwright 后端](docs/decisions/0002-api-or-playwright-exclusive-backends.md)
- [ADR-0003：本地 MCP 适配器](docs/decisions/0003-local-mcp-adapter.md)
- [freee HR API 能力清单](docs/freee-hr-api-capabilities.md)
- [开发待办](TODO.md)

## 许可证

本项目采用 [MIT License](LICENSE)。
