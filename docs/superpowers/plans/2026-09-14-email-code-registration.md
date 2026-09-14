# 邮箱验证码注册 / 邮箱密码登录 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把前台登录/注册改造成「登录=邮箱+密码、注册=邮箱验证码+密码、已注册邮箱拒发验证码」，补齐后端测试、清理死 i18n key，以 PR 交付。

**Architecture:** 后端删掉验证码免密登录与补设密码接口，发码接口收窄为注册专用并在发码前查重，注册建号前强制校验一次性场景验证码。前端弹窗收敛为登录/注册两 tab。核心发码前置决策抽为纯函数做表驱动测试，不引入 DB mock（仓库惯例）。

**Tech Stack:** Go 1.27 + gin + pgxpool（`services/api`）；Next.js + React + TypeScript（`apps/web`）；i18n 定义分布在 `dictionaries.ts`、`it.ts`、`I18nProvider.tsx`、`packages/shared-types/src/index.ts`。

**Spec:** `docs/superpowers/specs/2026-09-14-email-code-registration-design.md`

## Global Constraints

- 所有工作在分支 `feat/email-code-registration`（已基于 `origin/main` 创建，spec 已提交）。
- **绝不部署/触碰生产服务器**（无 ssh/scp/上传动作）；交付物是推送的分支 + 浏览器 PR 链接。
- 无数据库迁移、无新增环境变量、无新增 npm/go 依赖。
- 后端测试不连数据库：仓库没有 DB mock 基建，沿用纯函数/接口 fake 的既有风格。
- 不处理后台 `email_otp_login_enabled` 开关（spec 第 3 节明确保留）。
- 每个 commit message 末尾加 `Co-Authored-By: Claude Code <noreply@anthropic.com>`。
- 提交前必须全绿：`go build ./...`、`go test ./...`、`tsc --noEmit`。
- 工作目录：仓库根 `F:\tuna-source-20260831\starai-prod`（Go 命令在 `services/api` 下执行）。

## File Structure

| 文件 | 责任 | 本计划动作 |
|---|---|---|
| `services/api/internal/service/email_otp.go` | 发码/验码服务 | Task 1 已随既有改动完成；Task 2 抽出纯函数 `evaluateRegisterSend` |
| `services/api/internal/service/email_otp_test.go` | 发码守卫与验码测试 | Task 2 新建 |
| `services/api/internal/service/auth.go` | 注册强制验码 | Task 1 提交既有改动 |
| `services/api/internal/handler/handler.go` | 路由/参数/错误映射 | Task 1 提交既有改动 |
| `apps/web/src/components/LoginModal.tsx` | 登录注册弹窗 | Task 1 提交既有改动 |
| `apps/web/src/i18n/dictionaries.ts` | zh/en/ja/ko/vi 字典 | Task 1 提交新增 4 key；Task 3 删 13 个死 key |
| `apps/web/src/i18n/it.ts` | 意语字典 | Task 3 删 15 个死 key |
| `apps/web/src/i18n/I18nProvider.tsx` | EXTRA 翻译补丁 | Task 3 删 2 个死 key × 5 语言块 |
| `packages/shared-types/src/index.ts` | `UI_TRANSLATION_KEYS` 与 `UI_TRANSLATION_ZH_LABELS` | Task 3 删 13 个死键、登记 4 个新键 |

---

### Task 1: 提交工作区既有的 6 文件实现

工作区已有一份完整实现并已验证可编译（spec 第 2 节）。本任务只做审查后入库，不改代码。

**Files:**
- Modify: `services/api/internal/service/email_otp.go`
- Modify: `services/api/internal/service/auth.go`
- Modify: `services/api/internal/handler/handler.go`
- Modify: `apps/web/src/components/LoginModal.tsx`
- Modify: `apps/web/src/i18n/dictionaries.ts`
- Modify: `apps/web/src/i18n/it.ts`

- [ ] **Step 1: 重新确认基线全绿**

Run（在 `services/api`）：
```bash
go build ./... && go test ./internal/handler/ ./internal/service/ ./internal/middleware/
```
Expected: build 无输出；三个包均 `ok`。

Run（在 `apps/web`）：
```bash
node_modules/.bin/tsc --noEmit
```
Expected: 退出码 0，无输出。

- [ ] **Step 2: 只暂存这 6 个文件并审查 diff 范围**

