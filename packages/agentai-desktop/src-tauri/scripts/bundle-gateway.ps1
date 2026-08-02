# bundle-gateway.ps1 — 打包 Gateway + node_modules 到 resources/gateway-dist-v2/
#
# ╔══════════════════════════════════════════════════════════════╗
# ║ 构建一致性修复 (P0):                                        ║
# ║ 1. 目录名 gateway-dist → gateway-dist-v2                    ║
# ║    (与 build-for-desktop.mjs / prepare-gateway.mjs 一致)   ║
# ║ 2. 不删除 package.json (install-deps.bat 首次启动需要它)   ║
# ║ 3. 验证 keyFiles 修正为 dist/index.js (编译后目录结构)      ║
# ╚══════════════════════════════════════════════════════════════╝

$ErrorActionPreference = "Stop"

$srcTauriDir = Resolve-Path (Split-Path -Parent $MyInvocation.MyCommand.Path)
$depDir = "$srcTauriDir/resources/gateway-dist-v2"
$gwRoot = Resolve-Path "$srcTauriDir/../../../agentai-gateway"
$gwDist = "$gwRoot/dist"

Write-Host "[bundle] 目标目录: $depDir"

# 1. 清空旧目录
if (Test-Path $depDir) { Remove-Item -Recurse -Force $depDir }
New-Item -ItemType Directory -Path $depDir -Force | Out-Null

# 2. 复制 dist/ 编译产物 (新结构: gateway-dist-v2/dist/*.js)
Write-Host "[bundle] 复制 dist/ 编译产物..."
New-Item -ItemType Directory -Path "$depDir/dist" -Force | Out-Null
Copy-Item -Recurse -Force "$gwDist/*" "$depDir/dist/"

# 3. 复制 package.json（install-deps.bat / 首次启动需要）
Copy-Item "$gwRoot/package.json" "$depDir/package.json" -Force

# 4. 安装 production 依赖（用 npm，不走 pnpm store 避免权限问题）
Write-Host "[bundle] 安装 production 依赖..."
Push-Location $depDir
$npm = Get-Command "npm" -ErrorAction SilentlyContinue
if (-not $npm) {
    # 候选路径按优先级：WorkBuddy管理版 → Node官方安装版 → Chocolatey/包管理器 → PATH版
    $candidates = @(
        "C:\Users\Administrator\.workbuddy\binaries\node\versions\22.22.2\npm.cmd",
        "$env:LOCALAPPDATA\npm\npm.cmd",
        "C:\Program Files\nodejs\npm.cmd",
        "C:\ProgramData\npm\npm.cmd",
        "$env:APPDATA\npm\npm.cmd"
    )
    foreach ($c in $candidates) {
        if (Test-Path $c) { $npm = $c; break }
    }
}
if (-not $npm) {
    Write-Host "[bundle] WARN: 找不到 npm, 跳过 node_modules 安装"
    Write-Host "[bundle] 首次启动时 install-deps.bat 会自动补装"
    Pop-Location
    exit 0
}
& $npm install --production --ignore-scripts --no-optional --legacy-peer-deps 2>&1 | ForEach-Object { Write-Host "  $_" }
Pop-Location

# 5. 验证关键文件 (新结构: dist/index.js)
$keyFiles = @(
    "package.json",
    "dist/index.js",
    "node_modules/express/package.json",
    "node_modules/cors/package.json",
    "node_modules/socket.io/package.json"
)
$allOk = $true
foreach ($f in $keyFiles) {
    $path = Join-Path $depDir $f
    if (Test-Path $path) {
        Write-Host "[bundle] OK  $f"
    } else {
        Write-Host "[bundle] MISS $f"
        $allOk = $false
    }
}

if ($allOk) {
    Write-Host "[bundle] SUCCESS"
} else {
    Write-Host "[bundle] WARN: 部分依赖未打包 (首次启动会自动补装)"
}
exit 0
