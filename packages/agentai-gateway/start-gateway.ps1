# 一键启动 agentai-gateway（含端口清理 + 自动重启）
# 用法: .\start-gateway.ps1

$PORT = 18789
$LOG = "$env:USERPROFILE\.agentai\gateway-crash.log"

Write-Host "=== agentai-gateway 启动脚本 ===" -ForegroundColor Cyan
Write-Host "[1/4] 清理残留进程..." -ForegroundColor Yellow

# 杀占用端口的进程
$old = netstat -ano | Select-String ":$PORT" | Select-String "LISTENING"
if ($old) {
    $pid = ($old -split '\s+')[-1]
    if ($pid -and $pid -ne "0") {
        taskkill /F /PID $pid 2>$null
        Write-Host "  Killed PID $pid on port $PORT" -ForegroundColor Green
    }
}

# 杀同名网关进程
Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object {
    $_.CommandLine -match "agentai-gateway" -or $_.CommandLine -match "dist/index.js"
} | ForEach-Object {
    taskkill /F /PID $_.Id 2>$null
    Write-Host "  Killed gateway PID $($_.Id)" -ForegroundColor Green
}

Start-Sleep -Seconds 1

Write-Host "[2/4] 编译..." -ForegroundColor Yellow
pnpm build 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "  ❌ 编译失败！" -ForegroundColor Red
    exit 1
}
Write-Host "  ✅ 编译成功" -ForegroundColor Green

Write-Host "[3/4] 启动网关..." -ForegroundColor Yellow
$ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
Add-Content -Path $LOG -Value "[$ts] === gateway started ==="

# 启动（监控模式：崩溃后自动重启）
$restarts = 0
while ($restarts -lt 5) {
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Write-Host "  Starting node dist/index.js (attempt $($restarts+1))..." -ForegroundColor Green
    
    $proc = Start-Process -FilePath "node" -ArgumentList "dist/index.js" -NoNewWindow -PassThru -RedirectStandardOutput "$env:TEMP\gateway-out.txt" -RedirectStandardError "$env:TEMP\gateway-err.txt"
    
    # 等待进程退出
    $proc.WaitForExit()
    $code = $proc.ExitCode
    
    Add-Content -Path $LOG -Value "[$ts] gateway exited with code $code"
    
    if ($code -eq 0) {
        Write-Host "  ⏹️  gateway 正常退出" -ForegroundColor Yellow
        break
    }
    
    $restarts++
    Write-Host "  ⚠️  gateway 异常退出 (code $code)，${restarts}/5 次重启..." -ForegroundColor Red
    
    # 读取错误日志
    if (Test-Path "$env:TEMP\gateway-err.txt") {
        $err = Get-Content "$env:TEMP\gateway-err.txt" -Tail 10
        Add-Content -Path $LOG -Value "  stderr: $err"
    }
    
    if ($restarts -ge 5) {
        Write-Host "  ❌ 崩溃次数过多，不再自动重启" -ForegroundColor Red
        break
    }
    
    Start-Sleep -Seconds 2
}

Write-Host "[4/4] 完成" -ForegroundColor Cyan
Write-Host "  端口: http://127.0.0.1:$PORT" -ForegroundColor Cyan
Write-Host "  崩溃日志: $LOG" -ForegroundColor Cyan
