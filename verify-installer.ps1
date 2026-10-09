$installer = "f:\agentai-platform\packages\agentai-desktop\src-tauri\target\release\bundle\nsis\PulseFlow_0.1.0_x64-setup.exe"
Write-Host "=== 验证新安装包: $installer ==="
Write-Host "文件大小: $((Get-Item $installer).Length / 1MB) MB"
Write-Host "创建时间: $((Get-Item $installer).LastWriteTime)"

# 复制安装包为 zip 后改名解压
$tempDir = Join-Path $env:TEMP "pulseflow-verify-$(Get-Random)"
New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
$zipPath = Join-Path $tempDir "installer.zip"
Copy-Item $installer $zipPath

Add-Type -AssemblyName System.IO.Compression.FileSystem
try {
    [System.IO.Compression.ZipFile]::ExtractToDirectory($zipPath, $tempDir)
    Write-Host "`n解压成功: $tempDir"
} catch {
    Write-Host "解压失败: $_"
    exit 1
}

# 查找 index-*.js
$indexFiles = Get-ChildItem -Path $tempDir -Recurse -Filter "index-*.js" -ErrorAction SilentlyContinue | Where-Object { $_.DirectoryName -like "*assets\js*" }
Write-Host "`n找到 index-*.js 文件: $($indexFiles.Count) 个"
$main = $indexFiles | Where-Object { $_.Length -gt 500KB } | Select-Object -First 1
if (-not $main) { $main = $indexFiles | Sort-Object Length -Descending | Select-Object -First 1 }

if ($main) {
    Write-Host "主 bundle: $($main.Name) ($([math]::Round($main.Length / 1KB)) KB)"
    Write-Host "`n=== 关键修复点检查 ==="
    $c = Get-Content $main.FullName -Raw
    $checks = @(
        @{ n="NavGroupDropdown (maxHeight: 480)"; p="maxHeight:\s*480" },
        @{ n="绝对定位 (替代 antd Dropdown)"; p="position:\s*[\x27\x22]?absolute" },
        @{ n="--vscode-editor-background"; p="--vscode-editor-background" },
        @{ n="--vscode-input-background"; p="--vscode-input-background" },
        @{ n="--vscode-editorSuggestWidget"; p="--vscode-editorSuggestWidget" },
        @{ n="--vscode-sideBar-background"; p="--vscode-sideBar-background" },
        @{ n="防御性初始化 lastPage key"; p="agentai\.lastPage" },
        @{ n="transparent (Tauri 透明窗)"; p="transparent" },
        @{ n="PictureOutlined 创作图标"; p="PictureOutlined" }
    )
    foreach ($chk in $checks) {
        $cnt = ([regex]::Matches($c, $chk.p)).Count
        $status = if ($cnt -gt 0) { "[OK]" } else { "[--]" }
        Write-Host ("  {0} {1}: {2} 次" -f $status, $chk.n, $cnt)
    }
} else {
    Write-Host "未找到主 bundle 文件"
}

# 清理
Remove-Item $tempDir -Recurse -Force -ErrorAction SilentlyContinue
Write-Host "`n=== 验证完成 ==="
