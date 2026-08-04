<#
.SYNOPSIS
    PulseFlow 一键发布脚本
.DESCRIPTION
    自动完成版本标签创建、推送、触发 GitHub Actions 打包
.PARAMETER Version
    版本号 (如 v0.2.0)
.PARAMETER Message
    发布说明 (可选)
.EXAMPLE
    .\release.ps1 -Version "v0.2.0" -Message "修复登录Bug"
#>

param(
    [Parameter(Mandatory=$true)]
    [string]$Version,
    
    [string]$Message = ""
)

$ErrorActionPreference = "Stop"

Write-Host @"
╔══════════════════════════════════════════╗
║     🚀 PulseFlow Release Publisher      ║
╚══════════════════════════════════════════╝
"@

# 验证版本号格式
if ($Version -notmatch '^v\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$') {
    Write-Host "❌ 版本号格式错误！正确格式: v0.1.0, v1.2.3-beta.1"
    exit 1
}

# 检查 Git 状态
Write-Host "`n📋 Step 1/5: 检查工作区状态..."
$status = git status --porcelain
if ($status) {
    Write-Host "⚠️  发现未提交的更改:"
    git status --short
    $response = Read-Host "是否继续？(y/N)"
    if ($response -ne 'y' -and $response -ne 'Y') {
        Write-Host "❌ 已取消"
        exit 1
    }
} else {
    Write-Host "✅ 工作区干净"
}

# 检查是否已存在该标签
Write-Host "`n📋 Step 2/5: 检查标签..."
$existingTag = git tag -l $Version
if ($existingTag) {
    Write-Host "⚠️  标签 $Version 已存在"
    $response = Read-Host "是否删除并重新创建？(y/N)"
    if ($response -eq 'y' -or $response -eq 'Y') {
        git tag -d $Version
        git push origin ":refs/tags/$Version" 2>$null
        Write-Host "✅ 旧标签已删除"
    } else {
        Write-Host "❌ 已取消"
        exit 1
    }
}

# 创建标签
Write-Host "`n📋 Step 3/5: 创建标签..."
$tagMessage = "Release $Version"
if ($Message) {
    $tagMessage = "Release $Version - $Message"
}
git tag -a $Version -Message $tagMessage
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ 标签创建失败"
    exit 1
}
Write-Host "✅ 标签 $Version 创建成功"

# 推送标签
Write-Host "`n📋 Step 4/5: 推送标签到 GitHub..."
git push origin $Version
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ 标签推送失败 (检查网络连接)"
    exit 1
}
Write-Host "✅ 标签已推送"

# 完成
Write-Host @"

╔══════════════════════════════════════════╗
║          ✅ 发布流程启动成功！           ║
╠══════════════════════════════════════════╣
║                                          ║
║  📦 版本: $Version                       ║
║  ⏱️  预计时间: 10-15 分钟                ║
║                                          ║
║  🔗 监控进度:                            ║
║  https://github.com/yfgzpf/AgentAI-Platform/actions  ║
║                                          ║
║  📥 下载地址 (构建完成后):               ║
║  https://github.com/yfgzpf/AgentAI-Platform/releases/tag/$Version  ║
║                                          ║
╚══════════════════════════════════════════╝
"@

# 可选: 自动打开浏览器
$response = Read-Host "是否打开 GitHub Actions 页面？(Y/n)"
if ($response -ne 'n' -and $response -ne 'N') {
    Start-Process "https://github.com/yfgzpf/AgentAI-Platform/actions"
}
