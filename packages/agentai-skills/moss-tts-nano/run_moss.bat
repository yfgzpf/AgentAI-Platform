@echo off
SET HF_ENDPOINT=https://hf-mirror.com
SET HF_HOME=F:\agentai-platform\.cache\huggingface
SET HF_HUB_DISABLE_SYMLINKS_WARNING=1
SET PYTHONIOENCODING=utf-8

cd /d "%~dp0"

echo [%DATE% %TIME%] Starting MOSS-TTS-Nano... > moss_service.log
python app.py >> moss_service.log 2>&1
echo [%DATE% %TIME%] Exited with code %ERRORLEVEL% >> moss_service.log
