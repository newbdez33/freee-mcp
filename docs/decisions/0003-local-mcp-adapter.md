# ADR-0003：增加本地 MCP 适配层

- 状态：已接受
- 日期：2026-08-11
- 替代范围：ADR-0001 中“当前不实现 MCP”的阶段性决定

## 背景

CLI 已验证 OAuth、System Keychain、个人打卡、Playwright 部门勤怠和员工申请审批。随着能力增加，Codex 和 Claude Code 仅依赖 Skill 拼装 shell 命令会重复解析参数，也无法直接获得标准工具 Schema、只读属性和客户端写操作审批。

用户决定保留 CLI，同时增加 MCP 作为两个 Agent 的主要业务入口。API 与 Playwright 仍是两个互斥业务后端，MCP 不是第三个业务后端。

## 决定

采用四层结构：

1. `FreeeService`：统一认证、独占后端选择、查询、预览、状态复核和写操作。
2. CLI：人工操作、认证配置和兼容入口。
3. 本地 STDIO MCP Server：向 Codex 和 Claude Code 公开结构化业务工具。
4. Agent Skill：说明工具选择、审批流程、安全边界和 CLI 初始化方法。

MCP 与 CLI 不得各自复制业务实现。MCP Server 在初始化时只选择一次 API 或 Playwright；所选后端失败时返回错误，不切换后端，也不得改用 CLI 绕过失败。

## 工具和写入边界

- 查询工具标记为 `readOnlyHint: true`。
- 打卡和审批分别拆成 prepare 与 commit 工具。
- prepare 只读取 freee，返回完整预览与 SHA-256 指纹。
- commit 必须收到同一对象、动作、未变化的指纹和 `confirm: true`。
- commit 前由 Core 再次读取当前状态；状态变化时在写入前停止。
- Agent 只有在用户当前消息明确批准预览中的精确对象和动作时才能调用 commit。
- 客户端工具审批是附加保护，不替代 Core 的确认与指纹复核。
- 测试、实现、“继续”或一般性的“处理申请”请求不得触发真实写入；未知结果不得自动重试。

认证配置暂不暴露为 MCP 写工具。这些操作需要本地隐藏输入或特殊授权，继续由 CLI 在用户明确同意后完成。MCP 只能读取安全的认证状态并返回安装路径对应的安全配置命令，不返回账号、密码、Token、Client Secret、Cookie 或 profile。

## 客户端配置

- Codex 使用项目级 `.codex/config.toml`，并把非只读工具设为需要审批。
- Claude Code 通过用户级 `freee@freee-tools` 插件同时加载 MCP Server 和 Skill，不依赖当前项目目录；源码仓库仅用于开发。
- Codex 直接启动 `node dist/mcp-entry.js`；Claude 插件使用 `${CLAUDE_PLUGIN_ROOT}` 启动同一个本地 STDIO Server，并把非敏感 OAuth 配置放在可跨版本保留的 `${CLAUDE_PLUGIN_DATA}`。
- 配置文件不包含凭据；Server 从 System Keychain 和非敏感运行配置读取状态。

## 结果

优点：

- Codex 和 Claude Code 获得相同的工具名、输入 Schema、结构化结果和安全说明。
- 只读查询与真实写入在客户端界面中可区分。
- CLI、MCP 和 Skill 共用一套后端和安全规则，减少行为漂移。
- MCP 仍是本机进程，不需要把 freee 凭据部署到远程服务。

代价：

- Claude Code 需要添加公开 marketplace 并安装用户级插件；用户无需 GitHub 账号或手工下载源码，首次缓存插件时会自动安装锁定的 Node.js 依赖并构建 `dist`。
- Playwright MCP 调用仍受网页结构、MFA 和持久 profile 约束。
- 考勤工具更新默认保持显式，由用户执行 marketplace 与 plugin update 后再重新加载插件，避免代码在未知时刻切换版本。

## 依据

- [OpenAI Docs：Model Context Protocol](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)
- [Model Context Protocol TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- 本项目 MCP 内存协议测试与真实 STDIO 只读冒烟测试
