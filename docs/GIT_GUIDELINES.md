# AgentAI Platform — Git 工作流规范 v1.0

> 最后更新: 2026-06-08
> 富哥指令: "项目及GIT说明相关规范一定清晰"

---

## 〇、核心原则

1. **主分支保护**: `main` 不可直接 push, 必须 PR + 至少 1 评审
2. **小颗粒提交**: 一次提交只做一件事, 50-300 行最佳
3. **Conventional Commits**: 提交信息严格遵循 [Conventional Commits 1.0](https://www.conventionalcommits.org/)
4. **CI/CD 必跑**: PR 必须通过所有检查才能合并
5. **不破坏历史**: 禁止 force push 到 `main` / `master`

---

## 一、分支策略 (Git Flow 简化版)

```
main (生产) ─────────────────────────●  (每次发版打 tag)
   │
   ├── develop (开发主线) ──────────●──●──●──●──
   │     │
   │     ├── feature/xxx ──●──● (合到 develop 后删)
   │     ├── fix/xxx ───────●──● (合到 develop + main 后删)
   │     └── refactor/xxx ──●──●
   │
   ├── release/v0.x.0 ────●──● (从 develop 分出, 准备发版)
   │     │
   │     └── 合到 main (打 tag) + 合回 develop
   │
   └── hotfix/xxx ────●──● (从 main 分出, 紧急修复, 直接合到 main + develop)
```

### 1.1 分支命名规范

| 类型 | 格式 | 示例 | 生命周期 |
|------|------|------|----------|
| 主分支 | `main` / `develop` | `main` | 永久 |
| 功能 | `feature/<scope>-<name>` | `feature/skill-image-gen` | 短期 (合后删) |
| 修复 | `fix/<scope>-<name>` | `fix/gateway-port-conflict` | 短期 |
| 重构 | `refactor/<scope>-<name>` | `refactor/skill-manager` | 短期 |
| 文档 | `docs/<name>` | `docs/tutorial-v2` | 短期 |
| 发布 | `release/v<major>.<minor>.<patch>` | `release/v0.2.0` | 中期 (发版完删) |
| 热修 | `hotfix/<scope>-<name>` | `hotfix/cve-2026-001` | 极短 |

**scope 命名空间** (项目模块):
- `gateway` / `core` / `gui` / `desktop` / `skills` / `docs` / `ci` / `infra`

### 1.2 实战示例

```bash
# 1. 拉最新 develop
git checkout develop
git pull origin develop

# 2. 从 develop 开 feature 分支
git checkout -b feature/skill-image-gen

# 3. 编码 + 多次提交
git add .
git commit -m "feat(skills): add agentai-image-gen skeleton"
git commit -m "feat(skills): wire to Agnes Image 2.1 API"
git commit -m "test(skills): add image-gen integration tests"

# 4. 推远程 + 开 PR
git push -u origin feature/skill-image-gen
gh pr create --base develop --title "feat(skills): agentai-image-gen skill" --body "..."

# 5. CI 通过 + Reviewer 批准 + 合并
gh pr merge --squash  # squash 模式合并, 保持 main 历史干净

# 6. 删本地分支
git checkout develop
git pull
git branch -d feature/skill-image-gen
```

---

## 二、提交信息规范 (Conventional Commits)

### 2.1 格式

```
<type>(<scope>): <subject>
<BLANK LINE>
<body> (可选, 详细说明)
<BLANK LINE>
<footer> (可选, BREAKING CHANGE / Closes #issue)
```

### 2.2 type 必选 (12 个)

| type | 含义 | 示例 |
|------|------|------|
| `feat` | 新功能 | `feat(skills): add agentai-image-gen skill` |
| `fix` | Bug 修复 | `fix(gateway): port 18789 conflict on Windows` |
| `docs` | 文档 | `docs: add tutorial v1.0` |
| `style` | 格式 (空格/分号) | `style(gui): format with prettier` |
| `refactor` | 重构 (不改功能) | `refactor(core): simplify skill loader` |
| `perf` | 性能优化 | `perf(gateway): cache LLM responses 5min` |
| `test` | 测试 | `test(skills): add image-gen unit tests` |
| `build` | 构建/依赖 | `build: bump tauri to 2.1.0` |
| `ci` | CI/CD | `ci: add GitHub Actions for Windows` |
| `chore` | 杂项 (注释/格式化) | `chore: update .gitignore` |
| `revert` | 回滚 | `revert: feat(skill-x) #123` |
| `security` | 安全修复 | `security: fix path traversal in skill loader` |

### 2.3 subject 规则

- 50 字符以内
- 动词开头, 祈使语气 ("add" 不是 "added")
- 首字母小写
- 末尾不加句号
- 中文项目可用中文, 但**保持一致**

### 2.4 body 规则

- 72 字符换行
- 解释"为什么"而不是"是什么"
- 关联 issue: `Closes #123` / `Refs #456`

### 2.5 BREAKING CHANGE

任何破坏性变更必须在 footer 标 `BREAKING CHANGE: <说明>`:

```
feat(gateway)!: rename --config to --config-file

BREAKING CHANGE: --config flag is now --config-file to align with v2 spec.
Migration: sed -i 's/--config /--config-file /g' scripts/
```

### 2.6 完整示例

```
feat(skills): add agentai-image-gen skill

Implements the multimodal image generation skill using Agnes Image 2.1 API.
Supports:
- text-to-image (T2I)
- image-to-image (I2I)
- 1024x1024 / 2048x2048 resolution
- 10+ style presets (oil-paint / watercolor / cyberpunk / etc.)

Pricing: 1 credit per image, free tier 100 images/month.

Closes #42
Refs #38 (parent: multimodal initiative)
```

---

## 三、PR (Pull Request) 流程

### 3.1 PR 标题

与 commit subject 一致, 用 `type(scope): subject` 格式:

```
feat(skills): add agentai-image-gen skill
```

### 3.2 PR 模板 (`.github/PULL_REQUEST_TEMPLATE.md`)

```markdown
## 📋 变更说明

<!-- 简述这个 PR 做什么 -->

## 🎯 关联 Issue

Closes #
Refs #

## 🧪 测试

- [ ] 单元测试通过 (`pnpm test`)
- [ ] 集成测试通过 (`pnpm test:integration`)
- [ ] 手动测试通过 (Tauri 桌面 + Web + QQ + VSCode 至少 1 渠道)
- [ ] 文档已更新 (README / docs/)
- [ ] CHANGELOG.md 已更新

## 📸 截图 / 日志 (可选)

<!-- 贴截图或关键日志 -->

## ⚠️ Breaking Change

- [ ] 否
- [ ] 是 → footer 已说明

## ✅ Checklist

- [ ] 代码风格: `pnpm lint` 通过
- [ ] 类型检查: `pnpm typecheck` 通过
- [ ] 已自审 (diff 完整看过)
- [ ] 至少 1 位 Reviewer 批准
- [ ] 分支与 base 无冲突
```

### 3.3 Reviewer 要求

| 变更类型 | 必填 Reviewer | 数量 |
|---------|-------------|------|
| `feat` / `fix` 核心 | 核心维护者 | 1+ |
| `feat` / `fix` 技能 | 技能所有者 | 1+ |
| `docs` | 任意维护者 | 1 |
| `style` / `chore` | 任意 | 1 |
| `security` | 安全负责人 | 2 |
| `BREAKING CHANGE` | 核心维护者 | 2+ |

### 3.4 合并策略

- **Squash Merge** (默认): 多个 commit 合成 1 个, 历史干净
- **Rebase Merge**: 保留每个 commit, 适合功能清晰的小 PR
- **Merge Commit**: 保留完整分支历史, 仅用于 release

**禁用**: 任何分支的 Force Push (除非维护者明确同意)

---

## 四、版本号 (SemVer 2.0.0)

```
v<MAJOR>.<MINOR>.<PATCH>-<PRERELEASE>
```

| 增量 | 触发 |
|------|------|
| MAJOR | 破坏性变更 (BREAKING CHANGE) |
| MINOR | 新功能 (向后兼容) |
| PATCH | Bug 修复 (向后兼容) |
| PRERELEASE | 预发布: `alpha.1` / `beta.2` / `rc.3` |

**示例**:
- `v0.1.0-alpha.1` → 阶段 1 脚手架
- `v0.2.0` → 阶段 2 智能体核心
- `v0.5.0` → 阶段 5 VSCode 集成
- `v1.0.0` → 完整 6 阶段全部验收

---

## 五、CHANGELOG.md (自动生成)

```markdown
# Changelog

## [Unreleased]

### Added
- (下一个版本的变更)

## [0.2.0] - 2026-06-15

### Added
- feat(skills): agentai-image-gen skill (#45)
- feat(gateway): LLM intelligent routing (#42)
- docs: tutorial v1.0 (#38)

### Fixed
- fix(gateway): port conflict on Windows (#40)
- fix(skills): sandbox memory leak (#39)

### Security
- security: AES-256-GCM key encryption (#36)
```

**自动生成** (CI 流程):
```bash
npx standard-version  # 或 commitlint + release-please
```

---

## 六、Tag 与 Release

### 6.1 打 Tag

```bash
# 打 tag
git tag -a v0.2.0 -m "v0.2.0 - Stage 2: Agent Core"
git push origin v0.2.0

# 列 tag
git tag -l

# 删除 tag
git tag -d v0.2.0
git push origin :refs/tags/v0.2.0
```

### 6.2 GitHub Release

每次 `v*.*.*` tag 触发 GitHub Actions 自动:
- 跨平台编译 (Windows / Mac / Linux)
- 桌面端 Tauri 打包 (NSIS / DMG / AppImage)
- VSCode 扩展发布到 Marketplace
- npm 包发布 (各子包)
- 草拟 Release Notes (基于 CHANGELOG)

### 6.3 紧急热修 (Hotfix)

```bash
# 1. 从 main 开 hotfix
git checkout main
git pull
git checkout -b hotfix/gateway-port-conflict

# 2. 修 bug + 提交
git commit -m "fix(gateway): port 18789 conflict on Windows

Closes #45"

# 3. 合到 main + 打 tag + 合回 develop
git checkout main
git merge --no-ff hotfix/gateway-port-conflict
git tag -a v0.2.1 -m "hotfix: port conflict"
git push origin main v0.2.1

git checkout develop
git merge --no-ff hotfix/gateway-port-conflict
git push origin develop

# 4. 删分支
git branch -d hotfix/gateway-port-conflict
```

---

## 七、.gitattributes 跨平台

```gitattributes
# 防止 CRLF/LF 冲突 (Windows ↔ Linux)
* text=auto eol=lf

# 显式 LF
*.js   text eol=lf
*.ts   text eol=lf
*.json text eol=lf
*.md   text eol=lf
*.yml  text eol=lf
*.yaml text eol=lf
*.sh   text eol=lf

# 二进制
*.png binary
*.jpg binary
*.ico binary
*.exe binary
*.dll binary
*.so binary
*.dylib binary
*.node binary
```

---

## 八、Submodule / Monorepo 策略

AgentAI Platform 是 **pnpm workspace** 单仓多包:

```
agentai-platform/         ← 单仓 (monorepo)
├── packages/
│   ├── agentai-gateway/    ← 独立子包, 可独立发版
│   ├── agentai-core/
│   ├── agentai-gui/
│   ├── agentai-desktop/
│   └── agentai-skills/
├── apps/
│   ├── docs-site/         ← 文档站
│   └── market/            ← 技能市场
├── package.json
├── pnpm-workspace.yaml
├── .npmrc
└── .gitignore
```

**单仓多包优势**:
- 一次 PR 跨多个包
- 共享 types / utils
- 统一发版

**锁定版本** (跨包依赖):
- `@agentai/core`: workspace 协议 → 总是最新本地代码
- `react`: ^18.2.0 → 统一版本

---

## 九、CI/CD (GitHub Actions)

### 9.1 PR 检查 (`.github/workflows/pr.yml`)

```yaml
name: PR Check
on: pull_request
jobs:
  lint-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - run: pnpm install
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm test:integration
```

### 9.2 桌面端打包 (`.github/workflows/release.yml`)

```yaml
name: Release
on:
  push:
    tags: ['v*.*.*']
jobs:
  tauri-build:
    strategy:
      matrix: [windows-latest, macos-latest, ubuntu-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - run: pnpm install
      - run: pnpm --filter @agentai/desktop tauri build
      - uses: actions/upload-artifact@v4
        with:
          name: agentai-desktop-${{ matrix.os }}
          path: packages/agentai-desktop/src-tauri/target/release/bundle/
```

---

## 十、Committer 身份

### 10.1 全局设置 (一次性)

```bash
git config --global user.name "Your Name"
git config --global user.email "your.email@example.com"
```

### 10.2 GPG 签名 (推荐)

```bash
# 生成 GPG key
gpg --full-generate-key

# 配置 git 使用
git config --global user.signingkey <GPG_KEY_ID>
git config --global commit.gpgsign true

# 让 GitHub 识别: https://github.com/settings/keys 添加 GPG 公钥
```

签名后 commit 旁会有 `Verified` 徽章 ✅

---

## 十一、Code Review 礼仪

### 11.1 Reviewer 规则
- **24 小时内** 第一次响应
- 优先看 **PR 描述** (不是直接看 diff)
- 区分 **必须修改** (🚫) / **建议** (💡) / **nit** (小问题)
- 用 **问题句** 而非 **命令句**: "这里能不能用 ...?" 而不是 "改成 ..."
- 看到好的代码要夸 ✨ (PR 鼓励文化)

### 11.2 作者规则
- **小颗粒** 提交 (避免 1000+ 行大 PR)
- **先自审** 再请求 Review
- **解释** 设计选择, 不仅是实现
- 对 Review 反馈要 **逐条回应** (即使只是 "已修")
- 接受建设性批评, 解释技术分歧

### 11.3 Review 标签 (建议)

- 🚫 **MUST FIX** (阻断合并)
- 💡 **SUGGESTION** (建议, 可不修)
- ❓ **QUESTION** (提问, 等作者解释)
- 🎨 **NIT** (小问题, 美化)
- ✨ **PRAISE** (好代码!)

---

## 十二、紧急流程 (Secrets 泄露)

**如果发现真实密钥被提交到 Git**:

```bash
# 1. 立即 rotate 密钥 (在各平台控制台)

# 2. 用 BFG Repo-Cleaner 清除历史
brew install bfg
bfg --delete-files .env
git reflog expire --expire=now --all
git gc --prune=now --aggressive
git push --force

# 3. 通知所有 Collaborators 重新拉取

# 4. 提交 incident report
```

**预防** (本项目已配置):
- ✅ `.gitignore` 强制拦截 `.env` / `keys.enc` / `.salt`
- ✅ pre-commit hook: `git secrets --install` 扫描常见密钥模式
- ✅ CI 检查: 检测到 `sk-` / `pk-` / `AKIA` 等前缀 → 失败

---

**v1.0 完, 富哥验收 + 拍板开阶段 1 时同步落地 .github/ 目录**
