# AgentAI Desktop - 桌面端打包脚本
# ----------------------------------------------------
# 完整流程:
#   1. 编译 VSCode shared/webview (供 Lite 模式复用)
#   2. 生成 Lite HTML
#   3. 编译 Gateway
#   4. 编译 GUI
#   5. 编译 Tauri (Windows MSI/NSIS)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$vscodeDir = Join-Path $root "packages\agentai-vscode"
$gatewayDir = Join-Path $root "packages\agentai-gateway"
$guiDir = Join-Path $root "packages\agentai-gui"
$desktopDir = Join-Path $root "packages\agentai-desktop"
$tauriDir = Join-Path $desktopDir "src-tauri"
$liteScript = Join-Path $tauriDir "scripts\build-lite.cjs"

Write-Host "🚀 AgentAI Desktop 打包" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 步骤 1: 编译 VSCode shared (供 Lite 复用)
Write-Host "[1/5] 编译 VSCode shared/webview-template..." -ForegroundColor Yellow
Push-Location $vscodeDir
try {
    npx tsc -p ./
    if ($LASTEXITCODE -ne 0) { throw "VSCode tsc 失败" }
    Write-Host "  ✅ VSCode 编译完成" -ForegroundColor Green
} finally {
    Pop-Location
}

# 步骤 2: 生成 Lite HTML
Write-Host "[2/5] 生成 Lite HTML..." -ForegroundColor Yellow
node $liteScript
if ($LASTEXITCODE -ne 0) { throw "Lite HTML 生成失败" }

# 步骤 3: 编译 Gateway
Write-Host "[3/5] 编译 Gateway..." -ForegroundColor Yellow
Push-Location $gatewayDir
try {
    pnpm build
    if ($LASTEXITCODE -ne 0) { throw "Gateway build 失败" }
    Write-Host "  ✅ Gateway 编译完成" -ForegroundColor Green
} finally {
    Pop-Location
}

# 步骤 4: 编译 GUI
Write-Host "[4/5] 编译 GUI..." -ForegroundColor Yellow
Push-Location $guiDir
try {
    pnpm build
    if ($LASTEXITCODE -ne 0) { throw "GUI build 失败" }
    Write-Host "  ✅ GUI 编译完成" -ForegroundColor Green
} finally {
    Pop-Location
}

# 步骤 5: 编译 Tauri
Write-Host "[5/5] 编译 Tauri (Windows MSI/NSIS)..." -ForegroundColor Yellow
Push-Location $desktopDir
try {
    # 开发模式: pnpm tauri dev
    # 打包: pnpm tauri build
    pnpm tauri build --target x86_64-pc-windows-msvc
    if ($LASTEXITCODE -ne 0) { throw "Tauri build 失败" }
    Write-Host "  ✅ Tauri 编译完成" -ForegroundColor Green
} finally {
    Pop-Location
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "✅ 桌面端打包完成!" -ForegroundColor Green
Write-Host "📦 输出: $tauriDir\target\x86_64-pc-windows-msvc\release\bundle\" -ForegroundColor Green
Write-Host ""
Write-Host "📊 资源对比:" -ForegroundColor Cyan
Write-Host "   Full 模式: ~10MB (完整 GUI)" -ForegroundColor Gray
Write-Host "   Lite 模式: ~50KB (Webview 模板)" -ForegroundColor Gray
Write-Host "   Gateway:  ~30MB (Node.js 运行时)" -ForegroundColor Gray
Write-Host ""
