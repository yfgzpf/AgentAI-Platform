# 清理临时文件脚本
# 删除测试文件和临时文件

$tempFiles = @(
    "test-*.json",
    "test-*.js",
    "test-*.mjs",
    "test-*.ps1",
    "test-*.mp3",
    "tsc-*.txt",
    "vitest-*.txt",
    "tools_diff.txt",
    "tmp_read.cjs",
    "commit-message.txt",
    "weixin.jpg"
)

$deletedCount = 0

foreach ($pattern in $tempFiles) {
    $files = Get-ChildItem -Path "." -Name $pattern -ErrorAction SilentlyContinue
    foreach ($file in $files) {
        if (Test-Path $file) {
            Remove-Item $file -Force
            Write-Host "Deleted: $file" -ForegroundColor Green
            $deletedCount++
        }
    }
}

Write-Host "`nTotal deleted: $deletedCount files" -ForegroundColor Cyan
