#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
桌面控制技能
支持打开应用、执行命令、键盘鼠标模拟、截图
"""

import argparse
import json
import os
import sys
import subprocess
from datetime import datetime

try:
    import pyautogui
    pyautogui.FAILSAFE = True
    pyautogui.PAUSE = 0.5
    PYAUTOGUI_AVAILABLE = True
except ImportError:
    PYAUTOGUI_AVAILABLE = False
    print("[WARN] pyautogui not installed. Run: pip install pyautogui pillow")

def open_application(app_path: str):
    """打开应用程序"""
    if not app_path:
        return {"success": False, "error": "未指定应用程序路径"}
    
    try:
        if sys.platform == 'win32':
            if app_path.startswith('explorer'):
                subprocess.Popen(['explorer', app_path.replace('explorer ', '')])
            else:
                os.startfile(app_path)
        elif sys.platform == 'darwin':
            subprocess.Popen(['open', app_path])
        else:
            subprocess.Popen(['xdg-open', app_path])
        
        return {"success": True, "message": f"已打开: {app_path}"}
    except Exception as e:
        return {"success": False, "error": str(e)}

def execute_command(cmd: str):
    """执行系统命令"""
    if not cmd:
        return {"success": False, "error": "未指定命令"}
    
    try:
        result = subprocess.run(
            cmd, 
            shell=True, 
            capture_output=True, 
            text=True,
            timeout=60
        )
        
        return {
            "success": True,
            "returncode": result.returncode,
            "stdout": result.stdout[:2000],
            "stderr": result.stderr[:1000]
        }
    except subprocess.TimeoutExpired:
        return {"success": False, "error": "命令执行超时"}
    except Exception as e:
        return {"success": False, "error": str(e)}

def key_press(key: str):
    """模拟按键"""
    if not PYAUTOGUI_AVAILABLE:
        return {"success": False, "error": "pyautogui 未安装"}
    
    try:
        pyautogui.press(key)
        return {"success": True, "message": f"已按下: {key}"}
    except Exception as e:
        return {"success": False, "error": str(e)}

def key_hotkey(*keys):
    """模拟组合键"""
    if not PYAUTOGUI_AVAILABLE:
        return {"success": False, "error": "pyautogui 未安装"}
    
    try:
        pyautogui.hotkey(*keys)
        return {"success": True, "message": f"已按下组合键: {'+'.join(keys)}"}
    except Exception as e:
        return {"success": False, "error": str(e)}

def mouse_click(x: int = None, y: int = None, button: str = 'left'):
    """模拟鼠标点击"""
    if not PYAUTOGUI_AVAILABLE:
        return {"success": False, "error": "pyautogui 未安装"}
    
    try:
        if x is not None and y is not None:
            pyautogui.click(x, y, button=button)
        else:
            pyautogui.click(button=button)
        return {"success": True, "message": f"已点击: ({x}, {y})" if x else "已点击当前位置"}
    except Exception as e:
        return {"success": False, "error": str(e)}

def type_text(text: str, interval: float = 0.05):
    """模拟打字"""
    if not PYAUTOGUI_AVAILABLE:
        return {"success": False, "error": "pyautogui 未安装"}
    
    try:
        pyautogui.typewrite(text, interval=interval)
        return {"success": True, "message": f"已输入文本: {text[:50]}..."}
    except Exception as e:
        return {"success": False, "error": str(e)}

def take_screenshot(output_path: str = None):
    """截取屏幕"""
    if not PYAUTOGUI_AVAILABLE:
        return {"success": False, "error": "pyautogui 未安装"}
    
    try:
        if not output_path:
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            output_path = f"screenshot_{timestamp}.png"
        
        screenshot = pyautogui.screenshot()
        screenshot.save(output_path)
        
        return {
            "success": True, 
            "output": output_path,
            "message": f"截图已保存: {output_path}"
        }
    except Exception as e:
        return {"success": False, "error": str(e)}

def open_folder(folder_path: str):
    """打开文件夹"""
    if not folder_path:
        return {"success": False, "error": "未指定文件夹路径"}
    
    try:
        folder_path = os.path.abspath(folder_path)
        
        if not os.path.exists(folder_path):
            return {"success": False, "error": f"文件夹不存在: {folder_path}"}
        
        if sys.platform == 'win32':
            os.startfile(folder_path)
        elif sys.platform == 'darwin':
            subprocess.Popen(['open', folder_path])
        else:
            subprocess.Popen(['xdg-open', folder_path])
        
        return {"success": True, "message": f"已打开文件夹: {folder_path}"}
    except Exception as e:
        return {"success": False, "error": str(e)}

def main():
    parser = argparse.ArgumentParser(description='桌面控制技能')
    parser.add_argument('--action', required=True, 
                       choices=['open', 'cmd', 'keypress', 'hotkey', 'click', 'type', 'screenshot', 'open_folder'],
                       help='操作类型')
    parser.add_argument('--app', help='应用程序路径')
    parser.add_argument('--cmd', help='要执行的命令')
    parser.add_argument('--key', help='要按下的键')
    parser.add_argument('--keys', help='组合键，用逗号分隔')
    parser.add_argument('--x', type=int, help='X坐标')
    parser.add_argument('--y', type=int, help='Y坐标')
    parser.add_argument('--button', default='left', choices=['left', 'right', 'middle'], help='鼠标按钮')
    parser.add_argument('--text', help='要输入的文本')
    parser.add_argument('--output', help='输出文件路径')
    parser.add_argument('--path', help='文件夹路径')
    parser.add_argument('--params', type=str, help='JSON格式的参数')
    
    args = parser.parse_args()
    
    result = {"success": False, "error": "未知操作"}
    
    try:
        if args.action == 'open':
            result = open_application(args.app)
        
        elif args.action == 'cmd':
            result = execute_command(args.cmd)
        
        elif args.action == 'keypress':
            result = key_press(args.key)
        
        elif args.action == 'hotkey':
            keys = args.keys.split(',') if args.keys else [args.key]
            result = key_hotkey(*keys)
        
        elif args.action == 'click':
            result = mouse_click(args.x, args.y, args.button)
        
        elif args.action == 'type':
            result = type_text(args.text)
        
        elif args.action == 'screenshot':
            result = take_screenshot(args.output)
        
        elif args.action == 'open_folder':
            result = open_folder(args.path or args.app)
    
    except Exception as e:
        result = {"success": False, "error": str(e)}
    
    print(f"##RESULT## {json.dumps(result, ensure_ascii=False)}")

if __name__ == '__main__':
    main()
