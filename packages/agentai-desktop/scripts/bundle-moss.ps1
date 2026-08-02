#!/usr/bin/env pwsh
<#
.SYNOPSIS
MOSS-TTS bundle script - runs before Tauri build
Copies moss-tts-nano skill directory + cached models to resources directory

Resource structure (after bundling):
  resources/
    moss-tts-server/
      app.py               # FastAPI entry
      moss_tts_nano_runtime.py
      text_normalization_pipeline.py
      assets/              # voice preset audio
      requirements.txt
    huggingface/
      hub/                 # HF model cache (optional, auto-download on first use)

#>

$ErrorActionPreference = "Stop"

# ===== Paths =====
$ROOT = Resolve-Path "$PSScriptRoot/../../.."
$SKILLS_DIR = "$ROOT/packages/agentai-skills/moss-tts-nano"
$RES_DIR = "$ROOT/packages/agentai-desktop/resources"
$MOSS_RES = "$RES_DIR/moss-tts-server"
$HF_RES = "$RES_DIR/huggingface"
$CACHE_DIR = "$ROOT/.cache/huggingface"

Write-Host "[bundle-moss] Start bundling MOSS-TTS resources..."

# 1) Create target directories
New-Item -ItemType Directory -Path $MOSS_RES -Force | Out-Null
New-Item -ItemType Directory -Path $HF_RES -Force | Out-Null

# 2) Copy skill directory (exclude .git, __pycache__, temp scripts)
Write-Host "[bundle-moss] Copying skill files..."
Get-ChildItem -Path $SKILLS_DIR -File -Recurse | Where-Object {
    $_.FullName -notmatch '__pycache__|\.git|\.pyc|_download_models|start_with_env|scripts[\\/]'
} | ForEach-Object {
    $rel = $_.FullName.Substring($SKILLS_DIR.Length + 1)
    $dest = Join-Path $MOSS_RES $rel
    New-Item -ItemType Directory -Path (Split-Path $dest -Parent) -Force | Out-Null
    Copy-Item $_.FullName $dest -Force
}
Write-Host "[bundle-moss] Skill files copied."

# 3) Copy HF model cache (if downloaded)
if (Test-Path "$CACHE_DIR/hub/models--OpenMOSS-Team--MOSS-TTS-Nano") {
    Write-Host "[bundle-moss] Copying TTS model cache..."
    $ttsDir = "$CACHE_DIR/hub/models--OpenMOSS-Team--MOSS-TTS-Nano"
    $dest = "$HF_RES/hub/models--OpenMOSS-Team--MOSS-TTS-Nano"
    New-Item -ItemType Directory -Path $dest -Force | Out-Null
    Copy-Item "$ttsDir/*" $dest -Recurse -Force
    $sizeGB = [math]::Round((Get-ChildItem $dest -Recurse | Measure-Object Length -Sum).Sum / 1GB, 2)
    Write-Host "[bundle-moss] TTS model copied ($sizeGB GB)"
} else {
    Write-Host "[bundle-moss] WARNING: TTS model cache not found, will auto-download on first use"
}

if (Test-Path "$CACHE_DIR/hub/models--OpenMOSS-Team--MOSS-Audio-Tokenizer-Nano") {
    Write-Host "[bundle-moss] Copying Audio Tokenizer cache..."
    $audioDir = "$CACHE_DIR/hub/models--OpenMOSS-Team--MOSS-Audio-Tokenizer-Nano"
    $dest = "$HF_RES/hub/models--OpenMOSS-Team--MOSS-Audio-Tokenizer-Nano"
    New-Item -ItemType Directory -Path $dest -Force | Out-Null
    Copy-Item "$audioDir/*" $dest -Recurse -Force
    Write-Host "[bundle-moss] Audio Tokenizer copied."
} else {
    Write-Host "[bundle-moss] WARNING: Audio Tokenizer cache not found, will auto-download on first use"
}

Write-Host "[bundle-moss] DONE - MOSS-TTS bundling complete"
Write-Host "[bundle-moss]   Skill: $MOSS_RES"
Write-Host "[bundle-moss]   Model: $HF_RES"
