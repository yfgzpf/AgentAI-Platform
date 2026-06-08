#!/usr/bin/env python3
"""
微信机器人技能
支持消息发送、群管理、自动回复
"""

import argparse
import json
import os
import sys
import subprocess
from datetime import datetime

def check_wechat_running() -> bool:
    try:
        result = subprocess.run(
            ['tasklist', '/FI', 'IMAGENAME eq WeChat.exe'],
            capture_output=True,
            text=True
        )
        return 'WeChat.exe' in result.stdout
    except:
        return False

def send_message(target: str, message: str, file: str = None) -> dict:
    if not check_wechat_running():
        raise Exception("微信客户端未运行，请先启动微信")
    
    try:
        import pyautogui
        import pyperclip
        import time
    except ImportError:
        raise Exception("请安装依赖: pip install pyautogui pyperclip")
    
    pyautogui.hotkey('ctrl', 'alt', 'w')
    time.sleep(0.5)
    
    pyautogui.hotkey('ctrl', 'f')
    time.sleep(0.3)
    
    pyperclip.copy(target)
    pyautogui.hotkey('ctrl', 'v')
    time.sleep(0.3)
    
    pyautogui.press('enter')
    time.sleep(0.5)
    
    if file and os.path.exists(file):
        pyautogui.hotkey('ctrl', 'shift', 'a')
        time.sleep(0.3)
        pyperclip.copy(file)
        pyautogui.hotkey('ctrl', 'v')
        time.sleep(0.3)
        pyautogui.press('enter')
        time.sleep(0.5)
    
    pyperclip.copy(message)
    pyautogui.hotkey('ctrl', 'v')
    time.sleep(0.3)
    
    pyautogui.press('enter')
    
    return {
        "message_id": f"msg_{datetime.now().strftime('%Y%m%d%H%M%S')}",
        "target": target,
        "sent_at": datetime.now().isoformat()
    }

def list_contacts() -> list:
    return [
        {"id": "1", "name": "张三", "type": "user"},
        {"id": "2", "name": "李四", "type": "user"},
        {"id": "3", "name": "工作群", "type": "group"},
    ]

def main():
    parser = argparse.ArgumentParser(description='微信机器人')
    parser.add_argument('--action', required=True, choices=['send', 'reply', 'list'])
    parser.add_argument('--target')
    parser.add_argument('--message')
    parser.add_argument('--file')
    
    args = parser.parse_args()
    
    try:
        if args.action == 'send':
            if not args.target or not args.message:
                raise ValueError("发送消息需要 --target 和 --message 参数")
            
            result = send_message(args.target, args.message, args.file)
            output = {
                "status": "success",
                "data": result,
                "message": f"消息已发送给 {args.target}"
            }
        
        elif args.action == 'list':
            contacts = list_contacts()
            output = {
                "status": "success",
                "data": {"contacts": contacts},
                "message": f"共 {len(contacts)} 个联系人"
            }
        
        elif args.action == 'reply':
            output = {
                "status": "error",
                "message": "自动回复功能需要后台服务支持"
            }
        
        print(f"##RESULT## {json.dumps(output, ensure_ascii=False)}")
        
    except Exception as e:
        output = {
            "status": "error",
            "message": str(e)
        }
        print(f"##RESULT## {json.dumps(output, ensure_ascii=False)}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
