# PulseFlow 打包 / 密钥生成 / 自动更新 完整备忘 (v2026-08-03)

> 本文档汇总：**本地手动打包 / GitHub Actions 自动打包 / Tauri Updater 密钥生成 / 应用内自动更新 / 关闭应用时自动安装 (Trae 风格)** 全流程。

---

## ══════════ 0. 版本号约定 ══════════

所有版本号 `X.Y.Z`（如 `0.1.0`、`0.2.0`）**必须同时同步 4 处**，否则 Updater 版本检测不生效：

| 位置 | 示例 | 改完验证 |
|------|------|----------|
| 1. 根 `package.json` | `"version": "0.1.0"` | `pnpm -v` 加载后 App.tsx `__APP_VERSION__` 会读 |
| 2. `packages/agentai-desktop/package.json` | `"version": "0.1.0"` | 桌面壳前端包版本 |
| 3. `packages/agentai-desktop/src-tauri/Cargo.toml` | `version = "0.1.0"` | Tauri build 生成安装包版本号 |
| 4. `packages/agentai-desktop/src-tauri/tauri.conf.json` | `"version": "0.1.0"` | Tauri 配置内版本（Updater 实际比较版本） |

> ✅ **一键检查**：4 处版本号必须完全一致，否则 Updater 会报告"已最新"但实际不是。

---

## ══════════ 1. Tauri Updater 签名密钥生成 ══════════

**必须做一次**。**公钥 (PUBLIC KEY) 进仓库，私钥 (PRIVATE KEY + 密码) 只填 GitHub Secrets / 本地 .env，绝对不要 git commit。**

### 1.1 生成命令 (PowerShell / Linux / macOS)

```bash
# 在仓库根目录执行（生成一对私钥+公钥，保存到 ~/.tauri-keys/）
cd f:\agentai-platform
pnpm tauri signer generate --password "你的私钥密码(强烈建议 32 位，字母+数字+符号)"
```

生成后终端会输出类似：

```
Signing keypair generated:
  Private key (DO NOT COMMIT):
    C:\Users\Administrator\.tauri-keys\PulseFlow_private.key
  Public key:
    dW50cnVzdGVkLS10aGlzLWlzLXBsYWNlaG9sZGVyLWZvci1vbmUtb2YtdGhlLW5ldy1rZXlzLWdlbmVyYXRlZC1kdXJpbmctZGVwbG95
  Environment variables:
    TAURI_PRIVATE_KEY=<content of .key file>
    TAURI_KEY_PASSWORD=<your password>
```

### 1.2 把公钥填入 `tauri.conf.json` (一次性)

打开 `packages/agentai-desktop/src-tauri/tauri.conf.json` → `plugins.updater.pubkey` 字段替换：

```json
{
  "plugins": {
    "updater": {
      "active": true,
      "endpoints": [
        "https://github.com/PulseFlowAI/pulseflow-platform/releases/latest/download/latest.json",
        "https://gitee.com/api/v5/repos/PulseFlowAI/pulseflow-platform/releases/latest"
      ],
      "dialog": true,
      "pubkey": "↙️↙️↙️ 把生成的 PUBLIC KEY (base64) 贴到这里 ↙️↙️↙️"
    }
  }
}
```

### 1.3 私钥保存（3 个位置）

| 位置 | 变量名 | 内容 | 用途 |
|------|--------|------|------|
| **本地 .env**（手动打包用） | `TAURI_PRIVATE_KEY` | `~/.tauri-keys/PulseFlow_private.key` 文件的 `全部内容`（含 `-----BEGIN-----/-----END-----`） | `pnpm tauri build` 本地签名安装包 |
| 同上 | `TAURI_KEY_PASSWORD` | 你生成时输的密码（若生成时为空则不设置） | 同上 |
| **GitHub Secrets**（CI 自动打包用） | `TAURI_SIGNING_PRIVATE_KEY` | 同上 `.key` 内容 | GitHub Actions `.github/workflows/release-desktop.yml` |
| 同上 | `TAURI_SIGNING_PUBLIC_KEY` | 公钥（可选，日志调试用） | 同上 |
| 同上 | `TAURI_KEY_PASSWORD` | 同上密码 | 同上 |
| 同上 | `GITHUB_TOKEN` | **不用设置**，`${{ secrets.GITHUB_TOKEN }}` 是 GitHub Actions 自动注入 | Release 发布权限 / 上传 Assets |

