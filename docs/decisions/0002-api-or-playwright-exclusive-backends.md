# ADR-0002：API 或 Playwright 互斥双后端

- 状态：已接受
- 日期：2026-08-10
- 替代范围：ADR-0001 中“业务操作不使用浏览器自动化”的绝对限制

## 背景

目标账号在株式会社GCU中的 API 角色为 `attendance_manager`。该账号可以在 freee 网页的“勤怠一覧”查看受管部门员工，但真实 Public API 调用在读取员工所属关系时返回无权限。freee 官方也说明，网页管理权限不一定映射到 Public API，跨员工 API 访问通常需要 `company_admin`。

旧项目 `/Users/jacky/projects/dev/freee-checkin` 已验证 Playwright 能使用账号密码登录 freee，并通过 `data-testid` 选择器操作考勤页面。它证明了无 API 用户可以使用网页后端，但其中的 `.env` 密码、全环境变量日志、通用动作 JSON、强制点击和无确认定时写入不适合作为新项目的安全边界。

## 决定

保留同一个 CLI 和 Agent Skill，但提供两个互斥的完整后端，而不是按业务操作混合 API 与浏览器：

### API 分支

- `FREEE_BACKEND=api` 时选择；`auto` 模式下存在 API/OAuth 配置时也选择。
- 所有身份、查询、打卡、部门和申请操作都只能通过 Public API 完成。
- API 权限不足时明确停止；不得回退到 Playwright。
- 即使 System Keychain 中还保存着网页账号密码，也忽略浏览器凭据。

### Playwright 分支

- `FREEE_BACKEND=playwright` 时选择；`auto` 模式下仅在没有 API/OAuth 配置时选择。
- 所有身份、查询、打卡、部门和申请操作都通过受控 Playwright 适配器完成。
- freee 登录账号和密码保存在 System Keychain，不写入 `.env`、配置文件、命令参数或日志。
- Playwright 只从 CLI 的凭据接口读取账号密码，并且只在预期的 freee 官方登录域名自动填写。
- MFA、CAPTCHA 或异常登录确认由用户在可见浏览器中完成。

### 后端选择

后端在命令开始时确定，在命令执行期间保持不变：

1. `FREEE_BACKEND=api`：选择 `api`，忽略 Playwright 凭据。
2. `FREEE_BACKEND=playwright`：选择 `playwright`，忽略现有 API 配置和 Token。
3. 未设置或为 `auto`：检测到 API 配置时选择 `api`，否则选择 `playwright`。
4. 已选后端的认证、权限或页面操作失败：返回该后端错误，不回退。

`.env` 只允许保存 `FREEE_BACKEND`、浏览器是否 headless、浏览器 channel 和 profile 路径等非敏感设置；不得保存账号、密码、Token 或 Client Secret。

结构化输出必须包含 `backend: api|playwright`，便于确认实际执行路径。

## Playwright 凭据与会话

- 已实现 `browser configure --confirm`，让用户在本地交互式终端隐藏输入账号、密码和二次确认，并写入、回读验证 System Keychain 条目。
- CLI 不向 Agent 或聊天返回账号、密码、Cookie 或 session storage。
- 登录 Cookie 和本地存储保存在仓库外、权限受限的专用浏览器 profile。
- 主页面只允许 `accounts.secure.freee.co.jp`、`p.secure.freee.co.jp` 和 `ep.secure.freee.co.jp`；Employee Portal 新标签页也必须重新验证。
- 密码或会话失效时停止，要求用户重新配置或完成交互式登录。
- 不读取旧 `freee-checkin` 的 `.env`，仅参考其登录流程和页面选择器。

## 共同安全边界

- 默认只读。真实打卡、修改、提交、审批、退回、删除和批量操作都要求专用命令、预览以及当前用户消息中的明确确认。
- Playwright 页面 URL、公司、员工、期间或选择器不唯一时立即停止；禁止 `force` 点击业务按钮。
- 只允许访问 freee 官方域名。
- Cookie、HTML、完整页面文本、员工邮箱和诊断截图不得进入普通日志或仓库。
- 测试使用模拟 API 和静态 HTML 夹具，不对真实员工执行写操作。

## 结果

优点：

- 有 API 的用户得到纯 API、可预测的执行路径。
- 没有 API 的用户可以复用 freee 网页权限和 `freee-checkin` 已验证的 Playwright 方法。
- 不会在 API 错误后悄悄切换到另一套权限和凭据。

代价：

- 两个后端需要分别实现和测试同一组业务命令。
- Playwright 分支依赖页面结构，并需要保护账号密码与浏览器 profile。
- `attendance_manager` 仍无法通过 API 查询部门员工；可以显式设置 `FREEE_BACKEND=playwright` 使用同一账号的网页管理范围，无需删除已有 API 配置。

## 依据

- [freee：操作権限を管理する](https://support.freee.co.jp/hc/ja/articles/204087410)
- [freee：人事労務API利用時のユーザー権限について](https://developer.freee.co.jp/reference/faq/hr_user_permission)
- [freee：従業員ポータル画面の見方](https://support.freee.co.jp/hc/ja/articles/36088473998105)
- [freee：従業員ガイド② 勤怠を入力・管理する](https://support.freee.co.jp/hc/ja/articles/4419332145689)
- 真实验证：`attendance_manager` 可使用网页勤怠一覧，但所属 Public API 返回无权限
- 参考实现：`/Users/jacky/projects/dev/freee-checkin`
