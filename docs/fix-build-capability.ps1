#!/usr/bin/env pwsh
# PulseFlow 打包能力一键修复脚本
# 执行前请确保已生成 Tauri 签名密钥

[CmdletBinding()]
param(
    [Parameter(Mandatory=$false)]
    [string]$Version = "0.1.0",
    
    [Parameter(Mandatory=$false)]
    [string]$PublicKey,
    
    [Parameter(Mandatory=$false)]
    [string]$PrivateKeyPath,
    
    [Parameter(Mandatory=$false)]
    [string]$Password
)

$ErrorActionPreference = "Stop"

Write-Host "╔════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║  PulseFlow 打包能力一键修复脚本 v1.0                   ║" -ForegroundColor Cyan
Write-Host "╚════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# 检查 Node.js
Write-Host "📦 环境检查..." -ForegroundColor Yellow
$nodeVersion = node -v
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Node.js 未安装，请先安装 Node.js ≥ 22 LTS" -ForegroundColor Red
    exit 1
}
Write-Host "✅ Node.js $nodeVersion 已安装" -ForegroundColor Green

# 检查 Rust
$rustcVersion = rustc -V
if ($LASTEXITCODE -ne 0) {
    Write-Host "⚠️  Rust 未安装，请执行: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh" -ForegroundColor Yellow
} else {
    Write-Host "✅ Rust $rustcVersion 已安装" -ForegroundColor Green
}

# 检查 pnpm
$pnpmVersion = pnpm -v
if ($LASTEXITCODE -ne 0) {
    Write-Host "⚠️  pnpm 未安装，请执行: npm install -g pnpm@latest" -ForegroundColor Yellow
} else {
    Write-Host "✅ pnpm $pnpmVersion 已安装" -ForegroundColor Green
}

Write-Host ""
Write-Host "═══════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  步骤 1: 统一版本号" -ForegroundColor White
Write-Host "═══════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

Write-Host "目标版本: $Version" -ForegroundColor Cyan
Write-Host ""