Run（仓库根）：
```bash
git add services/api/internal/service/email_otp.go services/api/internal/service/auth.go \
  services/api/internal/handler/handler.go apps/web/src/components/LoginModal.tsx \
  apps/web/src/i18n/dictionaries.ts apps/web/src/i18n/it.ts
git status --short
```
Expected: 恰好这 6 个文件为 `M `（已暂存）；`docs/` 下只有已提交的 spec，`.claude/`、`.next-dev*`、`.env.local` 等保持未跟踪、绝不暂存。

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(auth): require email code for registration, password-only login

Registration now requires a 6-digit email code proving mailbox ownership
before the account is created; the send-code endpoint refuses addresses
that are already registered. The email-code login and set-password
endpoints and their UI are removed; login is email+password only.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

- [ ] **Step 4: 确认工作区只剩预期内容**

Run: `git status --short`
Expected: 无已跟踪文件的改动（未跟踪的 `.claude/`、`.next-dev*`、`.env.local` 可忽略）。

---

### Task 2: 发码前置守卫纯函数化 + 后端测试（TDD）

**Files:**
- Modify: `services/api/internal/service/email_otp.go`（`SendCode` 内查重+冷却段替换为调用新纯函数）
- Test: `services/api/internal/service/email_otp_test.go`（新建）

**Interfaces:**
- Produces:
  - `func evaluateRegisterSend(exists bool, existsErr error, cooldownActive bool) error` — 未导出纯函数；错误优先级：`existsErr` > 已注册（消息含「该邮箱已注册」）> 冷却（消息含「发送过于频繁」）> nil。
  - `EmailOTPService.VerifyRegistrationCode(ctx context.Context, email, code string) error`（Task 1 修复后：只比对，**不删除缓存键**；失败返回 `ErrInvalidEmailCode`）。
  - `EmailOTPService.ConsumeRegistrationCode(ctx context.Context, email string)`（Task 1 修复后新增）：删除 `email_otp:register:<email>`；由 `AuthService.Register` 在 `tx.Commit` 成功后调用——建号失败不烧码。
  - `TempCache` 接口（Task 1 已存在）：`SetTemp(ctx, key, value string, ttl time.Duration) error`、`GetTemp(ctx, key string) (string, bool)`、`DelTemp(ctx, key string)`。

- [ ] **Step 1: 先写失败测试**

创建 `services/api/internal/service/email_otp_test.go`，完整内容：

```go
package service

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"
)

// fakeTempCache is an in-memory TempCache for code-issuance tests; no database
// or redis is required, matching the package's existing test style.
type fakeTempCache struct {
	mu     sync.Mutex
	values map[string]string
}

func newFakeTempCache() *fakeTempCache {
	return &fakeTempCache{values: map[string]string{}}
}

func (f *fakeTempCache) SetTemp(_ context.Context, key, value string, _ time.Duration) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.values[key] = value
	return nil
}

func (f *fakeTempCache) GetTemp(_ context.Context, key string) (string, bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	v, ok := f.values[key]
	return v, ok
}

func (f *fakeTempCache) DelTemp(_ context.Context, key string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.values, key)
}

func TestVerifyRegistrationCode(t *testing.T) {
	ctx := context.Background()
	const email = "newbie@example.com"
	key := "email_otp:register:" + email

	tests := []struct {
		name    string
		email   string
		code    string
		seed    bool
		wantErr error
	}{
		{name: "malformed email", email: "not-an-email", code: "123456", wantErr: ErrInvalidEmailCode},
		{name: "code too short", email: email, code: "1234", wantErr: ErrInvalidEmailCode},
		{name: "code never sent", email: email, code: "123456", wantErr: ErrInvalidEmailCode},
		{name: "wrong code is rejected without consuming", email: email, code: "000000", seed: true, wantErr: ErrInvalidEmailCode},
		{name: "correct code passes without consuming yet", email: email, code: "123456", seed: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c := newFakeTempCache()
			if tt.seed {
				if err := c.SetTemp(ctx, key, "123456", time.Minute); err != nil {
					t.Fatal(err)
				}
			}
			svc := &EmailOTPService{cache: c}
			err := svc.VerifyRegistrationCode(ctx, tt.email, tt.code)
			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("VerifyRegistrationCode() err=%v want %v", err, tt.wantErr)
			}
			// Verify never consumes the code: a failed later insert lets the
			// user retry with the same code; consumption is Register's job,
			// after the account row is committed.
			_, present := c.GetTemp(ctx, key)
			if tt.seed && !present {
				t.Fatal("VerifyRegistrationCode must not delete the code")
			}
		})
	}
}

func TestConsumeRegistrationCode(t *testing.T) {
	ctx := context.Background()
	const email = "newbie@example.com"
	key := "email_otp:register:" + email
	c := newFakeTempCache()
	svc := &EmailOTPService{cache: c}
	// Deleting an absent key is a no-op.
	svc.ConsumeRegistrationCode(ctx, email)
	if err := c.SetTemp(ctx, key, "123456", time.Minute); err != nil {
		t.Fatal(err)
	}
	svc.ConsumeRegistrationCode(ctx, email)
	if _, present := c.GetTemp(ctx, key); present {
		t.Fatal("ConsumeRegistrationCode must delete the registration code")
	}
}

func TestEvaluateRegisterSend(t *testing.T) {
	dbErr := errors.New("db unavailable")
	tests := []struct {
		name        string
		exists      bool
		existsErr   error
		cooldown    bool
		wantErr     bool
		wantMessage string
	}{
		{name: "fresh address, no cooldown", wantErr: false},
		{name: "already registered", exists: true, wantErr: true, wantMessage: "该邮箱已注册"},
		{name: "cooldown active", cooldown: true, wantErr: true, wantMessage: "发送过于频繁"},
		{name: "registered beats cooldown", exists: true, cooldown: true, wantErr: true, wantMessage: "该邮箱已注册"},
		{name: "lookup error beats everything", exists: true, existsErr: dbErr, cooldown: true, wantErr: true, wantMessage: "db unavailable"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := evaluateRegisterSend(tt.exists, tt.existsErr, tt.cooldown)
			if (err != nil) != tt.wantErr {
				t.Fatalf("evaluateRegisterSend() err=%v wantErr=%v", err, tt.wantErr)
			}
			if err != nil && !strings.Contains(err.Error(), tt.wantMessage) {
				t.Fatalf("err message=%q want substring %q", err.Error(), tt.wantMessage)
			}
		})
	}
}
```

