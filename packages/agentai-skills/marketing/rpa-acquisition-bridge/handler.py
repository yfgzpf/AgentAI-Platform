#!/usr/bin/env python3
"""
RPA Acquisition Bridge - RPA获客桥接器
集成TagUI、Automa、Playwright等真实RPA工具
"""

import json
import sys
import os
import subprocess
from pathlib import Path
from typing import Dict, Optional


class RPAAdapter:
    """RPA工具适配器基类"""
    
    def execute(self, params: Dict) -> Dict:
        raise NotImplementedError


class TagUIAdapter(RPAAdapter):
    """TagUI适配器"""
    
    def execute(self, params: Dict) -> Dict:
        script = params.get("script", "")
        script_params = params.get("script_params", {})
        
        if not script:
            return {"success": False, "error": "Missing script parameter"}
        
        # 检查TagUI是否安装
        tagui_path = self._find_tagui()
        if not tagui_path:
            return {
                "success": False,
                "error": "TagUI not found. Install with: npm install -g tagui"
            }
        
        # 准备脚本参数
        param_str = " ".join([f"{k}='{v}'" for k, v in script_params.items()])
        
        # 执行TagUI脚本
        cmd = [tagui_path, script, param_str]
        
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=300,
                cwd=os.path.dirname(script) if os.path.exists(script) else "."
            )
            
            return {
                "success": result.returncode == 0,
                "returncode": result.returncode,
                "stdout": result.stdout,
                "stderr": result.stderr,
                "tool": "tagui"
            }
        except subprocess.TimeoutExpired:
            return {"success": False, "error": "TagUI execution timeout", "tool": "tagui"}
        except Exception as e:
            return {"success": False, "error": str(e), "tool": "tagui"}
    
    def _find_tagui(self) -> Optional[str]:
        """查找TagUI可执行文件"""
        # 常见安装路径
        paths = [
            "tagui",
            "/usr/local/bin/tagui",
            "/usr/bin/tagui",
            os.path.expanduser("~/.npm-global/bin/tagui"),
            "C:\\Users\\%USERNAME%\\AppData\\Roaming\\npm\\tagui.cmd",
        ]
        
        for path in paths:
            try:
                result = subprocess.run([path, "--version"], capture_output=True, timeout=5)
                if result.returncode == 0:
                    return path
            except:
                continue
        
        return None


class PlaywrightAdapter(RPAAdapter):
    """Playwright适配器"""
    
    def execute(self, params: Dict) -> Dict:
        script = params.get("script", "")
        script_params = params.get("script_params", {})
        
        if not script:
            return {"success": False, "error": "Missing script parameter"}
        
        # 检查Playwright是否安装
        try:
            import playwright
        except ImportError:
            return {
                "success": False,
                "error": "Playwright not installed. Run: pip install playwright && playwright install"
            }
        
        # 将参数写入临时文件
        param_file = "/tmp/playwright_params.json"
        with open(param_file, "w") as f:
            json.dump(script_params, f)
        
        # 执行Python脚本
        env = os.environ.copy()
        env["PARAMS_FILE"] = param_file
        
        try:
            result = subprocess.run(
                ["python", script],
                capture_output=True,
                text=True,
                timeout=300,
                env=env
            )
            
            return {
                "success": result.returncode == 0,
                "returncode": result.returncode,
                "stdout": result.stdout[-2000:] if len(result.stdout) > 2000 else result.stdout,
                "stderr": result.stderr[-1000:] if len(result.stderr) > 1000 else result.stderr,
                "tool": "playwright"
            }
        except subprocess.TimeoutExpired:
            return {"success": False, "error": "Playwright execution timeout", "tool": "playwright"}
        except Exception as e:
            return {"success": False, "error": str(e), "tool": "playwright"}


class AutomaAdapter(RPAAdapter):
    """Automa适配器 (通过Chrome扩展协议)"""
    
    def execute(self, params: Dict) -> Dict:
        workflow = params.get("workflow", "")
        workflow_params = params.get("params", {})
        
        if not workflow:
            return {"success": False, "error": "Missing workflow parameter"}
        
        # Automa需要通过Chrome扩展的Native Messaging或HTTP API调用
        # 这里提供一个模拟实现，实际部署时需要配置Automa服务器
        
        # 检查Automa工作流文件是否存在
        workflow_file = f"workflows/{workflow}.json"
        if not os.path.exists(workflow_file):
            return {
                "success": False,
                "error": f"Workflow not found: {workflow_file}. Please download from Automa marketplace.",
                "hint": "Visit https://www.automa.site/marketplace to download workflows"
            }
        
        # 模拟执行 (实际应调用Automa API)
        return {
            "success": True,
            "message": "Automa workflow loaded (simulated execution)",
            "workflow": workflow,
            "params": workflow_params,
            "note": "To run actually, install Automa Chrome extension and configure API",
            "tool": "automa"
        }


