# 新成员上手

这份文档只讲**从拿到仓库访问权到提交第一个 PR**。本地环境怎么跑见 [README.md](README.md)，日常规矩见 [CONTRIBUTING.md](CONTRIBUTING.md)。

---

## 最重要的一件事

**从现在起，不要再 SSH 登录服务器改代码。**

以前大家都是登进 `/opt/starai` 直接改文件。这样做没有任何记录：谁改了什么、什么时候改的、为什么改，全都查不到；两个人改同一个文件，后写的直接覆盖前面的，连提示都没有。之前服务器上留下的一堆 `.orig`、`.rej`、`.bak-*` 文件就是这么来的。

现在服务器已经是 git 工作副本了，改动会被 `git status` 记录下来 —— 但**记录不等于允许**。正确的做法是在自己机器上改、走 PR、然后在服务器上 `git pull`。

服务器上的 git 密钥是**只读**的，推不上去，这是故意的。

---

## 1. 接受仓库邀请

仓库是私有的。项目负责人会通过 GitHub 邀请你，你会收到邮件，点击接受即可。

接受后确认能打开：https://github.com/lihangyi1990-netizen/starai

## 2. 配置 SSH 密钥

如果你还没有给这台机器配过 GitHub 的 SSH 密钥：

```bash
# 生成（邮箱换成你自己的）
ssh-keygen -t ed25519 -C "your@email.com"
# 一路回车即可，密码可以留空

# 查看公钥
cat ~/.ssh/id_ed25519.pub
```

把输出的那一整行贴到 https://github.com/settings/keys → **New SSH key**。

验证：

```bash
ssh -T git@github.com
# 看到 "Hi <你的用户名>! You've successfully authenticated" 就成功了
# 它后面会说 "does not provide shell access"，这是正常的
```

## 3. 克隆仓库

```bash
git clone git@github.com:lihangyi1990-netizen/starai.git
cd starai
```

## 4. 准备环境变量

仓库里**没有**真实的密钥文件，这是有意的 —— `.env.production` 装着生产数据库密码、对象存储凭据和模型网关密钥，一旦进了 git 历史就很难彻底清除。

本地开发不需要生产密钥，用仓库自带的模板即可：

```bash
cp .env.local .env
```

然后按 [README.md](README.md) 的「本地一键启动」跑起来。

如果你确实需要生产配置（一般只有部署时才需要，且应该直接在服务器上操作），找项目负责人通过安全渠道索取，**不要**发在群聊里、也不要提交进仓库。

## 5. 提交你的第一个改动

```bash
git checkout main
git pull                          # 永远先同步再开分支

git checkout -b fix/你的改动简述    # 分支名用英文，能看懂就行

# ...改代码...

git add -A
git commit -m "说清楚改了什么、为什么"
git push -u origin fix/你的改动简述
```

推送后终端会打印一个链接，点开 → **Create pull request**。

PR 建好后 GitHub Actions 会自动跑检查（Go 测试、前端构建、迁移文件校验）。**合并前看一眼绿色 Merge 按钮上方的 checks 区域** —— 目前仓库没有开强制检查（免费版私有仓库不支持），所以红着也能合并，全靠自觉。

合并后清理：

```bash
git checkout main
git pull
git branch -d fix/你的改动简述
```

## 6. 如果你要改数据库迁移

这是唯一一类 git 会**静默合并出错**的改动，务必读 [CONTRIBUTING.md](CONTRIBUTING.md) 的迁移章节。三条要点：

- **动手前先 `git pull`**，再看 `infra/migrations/` 里最大的编号是多少，你的用下一个。两个人同时用了同一个编号，git 合并时不会报冲突，但部署会炸。
- `.up.sql` 和 `.down.sql` **必须成对**。
- 改完跑 `node scripts/update-migration-checksums.js` 重新生成校验清单，**不要手动编辑** `checksums.sha256`（手改正是它之前出错的原因）。

已经应用到生产的迁移**绝对不能再改内容** —— 改了校验和就对不上，部署会失败。要修就新加一个迁移。

---

## 如果你之前在服务器上改过东西

先别慌，也别急着覆盖。登上服务器看一眼：

```bash
cd /opt/starai
git status          # 列出所有被改动的文件
git diff            # 看具体改了什么
```

然后判断：

- **这个改动还需要** → 记下改了什么，回自己机器上重新走一遍分支 + PR 流程
- **这个改动不需要了** → `git checkout -- <文件路径>` 撤回

**永远不要在服务器上跑 `git reset --hard`** —— 它会连别人未提交的改动一起清掉，且无法恢复。
