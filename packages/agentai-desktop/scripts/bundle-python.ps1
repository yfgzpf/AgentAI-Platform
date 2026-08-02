#!/usr/bin/env pwsh
<#
.SYNOPSIS
下载 Python Embeddable 并放到 resources/python/
打包后 python-bridge.ts 会优先使用这个内置 Python
#>
$ErrorActionPreference = "Stop"

$ROOT = Resolve-Path "$PSScriptRoot/../.."
$RES_DIR = "$ROOT/packages/agentai-desktop/resources/python"
$URL = "https://www.python.org/ftp/python/3.13.3/python-3.13.3-embed-amd64.zip"
$ZIP = "$env:TEMP\python-embed.zip"

Write-Host "[bundle-python] Start..."

# 如果已有 python.exe, 跳过
if (Test-Path "$RES_DIR\python.exe") {
    Write-Host "[bundle-python] Python Embeddable already exists, skipping."
    exit 0
}

# 下载
Write-Host "[bundle-python] Downloading Python 3.13.3 Embeddable..."
try {
    Invoke-WebRequest -Uri $URL -OutFile $ZIP -UseBasicParsing
} catch {
    Write-Host "[bundle-python] WARNING: Download failed, Python skills will use system Python instead."
    exit 0
}

# 解压
Write-Host "[bundle-python] Extracting to $RES_DIR..."
New-Item -ItemType Directory -Path $RES_DIR -Force | Out-Null
Expand-Archive -Path $ZIP -DestinationPath $RES_DIR -Force

# 启用 pip (取消 ._pth 文件中的 import site 注释)
$pthFile = Get-ChildItem "$RES_DIR\python*._pth" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($pthFile) {
    $content = Get-Content $pthFile.FullName
    $content = $content -replace '^#import site', 'import site'
    Set-Content $pthFile.FullName $content
    Write-Host "[bundle-python] Enabled pip in $($pthFile.Name)"
}

# 下载 get-pip.py
Write-Host "[bundle-python] Installing pip..."
try {
    Invoke-WebRequest -Uri "https://bootstrap.pypa.io/get-pip.py" -OutFile "$RES_DIR\get-pip.py" -UseBasicParsing
    Push-Location $RES_DIR
    & .\python.exe get-pip.py --quiet 2>$null
    Pop-Location
    Remove-Item "$RES_DIR\get-pip.py" -ErrorAction SilentlyContinue
} catch {
    Write-Host "[bundle-python] WARNING: pip install failed, user can install later"
}

Remove-Item $ZIP -ErrorAction SilentlyContinue
$sizeMB = [math]::Round((Get-ChildItem $RES_DIR -Recurse | Measure-Object Length -Sum).Sum / 1MB, 1)
Write-Host "[bundle-python] DONE - Python Embeddable ready ($sizeMB MB at $RES_DIR)"
