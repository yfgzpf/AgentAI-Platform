# bundle-python.ps1 — 打包 Python 技能环境到 Tauri 桌面端资源目录
# ---------------------------------------------------------------
# 在 tauri build 的 beforeBuildCommand 中执行:
#   1. 收集 agentai-skills (37+ Python 多模态技能)
#   2. 收集 SkillOpt-Sleep (离线自进化引擎)
#   3. 生成 python-requirements.txt (依赖清单)
#   4. 复制到 src-tauri/resources/python/ (嵌入安装包)
#
# 用法: .\scripts\bundle-python.ps1 [-OutputDir "../resources/python"]
#
# 前置条件:
#   - Python 3.10+ 已安装 (NSIS 安装钩子会检测并安装)
#   - 项目根目录下 packages/agentai-skills/ 和 SkillOpt/ 存在

param(
  [string]$OutputDir = "..\resources\python"
)

$ErrorActionPreference = "Stop"

# ── 路径解析 ──────────────────────────────────────────────
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$TauriDir = Split-Path -Parent $ScriptDir
$DesktopDir = Split-Path -Parent $TauriDir
$RootDir = Split-Path -Parent $DesktopDir
$SkillsSrc = Join-Path $RootDir "packages\agentai-skills"
$SkillOptSrc = Join-Path $RootDir "SkillOpt"
$DestDir = Join-Path $TauriDir $OutputDir

Push-Location $TauriDir

Write-Host ""
Write-Host "╔══════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║     🔧 AgentAI — Python 技能环境打包              ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# ── Step 0: 清理旧产物 ──────────────────────────────────────
Write-Host "[0/5] 🧹 清理旧的 Python 资源..." -ForegroundColor Yellow
Remove-Item -Recurse -Force $DestDir -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $DestDir -Force | Out-Null
Write-Host "      ✅ 输出目录已清空: $DestDir" -ForegroundColor Green

# ── Step 1: 打包 agentai-skills ─────────────────────────────
Write-Host "[1/5] 📦 打包 agentai-skills (Python 多模态技能)..." -ForegroundColor Yellow

if (-not (Test-Path $SkillsSrc)) {
  Write-Host "      ⚠️  skills 目录不存在: $SkillsSrc" -ForegroundColor Yellow
  Write-Host "         将跳过技能打包, 桌面端启动后需要在线拉取" -ForegroundColor DarkGray
} else {
  $skillsDest = Join-Path $DestDir "skills"
  
  # 复制整个 skills 目录 (保留结构)
  Copy-Item -Recurse -Force $SkillsSrc $skillsDest
  
  # 排除不需要的文件 (__pycache__, .pytest_cache, node_modules, .git)
  Get-ChildItem -Path $skillsDest -Recurse -Directory -Filter "__pycache__" | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
  Get-ChildItem -Path $skillsDest -Recurse -Directory -Filter ".pytest_cache" | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
  Get-ChildItem -Path $skillsDest -Recurse -Directory -Filter "node_modules" | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
  Get-ChildItem -Path $skillsDest -Recurse -Directory -Filter ".git" | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
  # 排除 .pyc 文件
  Get-ChildItem -Path $skillsDest -Recurse -File -Filter "*.pyc" | Remove-Item -Force -ErrorAction SilentlyContinue
  
  # 统计
  $skillDirs = (Get-ChildItem -Path $skillsDest -Directory | Where-Object { $_.Name -ne "_lib" -and $_.Name -ne "agents" -and $_.Name -ne "__pycache__" })
  $skillsSize = (Get-ChildItem -Path $skillsDest -Recurse -File | Measure-Object -Property Length -Sum).Sum
  $skillsSizeKB = [math]::Round($skillsSize / 1KB, 0)
  
  Write-Host "      ✅ 技能已复制: $($skillDirs.Count) 个技能目录 ($skillsSizeKB KB)" -ForegroundColor Green
}

# ── Step 2: 打包 SkillOpt-Sleep (离线自进化引擎) ────────────
Write-Host "[2/5] 🧬 打包 SkillOpt-Sleep (离线自进化引擎)..." -ForegroundColor Yellow

