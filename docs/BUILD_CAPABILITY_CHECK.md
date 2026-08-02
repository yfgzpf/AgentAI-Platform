# PulseFlow 打包能力检查报告

> **检查时间**：2026-08-03 01:45  
> **文档依据**：`docs/build-and-deploy.md`  
> **结论**：⚠️ **需修复后具备完整推送打包能力**

---

## 一、检查结果总览

| 检查项 | 状态 | 问题描述 |
|--------|------|---------|
| 版本号同步 (4处) | ❌ **失败** | 根/桌面包用 `0.1.0-alpha.1`，Rust 用 `0.1.0` |
| 签名密钥生成 | ❌ **未生成** | 需执行 `pnpm tauri signer generate` |
| 公钥配置 | ❌ **占位符** | tauri.conf.json 公钥为占位内容 |
| 私钥存储 | ❌ **未配置** | .env 无 TAURI_PRIVATE_KEY |
| GitHub Secrets | ⚠️ **需手动确认** | 需检查 3 个 Secret 是否设置 |
| GitHub Actions 工作流 | ✅ 存在 | `release-desktop.yml` 配置完整 |
| Cargo.toml 配置 | ✅ 正常 | 依赖完整，含 updater 插件 |

---

## 二、详细问题分析

### ❌ 问题 1：版本号不一致（阻塞项）

#### 现状
```bash
# 根 package.json
"version": "0.1.0-alpha.1"

# packages/agentai-desktop/package.json  
"version": "0.1.0-alpha.1"

# packages/agentai-desktop/src-tauri/Cargo.toml
version = "0.1.0"

# packages/agentai-desktop/src-tauri/tauri.conf.json
"version": "0.1.0"
```

#### 影响
- **Tauri Updater 版本检测失败**：公客户端检查更新时，会认为已安装版本（0.1.0）等于或高于新版
- **GitHub Actions Release 发布混乱**：4 平台产物版本号不一致
- **语义化版本冲突**：`0.1.0-alpha.1` 不满足 Cargo 的语义版本要求

#### 修复方案
**方案 A：统一为 `0.1.0`（推荐，稳定版）**
```bash
# 1. 修改根 package.json
sed -i 's/"version": "0.1.0-alpha.1"/"version": "0.1.0"/' package.json

# 2. 修改桌面包 package.json  
sed -i 's/"version": "0.1.0-alpha.1"/"version": "0.1.0"/' packages/agentai-desktop/package.json

# 3. 验证 4 处一致
grep -r '"version"' package.json packages/agentai-desktop/package.json packages/agentai-desktop/src-tauri/Cargo.toml packages/agentai-desktop/src-tauri/tauri.conf.json
```

**方案 B：统一为 `0.1.0-alpha.1`（保留 alpha 标记）**
```bash
# Cargo.toml 需改为 (Cargo 支持 alpha 但不推荐)
version = "0.1.0-alpha.1"
```
⚠️ 注：Cargo.toml 不支持 `-alpha` 后缀的语义版本，需改用 `0.1.0-a1` 格式。

---

### ❌ 问题 2：签名密钥未生成（阻塞项）

#### 现状
```json
// tauri.conf.json
"pubkey": "dW50cnVzdGVkLS10aGlzLWlzLXBsYWNlaG9sZGVyLWZvci1vbmUtb2YtdGhlLW5ldy1rZXlzLWdlbmVyYXRlZC1kdXJpbmctZGVwbG95"
```
这是占位符，不是真实公钥。

#### 影响
- 本地打包无法生成 `.sig` 签名文件
- GitHub Actions 打包失败（Secrets 未配置）
- Updater 无法验证安装包完整性

#### 修复方案（一次性操作）

**步骤 1：生成密钥对**
```bash
cd f:\agentai-platform
pnpm tauri signer generate --password "你的强密码(建议32位)"
```

**步骤 2：记录输出**
```
Signing keypair generated:
  Private key: C:\Users\Administrator\.tauri-keys\PulseFlow_private.key
  Public key: dW50cnVzdGVkLS10aGlz... (实际公钥)
  Environment variables:
    TAURI_PRIVATE_KEY=<私钥内容>
    TAURI_KEY_PASSWORD=<你的密码>
```

**步骤 3：更新 tauri.conf.json**
```json
{
  "plugins": {
    "updater": {
      "active": true,
      "endpoints": [...],
      "dialog": true,
      "pubkey": "替换为步骤2输出的公钥"
    }
  }
}
```

