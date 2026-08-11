# freee Agent 工具开发清单

## 已确认的方向

- [x] 确定 API 与 Playwright 为两个互斥后端，不按操作混用或失败回退
- [x] 支持 `FREEE_BACKEND=api|playwright|auto`；显式配置优先，`auto` 才按 API 配置是否存在判断
- [x] 确认 `attendance_manager` 的网页部门权限不能通过 Public API 跨员工使用
- [x] Playwright 分支参考 `freee-checkin`，但不复用其 `.env`、环境变量日志、强制点击和无确认写入
- [x] 先用本地 CLI 验证业务能力，再抽取共享 Core Service 并增加 STDIO MCP Server
- [x] 同一份 Skill 同时供 Codex 与 Claude Code 使用
- [x] MCP、CLI 和 Skill 共享同一套后端选择与写操作安全规则
- [x] 普通用户的 Client Secret 与 OAuth Token 只使用 System Keyring；仓库内不保存 Secret
- [x] 已用现有 Access Token 完成只读连通性验证

## 第一阶段：安全打卡基础

- [x] 初始化 Node.js / TypeScript CLI 项目
- [x] 实现 `auth status`：检查凭据和 API 连通性
- [x] 实现 `me`：读取当前用户、公司与员工身份
- [x] 实现 `clock status`：查看当前允许的打卡类型
- [x] 实现上班、休息开始、休息结束、下班命令
- [x] 所有写操作要求显式 `--confirm`，并在调用前再次检查当前允许状态
- [x] 增加单元测试，测试中不得调用真实写接口
- [x] 建立 Codex / Claude Code 共用的 `freee` Skill
- [x] 完成 Skill 结构校验
- [x] 使用 System Keyring 凭据完成 `auth status` 和 `clock status` 只读实测

## 第二阶段：OAuth 与日常勤怠

- [x] 实现 `auth configure` 与可插拔凭据接口
- [x] 实现跨平台 System Keyring 后端（默认）
- [x] 实现 CI / 临时 Access Token 的 environment 后端，并禁止不安全的 Token 轮换
- [x] 实现 OAuth 本机回调、授权码交换和通用 Token Store
- [x] 在 freee 开发应用设置 `http://127.0.0.1:48181/callback`，完成一次真实 OAuth 授权
- [x] Access Token 过期前自动刷新，并原子轮换一次性 Refresh Token
- [x] 增加跨进程刷新锁，避免 Codex 与 Claude Code 同时消费同一枚 Refresh Token
- [x] API 返回 401 时刷新并且只重试一次
- [ ] 查询指定日期的出退勤记录
- [ ] 查询月度勤怠汇总、缺勤、迟到、早退与未打卡异常
- [ ] 申请或修改出退勤记录，并为变更增加预览和确认
- [ ] 查询、创建和撤回休假/加班等本人申请（以 API 实际支持范围为准）

## 第三阶段：月次与管理员功能

- [x] 实现统一后端选择器并禁止运行中回退
- [x] 在业务命令 JSON 中输出 `backend: api|playwright`
- [x] 实现 Playwright System Keychain 凭据库，同时保存 freee 登录账号和密码
- [x] 实现 `browser configure --confirm`，在本地交互式终端隐藏读取账号、密码和二次确认，写入并回读验证 System Keychain
- [x] MCP 缺少 Playwright 凭据时返回本地配置命令，不允许通过聊天或 MCP 参数提交凭据
- [x] 引入 Playwright 并建立仓库外、权限受限的持久化浏览器 profile
- [x] 实现 `browser status`：从 Keychain 自动登录；MFA/CAPTCHA 切换到可见浏览器处理
- [x] 为 freee 官方域名、预期 URL、单一选择器和只读页面建立强制校验
- [x] 使用脱敏表格快照测试勤怠一覧解析，不在测试中访问真实员工数据
- [ ] 查询月次勤怠申请状态
- [ ] 提交、撤回月次勤怠申请
- [x] 完成 API 版部门状态原型并验证其受 `company_admin` 限制，当前角色不可用
- [x] 在 Playwright 分支实现 `team status`，读取当前可见范围的成员、月次不备和工时汇总
- [ ] 在 Playwright 分支增加指定日期的成员出退勤明细
- [ ] 支持选择是否递归汇总子部门
- [x] 汇总部门締め申請状态和非零不备成员
- [x] 查询当前账号可处理的申请列表与单件详情，包括休假、月次締め和勤怠修正等种别
- [x] 单件承认或差戻し员工申请；写入前显示对象、期间、内容和自动检查结果，并绑定详情指纹
- [ ] 支持批量操作前的 dry-run、逐项确认与审计日志

## 第四阶段：MCP 接入

- [x] 抽取 `FreeeService`，供 CLI 与 MCP 共享认证、后端和业务实现
- [x] 实现本地 STDIO MCP Server 和 11 个结构化工具
- [x] 为只读、预览和写入工具添加 MCP annotations
- [x] 打卡和审批采用 prepare/commit 两阶段工具，并绑定 SHA-256 状态指纹
- [x] commit 工具同时要求客户端审批、`confirm: true` 和服务端状态复核
- [x] 增加 MCP 内存协议测试；测试中不调用真实写操作
- [x] 使用真实 System Keychain + Playwright 完成 STDIO 工具发现和个人状态只读验证
- [x] 增加 Codex `.codex/config.toml` 与 Claude Code `.mcp.json` 项目配置
- [x] 更新共用 Skill，业务操作优先使用 MCP，CLI 保留初始化和故障处理职责
- [ ] 增加 MCP 服务器并发会话、超时和取消的压力测试
- [ ] 发布可安装包后，把项目配置从相对 `dist` 路径升级为稳定的包命令

## 后续可选项

- [ ] 发布为可安装的 npm CLI / Skill 包
- [ ] 增加 CI：类型检查、测试、敏感信息扫描
- [ ] 补充管理员操作权限矩阵与 API 覆盖清单

## 安全规则

- 不向日志、终端错误、测试快照或 Git 文件输出任何 Token / Secret
- 默认只读；真实写操作必须由用户明确要求并显式确认
- 打卡前先读取 `available_types`，不猜测或绕过 freee 当前状态
- 测试和开发验证不执行真实打卡、审批、提交或删除
- 涉及多公司或多员工身份时不得自动猜测，必须明确选择目标
- Playwright 账号密码只保存在 System Keychain；不得进入 `.env`、命令参数、聊天、仓库或日志
- 浏览器 profile、Cookie、HTML 和诊断截图不得写入仓库或普通日志
- 禁止输出全部环境变量，禁止对业务按钮使用强制点击
