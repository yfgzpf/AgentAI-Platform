@echo off
REM =============================================================
REM install-deps.bat — 安装后/首次启动时的 Gateway 依赖自举
REM ╔══════════════════════════════════════════════════════════╗
REM ║ 构建一致性修复 (P0):                                    ║
REM ║ 1. gateway-dist → gateway-dist-v2 (与主构建脚本一致)    ║
REM ║ 2. 先判断 package.json 是否存在 (便携版可能无此文件)    ║
REM ║ 3. 优先使用构建时已预装好的 node_modules (存在则跳过)   ║
REM ║ 4. npm 不存在时 (即 Node.js 没装) → 不报错, 返回 0      ║
REM ║    首次启动 UI 会再向用户提示安装 Node.js               ║
REM ╚══════════════════════════════════════════════════════════╝
REM =============================================================
setlocal enabledelayedexpansion
chcp 65001 >nul
echo [install-deps] PulseFlow Gateway 依赖检查

set "SCRIPT_DIR=%~dp0"
set "GW_DIR=%SCRIPT_DIR%..\resources\gateway-dist-v2"

REM 规范化路径
for %%i in ("%GW_DIR%") do set "GW_DIR=%%~fi"

if not exist "%GW_DIR%" (
    echo [install-deps] WARN: Gateway目录不存在: %GW_DIR%
    echo [install-deps] SKIP (便携版可能未打包网关)
    exit /b 0
)

echo [install-deps] Gateway 目录: %GW_DIR%
cd /d "%GW_DIR%"

REM 1. node_modules 存在 → 构建时已预安装，直接跳过
if exist "node_modules\express\package.json" (
    echo [install-deps] OK: node_modules 已预安装
    goto :check_playwright
)

REM 2. 没有 package.json → 无法 npm install（迷你版本）
if not exist "package.json" (
    echo [install-deps] WARN: package.json 不存在, SKIP
    exit /b 0
)

REM 3. npm 是否可用
where npm >nul 2>nul
if errorlevel 1 (
    echo [install-deps] WARN: npm 未找到, SKIP (首次启动 UI 会提示安装 Node.js)
    exit /b 0
)

REM 4. 执行 npm install
echo [install-deps] node_modules 缺失, 执行 npm install --production...
call npm install --production --no-optional --ignore-scripts --legacy-peer-deps
if errorlevel 1 (
    echo [install-deps] WARN: npm install 失败 (可忽略, 首次启动 UI 会重试)
) else (
    echo [install-deps] OK: npm install 完成
)

:check_playwright
REM =============================================================
REM Playwright Chromium: 不在安装包中 (~4GB), 只在首次启动 UI 里安装
REM =============================================================
where npx >nul 2>nul
if errorlevel 1 goto :done

if exist "%LOCALAPPDATA%\ms-playwright\chromium-*" (
    echo [install-deps] OK: Playwright Chromium 已安装
) else (
    echo [install-deps] INFO: Playwright Chromium 待首次启动时安装
)

:done
echo [install-deps] Done
endlocal
exit /b 0
