# 复制Gateway和完整依赖
$src = "F:\agentai-platform\packages\agentai-gateway\dist"
$dst = "F:\agentai-platform\packages\agentai-desktop\src-tauri\resources\gateway-dist"
$nmSrc = "F:\agentai-platform\node_modules"

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