if (-not (Test-Path $SkillOptSrc)) {
  Write-Host "      ⚠️  SkillOpt 目录不存在: $SkillOptSrc" -ForegroundColor Yellow
  Write-Host "         将跳过自进化引擎, 反思门仍可工作(在线模式)" -ForegroundColor DarkGray
} else {
  $skilloptDest = Join-Path $DestDir "skillopt_sleep"
  
  # 只复制 skillopt_sleep 子模块 (不是整个 SkillOpt 目录)
  $sleepSrc = Join-Path $SkillOptSrc "skillopt_sleep"
  if (Test-Path $sleepSrc) {
    Copy-Item -Recurse -Force $sleepSrc $skilloptDest
    
    # 清理 __pycache__
    Get-ChildItem -Path $skilloptDest -Recurse -Directory -Filter "__pycache__" | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    Get-ChildItem -Path $skilloptDest -Recurse -File -Filter "*.pyc" | Remove-Item -Force -ErrorAction SilentlyContinue
    
    $optFiles = (Get-ChildItem -Path $skilloptDest -Recurse -File -Filter "*.py").Count
    $optSize = (Get-ChildItem -Path $skilloptDest -Recurse -File | Measure-Object -Property Length -Sum).Sum
    $optSizeKB = [math]::Round($optSize / 1KB, 0)
    
    Write-Host "      ✅ SkillOpt-Sleep 已复制: $optFiles 个 Python 文件 ($optSizeKB KB)" -ForegroundColor Green
  } else {
    Write-Host "      ⚠️  skillopt_sleep 子目录不存在" -ForegroundColor Yellow
  }
}

# ── Step 3: 生成依赖清单 requirements.txt ───────────────────
Write-Host "[3/5] 📋 生成 Python 依赖清单..." -ForegroundColor Yellow

$reqFile = Join-Path $DestDir "requirements.txt"

# 从各子项目的 requirements.txt / pyproject.toml 收集依赖
$allDeps = @{}

# agentai-skills 的依赖
$skillsReq = Join-Path $SkillsSrc "requirements.txt"
if (Test-Path $skillsReq) {
  Get-Content $skillsReq | ForEach-Object {
    $line = $_.Trim()
    if ($line -and -not $line.StartsWith("#") -and $line.Contains("=")) {
      $pkgName = ($line -split "[=<>~! ]")[0].Trim().ToLower()
      if ($pkgName) { $allDeps[$pkgName] = $line }
    }
  }
}

# SkillOpt 的依赖
$skilloptReq = Join-Path $SkillOptSrc "requirements.txt"
if (Test-Path $skilloptReq) {
  Get-Content $skilloptReq | ForEach-Object {
    $line = $_.Trim()
    if ($line -and -not $line.StartsWith("#") -and $line.Contains("=")) {
      $pkgName = ($line -split "[=<>~! ]")[0].Trim().ToLower()
      if ($pkgName) { $allDeps[$pkgName] = $line }
    }
  }
}

# SkillOpt pyproject.toml 中的依赖
$skilloptPyproject = Join-Path $SkillOptSrc "pyproject.toml"
if (Test-Path $skilloptPyproject) {
  $inDeps = $false
  Get-Content $skilloptPyproject | ForEach-Object {
    $line = $_.Trim()
    if ($line -match "^\[dependencies\]") { $inDeps = $true; return }
    if ($line -match "^\[") { $inDeps = $false; return }
    if ($inDeps -and $line -match '\w+\s*=\s*["\'].*["\']') {
      $pkgName = ($line -split "\s*=")[0].Trim().ToLower()
      if ($pkgName) { $allDeps[$pkgName] = $line }
    }
  }
}

# 写入合并后的 requirements.txt
$depLines = @(
  "# Auto-generated by bundle-python.ps1",
  "# AgentAI Desktop Python Dependencies",
  "# Generated: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')",
  "",
  "# === Core ===",
  "fastapi>=0.110.0",
  "uvicorn>=0.27.0",
  "pydantic>=2.6.0",
  "httpx>=0.26.0",
  "websockets>=12.0",
  "",
  "# === Skills Runtime ===",
  "Pillow>=10.0.0",
  "openpyxl>=3.1.2",
  "python-docx>=1.1.0",
  "python-pptx>=0.6.23",
  "beautifulsoup4>=4.12.0",
  "lxml>=5.1.0",
  "aiofiles>=23.2.0",
  "",
  "# === AI / LLM ===",
  "openai>=1.12.0",
  "anthropic>=0.18.0",
  "tiktoken>=0.6.0",
  "",
  "# === Data ===",
  "pandas>=2.2.0",
  "numpy>=1.26.0",
  "",
  "# === SkillOpt ===",
  "rich>=13.7.0",
  "click>=8.1.0",
  "jinja2>=3.1.0",
  "",
  "# === Tools ===",
  "dockerode-py>=0.1.0",  # 如果有 Python Docker SDK
  "playwright>=1.41.0",    # 浏览器自动化
  "",
  "# === Collected from sub-projects below ===",
  ""
)

