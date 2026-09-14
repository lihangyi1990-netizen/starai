# 邮箱验证码注册、邮箱密码登录 — 设计文档

日期：2026-09-14
分支：`feat/email-code-registration`
交付方式：PR（合并后再按正常流程部署，本次**不直接发服务器**）

## 1. 背景与目标

改造前台登录/注册弹窗与对应后端接口：

1. **注册只能走「邮箱验证码 + 密码」**：邮箱、密码、确认密码、6 位邮箱验证码（推荐码、协议勾选为既有可选项）。
2. **登录只用「邮箱 + 密码」**：移除验证码免密登录入口。
3. **已注册邮箱不再发送验证码**：发码前后端查重，已注册直接拒绝，防止被当成免密登录侧门或邮件轰炸入口。

## 2. 现状盘点（工作区已有实现）

本分支基于 `origin/main`（2b13a81，与本地 HEAD 75fe77c 内容一致）。工作区已有一份未提交的完整实现，共 6 个文件，且已通过验证：

- `go build ./...` 通过；`internal/handler`、`internal/service`、`internal/middleware` 测试通过
- 前端 `tsc --noEmit` 通过

文件与行为：

| 文件 | 改动 |
|---|---|
| `services/api/internal/service/email_otp.go` | 删除 `VerifyAndLogin`（验证码即登录/自动注册）与 `SetInitialPassword`；新增 `VerifyRegistrationCode`（只验码、不发会话、不建号）；`SendCode` 发码前查重；缓存键场景隔离为 `email_otp:register:<email>`；邮件主题/正文改为注册语境；`TempCache` 抽成接口便于测试 |
| `services/api/internal/service/auth.go` | `Register` 新增 `emailCode` 与 `otp` 参数，建号前强制验码；`otp == nil` 时返回「注册服务暂不可用」 |
| `services/api/internal/handler/handler.go` | 注册接口接收 `email_code` 并透传；`ErrInvalidEmailCode` 映射为 400「邮箱验证码错误或已过期」；删除路由 `/auth/email/verify`、`/auth/set-password` |
| `apps/web/src/components/LoginModal.tsx` | 弹窗收敛为「登录 / 注册」两个 tab；删除邮箱验证 tab、`set_password` 步骤及相关状态；注册表单含验证码行（获取按钮 + 60 秒倒计时）；提交注册前前端校验验证码为 6 位 |
| `apps/web/src/i18n/dictionaries.ts`、`apps/web/src/i18n/it.ts` | 新增 4 个 key（`login.registerCode`、`login.enterRegisterCode`、`login.registerCodeHint`、`login.registerCodeRequired`），各 6 语言 |

## 3. 范围

### 包含

- 以上 6 个文件的既有改动（经复审后保留）
- i18n 死 key 清理（见第 6 节）
- 后端单元测试补齐（见第 7 节）

### 不包含

- 不动后台「系统配置」中的 `email_otp_login_enabled` 开关（产品已确认保留；该开关不再控制任何前台行为，但本次不清理，避免扩大 diff）
- 不新增「忘记密码/找回密码」功能（系统现状没有，属独立需求）
- 不动 OAuth 相关接口（前台弹窗本就无 OAuth 入口）
- 无数据库迁移
- 不部署生产

## 4. 后端设计

### 4.1 接口变化

| 接口 | 变化 |
|---|---|
| `POST /api/auth/email/send-code` | 保留，语义收窄为「仅注册发码」。请求体不变（`email`、`captcha_id`、`captcha_code`）。已注册邮箱返回 400「该邮箱已注册，请直接登录」 |
| `POST /api/auth/email/verify` | **删除**（验证码免密登录/自动注册） |
| `POST /api/auth/register` | 请求体新增 `email_code`；后端先查重、再验码，全部通过才建号；验证码校验失败返回 400「邮箱验证码错误或已过期」 |
| `POST /api/auth/login/password` | 不变，邮箱 + 密码（后台开启图形验证码时附带验证码） |
| `POST /api/auth/set-password`（鉴权区） | **删除**（仅服务于旧的「验证码登录后补设密码」流程） |

### 4.2 验证码生命周期

- 6 位数字，缓存键 `email_otp:register:<email>`，TTL 10 分钟。
- 校验成功立即删除（一次性）；错码/过期返回 `ErrInvalidEmailCode`。
- 发码冷却：`email_otp_cooldown:<email>` 60 秒；IP 维度限流维持路由层既有配置（10 次/小时）。
- 邮件文案为注册语境（「您正在注册 X，注册验证码是……」）。
- 邮件服务未启用时：调试模式（`email_otp_debug` 配置 / `EMAIL_OTP_DEBUG=1` / `APP_ENV=development`）返回 `debug_code`；否则报错提示去后台配置，与现状一致。

### 4.3 注册请求内的校验顺序

`AuthService.Register`：邮箱密码格式校验 → 邮箱查重（已存在返回 `ErrUserExists`）→ OTP 服务可用性（nil 报 500 类错误）→ `VerifyRegistrationCode`（失败返回 `ErrInvalidEmailCode`）→ bcrypt 哈希 → 建号。

查重先于验码：已注册邮箱不泄露验证码缓存状态，也不会被无效码请求消耗资源。

## 5. 前端设计

弹窗固定两 tab：**登录 / 注册**，不再受 `email_otp_login_enabled` 影响。

