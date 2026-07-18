# bundle-moss.ps1 — 打包 MOSS-TTS-Nano 到桌面端 (exe + 模型文件)
# 在 tauri build 前执行:
#   1. 用 PyInstaller 把 app.py 编译成 moss-tts-server.exe
#   2. 把 exe + 模型缓存复制到桌面端资源目录
# 结果: 桌面端安装后开箱即用, 用户不需要装 Python

param(
  [string]$CacheSource = "../../../.cache/huggingface/hub",
  [string]$OutputDir = "../models"
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location $ScriptDir

Write-Host "[bundle-moss] === 开始打包 MOSS-TTS-Nano ===" -ForegroundColor Cyan

# 1. 编译 exe
Write-Host "[bundle-moss] 步骤 1/3: 编译 moss-tts-server.exe ..." -ForegroundColor Cyan
$buildResult = & ".\build-moss-exe.ps1" 2>&1
if ($LASTEXITCODE -ne 0) {
  Write-Host "[bundle-moss] ❌ exe 编译失败" -ForegroundColor Red
  Write-Host $buildResult
  Pop-Location
  exit 1
}

# 2. 复制 exe 到 models 目录
$mossDest = Join-Path $OutputDir "moss-tts-server"
Write-Host "[bundle-moss] 步骤 2/3: 复制 exe 到 $mossDest ..." -ForegroundColor Cyan
Remove-Item -Recurse -Force $mossDest -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $mossDest -Force | Out-Null
Copy-Item -Recurse -Force "dist\exe\moss-tts-server\*" $mossDest

$exeSize = (Get-ChildItem -Recurse $mossDest -File | Measure-Object -Property Length -Sum).Sum
$exeSizeMB = [math]::Round($exeSize / 1MB, 1)
Write-Host "[bundle-moss]   ✅ exe 已复制 ($exeSizeMB MB)" -ForegroundColor Green

# 3. 复制模型缓存 (只复制两个模型, 跳过 .locks 等)
$cacheDest = Join-Path $OutputDir "huggingface\hub"
Write-Host "[bundle-moss] 步骤 3/3: 复制模型缓存 ..." -ForegroundColor Cyan
if (Test-Path $CacheSource) {
  Remove-Item -Recurse -Force $cacheDest -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Path $cacheDest -Force | Out-Null

  $modelDirs = @(
    "models--OpenMOSS-Team--MOSS-TTS-Nano",
    "models--OpenMOSS-Team--MOSS-Audio-Tokenizer-Nano"
  )

  foreach ($modelDir in $modelDirs) {
    $srcPath = Join-Path $CacheSource $modelDir
    if (Test-Path $srcPath) {
      $destPath = Join-Path $cacheDest $modelDir
      Write-Host "[bundle-moss]   复制 $modelDir ..." -ForegroundColor Gray
      Copy-Item -Recurse -Force $srcPath $destPath -Exclude @(".locks")
      $size = (Get-ChildItem -Recurse $destPath -File | Measure-Object -Property Length -Sum).Sum
      $sizeMB = [math]::Round($size / 1MB, 1)
      Write-Host "[bundle-moss]   ✅ $modelDir ($sizeMB MB)" -ForegroundColor Green
    } else {
      Write-Host "[bundle-moss]   ⚠️ 模型缓存未找到: $srcPath" -ForegroundColor Yellow
      Write-Host "[bundle-moss]   你需要先通过 ModelScope 或 hf-mirror 下载模型" -ForegroundColor Yellow
    }
  }
} else {
  Write-Host "[bundle-moss] ⚠️ HF 缓存目录不存在: $CacheSource" -ForegroundColor Yellow
  Write-Host "[bundle-moss] 模型不会打包进安装包, 首次启动会尝试下载" -ForegroundColor Yellow
}

# 4. 如果 assets 存在也复制 (demo 音频)
$assetsDest = Join-Path $OutputDir "moss-tts-server\assets"
if (Test-Path "dist\assets") {
  Copy-Item -Recurse -Force "dist\assets\*" $assetsDest -ErrorAction SilentlyContinue
}

# 5. 清理临时文件
Remove-Item -Recurse -Force "dist" -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force "build" -ErrorAction SilentlyContinue

Write-Host "[bundle-moss] ✅ 打包完成: 用户开箱即用 (exe + 模型已就绪)" -ForegroundColor Green

$totalSize = (Get-ChildItem -Recurse $OutputDir -File | Measure-Object -Property Length -Sum).Sum
$totalSizeMB = [math]::Round($totalSize / 1MB, 1)
Write-Host "[bundle-moss] 总大小: $totalSizeMB MB" -ForegroundColor Cyan

Pop-Location
