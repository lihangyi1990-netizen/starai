# 协作规范

## 一条核心规则

**仓库是唯一真相源。不要在服务器上直接改源码。**

在此之前 `/opt/starai` 没有版本管理，几个人共用一个 root 账号直接编辑，结果是：`*.orig` / `*.before` / `*.bak-*` 一堆手改残渣、迁移号 018 / 020 / 081 三处撞车、`checksums.sha256` 被追加出一条重复行同时漏掉了 097。谁改的、改了什么、线上跑的是哪个版本，全都查不出来。

下面的流程就是为了让这些问题不再发生。

---

## 日常开发

```bash
git switch main && git pull
git switch -c feat/<简短名>

# 改代码，本地先自测（别拿 CI 当编译器）
cd services/api && go test ./... && go vet ./...
cd ../worker && go test ./... && go vet ./...
pnpm -r lint

git push -u origin feat/<简短名>
```

然后在 GitHub 开 PR，等 `verify` 变绿再合入 `main`。

`main` 已开启保护：CI 不通过合不进去。2-3 人规模不强制他人 review，但**不要绕过 CI**。

---

## 部署

```bash
ssh 服务器
cd /opt/starai
git pull
bash scripts/deploy-prod.sh
```

`deploy-prod.sh` 会先打印本次部署的 commit、分支、未提交改动数，以及 HEAD 是否在 `origin/main` 上，并写进 `.deployed-commit`。**部署前看一眼这几行**，确认部署的确实是你以为的那个版本。

想强制只允许部署已合入 main 的代码：

```bash
REQUIRE_CLEAN_TREE=1 bash scripts/deploy-prod.sh
```

工作区脏、或 HEAD 不在 `origin/main` 上，都会被拒绝。

---

## 新增数据库迁移（最容易出事的地方）

迁移撞号是**最危险的一类冲突，因为 git 不会报警** —— 两人各加一个不同文件名的迁移，合并干净通过，但数据库里的执行顺序就变得不确定了。018 / 020 / 081 就是这么来的。

务必按顺序做：

```bash
# 1. 先 pull，再取号。不 pull 就取号 = 撞号
git switch main && git pull

# 2. 看当前最大号
ls infra/migrations/*.up.sql | tail -1

# 3. 用下一个号，up 和 down 必须成对（缺 down 会被 CI 拦）
#    infra/migrations/098_your_change.up.sql
#    infra/migrations/098_your_change.down.sql

# 4. 重新生成校验和清单 —— 不要手工编辑这个文件
node scripts/update-migration-checksums.js

# 5. 本地先验一遍
node scripts/verify-migrations.js
```

两条铁律：

- **`checksums.sha256` 只能由脚本生成**。手工往里追加就是那条重复的 095 行的来历。
- **已经执行过的迁移永不修改**。要改就加一个新迁移。改了老迁移，CI 的 checksum 校验会拦你 —— 那不是误报，是因为生产库里已经按老内容执行过了。

018 / 020 / 081 保留现状不重编号：它们已经在生产库执行过，重编号会破坏迁移记录。它们在 `verify-migrations.js` 的白名单里，**新的重号仍然会被拦住**。

---

## 万一在服务器上改了

排障时临时改一下是可以的，但收尾必须做：

```bash
cd /opt/starai
git status          # 看看动了什么
git diff            # 看清具体改动
```

然后二选一：

```bash
# 改动有价值 → 提交成分支，走正常 PR 流程
git switch -c fix/<简短名> && git add -p && git commit && git push -u origin fix/<简短名>

# 改动是临时的 → 丢掉
git checkout -- <文件>
```

**不要**留着不管。留着的后果就是下一个人 `git pull` 时冲突，或者被无声覆盖。

**不要**在服务器上跑 `git reset --hard`，也不要跑 `scripts/sync-update.sh`（整树 `rsync --delete`，会按旧快照误删服务器文件）。

AI agent（codex / Claude Code 等）同样走这套流程，不要让它直接写生产目录。

---

## 不纳入版本管理的东西

`.env.production` 含生产凭据，只存在于服务器上，已被 `.gitignore` 排除。需要新增配置项时，改 `.env.example` 模板并在 PR 里说明，再由部署的人手动同步到服务器的 `.env.production`。

`data/`（用户上传）和 `backups/` 同样不入库。