# 读取当前版本
$rootVersion = (Get-Content package.json -Raw | ConvertFrom-Json).version
$desktopVersion = (Get-Content packages/agentai-desktop/package.json -Raw | ConvertFrom-Json).version
$cargoVersion = (Select-String -Path "packages/agentai-desktop/src-tauri/Cargo.toml" -Pattern "^version\s*=\s*"" -AllMatches).Matches.Value
$cargoVersion = $cargoVersion -replace '^version\s*=\s*"', '' -replace '"$', ''
$tauriVersion = (Get-Content packages/agentai-desktop/src-tauri/tauri.conf.json -Raw | ConvertFrom-Json).version

Write-Host "当前版本状态:" -ForegroundColor Yellow
Write-Host "  根 package.json:    $rootVersion"
Write-Host "  桌面包 package.json: $desktopVersion"
Write-Host "  Cargo.toml:         $cargoVersion"
Write-Host "  tauri.conf.json:    $tauriVersion"

if ($rootVersion -eq $Version -and $desktopVersion -eq $Version -and $cargoVersion -eq $Version -and $tauriVersion -eq $Version) {
    Write-Host ""
    Write-Host "✅ 版本号已同步，无需修改" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "🔧 正在统一版本号到 $Version..." -ForegroundColor Cyan
    
    # 更新根 package.json
    $rootJson = Get-Content package.json -Raw | ConvertFrom-Json
    $rootJson.version = $Version
    $rootJson | ConvertTo-Json -Depth 10 | Set-Content package.json
    Write-Host "  ✅ 根 package.json 已更新"
    
    # 更新桌面包 package.json
    $desktopJson = Get-Content packages/agentai-desktop/package.json -Raw | ConvertFrom-Json
    $desktopJson.version = $Version
    $desktopJson | ConvertTo-Json -Depth 10 | Set-Content packages/agentai-desktop/package.json
    Write-Host "  ✅ 桌面包 package.json 已更新"
    
    # 更新 Cargo.toml
    (Get-Content packages/agentai-desktop/src-tauri/Cargo.toml) -replace "^version\s*=\s*.*", "version = `"$Version`"" | Set-Content packages/agentai-desktop/src-tauri/Cargo.toml
    Write-Host "  ✅ Cargo.toml 已更新"
    
    # 更新 tauri.conf.json
    $tauriJson = Get-Content packages/agentai-desktop/src-tauri/tauri.conf.json -Raw | ConvertFrom-Json
    $tauriJson.version = $Version
    $tauriJson | ConvertTo-Json -Depth 20 | Set-Content packages/agentai-desktop/src-tauri/tauri.conf.json
    Write-Host "  ✅ tauri.conf.json 已更新"
    
    Write-Host ""
    Write-Host "✅ 版本号已统一为 $Version" -ForegroundColor Green
}

Write-Host ""
Write-Host "═══════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  步骤 2: 配置签名密钥" -ForegroundColor White
Write-Host "═══════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

# 检查密钥是否已配置
$currentPubkey = (Get-Content packages/agentai-desktop/src-tauri/tauri.conf.json -Raw | ConvertFrom-Json).plugins.updater.pubkey
$placeholder = "dW50cnVzdGVkLS10aGlzLWlzLXBsYWNlaG9sZGVyLWZvci1vbmUtb2YtdGhlLW5ldy1rZXlzLWdlbmVyYXRlZC1kdXJpbmctZGVwbG95"

if ($PublicKey -and $PublicKey -ne $placeholder) {
    Write-Host "🔧 使用提供的公钥更新 tauri.conf.json..." -ForegroundColor Cyan
    
    $tauriJson = Get-Content packages/agentai-desktop/src-tauri/tauri.conf.json -Raw | ConvertFrom-Json
    $tauriJson.plugins.updater.pubkey = $PublicKey
    $tauriJson | ConvertTo-Json -Depth 20 | Set-Content packages/agentai-desktop/src-tauri/tauri.conf.json
    Write-Host "✅ tauri.conf.json 公钥已更新" -ForegroundColor Green
} elseif ($currentPubkey -eq $placeholder) {
    Write-Host "⚠️  检测到公钥仍为占位符" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "请按以下步骤生成密钥:" -ForegroundColor Cyan
    Write-Host "  1. 执行: pnpm tauri signer generate --password '你的强密码'" -ForegroundColor White
    Write-Host "  2. 复制输出的 PUBLIC KEY" -ForegroundColor White
    Write-Host "  3. 重新运行此脚本，或使用手动命令更新" -ForegroundColor White
    Write-Host ""
    Write-Host "示例:" -ForegroundColor Yellow
    Write-Host "  pnpm tauri signer generate --password `"MySecurePassword123!`"" -ForegroundColor Gray
    Write-Host "  # 复制 PUBLIC KEY，然后:" -ForegroundColor Gray
    Write-Host "  # ./fix-build-capability.ps1 -PublicKey `"xxx`"" -ForegroundColor Gray
} else {
    Write-Host "✅ tauri.conf.json 公钥已配置" -ForegroundColor Green
}

Write-Host ""
Write-Host "═══════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  步骤 3: 配置本地 .env" -ForegroundColor White
Write-Host "═══════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

if ($PrivateKeyPath -and (Test-Path $PrivateKeyPath)) {
    Write-Host "🔧 读取私钥文件..." -ForegroundColor Cyan
    $privateKey = Get-Content $PrivateKeyPath -Raw
    $privateKey = $privateKey -replace "`r`, "`n"
    
    # 读取或创建 .env
    $envPath = ".env"
    if (Test-Path $envPath) {
        $envContent = Get-Content $envPath -Raw
    } else {
        $envContent = ""
    }
    
    # 更新或添加 TAURI 相关配置
    $envContent = $envContent -replace "TAURI_PRIVATE_KEY=.*", "TAURI_PRIVATE_KEY=$privateKey"
    $envContent = $envContent -replace "TAURI_KEY_PASSWORD=.*", "TAURI_KEY_PASSWORD=$Password"
    
    # 如果没有相关配置，追加到文件末尾
    if ($envContent -notmatch "TAURI_PRIVATE_KEY") {
        $envContent += "`n`n# Tauri Updater 签名密钥`n"
        $envContent += "TAURI_PRIVATE_KEY=$privateKey`n"
        $envContent += "TAURI_KEY_PASSWORD=$Password`n"
    }
    
    Set-Content -Path $envPath -Value $envContent
    Write-Host "✅ .env 文件已更新" -ForegroundColor Green
} else {
    Write-Host "⚠️  未提供私钥文件路径" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "请按以下步骤配置本地 .env:" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "1. 读取私钥文件:" -ForegroundColor White
    Write-Host "   Get-Content `$env:USERPROFILE\.tauri-keys\PulseFlow_private.key -Raw" -ForegroundColor Gray
    Write-Host ""
    Write-Host "2. 编辑 .env 文件，添加:" -ForegroundColor White
    Write-Host "   TAURI_PRIVATE_KEY=<私钥完整内容>" -ForegroundColor Gray
    Write-Host "   TAURI_KEY_PASSWORD=<你的密码>" -ForegroundColor Gray
    Write-Host ""
    Write-Host "或者运行:" -ForegroundColor Cyan
    Write-Host "   ./fix-build-capability.ps1 -PrivateKeyPath `"$env:USERPROFILE\.tauri-keys\PulseFlow_private.key`" -Password `"你的密码`"" -ForegroundColor White
}

Write-Host ""
Write-Host "═══════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  步骤 4: 配置 GitHub Secrets" -ForegroundColor White
Write-Host "═══════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

Write-Host "请手动在 GitHub 仓库配置以下 Secrets:" -ForegroundColor Cyan
Write-Host ""
Write-Host "📍 仓库: PulseFlowAI/pulseflow-platform" -ForegroundColor White
Write-Host "   Settings → Secrets and variables → Actions → New repository secret" -ForegroundColor White
Write-Host ""

Write-Host "Secret 列表:" -ForegroundColor Yellow
Write-Host "  1. TAURI_SIGNING_PRIVATE_KEY" -ForegroundColor White
Write-Host "     内容: 私钥完整内容（含 -----BEGIN----- 和 -----END-----）" -ForegroundColor Gray
Write-Host ""
Write-Host "  2. TAURI_SIGNING_PUBLIC_KEY" -ForegroundColor White
Write-Host "     内容: 公钥（可选，用于日志调试）" -ForegroundColor Gray
Write-Host ""
Write-Host "  3. TAURI_KEY_PASSWORD" -ForegroundColor White
Write-Host "     内容: 私钥密码" -ForegroundColor Gray
Write-Host ""

Write-Host "═══════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  步骤 5: 验证配置" -ForegroundColor White
Write-Host "═══════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

# 最终验证
Write-Host "📊 配置状态检查:" -ForegroundColor Yellow
Write-Host ""

# 版本号
$finalRoot = (Get-Content package.json -Raw | ConvertFrom-Json).version
$finalDesktop = (Get-Content packages/agentai-desktop/package.json -Raw | ConvertFrom-Json).version
$finalCargo = (Select-String -Path "packages/agentai-desktop/src-tauri/Cargo.toml" -Pattern "^version\s*=\s*"" -AllMatches).Matches.Value
$finalCargo = $finalCargo -replace '^version\s*=\s*"', '' -replace '"$', ''
$finalTauri = (Get-Content packages/agentai-desktop/src-tauri/tauri.conf.json -Raw | ConvertFrom-Json).version

if ($finalRoot -eq $Version -and $finalDesktop -eq $Version -and $finalCargo -eq $Version -and $finalTauri -eq $Version) {
    Write-Host "  ✅ 版本号同步: $Version" -ForegroundColor Green
} else {
    Write-Host "  ❌ 版本号不一致" -ForegroundColor Red
    Write-Host "     根: $finalRoot, 桌面: $finalDesktop, Cargo: $finalCargo, Tauri: $finalTauri" -ForegroundColor Red
}

# 公钥
$finalPubkey = (Get-Content packages/agentai-desktop/src-tauri/tauri.conf.json -Raw | ConvertFrom-Json).plugins.updater.pubkey
if ($finalPubkey -ne $placeholder) {
    Write-Host "  ✅ 公钥已配置" -ForegroundColor Green
} else {
    Write-Host "  ❌ 公钥仍为占位符" -ForegroundColor Red
}

# 私钥
if (Test-Path ".env" -and (Get-Content .env -Raw) -match "TAURI_PRIVATE_KEY") {
    Write-Host "  ✅ 本地私钥已配置" -ForegroundColor Green
} else {
    Write-Host "  ⚠️  本地私钥未配置（不影响 CI，但影响本地打包）" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "═══════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  完成" -ForegroundColor White
Write-Host "═══════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

Write-Host "下一步操作:" -ForegroundColor Cyan
Write-Host ""
Write-Host "1. 执行本地签名打包测试:" -ForegroundColor White
Write-Host "   pnpm build:desktop" -ForegroundColor Gray
Write-Host ""
Write-Host "2. 确认产物包含 .sig 文件:" -ForegroundColor White
Write-Host "   ls packages/agentai-desktop/src-tauri/target/release/bundle/nsis/*.sig" -ForegroundColor Gray
Write-Host ""
Write-Host "3. 推送 Tag 触发 CI:" -ForegroundColor White
Write-Host "   git tag v$Version" -ForegroundColor Gray
Write-Host "   git push origin main" -ForegroundColor Gray
Write-Host "   git push origin v$Version" -ForegroundColor Gray
Write-Host ""
Write-Host "4. 等待 30-60 分钟后检查 GitHub Actions 和 Release 页面" -ForegroundColor White
Write-Host ""

Write-Host "✅ 一键修复脚本执行完成！" -ForegroundColor Green