- [ ] **Step 2: 运行测试确认失败**

Run（在 `services/api`）：
```bash
go test ./internal/service/ -run 'TestVerifyRegistrationCode|TestEvaluateRegisterSend' -v
```
Expected: **编译失败**，`undefined: evaluateRegisterSend`（`TestVerifyRegistrationCode` 针对已存在函数，是行为固化测试；守卫函数尚未抽出）。

- [ ] **Step 3: 抽出纯函数并让 SendCode 调用它**

在 `services/api/internal/service/email_otp.go` 中，把 `SendCode` 里的这一段：

```go
	exists, err := s.emailExists(ctx, email)
	if err != nil {
		return nil, err
	}
	if exists {
		return nil, errors.New("该邮箱已注册，请直接登录")
	}
	// Rate limit: 60s between sends per email.
	if v, ok := s.cache.GetTemp(ctx, "email_otp_cooldown:"+email); ok && v != "" {
		return nil, errors.New("发送过于频繁，请稍后再试")
	}
```

替换为：

```go
	exists, err := s.emailExists(ctx, email)
	cooldown := false
	if v, ok := s.cache.GetTemp(ctx, "email_otp_cooldown:"+email); ok && v != "" {
		cooldown = true
	}
	// Pure policy call: lookup failure must not silently allow sending, an
	// already-registered address never gets a code, and the per-address
	// cooldown is checked last so it never masks the other rejections.
	if err := evaluateRegisterSend(exists, err, cooldown); err != nil {
		return nil, err
	}
```

并在同文件（`VerifyRegistrationCode` 下方即可）新增：

```go
// evaluateRegisterSend is the pre-issue policy for a registration code.
// exists/existsErr come from the auth_identities lookup; cooldownActive
// reports whether the 60-second per-address cooldown is present. It is a pure
// function so the rejection ordering can be table-tested without a database.
func evaluateRegisterSend(exists bool, existsErr error, cooldownActive bool) error {
	if existsErr != nil {
		return existsErr
	}
	if exists {
		return errors.New("该邮箱已注册，请直接登录")
	}
	if cooldownActive {
		return errors.New("发送过于频繁，请稍后再试")
	}
	return nil
}
```

- [ ] **Step 4: 运行测试确认通过**

Run：
```bash
go test ./internal/service/ -run 'TestVerifyRegistrationCode|TestEvaluateRegisterSend' -v
```
Expected: 三个顶层测试 PASS（`TestVerifyRegistrationCode` 5 子用例、`TestConsumeRegistrationCode`、`TestEvaluateRegisterSend` 5 子用例）。