**步骤 4：配置本地 .env**
```bash
# 读取私钥内容
$env:KEY = Get-Content "$env:USERPROFILE\.tauri-keys\PulseFlow_private.key" -Raw
# 追加到 .env
@"

# Tauri Updater 签名密钥
TAURI_PRIVATE_KEY=$env:KEY
TAURI_KEY_PASSWORD=你的密码

"@ | Out-File -FilePath .env -Encoding utf8 -Append
```

**步骤 5：配置 GitHub Secrets**
进入 `https://github.com/PulseFlowAI/pulseflow-platform/settings/secrets/actions` 添加：
- `TAURI_SIGNING_PRIVATE_KEY` = 私钥内容（含 BEGIN/END 行）
- `TAURI_SIGNING_PUBLIC_KEY` = 公钥（可选）
- `TAURI_KEY_PASSWORD` = 私钥密码

---

### ⚠️ 问题 3：GitHub Actions 工作流完整性

#### 现状
✅ `release-desktop.yml` 存在且配置完整：
- 支持 push tag `v*` 触发
- 支持 workflow_dispatch 手动触发
- 包含 4 平台构建 (Windows/macOS x64/arm64/Linux)
- 自动生成 latest.json 和 Release
- 签名验证流程完整

#### 需确认
请在 GitHub 仓库 → Settings → Secrets and variables → Actions 检查：
- [ ] `TAURI_SIGNING_PRIVATE_KEY` 已设置
- [ ] `TAURI_SIGNING_PUBLIC_KEY` 已设置（可选）
- [ ] `TAURI_KEY_PASSWORD` 已设置
- [ ] `GITHUB_TOKEN` 自动注入（无需设置）

---

## 三、环境依赖检查清单

### ✅ 必需环境

| 组件 | 最低版本 | 检查命令 | 状态 |
|------|---------|---------|------|
| Node.js | ≥ 22 LTS | `node -v` | ⚠️ 需确认 |
| Rust 工具链 | ≥ 1.80 | `rustc -V` | ⚠️ 需确认 |
| Rust target | x86_64-pc-windows-msvc | `rustup target list --installed` | ⚠️ 需确认 |
| pnpm | ≥ 9 | `pnpm -v` | ⚠️ 需确认 |
| WebView2 | Win10 1803+ 自带 | 检查系统版本 | ✅ 自动 |

### 🔧 安装命令（如缺失）

```bash
# Node.js 22 LTS
# 下载：https://nodejs.org/en/download

# Rust 工具链
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup target add x86_64-pc-windows-msvc

# pnpm
npm install -g pnpm@latest

# 依赖安装
cd f:\agentai-platform
pnpm install
```

---

## 四、修复后验证步骤

### 4.1 版本号同步验证

```bash
cd f:\agentai-platform
echo "检查 4 处版本号一致性..."
node -p "require('./package.json').version"
node -p "require('./packages/agentai-desktop/package.json').version"
grep '^version' packages/agentai-desktop/src-tauri/Cargo.toml
node -p "require('./packages/agentai-desktop/src-tauri/tauri.conf.json').version"
```

✅ 全部输出应为相同版本号（如 `0.1.0`）

### 4.2 本地签名打包验证

```bash
# 验证 .env 配置
grep -c "TAURI_PRIVATE_KEY" .env
# → 应输出 1

# 执行本地打包
pnpm build:desktop
```

✅ 预期输出：
```
packages/agentai-desktop/src-tauri/target/release/bundle/
├── nsis/
│   ├── PulseFlow_0.1.0_x64-setup.exe
│   └── PulseFlow_0.1.0_x64-setup.exe.sig  ✅ 签名文件存在
```

### 4.3 版本号验证命令

创建一个检查脚本：

```powershell
# check-versions.ps1
Write-Host "=== 版本号同步检查 ===" -ForegroundColor Cyan

$root = (Get-Content package.json | ConvertFrom-Json).version
$desktop = (Get-Content packages/agentai-desktop/package.json | ConvertFrom-Json).version
$cargo = (Select-String -Path "packages/agentai-desktop/src-tauri/Cargo.toml" -Pattern "^version\s*=\s*"").Matches.Value -replace ".*=\s*""", ""
$tauri = (Get-Content packages/agentai-desktop/src-tauri/tauri.conf.json | ConvertFrom-Json).version

Write-Host "根 package.json:    $root"
Write-Host "桌面包 package.json: $desktop"
Write-Host "Cargo.toml:         $cargo"
Write-Host "tauri.conf.json:    $tauri"

if ($root -eq $desktop -and $root -eq $cargo -and $root -eq $tauri) {
    Write-Host "`n✅ 版本号同步完成" -ForegroundColor Green
} else {
    Write-Host "`n❌ 版本号不一致，请修复" -ForegroundColor Red
    exit 1
}
```

---

## 五、一键修复脚本

### 修复版本号（方案 A）

```powershell
# fix-versions.ps1
Write-Host "=== 修复版本号到 0.1.0 ===" -ForegroundColor Cyan

