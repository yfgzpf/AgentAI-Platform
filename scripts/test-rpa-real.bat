@echo off
chcp 65001 >nul
echo ==========================================
echo   RPA获客系统真实测试
echo ==========================================
echo.

set SKILL_PATH=packages\agentai-skills\marketing\rpa-acquisition-bridge

echo [1/4] 测试 TagUI 安装状态...
echo {"tool": "tagui", "action": "check"} > test_input.json
cd %SKILL_PATH%
python handler.py < ..\..\..\..\test_input.json > ..\..\..\..\test_result.json 2>&1
cd ..\..\..\..
type test_result.json | findstr "success" >nul
if %errorlevel% == 0 (
    echo ✅ TagUI 测试完成
) else (
    echo ⚠️ TagUI 未安装，请先安装: npm install -g tagui
)
echo.

echo [2/4] 测试 Automa 工作流加载...
echo {"tool": "automa", "workflow": "xiaohongshu-post", "params": {"title": "测试", "content": "内容"}} > test_input.json
cd %SKILL_PATH%
python handler.py < ..\..\..\..\test_input.json > ..\..\..\..\test_result.json 2>&1
cd ..\..\..\..
type test_result.json | findstr "success" >nul
if %errorlevel% == 0 (
    echo ✅ Automa 测试完成
) else (
    echo ⚠️ 工作流不存在，请从Automa市场下载
)
echo.

echo [3/4] 测试 Playwright 检查...
echo {"tool": "playwright", "action": "check"} > test_input.json
cd %SKILL_PATH%
python handler.py < ..\..\..\..\test_input.json > ..\..\..\..\test_result.json 2>&1
cd ..\..\..\..
type test_result.json | findstr "success" >nul
if %errorlevel% == 0 (
    echo ✅ Playwright 测试完成
) else (
    echo ⚠️ Playwright 未安装，请先安装: pip install playwright
)
echo.

echo [4/4] 测试八爪鱼配置...
echo {"tool": "bazhuayu", "app_id": "test", "params": {}} > test_input.json
cd %SKILL_PATH%
python handler.py < ..\..\..\..\test_input.json > ..\..\..\..\test_result.json 2>&1
cd ..\..\..\..
type test_result.json | findstr "success" >nul
if %errorlevel% == 0 (
    echo ✅ 八爪鱼配置测试完成
) else (
    echo ⚠️ 需要配置八爪鱼API密钥
)
echo.

echo ==========================================
echo   测试完成
echo ==========================================
echo.
echo 详细结果保存在 test_result.json
echo.
echo 下一步:
echo 1. 安装缺失的工具
echo 2. 从Automa市场下载工作流
echo 3. 配置八爪鱼API密钥
echo 4. 运行真实获客任务
echo.

pause
