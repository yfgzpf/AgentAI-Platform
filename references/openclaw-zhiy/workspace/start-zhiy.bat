@echo off
chcp 65001 >nul
echo.
echo  ========================================
echo   智 Y.Ai - 企业级 AI 助手系统
echo   基于 OpenClaw 中文版构建
echo  ========================================
echo.
echo  [启动中] 正在初始化系统...
echo.

cd /d F:\智Y.AI\zhiy-ai\openclaw-source\openclaw-zh

echo  [Gateway] 启动网关服务...
echo  访问地址: http://127.0.0.1:18789
echo  浏览器控制: http://127.0.0.1:18791
echo.
echo  按 Ctrl+C 停止服务
echo.

node openclaw.mjs gateway
