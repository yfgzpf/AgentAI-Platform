<#
.SYNOPSIS
    本地打包工具 (Windows)
.DESCRIPTION
    一键完成本地 Tauri 应用打包，自动处理环境检查、依赖安装、签名配置
.EXAMPLE
    .\build-local.ps1              # 标准构建
    .\build-local.ps1 -Clean      # 清理后重新构建
    .\build-local.ps1 -Debug      # 调试模式（详细日志）
#>

param(
    [switch]$Clean,
    [switch]$Debug,
    [switch]$SkipDeps
)

$ErrorActionPreference = "Continue"

Write-Host @"
╔══════════════════════════════════════════╗
║   📦 PulseFlow Local Build Tool v1.0     ║
╚══════════════════════════════════════════╝
"@

# ===== 环境检查 =====
Write-Host "`n🔍 Step 1/5: 检查环境..."

$envChecks = @{
    "Node.js" = @{ cmd = "node"; arg = "--version"; min = "v22" }
    "pnpm" = @{ cmd = "pnpm"; arg = "--version"; min = "9" }
    "Rust" = @{ cmd = "rustc"; arg = "--version"; min = "1.70" }
}

$allGood = $true
foreach ($name in $envChecks.Keys) {
    $check = $envChecks[$name]
    $output = & $check.cmd $check.arg 2>&1
    $version = $output | Select-String "\d+\.\d+"
    
    if ($LASTEXITCODE -eq 0 -and $version) {
        Write-Host "  ✅ $name : $($version.Matches[0].Value)"
    } else {
        Write-Host "  ❌ $name : 未找到或版本过低"
        $allGood = $false
    }
}

if (-not $allGood) {
    Write-Host "`n❌ 环境检查失败，请先安装缺失的工具"
    exit 1
}

# ===== 清理（可选）=====
if ($Clean) {
    Write-Host "`n🧹 Step 2/5: 清理构建缓存..."
    $dirsToClean = @(
        "packages\agentai-desktop\src-tauri\target",
        "packages\agentai-gui\dist",
        "packages\agentai-gateway\dist"
    )
    
    foreach ($dir in $dirsToClean) {
        if (Test-Path $dir) {
            Remove-Item -Recurse -Force $dir
            Write-Host "  🗑️  已清理: $dir"
        }
    }
} else {
    Write-Host "`n⏭️  Step 2/5: 跳过清理 (使用 -Clean 参数启用)"
}

# ===== 配置签名密钥 =====
Write-Host "`n🔐 Step 3/5: 配置签名..."
$privateKeyPath = "PulseFlow"
if (Test-Path $privateKeyPath) {
    # 从文件读取私钥
    $keyContent = Get-Content $privateKeyPath -Raw
    $env:TAURI_PRIVATE_KEY = $keyContent
    
    # 提示输入密码
    $password = Read-Host "请输入私钥密码" -AsSecureString
    $passwordPlain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($password))
    $env:TAURI_KEY_PASSWORD = $passwordPlain
    
    Write-Host "  ✅ 签名密钥已配置"
} else {
    Write-Host "  ⚠️  未找到私钥文件: $privateKeyPath"
    Write-Host "     将以无签名模式构建"
    Write-Host "     运行以下命令生成密钥:"
    Write-Host "     .\scripts\manage-tauri-keys.ps1 -Action generate"
}

# ===== 执行构建 =====
Write-Host "`n🔨 Step 4/5: 开始构建..."
Write-Host "  这可能需要 10-20 分钟..."

Set-Location packages\agentai-desktop

if ($Debug) {
    pnpm tauri build --verbose
} else {
    pnpm tauri build
}

Set-Location ..\..

if ($LASTEXITCODE -eq 0) {
    Write-Host "`n✅ Step 5/5: 构建成功！"
    
    # 显示产物位置
    $outputDir = "packages\agentai-desktop\src-tauri\target\release\bundle\nsis"
    if (Test-Path $outputDir) {
        $exeFiles = Get-ChildItem -Path $outputDir -Filter "*.exe"
        if ($exeFiles) {
            Write-Host "`n📦 安装包位置:"
            $exeFiles | ForEach-Object {
                Write-Host "  📄 $($_.FullName) ($( [math]::Round($_.Length / 1MB, 2)) MB)"
            }
            
            # 打开文件夹
            $response = Read-Host "`n是否打开输出文件夹？(Y/n)"
            if ($response -ne 'n' -and $response -ne 'N') {
                Explorer.exe $outputDir
            }
        }
    }
    
    Write-Host @"

╔══════════════════════════════════════════╗
║          🎉 构建成功完成！               ║
╚══════════════════════════════════════════╝
"@
} else {
    Write-Host "`n❌ Step 5/5: 构建失败！"
    Write-Host "  请查看上方错误信息"
    if (-not $Debug) {
        Write-Host "  提示: 使用 -Debug 参数获取详细日志"
    }
    exit 1
}
