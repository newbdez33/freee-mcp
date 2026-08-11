# freee 人事労務 API 能力清单

- 盘点日期：2026-08-10
- 依据：[freee 官方人事労務 OpenAPI Schema](https://raw.githubusercontent.com/freee/freee-api-schema/master/hr/open-api-3/api-schema.json)
- 当前 Schema：109 个 HTTP 操作，30 个业务类别

> “API 中存在”不代表当前账号一定可以调用。实际可用范围同时受 freee 套餐、API 应用权限、授权用户角色、事業所和部门范围限制。CLI 必须以实际 API 响应为准。

## 真实权限验证结论

株式会社GCU中的当前用户角色为 `attendance_manager`。该用户能在网页“勤怠一覧”查看受管部门员工，但员工所属 Public API 返回无权限。freee 官方 FAQ 也说明，网页管理权限不一定映射到 API；通过 API 跨员工读取通常需要 `company_admin`。

因此本项目提供两个互斥后端，而不是按操作混合路由：

| 配置状态 | 后端 | 行为 |
| --- | --- | --- |
| `FREEE_BACKEND=api` | Public API | 所有命令只走 API；权限不足时停止，不回退 |
| `FREEE_BACKEND=playwright` | Playwright | 所有命令走网页；账号密码来自 System Keychain |
| 未设置或 `auto` | 自动选择 | 存在 API 配置时用 API，否则用 Playwright |

显式后端配置优先于凭据是否存在；完整设计见 [ADR-0002](decisions/0002-api-or-playwright-exclusive-backends.md)。

## 建议开放顺序

### 第一阶段：本人打卡和查询

- OAuth 登录、退出和授权状态检查。
- 获取当前用户、事業所、角色和本人 `employee_id`。
- 查询当前允许的打卡类型。
- 出勤、休息开始、休息结束、退勤。
- 查询本人打卡记录、指定日期勤怠和月次勤怠汇总。

### 第二阶段：申请和部门勤怠管理

- 月次勤怠締め申请的查询、创建、更新、取消、批准和退回。
- 勤务时间修正、有薪休假、特别休假和加班申请。
- API 分支只有 `company_admin` 可跨员工查询；`attendance_manager` 收到权限错误且不回退。
- Playwright 分支按网页账号的实际管理范围查询部门员工日次/月次勤怠。
- 在预览和确认后修正员工勤怠。

### 默认禁用：高敏感人事数据

- 删除勤怠或申请。
- 创建、修改或删除员工、部门、职位。
- 姓名、地址、家属、银行账户、基本工资、社保和养老金写操作。
- 津贴、扣除、工资、奖金和年末调整写操作。

这些能力可以在以后按明确需求逐项启用，但不能作为通用的“任意 freee API”入口暴露给 Agent。

## 完整能力地图

### 1. 身份与授权上下文

- 获取当前登录用户。
- 获取用户关联的事業所、角色、员工 ID 和显示名称。

API 不提供账号密码登录；认证通过 OAuth Token 完成。

### 2. 打卡（タイムレコーダー）

- 获取指定员工的打卡列表。
- 获取单条打卡记录。
- 获取当前允许的打卡类型。
- 注册打卡：
  - `clock_in`：出勤。
  - `break_begin`：休息开始。
  - `break_end`：休息结束。
  - `clock_out`：退勤。
- 管理员可在 API 允许时指定打卡日期和时间；普通本人打卡应使用当前时间。

### 3. 日次勤怠

- 获取指定员工指定日期的勤怠。
- 更新指定日期的勤怠，包括工作和休息时间等 Schema 支持的字段。
- 删除指定日期的勤怠。

更新和删除必须区分“本人申请修正”和“管理员直接修改”，首版不把两者混为同一个命令。

### 4. 月次勤怠汇总与勤怠标签

- 获取员工指定年月的勤怠信息月次汇总。
- 更新月次勤怠汇总。
- 获取员工可使用的勤怠标签。
- 获取指定日期的勤怠标签和使用次数。
- 更新指定日期的勤怠标签。
- 获取勤怠标签月次汇总。
- 更新勤怠标签月次汇总。

### 5. 月次勤怠締め申请

- 查询申请列表，可按状态、申请人、审批人、目标月份和自动检查结果筛选。
- 获取单个申请及其当前审批步骤。
- 创建月次勤怠締め申请。
- 更新申请。
- 删除或取消申请。
- 执行审批动作：批准、取消、退回、撤销批准等 API 支持的动作。

创建申请需要目标年月和申请路线；审批时需要使用最新的审批轮次与步骤，避免审批过期状态。

### 6. 勤务时间修正申请

- 查询申请列表和单个申请。
- 创建、更新、删除勤務时间修正申请。
- 批准、取消、退回或执行其他支持的审批动作。

### 7. 有薪休假申请

- 查询申请列表和单个申请。
- 创建、更新、删除有薪休假申请。
- 执行批准、取消、退回等审批动作。

### 8. 特别休假申请与余额

- 获取员工特别休假列表。
- 查询特别休假申请列表和单个申请。
- 创建、更新、删除特别休假申请。
- 执行批准、取消、退回等审批动作。

### 9. 加班申请

- 获取创建加班申请所需的设置信息。
- 查询加班申请列表和单个申请。
- 创建、更新、删除加班申请。
- 执行批准、取消、退回等审批动作。

### 10. 申请路线

- 获取申请路线列表。
- 获取单个申请路线和审批步骤。

### 11. 员工管理

- 获取事業所全部期间的员工列表，包括 API 允许返回的离职员工。
- 获取指定年月的员工列表。
- 获取单个员工。
- 创建、更新、删除员工。

员工写操作属于高风险功能，首版只开放查询。

### 12. 部门、职位与所属

- 获取、创建、更新、删除部门。
- 获取、创建、更新、删除职位。
- 获取事業所的员工所属关系列表。
- 获取指定员工的所属关系。

当前 Schema 对所属关系主要提供查询；不应假设能通过同一组端点直接修改员工所属。

### 13. 员工个人资料

- 获取、更新员工姓名、地址等资料。
- 获取员工自定义字段。
- 获取、批量更新员工家属信息。
- 获取、更新员工银行账户。

这些数据包含高度敏感的个人信息，默认不向 Skill 开放写能力，日志也不得记录完整响应。

### 14. 薪酬与社会保险规则

- 获取、更新员工基本工资规则。
- 获取、更新员工健康保险规则。
- 获取、更新员工厚生年金保险规则。

### 15. 津贴与扣除

- 获取津贴项目列表和详情，创建津贴项目。
- 获取扣除项目列表和详情，创建扣除项目。
- 获取、更新、删除员工津贴规则。
- 获取、更新、删除员工扣除规则。

### 16. 工资与奖金明细

- 获取工资明细列表。
- 获取指定员工工资明细。
- 更新工资明细备注。
- 获取奖金明细列表。
- 获取指定员工奖金明细。

工资与奖金响应属于高敏感数据，首版不向通用 Agent 工作流开放。

### 17. 年末调整

- 获取年末调整对象员工列表和单个员工详情。
- 更新员工年末调整信息。
- 更新家属信息。
- 更新工资与奖金信息。
- 创建、更新、删除前职信息。
- 创建、更新、删除保险费信息。
- 创建、更新、删除住宅贷款信息。
- 更新住宅贷款扣除额。

年末调整写操作数量多、财务和合规风险高，默认全部禁用。

## CLI 能力设计建议

首版命令可以收敛为：

```text
freee auth login
freee auth status
freee me
freee clock status
freee clock in
freee clock break-start
freee clock break-end
freee clock out
freee attendance day [date]
freee attendance month [year-month]
freee monthly-request list
freee monthly-request prepare-submit [year-month]
freee monthly-request submit --confirmation <token>
```

部门管理阶段再增加：

```text
freee browser login
freee team status [date]
freee employees list                         # company_admin API 后端
freee attendance employee <employee-id> [date] # 根据角色选择 API/浏览器后端
freee attendance prepare-update <employee-id> <date>
freee attendance commit-update --confirmation <token>
freee approvals list
freee approvals prepare-action <request-id> <approve|feedback>
freee approvals commit-action --confirmation <token>
```

不提供 `freee api <method> <path>` 这类绕过策略层的通用命令。