- [ ] **Step 5: 全包回归并提交**

Run：
```bash
go build ./... && go test ./...
```
Expected: build 无输出；所有包 `ok`（无 service 包以外的失败）。

```bash
git add services/api/internal/service/email_otp.go services/api/internal/service/email_otp_test.go
git commit -m "test(auth): cover registration-code verification and send-code guard

Extract the exists/cooldown rejection policy into evaluateRegisterSend so
the refusal order (lookup error, already registered, cooldown) is
table-tested without a database; verify rejects all bad inputs without
consuming the code, and ConsumeRegistrationCode deletes it exactly once.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: 清理 15 个死 i18n key，并在 shared-types 登记 4 个新 key

旧验证码登录/补设密码流程删除后，这些 key 在 `apps/web/src`、`apps/admin/src`、`packages` 代码中零引用（spec 第 6 节已全仓扫描）。

- **13 个通用死 key**：`login.desc`、`login.emailTab`、`login.accountTab`、`login.submit`、`login.verifying`、`login.firstHint`、`login.setPassword`、`login.setPasswordDesc`、`login.setPasswordDescNew`、`login.newPassword`、`login.later`、`login.finish`、`login.emailCode`
  - 分布：`dictionaries.ts` ×5 语言、`it.ts` ×1、shared-types 的数组与 zh 标签表 ×各 1。
- **2 个仅残留在 EXTRA/it 的死 key**：`login.verifyFailed`、`login.setPasswordFailed`
  - 分布：`I18nProvider.tsx` ×5 语言块、`it.ts` ×1。
- 保留：`login.confirmPassword`、`login.getCode`、`login.sendFailed`、`login.debugCode`（仍在使用）。

**Files:**
- Modify: `apps/web/src/i18n/dictionaries.ts`
- Modify: `apps/web/src/i18n/it.ts`
- Modify: `apps/web/src/i18n/I18nProvider.tsx`
- Modify: `packages/shared-types/src/index.ts`

- [ ] **Step 1: 记录删除前计数（作为脚本断言基线）**

Run（仓库根）：
```bash
for f in apps/web/src/i18n/dictionaries.ts apps/web/src/i18n/it.ts apps/web/src/i18n/I18nProvider.tsx packages/shared-types/src/index.ts; do echo "== $f"; done
```
预期删除总量（脚本会自行断言，不需手算）：dictionaries 65 行、it.ts 15 行、I18nProvider 10 行、shared-types 数组 13 行 + 标签表 13 行，共 **116 行**。

- [ ] **Step 2: 运行一次性精确清理脚本**

在仓库根创建临时脚本 `./i18n-prune.tmp.py`（用 `python` 运行；脚本按「整键精确匹配 + 行形态」删除，不会误伤 `login.descAccountOnly` 这类前缀相似键；用完即删，不提交）：

```python
import io, re, sys

DEAD13 = ["desc","emailTab","accountTab","submit","verifying","firstHint",
          "setPassword","setPasswordDesc","setPasswordDescNew","newPassword",
          "later","finish","emailCode"]
DEAD_EXTRA = ["verifyFailed","setPasswordFailed"]

# 行形态：键值对（2/4 空格缩进都匹配），要求引号后紧跟冒号
KV = r'^\s*"{key}"\s*:.*\r?\n$'
# 数组元素形态：  "login.xxx",
ARR = r'^\s*"{key}"\s*,\s*\r?\n$'

def strip(path, suffixes, tmpl, expect):
    text = io.open(path, encoding="utf-8").read()
    lines = text.splitlines(keepends=True)
    kept, removed = [], 0
    for line in lines:
        if any(re.match(tmpl.format(key=re.escape("login."+s)), line) for s in suffixes):
            removed += 1
            continue
        kept.append(line)
    if removed != expect:
        sys.exit(f"{path}: removed {removed}, expected {expect}")
    io.open(path, "w", encoding="utf-8", newline="").write("".join(kept))
    print(f"{path}: removed {removed}")

