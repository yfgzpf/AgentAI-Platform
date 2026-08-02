@echo off
chcp 65001 >nul
echo [install-deps] Installing Gateway dependencies...

set "GW_DIR=%~dp0..\resources\gateway-dist"
cd /d "%GW_DIR%"

echo [install-deps] Working directory: %CD%

if not exist "node_modules" (
    echo [install-deps] node_modules not found, running npm install...
    call npm install --production --no-optional --ignore-scripts
    if errorlevel 1 (
        echo [install-deps] ERROR: npm install failed!
        exit /b 1
    )
    echo [install-deps] npm install completed!
) else (
    echo [install-deps] node_modules already exists.
)

echo [install-deps] Done!
