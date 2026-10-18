@echo off
REM 2026-10-18: 缓存目录改为用户可写路径 (装到 Program Files 时安装目录不可写)
IF NOT DEFINED HF_HOME SET "HF_HOME=%LOCALAPPDATA%\PulseFlow\huggingface"
python app.py