> 🔒 **安全提醒**：不要把 `TAURI_PRIVATE_KEY` 的值贴到任何 Issue / PR / 聊天里，一旦泄露 GitHub 任何人都能伪造你的安装包更新。

---

## ══════════ 2. 本地手动打包（开发调试用） ══════════

### 2.1 环境要求

```bash
# Node.js ≥ 22 (Tauri 要求 LTS 最新)
node -v
# → v22.x

# Rust 工具链 (rustup default stable-msvc / stable)
rustc -V
# → rustc 1.8x.x

# Rust 平台 target (Windows x64)
rustup target list --installed
# → 必须包含: x86_64-pc-windows-msvc
# 如缺失: rustup target add x86_64-pc-windows-msvc

# WebView2 (Win10 1803+/Win11 自带，不用装)
```

### 2.2 安装依赖（首次）

```bash
cd f:\agentai-platform
# 全量安装 (Monorepo)
pnpm install

# 只装 Desktop 子包
pnpm --filter agentai-desktop install
```

### 2.3 本地签名 `.env`（如果要打包出**带签名**的安装包，Updater 能识别）

在仓库根目录 `.env` 追加：

```env
# ← 从 ~/.tauri-keys/PulseFlow_private.key 整文件复制进来 (含 -----BEGIN-----)
TAURI_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n
TAURI_KEY_PASSWORD=你的私钥密码
```

### 2.4 执行打包

```bash
cd f:\agentai-platform
pnpm build:desktop      # 对应根 package.json: pnpm --filter agentai-desktop tauri build
```

产物位置：
```
packages/agentai-desktop/src-tauri/target/release/bundle/
├─ msi/
│   └─ PulseFlow_0.1.0_x64_en-US.msi           ← Windows 安装包 (MSI)
├─ nsis/
│   └─ PulseFlow_0.1.0_x64-setup.exe          ← Windows 安装包 (NSIS, 推荐分发)
│   └─ PulseFlow_0.1.0_x64-setup.exe.sig      ← ✅ 签名文件 (Updater 必需)
└─ ...
```

> ✅ `.sig` 文件存在 = 本地私钥注入成功，Updater 能校验。如果没生成 `.sig`，检查 `.env` 里 `TAURI_PRIVATE_KEY` 是否包含 `-----BEGIN PRIVATE KEY-----` 完整首尾，是否有多余换行。

### 2.5 本地生成 `latest.json`（模拟 CI 输出）

```bash
cd packages/agentai-desktop/src-tauri/target/release/bundle/nsis
dir *.sig
```

然后人工按格式写 latest.json（示例 Windows）：

```json
{
  "version": "0.1.0",
  "notes": "本地测试版",
  "pub_date": "2026-08-03T12:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "（把 .sig 文件的内容整段贴进来）",
      "url": "https://你的域名/PulseFlow_0.1.0_x64-setup.exe"
    }
  }
}
```

---

## ══════════ 3. GitHub 自动打包 + 自动更新 ══════════

### 3.1 推送 Tag 触发 CI

```bash
# 1. 同步 4 处版本号 (见 §0)
# 2. 打 tag
git tag v0.1.0
git push --tags
```

→ GitHub Actions 自动跑 `.github/workflows/release-desktop.yml` → 4 平台 30~60 分钟完成。

### 3.2 Release 页面 4 平台产物

```
x86_64-setup.exe         (Windows 安装包)
x86_64-setup.exe.sig     (签名)
aarch64.dmg              (macOS Apple Silicon)
aarch64.dmg.sig          (签名)
x86_64.dmg               (macOS Intel)
x86_64.dmg.sig           (签名)
x86_64.AppImage          (Linux)
x86_64.AppImage.sig      (签名)
latest.json              (Updater 读取的版本清单)
```

### 3.3 Updater 端点指向

已配置在 `tauri.conf.json`，**无需改**：

```
https://github.com/PulseFlowAI/pulseflow-platform/releases/latest/download/latest.json
```

GitHub 的 `/releases/latest/download/<asset_name>` 永远会**重定向到最新 Release**，不用再改版本号。

---

