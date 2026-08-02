# bundle-gateway.ps1 — 打包 Gateway + node_modules 到 resources/gateway-dist/

$ErrorActionPreference = "Stop"

$srcTauriDir = Resolve-Path (Split-Path -Parent $MyInvocation.MyCommand.Path)
$depDir = "$srcTauriDir/resources/gateway-dist"
$gwRoot = Resolve-Path "$srcTauriDir/../../agentai-gateway"
$gwDist = "$gwRoot/dist"

Write-Host "[bundle] 目标目录: $depDir"

# 1. 清空旧目录
if (Test-Path $depDir) { Remove-Item -Recurse -Force $depDir }
New-Item -ItemType Directory -Path $depDir -Force | Out-Null

# 2. 复制 dist/ 编译产物
Write-Host "[bundle] 复制 dist/ 编译产物..."
Copy-Item -Recurse -Force "$gwDist/*" $depDir

# 3. 复制 package.json（npm install 需要）
Copy-Item "$gwRoot/package.json" "$depDir/package.json" -Force

# 4. 安装 production 依赖（用 npm，不走 pnpm store 避免权限问题）
Write-Host "[bundle] 安装 production 依赖..."
Push-Location $depDir
$npm = Get-Command "npm" -ErrorAction SilentlyContinue
if (-not $npm) {
    $npm = "C:\Users\Administrator\.workbuddy\binaries\node\versions\22.22.2\npm.cmd"
}
& $npm install --production --ignore-scripts --no-optional --cache /tmp/npm-cache 2>&1 | ForEach-Object { Write-Host "  $_" }
Pop-Location

# 5. 删除用过的 package.json
Remove-Item "$depDir/package.json" -Force -ErrorAction SilentlyContinue

# 6. 验证关键文件
$keyFiles = @("index.js", "node_modules/express/package.json", "node_modules/cors/package.json", "node_modules/socket.io/package.json")
$allOk = $true
foreach ($f in $keyFiles) {
    $path = "$depDir/$f"
    if (Test-Path $path) {
        Write-Host "[bundle] ✅ $f"
    } else {
        Write-Host "[bundle] ❌ $f 缺失！"
        $allOk = $false
    }
}

if ($allOk) {
    Write-Host "[bundle] ✅ 打包成功"
} else {
    Write-Host "[bundle] ❌ 打包失败"
    exit 1
}
