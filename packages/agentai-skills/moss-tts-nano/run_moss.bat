@echo off
SET HF_ENDPOINT=https://hf-mirror.com
REM 2026-10-18: 模型缓存不能落在安装目录 —— 装到 Program Files 时不可写,
REM 且换盘符/换用户会直接失效。统一放用户可写的本地应用数据目录。
IF NOT DEFINED HF_HOME SET "HF_HOME=%LOCALAPPDATA%\PulseFlow\huggingface"
SET HF_HUB_DISABLE_SYMLINKS_WARNING=1
SET PYTHONIOENCODING=utf-8

cd /d "%~dp0"

echo [%DATE% %TIME%] Starting MOSS-TTS-Nano... > moss_service.log
python app.py >> moss_service.log 2>&1
echo [%DATE% %TIME%] Exited with code %ERRORLEVEL% >> moss_service.log