strip("apps/web/src/i18n/dictionaries.ts", DEAD13, KV, 65)
strip("apps/web/src/i18n/it.ts", DEAD13 + DEAD_EXTRA, KV, 15)
strip("apps/web/src/i18n/I18nProvider.tsx", DEAD_EXTRA, KV, 10)
strip("packages/shared-types/src/index.ts", DEAD13, ARR, 13)
strip("packages/shared-types/src/index.ts", DEAD13, KV, 13)
```

Run：
```bash
python ./i18n-prune.tmp.py && rm ./i18n-prune.tmp.py
```
Expected: 5 行 `removed` 输出，数字依次 65/15/10/13/13；任何 expect 不符脚本以非零退出（临时文件仍在，先 `git checkout -- <4 个文件>` 回滚、修正脚本后重跑，成功后 `rm` 删除临时文件）。

注意：最后两遍对同一文件先按数组形态删 13 行、再按键值形态删 13 行，互不重叠。

- [ ] **Step 3: 在 shared-types 登记 4 个新 key**

在 `packages/shared-types/src/index.ts` 的 `UI_TRANSLATION_KEYS` 数组中，找到：

```ts
  "login.getCode",
```

在其下方插入 4 行：

```ts
  "login.registerCode",
  "login.enterRegisterCode",
  "login.registerCodeHint",
  "login.registerCodeRequired",
```

在 `UI_TRANSLATION_ZH_LABELS` 中找到：

```ts
  "login.getCode": "获取验证码",
```

在其下方插入 4 行（文案与 dictionaries.ts 中文块一致）：

```ts
  "login.registerCode": "注册验证码",
  "login.enterRegisterCode": "请输入收到的 6 位注册验证码",
  "login.registerCodeHint": "注册前需先验证邮箱所有权",
  "login.registerCodeRequired": "请先获取并填写邮箱验证码",
```

- [ ] **Step 4: 断言零残留、零悬空引用**

Run（仓库根，Python 一次性检查，不落地文件）：

```bash
python - <<'EOF'
import io, re
dead = ["desc","emailTab","accountTab","submit","verifying","firstHint",
        "setPassword","setPasswordDesc","setPasswordDescNew","newPassword",
        "later","finish","emailCode","verifyFailed","setPasswordFailed"]
files = ["apps/web/src/i18n/dictionaries.ts","apps/web/src/i18n/it.ts",
         "apps/web/src/i18n/I18nProvider.tsx","packages/shared-types/src/index.ts"]
bad = []
for f in files:
    for i, line in enumerate(io.open(f, encoding="utf-8"), 1):
        for s in dead:
            if re.search(r'"login\.'+s+r'"(\s*[:,])', line):
                bad.append(f"{f}:{i}: login.{s}")
assert not bad, "\n".join(bad)
print("no dead keys remain in the four i18n files")
EOF
```
Expected: 打印 `no dead keys remain...`。

再确认 LoginModal 用到的每个 `login.*` key 在 zh 字典和 it.ts 里都有定义：

```bash
python - <<'EOF'
import io, re
modal = io.open("apps/web/src/components/LoginModal.tsx", encoding="utf-8").read()
used = set(re.findall(r't\("(login\.[A-Za-z]+)"', modal))
zh = io.open("apps/web/src/i18n/dictionaries.ts", encoding="utf-8").read()
zhblock = zh[zh.index("const zh"):zh.index("const en")]
it = io.open("apps/web/src/i18n/it.ts", encoding="utf-8").read()
missing = [k for k in sorted(used) if k not in zhblock or k not in it]
assert not missing, "missing: %s" % missing
print("all", len(used), "login keys used by LoginModal resolve in zh and it")
EOF
```
Expected: `all N login keys used by LoginModal resolve in zh and it`（N 为实际数量，约 24）。

- [ ] **Step 5: 类型检查与提交**

Run（`apps/web`）：`node_modules/.bin/tsc --noEmit`
Expected: 退出码 0。

Run（仓库根）：
```bash
git add apps/web/src/i18n/dictionaries.ts apps/web/src/i18n/it.ts \
  apps/web/src/i18n/I18nProvider.tsx packages/shared-types/src/index.ts
git diff --cached --stat
```
Expected: 恰好 4 个文件；净变化为 -116 行删除 + 8 行新增。

```bash
git commit -m "refactor(i18n): drop dead login keys and register the new ones

Remove the 13 OTP-login/set-password keys (plus verifyFailed and
setPasswordFailed from the EXTRA patches and it dictionary) that lost all
callers when email-code login was removed, across dictionaries.ts, it.ts,
I18nProvider.tsx and the shared-types translation catalog. Register the
four registration-code keys in UI_TRANSLATION_KEYS so the admin
translation UI can override them.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: 全量验证、推送分支、交付 PR 链接

**Files:** 无代码改动；仅运行验证与 git 推送。

- [ ] **Step 1: 后端全量**

