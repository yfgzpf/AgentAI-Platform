# build-moss-exe.ps1
# 用 PyInstaller 把 MOSS-TTS-Nano 的服务端 (app.py) 编译成 moss-tts-server.exe
# 产出的 exe 自带 Python 运行时, 用户不需要装 Python
#
# 输出:
#   dist/moss-tts-server/     <- 包含 moss-tts-server.exe + 运行时
#   dist/assets/              <- demo.jsonl + 参考音频 (app.py 需要)
#   dist/huggingface/hub/     <- 模型缓存 (由 bundle-moss.ps1 复制)
#
# 使用方式:
#   powershell -ExecutionPolicy Bypass -File scripts/build-moss-exe.ps1

param(
  [string]$MossSource = "..\..\..\agentai-skills\moss-tts-nano",
  [string]$OutputDir = "dist"
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location $ScriptDir

Write-Host "[build-moss-exe] 开始编译 MOSS-TTS-Nano → exe ..." -ForegroundColor Cyan

# 1. 安装 PyInstaller (如果没装)
try { pyinstaller --version 2>$null } catch {
  Write-Host "[build-moss-exe] 安装 PyInstaller..." -ForegroundColor Yellow
  pip install pyinstaller
}

# 2. 清理旧输出
Remove-Item -Recurse -Force "$OutputDir" -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force "build" -ErrorAction SilentlyContinue
Remove-Item "*.spec" -ErrorAction SilentlyContinue

# 3. 复制 MOSS 源码到临时目录 (不污染原项目)
$tmpSrc = Join-Path $OutputDir "_src"
New-Item -ItemType Directory -Path $tmpSrc -Force | Out-Null
Copy-Item -Recurse -Force "$MossSource\*.py" $tmpSrc -ErrorAction SilentlyContinue
Copy-Item -Recurse -Force "$MossSource\*.toml" $tmpSrc -ErrorAction SilentlyContinue
Copy-Item -Recurse -Force "$MossSource\assets" "$OutputDir\assets" -ErrorAction SilentlyContinue

Write-Host "[build-moss-exe] 编译中 (可能需要 2-5 分钟)..." -ForegroundColor Cyan

# 4. 用 PyInstaller 打包
#    --onedir: 单目录模式 (比 onefile 启动快, 调试方便)
#    --hidden-import: 确保 transformers/torch 等被包含
#    --add-data: assets 目录
pyinstaller --onedir `
  --name moss-tts-server `
  --distpath "$OutputDir\exe" `
  --workpath "$OutputDir\_build" `
  --specpath "$OutputDir\_spec" `
  --add-data "$OutputDir\assets;assets" `
  --hidden-import "uvicorn" `
  --hidden-import "uvicorn.logging" `
  --hidden-import "uvicorn.loops" `
  --hidden-import "uvicorn.loops.auto" `
  --hidden-import "uvicorn.protocols" `
  --hidden-import "uvicorn.protocols.http" `
  --hidden-import "uvicorn.protocols.http.auto" `
  --hidden-import "uvicorn.protocols.websocket" `
  --hidden-import "uvicorn.protocols.websocket.auto" `
  --hidden-import "fastapi" `
  --hidden-import "transformers" `
  --hidden-import "sentencepiece" `
  --hidden-import "torch" `
  --hidden-import "torchaudio" `
  --hidden-import "numpy" `
  --hidden-import "multipart" `
  --hidden-import "huggingface_hub" `
  --collect-all "transformers" `
  --collect-all "sentencepiece" `
  --noconfirm `
  "$tmpSrc\app.py" 2>&1

if ($LASTEXITCODE -ne 0) {
  Write-Host "[build-moss-exe] ❌ 编译失败" -ForegroundColor Red
  Pop-Location
  exit 1
}

# 5. 输出文件信息
$exePath = Resolve-Path "$OutputDir\exe\moss-tts-server" | Select-Object -ExpandProperty Path
$exeSize = (Get-ChildItem -Recurse $exePath -File | Measure-Object -Property Length -Sum).Sum
$exeSizeMB = [math]::Round($exeSize / 1MB, 1)

Write-Host "[build-moss-exe] ✅ 编译成功!" -ForegroundColor Green
Write-Host "  输出: $exePath" -ForegroundColor Cyan
Write-Host "  大小: $exeSizeMB MB" -ForegroundColor Cyan
Write-Host "  模型缓存: assets/ + huggingface/hub/ 单独存放" -ForegroundColor Cyan

# 6. 清理临时文件
Remove-Item -Recurse -Force $tmpSrc -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force "$OutputDir\_build" -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force "$OutputDir\_spec" -ErrorAction SilentlyContinue

Pop-Location
Write-Host "[build-moss-exe] 完成" -ForegroundColor Cyan
