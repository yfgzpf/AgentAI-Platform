<#
.SYNOPSIS
    Tauri 签名密钥管理工具
.DESCRIPTION
    生成、备份、验证、显示 Tauri 签名密钥
.EXAMPLE
    .\manage-tauri-keys.ps1 -Action generate
    .\manage-tauri-keys.ps1 -Action show-pubkey
    .\manage-tauri-keys.ps1 -Action backup
#>

param(
    [Parameter(Mandatory=$true)]
    [ValidateSet("generate", "show-pubkey", "verify", "backup", "check-secrets")]
    [string]$Action,
    
    [string]$KeyName = "PulseFlow"
)

$ErrorActionPreference = "Stop"

Write-Host @"
╔══════════════════════════════════════════╗
║   🔐 Tauri Signing Key Manager v1.0      ║
╚══════════════════════════════════════════╝
"@

switch ($Action) {
    "generate" {
        Write-Host "`n🔐 生成新的签名密钥对..."
        Write-Host "⚠️  注意: 这会使旧密钥失效，已安装的用户将无法自动更新！"
        $response = Read-Host "确认继续？(y/N)"
        if ($response -ne 'y' -and $response -ne 'Y') {
            Write-Host "❌ 已取消"
            exit 0
        }
        
        # 备份现有密钥
        if (Test-Path $KeyName) {
            Write-Host "📦 备份现有密钥..."
            .\scripts\manage-tauri-keys.ps1 -Action backup
        }
        
        # 生成新密钥
        Set-Location packages\agentai-desktop
        pnpm tauri signer generate -w $KeyName
        Set-Location ..\..
        
        if (Test-Path "$KeyName.pub") {
            Write-Host "`n✅ 密钥生成成功！"
            Write-Host "`n公钥内容 (需要更新到 tauri.conf.json):"
            Write-Host "----------------------------------------"
            Get-Content "$KeyName.pub"
            Write-Host "----------------------------------------"
            Write-Host "`n⚠️  接下来需要:"
            Write-Host "  1. 更新 tauri.conf.json → plugins.updater.pubkey"
            Write-Host "  2. 更新 GitHub Secrets → TAURI_SIGNING_PRIVATE_KEY"
            Write-Host "  3. 提交公钥文件到 Git"
        }
    }
    
    "show-pubkey" {
        $pubKeyPath = "$KeyName.pub"
        if (-not (Test-Path $pubKeyPath)) {
            Write-Host "❌ 公钥文件不存在: $pubKeyPath"
            exit 1
        }
        Write-Host "`n📖 公钥内容:"
        Write-Host "----------------------------------------"
        Get-Content $pubKeyPath
        Write-Host "----------------------------------------"
    }
    
    "backup" {
        $date = Get-Date -Format "yyyyMMdd-HHmmss"
        if ((Test-Path $KeyName) -or (Test-Path "$KeyName.pub")) {
            New-Item -ItemType Directory -Force -Path ".keys-backup" | Out-Null
            
            if (Test-Path $KeyName) {
                Copy-Item $KeyName ".keys-backup\$KeyName-$date"
                Write-Host "✅ 私钥已备份"
            }
            
            if (Test-Path "$KeyName.pub") {
                Copy-Item "$KeyName.pub" ".keys-backup\$KeyName.pub-$date"
                Write-Host "✅ 公钥已备份"
            }
            
            Write-Host "📦 备份位置: .keys-backup\"
        } else {
            Write-Host "⚠️  未找到密钥文件"
        }
    }
    
    "verify" {
        Write-Host "`n🔍 验证密钥配置..."
        $issues = @()
        
        # 检查私钥
        if (-not (Test-Path $KeyName)) {
            $issues += "❌ 私钥文件不存在: $KeyName"
        } else {
            Write-Host "✅ 私钥文件存在"
        }
        
        # 检查公钥
        if (-not (Test-Path "$KeyName.pub")) {
            $issues += "❌ 公钥文件不存在: $KeyName.pub"
        } else {
            Write-Host "✅ 公钥文件存在"
        }
        
        # 检查 tauri.conf.json
        $tauriConf = "packages\agentai-desktop\src-tauri\tauri.conf.json"
        if (Test-Path $tauriConf) {
            $conf = Get-Content $tauriConf | ConvertFrom-Json
            $configuredPubkey = $conf.plugins.updater.pubkey
            if ($configuredPubkey) {
                Write-Host "✅ tauri.conf.json 已配置公钥"
            } else {
                $issues += "❌ tauri.conf.json 未配置 updater.pubkey"
            }
        } else {
            $issues += "❌ tauri.conf.json 不存在"
        }
        
        # 输出结果
        if ($issues.Count -eq 0) {
            Write-Host "`n🎉 所有检查通过！"
        } else {
            Write-Host "`n⚠️  发现以下问题:"
            $issues | ForEach-Object { Write-Host $_ }
        }
    }
    
    "check-secrets" {
        Write-Host "`n🔑 GitHub Secrets 配置清单"
        Write-Host "========================================="
        Write-Host ""
        Write-Host "需要在 GitHub 仓库设置的 Secrets:"
        Write-Host ""
        Write-Host "1. TAURI_SIGNING_PRIVATE_KEY"
        Write-Host "   值: 私钥文件的完整内容"
        if (Test-Path $KeyName) {
            $keyContent = Get-Content $KeyName -Raw
            Write-Host "   当前私钥长度: $($keyContent.Length) 字符"
        } else {
            Write-Host "   ⚠️  私钥文件不存在！"
        }
        Write-Host ""
        Write-Host "2. TAURI_KEY_PASSWORD"
        Write-Host "   值: 生成密钥时设置的密码"
        Write-Host ""
        Write-Host "设置位置:"
        Write-Host "https://github.com/yfgzpf/AgentAI-Platform/settings/secrets/actions"
    }
}

Write-Host ""