## ══════════ 4. 应用内自动更新 & 关闭应用时自动安装 (Trae 风格) ══════════

### 4.1 用户感知的 3 条路径

| 路径 | 触发 | 行为 |
|------|------|------|
| **主动更新** | 设置 → 自动更新 → 「检查更新」→ 「立即安装」 | 前台下载 + 立即安装重启 |
| **后台静默 + 关闭时安装（默认，Trae 风格）** | 启动后 8s | 1. 静默 check → 发现新版本后台静默下载<br>2. 下载完 TitleBar 右侧出现 💜 `v0.2.0 就绪` 徽章<br>3. 用户点 **× 关闭窗口** → 弹 Modal 确认 3 选项（见下）|
| **用户勾选「以后自动安装」** | Modal 里勾选后持久化到 localStorage | 下次直接关窗口 → **无弹窗静默安装重启** |

### 4.2 关闭时 Modal 的 3 个按钮

```
┌─────────────────────────────────────────────┐
│ 💜 新版本已下载完成                         │
├─────────────────────────────────────────────┤
│ ⬇️ PulseFlow v0.2.0 · 2026-08-03            │
│    安装包 95 MB · 安装后自动重启            │
│                                             │
│ ℹ️ 和 Trae 一样：关闭应用时自动安装          │
│   点 [关闭并自动安装重启] ...               │
│                                             │
│ ☐ 以后关闭时自动安装（不再询问）            │
├─────────────────────────────────────────────┤
│             [取消] [仅关闭，下次启动安装]   │
│                 [关闭并自动安装重启] 🔵     │
└─────────────────────────────────────────────┘
```

### 4.3 状态机（前端 store/updaterStore.ts）

```
idle → checking → downloading → ready → installing → (Tauri updater 自动退出重启)
                ↘ error (写 store.error, 下次启动重试)
```

Rust 端会**把上次下载好但用户选了「仅关闭」的版本写入 AppState.pending 内存**，下次启动瞬间拉回来 → TitleBar 立即显示「已就绪」，不会重复下载。

---

## ══════════ 5. 常见问题 (FAQ) ══════════

| 现象 | 原因 | 解决 |
|------|------|------|
| 启动后 TitleBar 不出现更新徽章 | (1) 版本号一致 (2) latest.json endpoints 访问不到 (3) 本地 build 没签名 | ① 把 tag 推到 GitHub 让 CI 出 latest.json；② 4 处版本号差一位都不会提示更新 |
| 关闭窗口不弹 Modal，直接关了 | Updater 阶段还没到 ready 或 pending.downloaded=false | 点 TitleBar 徽章 tooltip 看当前阶段 |
| Rust 端 log 出现 `[Updater] 后台静默检查失败` | endpoints URL 不可访问或返回格式错 | 浏览器直接打 tauri.conf.json 里两个 endpoints 看能否拿到 JSON |
| 本地 build 没生成 .sig 文件 | `TAURI_PRIVATE_KEY` 没生效或粘贴有多余空格 | 先 `$env:TAURI_PRIVATE_KEY=(cat ~/.tauri-keys/xxx.key -Raw)` 再跑 pnpm tauri build |
| 安装包能下载但更新失败签名校验 `Signature invalid` | `pubkey` 贴错或用了非本次 PRIVATE KEY 生成的签名 | 重新跑 §1.1 生成一组新密钥，pubkey 换上去后再打 CI 包 |
| 「取消」关不掉 Modal | maskClosable=false 设计如此（防止误触） | 点「取消」按钮或右上角 ✕ |

---

## ══════════ 6. 一键升级 Checklist 模板 ══════════

每次发布新版本前对照：