# 追加收集到的项目特定依赖
foreach ($dep in $allDeps.Values | Sort-Object) {
  $depLines += $dep
}

Set-Content -Path $reqFile -Value $depLines -Encoding UTF8
$depCount = ($allDeps.Keys).Count
Write-Host "      ✅ 依赖清单已生成: $reqFile (核心 + $depCount 个项目依赖)" -ForegroundColor Green

# ── Step 4: 生成版本信息 manifest ────────────────────────────
Write-Host "[4/5] 📄 生成环境清单 manifest.json..." -ForegroundColor Yellow

$manifest = @{
  version = "0.1.0-alpha.1"
  generatedAt = (Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ")
  components = @{}
}

if (Test-Path (Join-Path $DestDir "skills")) {
  $skillList = @(Get-ChildItem -Path "$DestDir\skills" -Directory | Where-Object {
    $_.Name -notin @("_lib", "agents", "__pycache__")
  } | Select-Object -ExpandProperty Name)
  $manifest.components.skills = @{
    path = "skills"
    count = $skillList.Count
    items = $skillList
  }
}

if (Test-Path (Join-Path $DestDir "skillopt_sleep")) {
  $manifest.components.skillopt_sleep = @{
    path = "skillopt_sleep"
    type = "offline-evolution-engine"
    description = "验证门控的技能离线自进化 (Microsoft Research)"
  }
}

$manifest.components.requirements = @{
  path = "requirements.txt"
  installCommand = "pip install -r python/requirements.txt"
}

$manifestJson = $manifest | ConvertToJson -Depth 3
Set-Content -Path (Join-Path $DestDir "manifest.json") -Value $manifestJson -Encoding UTF8
Write-Host "      ✅ manifest.json 已生成" -ForegroundColor Green

# ── Step 5: 统计 & 验证 ─────────────────────────────────────
Write-Host "[5/5] 📊 打包统计与验证..." -ForegroundColor Yellow

$totalSize = (Get-ChildItem -Path $DestDir -Recurse -File | Measure-Object -Property Length -Sum).Sum
$totalSizeMB = [math]::Round($totalSize / 1MB, 2)
$totalFiles = (Get-ChildItem -Path $DestDir -Recurse -File).Count
$totalDirs = (Get-ChildItem -Path $DestDir -Recurse -Directory).Count

Write-Host ""
Write-Host "┌────────────────────────────────────────────────┐" -ForegroundColor Cyan
Write-Host "│  📦 Python 技能环境打包完成                      │" -ForegroundColor Cyan
Write-Host "├────────────────────────────────────────────────┤" -ForegroundColor Cyan
Write-Host "│  总大小:       $($totalSizeMB.ToString().PadLeft(8)) MB                  │" -ForegroundColor White
Write-Host "│  文件数:       $($totalFiles.ToString().PadLeft(8)) 个                   │" -ForegroundColor White
Write-Host "│  目录数:       $($totalDirs.ToString().PadLeft(8)) 个                   │" -ForegroundColor White
Write-Host "│  输出位置:     $DestDir │" -ForegroundColor Gray
Write-Host "└────────────────────────────────────────────────┘" -ForegroundColor Cyan
Write-Host ""

# 验证关键文件存在
$errors = @()
if (-not (Test-Path (Join-Path $DestDir "manifest.json"))) { errors += "缺少 manifest.json" }
if (-not (Test-Path (Join-Path $DestDir "requirements.txt"))) { errors += "缺少 requirements.txt" }

if ($errors.Count -gt 0) {
  Write-Host "⚠️  验证警告:" -ForegroundColor Yellow
  foreach ($err in $errors) { Write-Host "   - $err" -ForegroundColor Yellow }
}

Pop-Location

Write-Host "✨ bundle-python.ps1 执行完成!" -ForegroundColor Green