Run（`services/api`）：
```bash
go build ./... && go vet ./... && go test ./...
```
Expected: build/vet 无输出；所有包 `ok`。

- [ ] **Step 2: 前端全量**

Run（`apps/web`）：
```bash
node_modules/.bin/tsc --noEmit && npm run lint -- --quiet
```
Expected: tsc 无输出；eslint 无错误（warning 可接受）。若 lint 报告与本分支无关的历史问题，记录但不修复。

- [ ] **Step 3: i18n 硬编码扫描回归**

Run（仓库根）：
```bash
node scripts/scan-i18n-missing-web.js && git status --short docs/i18n-missing-web-zh.md
```
Expected: 脚本正常退出；若 `docs/i18n-missing-web-zh.md` 出现改动，`git diff` 确认不是 LoginModal 新增中文（本分支 UI 文案全部走 `t()`，应为零新增）；该文件是生成产物，不提交，`git checkout -- docs/i18n-missing-web-zh.md` 还原。

- [ ] **Step 4: 提交本计划文档**

```bash
git add docs/superpowers/plans/2026-09-14-email-code-registration.md
git commit -m "docs: implementation plan for email-code registration

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

- [ ] **Step 5: 推送并给出 PR 链接**

Run：
```bash
git push -u origin feat/email-code-registration
```

在浏览器打开（本机无 gh CLI，按既有约定走浏览器）：

```
https://github.com/lihangyi1990-netizen/starai/compare/main...feat/email-code-registration?expand=1
```

PR 标题：
```
feat(auth): 注册强制邮箱验证码，登录仅保留邮箱+密码
```

PR 描述（末尾的 Generated 行必须保留）：

```markdown
## 变更

- **注册**：邮箱 + 密码 + 确认密码 + 6 位邮箱验证码；后端建号前强制验码，验证码一次性（`email_otp:register:<email>`，10 分钟），注册接口新增 `email_code`
- **登录**：仅邮箱 + 密码；删除验证码免密登录接口 `POST /auth/email/verify` 与补设密码接口 `POST /auth/set-password` 及对应前端 tab/步骤
- **发码防滥用**：`POST /auth/email/send-code` 语义收窄为注册专用；已注册邮箱拒发（「该邮箱已注册，请直接登录」）；后台开启图形验证码时发码同样强制校验图形验证码（前端早已采集并上送，后端此前忽略，本次接通）；保留 60 秒/邮箱冷却与 IP 限流；邮件文案改为注册语境
- **验证码消费时机**：校验通过只比对不删除；建号事务提交成功后才消费验证码，DB 瞬时失败不会吞掉用户已收到的码
- **i18n**：新增 4 个注册文案 key（6 语言）；清理 15 个失去引用的旧 key，并在 shared-types 翻译键表登记新 key
- **测试**：新增 `email_otp_test.go`，覆盖验码全分支（错码不消费、成功一次性）与发码守卫优先级（DB 错误 > 已注册 > 冷却）；`go test ./...`、前端 `tsc` 全绿

## 部署注意（合并后）

- 只需重建 **api + web**；无数据库迁移、无新环境变量；admin 无需为本次发布重建
- **上线前只读核对历史无密码账号**，有结果则暂停上线：
  ```sql
  SELECT count(*) FROM auth_identities
  WHERE provider='email' AND (credential_hash IS NULL OR credential_hash='');
  ```
- 注册依赖发信通路，上线后用真实邮箱验证：正常注册、已注册拒发、错码拒绝

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

- [ ] **Step 6: 收尾确认**

- `git log --oneline origin/main..HEAD` 应显示 5 个 commit（spec、实现、测试、i18n、plan，顺序以实际为准）。
- 明确告知用户：**未触碰生产服务器**；部署待 PR 评审合并后另行进行。

## Self-Review 记录（计划作者已核对）

- Spec 覆盖：接口增删（Task 1）、验码生命周期与发码查重（Task 1 实现 + Task 2 测试）、前端两 tab（Task 1）、i18n 清理与新键登记（Task 3）、验证与 PR 交付（Task 4）、上线前 SQL 核对（Task 4 PR 描述）均有对应任务。
- 无占位符：每步含完整命令或完整代码。
- 类型/命名一致：`evaluateRegisterSend(exists, existsErr, cooldown)` 在测试与实现中签名一致；缓存键 `email_otp:register:` 与 Task 1 代码一致；4 个新 key 名与 Task 1 前端/dictionaries 完全一致。