- 登录：邮箱 + 密码（+ 图形验证码，按后台配置）。
- 注册：邮箱 + 密码 + 确认密码 + 验证码行（输入框 + 「获取验证码」按钮，60 秒倒计时）+ 推荐码（选填）+ 协议勾选。
- 获取验证码前要求邮箱已填且协议已勾选；后端拒发（如「该邮箱已注册，请直接登录」）时错误直接显示在弹窗内。
- 注册提交前端拦截：密码 ≥ 6 位、两次一致、验证码恰好 6 位数字、协议必勾；后端为最终裁决。
- 调试模式下返回的 `debug_code` 自动填入并提示，沿用既有行为。

## 6. i18n 清理（方案 C）

旧验证码登录/补设密码流程移除后，以下 key 在 `apps/web/src` 代码中零引用（已全仓扫描确认，含 `apps/admin`、`packages`），从 4 处定义中删除：

**死 key（13 个）**：`login.desc`、`login.emailTab`、`login.accountTab`、`login.submit`、`login.verifying`、`login.firstHint`、`login.setPassword`、`login.setPasswordDesc`、`login.setPasswordDescNew`、`login.newPassword`、`login.later`、`login.finish`、`login.emailCode`

**仅 EXTRA 补丁 / it.ts 中残留（2 个）**：`login.verifyFailed`、`login.setPasswordFailed`

涉及文件：

1. `apps/web/src/i18n/dictionaries.ts`：5 语言（zh/en/ja/ko/vi）删除上述 13 个 key。
2. `apps/web/src/i18n/it.ts`：删除 13 + 2 个 key。
3. `apps/web/src/i18n/I18nProvider.tsx`：`EXTRA_BUILTIN_TRANSLATIONS` 5 语言段删除 `login.verifyFailed`、`login.setPasswordFailed`。
4. `packages/shared-types/src/index.ts`：`UI_TRANSLATION_KEYS` 与 `UI_TRANSLATION_ZH_LABELS` 删除上述 13 个 key；同时**补登记**本次新增的 4 个 key（`login.registerCode`、`login.enterRegisterCode`、`login.registerCodeHint`、`login.registerCodeRequired`）及中文标签，使后台「界面翻译」能覆盖注册新文案。

保留：`login.confirmPassword`（注册仍用）、`login.getCode`（注册发码按钮仍用）、`login.sendFailed`、`login.debugCode`（仍在用，且现由 I18nProvider EXTRA 补丁提供，本次不搬动）。

注：数据库中既有的 `ui_translation_overrides` 若存有旧 key 的覆盖行，属无害冗余，本次不清理。

## 7. 测试计划

仓库现状：无 DB mock（`db` 为具体 `*pgxpool.Pool`），测试均为不连库的纯函数级。沿用此惯例。

1. **`VerifyRegistrationCode` 表驱动测试**（新建 `services/api/internal/service/email_otp_test.go`，用 fake `TempCache`）：
   - 邮箱格式非法 / 码长度非 6 → `ErrInvalidEmailCode`
   - 缓存无码（未发或过期）→ `ErrInvalidEmailCode`
   - 码不匹配 → `ErrInvalidEmailCode` 且缓存保留（允许重试到 TTL）
   - 码匹配 → nil 且键被删除（一次性）
2. **发码前置守卫纯函数测试**：将「格式 → 查重 → 冷却」的决策抽成纯函数（如 `evaluateRegisterSend(exists, existsErr, cooldownActive) error`），`SendCode` 调用它；覆盖已注册拒发、查重出错透传、冷却中拒发、全部通过放行。
3. 回归：`go build ./...`、`go test ./...`、前端 `tsc --noEmit`、`node scripts/scan-i18n-missing-web.js`（确认无新裸 key）。

不构造连库的 handler 集成测试（仓库无此基建）；handler 层仅为错误到状态码的简单映射，由编译与代码审查保障。

## 8. 风险与上线前检查

- **历史无密码账号风险**：旧版曾支持验证码免密登录（开关默认关闭）。若线上存在 `credential_hash` 为空的邮箱账号，改造后其无法登录且无找回密码入口。**部署前必须执行只读核对**：
  ```sql
  SELECT count(*) FROM auth_identities
  WHERE provider='email' AND (credential_hash IS NULL OR credential_hash='');
  ```
  结果非 0 时暂停部署，先定这批账号的处理方案（另行处理，不在本 PR 范围）。
- 部署必须重建 **api + web**。**admin 无需为本次发布重建**：shared-types 翻译键表的变化只影响后台「界面翻译」页的可选键列表，旧 admin 继续运行无故障，少显示的 4 个新键随下次 admin 常规发布带上即可。无迁移、无环境变量新增。
- 发信依赖：注册强依赖邮件通路；SMTP/Resend 未配置且非调试模式时用户无法注册（现状即有配置，部署后用真实邮箱走一遍注册 + 拒发验证）。

## 9. 验收标准

1. 登录 tab 只有邮箱 + 密码，能正常登录；无任何验证码登录入口。
2. 注册 tab：未填验证码前端拦截；错码/过期码后端 400；正确流程可注册并直接登录。
3. 已注册邮箱点「获取验证码」被拒，提示「该邮箱已注册，请直接登录」，且不发信、不写验证码缓存。
4. 验证码校验一次后失效；60 秒冷却与 IP 限流生效。
5. 6 语言下弹窗无裸 key；后台「界面翻译」可见 4 个新 key。
6. `go build`、`go test ./...`、`tsc --noEmit`、i18n 扫描全绿。
7. 变更以 PR 形式提交评审，未经合并/授权不触碰生产服务器。