# 更新根 package.json
$json = Get-Content package.json -Raw | ConvertFrom-Json
$json.version = "0.1.0"
$json | ConvertTo-Json -Depth 10 | Set-Content package.json

# 更新桌面包 package.json
$json2 = Get-Content packages/agentai-desktop/package.json -Raw | ConvertFrom-Json
$json2.version = "0.1.0"
$json2 | ConvertTo-Json -Depth 10 | Set-Content packages/agentai-desktop/package.json

Write-Host "✅ 版本号已统一为 0.1.0" -ForegroundColor Green

# 验证
.\check-versions.ps1
```

### 生成密钥并配置

```powershell
# setup-signing.ps1
Write-Host "=== Tauri 签名密钥配置 ===" -ForegroundColor Cyan

# 1. 生成密钥（交互式）
Write-Host "`n请执行: pnpm tauri signer generate --password '你的密码'" -ForegroundColor Yellow
$read = Read-Host "生成完成后按 Enter 继续..."

# 2. 读取公钥
$pubKey = Read-Host "请输入生成的 PUBLIC KEY"

# 3. 更新 tauri.conf.json
$conf = Get-Content packages/agentai-desktop/src-tauri/tauri.conf.json -Raw | ConvertFrom-Json
$conf.plugins.updater.pubkey = $pubKey
$conf | ConvertTo-Json -Depth 20 | Set-Content packages/agentai-desktop/src-tauri/tauri.conf.json
Write-Host "✅ tauri.conf.json 公钥已更新" -ForegroundColor Green

# 4. 提示 GitHub Secrets 配置
Write-Host "`n⚠️ 请手动配置 GitHub Secrets:" -ForegroundColor Yellow
Write-Host "   TAURI_SIGNING_PRIVATE_KEY = 私钥内容"
Write-Host "   TAURI_SIGNING_PUBLIC_KEY = $pubKey"
Write-Host "   TAURI_KEY_PASSWORD = 你的密码"
```

---

## 六、修复后发布流程

```bash
# 1. 确认版本号同步
.\check-versions.ps1

# 2. 更新 CHANGELOG.md（如有变更）

# 3. 提交并打 Tag
git add -A
git commit -m "chore: v0.1.0 首次发布准备"
git tag v0.1.0
git push origin main
git push origin v0.1.0

# 4. 等待 GitHub Actions 完成（30-60 分钟）
# 5. 检查 Release 页面确认 4 平台产物和 latest.json
# 6. 本地安装测试自动更新功能
```

---

## 七、风险评估

| 风险项 | 等级 | 缓解措施 |
|--------|------|---------|
| 密钥泄露 | 🔴 高 | 严格保管私钥，仅存储于 .env 和 GitHub Secrets |
| 版本不一致导致更新失败 | 🟠 中 | 每次发布前强制检查 4 处版本号 |
| GitHub Actions 构建超时 | 🟡 低 | 已配置 90 分钟超时，4 平台并行 |
| 公钥配置错误 | 🟠 中 | 生成后立即测试本地打包验证 .sig 文件 |

---

## 八、结论与建议

### 当前状态
⚠️ **不具备完整推送打包能力** — 存在 2 个阻塞问题和 1 个需确认项。

### 修复优先级
1. 🔴 **P0**：统一 4 处版本号（预计 5 分钟）
2. 🔴 **P0**：生成 Tauri 签名密钥对（预计 10 分钟）
3. 🟠 **P1**：配置 GitHub Secrets（预计 5 分钟）
4. 🟡 **P2**：本地签名打包测试验证（预计 20 分钟）

### 预计修复时间
**总计约 40 分钟**即可完成所有配置，具备完整推送打包能力。

---

> **下一步**：请执行 `docs/fix-build-capability.ps1` 一键修复脚本，或按 §四 手动修复后重新验证。
