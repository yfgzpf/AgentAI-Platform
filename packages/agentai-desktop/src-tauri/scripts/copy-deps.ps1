# 复制Gateway和完整依赖
# ════════════════════════════════════════════════════════════
# P0 修复: 移除 F:\agentai-platform 盘符硬编码
#   $PSScriptRoot = packages/agentai-desktop/src-tauri/scripts
#   monorepo root  = $PSScriptRoot/../../..
# ════════════════════════════════════════════════════════════
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..\..")
$src      = Join-Path $repoRoot "packages\agentai-gateway\dist"
$dst      = Join-Path $repoRoot "packages\agentai-desktop\src-tauri\resources\gateway-dist-v2"
$nmSrc    = Join-Path $repoRoot "node_modules"

# 清理并创建目录
if (Test-Path $dst) {
    Remove-Item -Recurse -Force $dst
}
New-Item -ItemType Directory -Force -Path $dst

# 复制gateway dist
Write-Host "Copying gateway dist..."
Copy-Item -Recurse -Force "$src\*" $dst

# 复制node_modules
Write-Host "Copying node_modules (this will take a few minutes)..."
New-Item -ItemType Directory -Force -Path "$dst\node_modules"

# 使用robocopy复制大量文件
robocopy $nmSrc "$dst\node_modules" /E /NFL /NDL /NJH /NJS /nc /ns /np

Write-Host "Done!"