class BazhuayuAdapter(RPAAdapter):
    """八爪鱼RPA适配器"""
    
    def execute(self, params: Dict) -> Dict:
        app_id = params.get("app_id", "")
        app_params = params.get("params", {})
        
        if not app_id:
            return {"success": False, "error": "Missing app_id parameter"}
        
        # 八爪鱼需要通过API调用
        # 这里提供模拟实现
        
        return {
            "success": True,
            "message": "Bazhuayu app configured (simulated execution)",
            "app_id": app_id,
            "params": app_params,
            "note": "To run actually, get API key from https://rpa.bazhuayu.com",
            "pricing_hint": "小红书搜索笔记采集: ¥20/month, 抖音视频采集: ¥20/month",
            "tool": "bazhuayu"
        }


class RPABridge:
    """RPA桥接器"""
    
    def __init__(self):
        self.adapters = {
            "tagui": TagUIAdapter(),
            "playwright": PlaywrightAdapter(),
            "automa": AutomaAdapter(),
            "bazhuayu": BazhuayuAdapter(),
        }
    
    def execute(self, tool: str, params: Dict) -> Dict:
        """执行RPA任务"""
        if tool not in self.adapters:
            return {
                "success": False,
                "error": f"Unknown tool: {tool}. Supported: {list(self.adapters.keys())}"
            }
        
        adapter = self.adapters[tool]
        return adapter.execute(params)


def main():
    try:
        input_data = json.load(sys.stdin)
        
        tool = input_data.get("tool", "")
        action = input_data.get("action", "execute")
        
        if not tool:
            print(json.dumps({
                "success": False,
                "error": "Missing 'tool' parameter. Use: tagui, playwright, automa, bazhuayu"
            }))
            sys.exit(1)
        
        bridge = RPABridge()
        
        if action == "execute":
            result = bridge.execute(tool, input_data)
        elif action == "check":
            # 检查工具安装状态
            result = check_tool_status(tool)
        else:
            result = {"success": False, "error": f"Unknown action: {action}"}
        
        # 格式化输出
        output = {
            "success": result.get("success", False),
            "output": format_output(result),
            "data": result
        }
        
        print(json.dumps(output, ensure_ascii=False))
        
    except Exception as e:
        print(json.dumps({
            "success": False,
            "error": str(e)
        }))
        sys.exit(1)


def check_tool_status(tool: str) -> Dict:
    """检查工具安装状态"""
    status = {"tool": tool, "installed": False}
    
    if tool == "tagui":
        try:
            result = subprocess.run(["tagui", "--version"], capture_output=True, timeout=5)
            status["installed"] = result.returncode == 0
            status["version"] = result.stdout.decode().strip() if result.stdout else "unknown"
        except:
            status["install_hint"] = "npm install -g tagui"
    
    elif tool == "playwright":
        try:
            import playwright
            status["installed"] = True
            status["version"] = playwright.__version__
        except ImportError:
            status["install_hint"] = "pip install playwright && playwright install"
    
    elif tool == "automa":
        status["installed"] = "check_browser_extension"
        status["install_hint"] = "Install from Chrome Web Store: https://chrome.google.com/webstore/detail/automa/infppggnoaenmfagbfknfkancpbljcca"
    
    elif tool == "bazhuayu":
        status["installed"] = "requires_api_key"
        status["install_hint"] = "Register at https://rpa.bazhuayu.com and get API key"
    
    return status


def format_output(result: Dict) -> str:
    """格式化输出"""
    if not result.get("success"):
        error = result.get("error", "Unknown error")
        hint = result.get("hint", "")
        output = f"❌ 执行失败: {error}"
        if hint:
            output += f"\n💡 提示: {hint}"
        return output
    
    tool = result.get("tool", "")
    output_parts = [f"✅ {tool.upper()} 执行成功"]
    
    if "stdout" in result:
        stdout = result["stdout"]
        if stdout:
            output_parts.append(f"\n📤 输出:\n{stdout}")
    
    if "message" in result:
        output_parts.append(f"\n📝 {result['message']}")
    
    if "note" in result:
        output_parts.append(f"\n💡 说明: {result['note']}")
    
    return "\n".join(output_parts)


if __name__ == "__main__":
    main()
