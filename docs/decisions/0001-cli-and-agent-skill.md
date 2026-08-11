# ADR-0001：使用 freee CLI + Agent Skill

- 状态：部分被 [ADR-0002](0002-api-or-playwright-exclusive-backends.md) 和 [ADR-0003](0003-local-mcp-adapter.md) 替代
- 日期：2026-08-10

## 背景

目标是让 Codex 和 Claude Code 能执行 freee 打卡、查询勤怠、提交月次勤怠申请，并在获得相应权限时协助部门管理员处理员工勤怠和审批。

旧项目 `freee-checkin` 使用 Playwright、账号密码和页面选择器模拟网页操作。freee 人事労務 API 已原生提供打刻、勤怠、员工、组织和申请审批接口，因此没有必要继续以网页自动化作为主实现。

> 2026-08-10 后续验证发现：freee 网页中的 `attendance_manager` 可以查看受管部门的勤怠一覧，但 Public API 不能以该角色跨员工读取所属和勤怠。“完全不使用浏览器自动化”的决定已由 ADR-0002 修正为 API 或 Playwright 两个互斥后端。

Codex 的 Agent Skill 可以包含说明、参考资料和可执行脚本，适合封装本地、可重复的工作流。Claude Code 也支持基于 `SKILL.md` 的 Agent Skills。

## 决定

### 1. 采用 CLI + Skill

实现一套本地 CLI 作为唯一的确定性执行层：

- 处理 freee OAuth 2.0 登录和 Token 刷新。
- 调用 freee 人事労務 API。
- 校验参数、用户角色、事業所和目标员工。
- 使用稳定的 JSON 作为机器可读输出。
- 对修改、提交、审批和删除操作执行明确的确认策略。
- 记录不包含 Token 和敏感正文的审计日志。

在 CLI 之上提供同一份跨客户端 Skill：

- `SKILL.md` 说明什么时候以及如何调用 CLI。
- Skill 不直接保存 Token，不直接拼接任意 HTTP 请求。
- Codex 和 Claude Code 共享相同的业务说明与脚本入口。

### 2. 第一阶段不实现 MCP

本项目当前是个人、本机使用场景。Codex 和 Claude Code 都可以通过本地 shell 调用 CLI，因此 MCP 会增加额外协议层、配置和维护成本，却不会增加当前所需的业务能力。

满足以下任一条件时重新评估 MCP：

- 需要给不具备本地 shell 的客户端使用。
- 需要远程或多人共享服务。
- 需要标准化工具发现、输入 Schema 或集中认证。
- 需要把同一集成分发给大量用户或团队。

即使以后增加 MCP，也只作为现有核心服务之上的薄适配层，不重写 freee API、认证和策略逻辑。

> 2026-08-11：在部门查询和申请审批功能稳定后，用户决定采用 MCP。ADR-0003 按本节预留的边界增加了本地薄适配层；CLI 和 Skill 继续保留。

### 3. API 优先，不使用账号密码自动化

- 认证采用 freee OAuth 2.0 Authorization Code Grant。
- 用户首次授权可能在 freee 页面登录，但 CLI 和 Skill 不读取或保存账号密码。
- Token 存储在 macOS Keychain 或权限严格的本地凭据存储中，不写入仓库。
- Access Token 和轮换后的 Refresh Token 必须原子更新；并发刷新必须加锁。
- Playwright 不进入首版依赖。仅当确认某项必要能力无法通过官方 API 实现时，才单独评估备用适配器。

### 4. 风险分级

- 只读操作：可以由 Skill 在符合用户意图时调用。
- 本人即时打卡：必须来自用户当前消息中的明确意图，并先检查可打卡类型。
- 修改勤怠、提交申请、审批或退回：显示预览并要求确认。
- 删除、批量修改、员工主数据、薪资、银行、社保和年末调整写操作：首版默认禁用。
- 不能只依赖 Skill 中的文字约束；关键限制必须由 CLI 代码强制执行。

## 结果

优点：

- 比网页自动化稳定，不依赖 DOM 和登录页面结构。
- 不保存 freee 登录密码。
- 一套核心代码同时服务 Codex、Claude Code 和人工命令行操作。
- 更容易做自动测试、确认策略、权限控制和审计。

代价：

- 需要创建 freee API 应用并完成一次用户授权。
- 能力受 freee 套餐、应用 Scope 和授权用户角色限制。
- 两个客户端的 Skill 发现目录和部分元数据不同，需要安装脚本或链接处理。

## 依据

- [OpenAI Docs：Build skills](https://learn.chatgpt.com/docs/build-skills)
- [Claude Code：Extend Claude with skills](https://code.claude.com/docs/en/skills)
- [freee：アクセストークンを取得する](https://developer.freee.co.jp/startguide/getting-access-token)
- [freee：トークンの有効期限について](https://developer.freee.co.jp/reference/faq/token_lifetime)
- [freee 人事労務 OpenAPI Schema](https://raw.githubusercontent.com/freee/freee-api-schema/master/hr/open-api-3/api-schema.json)