```
□ 同步 4 处版本号 vX.Y.Z (根 package.json / desktop package.json / Cargo.toml / tauri.conf.json)
□ CHANGELOG.md 已更新（git cliff 或手动）
□ 提交 + git tag vX.Y.Z
□ git push && git push --tags
□ 30 分钟后到 Actions 页面看 release-desktop ✅ ✅ ✅ ✅ (4 平台)
□ Release 页面确认 4 个 .sig + latest.json 已上传
□ 老版本本地打开确认设置 → 自动更新 → 「发现新版本 vX.Y.Z」能正常弹出
□ 关窗口 → Modal 「关闭并自动安装重启」 → 新版本自动启动

---

## ══════════ 7. 2026-08-03 P0 修复记录 ══════════

### 7.1 Token 超出预算：仅提示 AI 提前总结，**不中止任务**

**根因**：`cost/tracker.ts` 中 `severity` 设为 `critical`，业务端误将其当作中止信号；同时 `llm-router.ts` 对 Agnes 模型用了硬编码 `contextWindow: 512`，导致真实 256K 窗口被误判为接近满负荷。

**修复**：
| 位置 | 改动 |
|------|------|
| `cost/tracker.ts` | `severity: 'critical'` → `'warning'`，message 追加「建议 AI 提前生成最终总结并收尾；系统不会中止当前任务」 |
| `llm-router.ts` (L1298 后) | 新增 `PROVIDER_CONTEXT_WINDOW` 映射表，Agnes 2.5 系列 `524288`(512K)、Agnes 2.0 `262144`(256K)、智谱 `1_048_576`(1M)、DeepSeek `131072` |
| `llm-router.ts` (L1404) | `ctxWindow` 改为三层优先级：① `req.contextWindow`（用户自定义/上下文扩展）→ ② `PROVIDER_CONTEXT_WINDOW[modelName]`（按 model 名精确取，如 agnes-2.0 → 256K）→ ③ `defaultCtx`（provider 级默认，如 agnes → 512K）|

### 7.2 模型切换：同厂禁止回切（Agnes 2.5/2.0 同源）

**根因**：Agnes 2.5 和 Agnes 2.0 共享同一套 API endpoint，2.5 失败后切到 2.0 依然失败。原逻辑仅排除单个 `excludeProvider`，未做**整组排除**。

**修复**：
| 位置 | 改动 |
|------|------|
| `smart-model-switcher.ts` `_selectCommercialProvider()` | 用 `VENDOR_GROUPS` 分组（`agnes` 组含 `agnes` + `agentai` 两个 alias），失败时**整组跳过**；切换顺序：智谱/免费异厂 → DeepSeek Flash → SuperAPI → 其他商用 |
| `llm-router.ts` (L545) | 新增 `VENDOR_GROUPS` + `MODEL_MAP` + `findVendorGroupId()`（三层查找：provider→group / model→group / 自定义兜底）；备用轮换循环（L600）加 `sameVendorAsFailed(model.provider)` 提前 `continue` |

切换优先级（用户指定）：
```
免费异厂: 智谱 → sensenova → longcat → dxnt
商用异厂: DeepSeek-Flash → SuperAPI → Qwen → Moonshot → …
最终兜底: 智谱 (有免费额度)
禁止: 同厂回切（Agnes 2.5 ↔ 2.0 / agentai 别名）
```

### 7.3 技能系统：read_excel 不存在的修复

**根因**（3 个）：
1. 技能目录 `packages/agentai-gateway/skills/read-excel/` 存在，但元数据文件是 `skill.json` 而非 `SKILL.md`，扫描器没处理
2. `index.js` 里写的其实是 Python 代码（AI 自动生成时内容写错），不是有效 JS
3. 技能名注册为 `read-excel`（中划线），但 AI 调用的是 `read_excel`（下划线）

**修复**：
| 位置 | 改动 |
|------|------|
| `skill-orchestrator.ts` `scanDirectory()` | 兼容扫描 `skill.json` + `SKILL.md`，递归深度 3 层 |
| `skill-orchestrator.ts` `_registerFromDir()` | 新增 `detectFileContent()` 检测 `index.js` 实际是否为 Python 代码，是则写临时 `.py` 用 `python-bridge` 执行；双别名自动注册（`read-excel` ↔ `read_excel`） |
| `skill-orchestrator.ts` `executeSkill()` | 新增 `normalizeSkillName()`（下划线/中划线/大小写归一化）+ `_builtinFallbackSkill()`（内置 `read_excel`/`read_csv`/`read_pdf`/`web_search` fallback，即使技能未注册也能跑通） |

---

## ══════════ 8. 本地验证命令 ══════════

```powershell
# Gateway 编译验证
cd f:\agentai-platform\packages\agentai-gateway
pnpm run typecheck

# GUI 编译验证
cd f:\agentai-platform\packages\agentai-gui
npx tsc --noEmit
```

两个都 exit code 0 才算通过。
```
