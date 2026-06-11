#!/usr/bin/env python3
"""
微信智能客服技能
自动监听微信新消息，调用 LLM 生成智能回复
"""

import argparse
import json
import os
import sys
import time
import threading
import subprocess
import re
from pathlib import Path
from datetime import datetime
from typing import Optional, Dict, Any, List, Tuple
from dataclasses import dataclass, field
from enum import Enum
import queue

try:
    import pyautogui
    import pyperclip
    pyautogui.FAILSAFE = True
    pyautogui.PAUSE = 0.3
except ImportError:
    print("请安装 pyautogui 和 pyperclip: pip install pyautogui pyperclip")
    sys.exit(1)

try:
    from PIL import Image, ImageGrab
except ImportError:
    print("请安装 pillow: pip install pillow")
    sys.exit(1)

try:
    import pytesseract
except ImportError:
    print("请安装 pytesseract: pip install pytesseract")
    pytesseract = None

try:
    import openai
except ImportError:
    print("请安装 openai: pip install openai")
    sys.exit(1)

if sys.platform == "win32":
    try:
        import win32gui
        import win32con
        import win32api
    except ImportError:
        print("请安装 pywin32: pip install pywin32")


class AssistantState(Enum):
    STOPPED = "stopped"
    RUNNING = "running"
    PAUSED = "paused"


@dataclass
class WeChatMessage:
    sender: str
    content: str
    is_group: bool = False
    is_mentioned: bool = False
    timestamp: datetime = field(default_factory=datetime.now)
    replied: bool = False


class WeChatController:
    """微信窗口控制器"""
    
    def __init__(self):
        self.window_handle = None
        self.window_rect = None
    
    def find_wechat_window(self) -> bool:
        """查找微信窗口"""
        if sys.platform != "win32":
            return False
        
        def callback(hwnd, windows):
            title = win32gui.GetWindowText(hwnd)
            if "微信" in title or "WeChat" in title:
                windows.append(hwnd)
        
        windows = []
        win32gui.EnumWindows(callback, windows)
        
        if windows:
            self.window_handle = windows[0]
            rect = win32gui.GetWindowRect(self.window_handle)
            self.window_rect = {
                "left": rect[0],
                "top": rect[1],
                "width": rect[2] - rect[0],
                "height": rect[3] - rect[1]
            }
            return True
        return False
    
    def activate_wechat(self) -> bool:
        """激活微信窗口"""
        if not self.window_handle:
            if not self.find_wechat_window():
                return False
        
        try:
            win32gui.SetForegroundWindow(self.window_handle)
            time.sleep(0.5)
            return True
        except Exception as e:
            print(f"激活微信窗口失败: {e}")
            return False
    
    def capture_chat_area(self) -> Optional[Image.Image]:
        """截取聊天区域"""
        if not self.activate_wechat():
            return None
        
        if not self.window_rect:
            return None
        
        chat_area = (
            self.window_rect["left"] + 300,
            self.window_rect["top"] + 100,
            self.window_rect["left"] + self.window_rect["width"] - 50,
            self.window_rect["top"] + self.window_rect["height"] - 150
        )
        
        screenshot = ImageGrab.grab(bbox=chat_area)
        return screenshot
    
    def click_contact(self, contact_name: str) -> bool:
        """点击联系人"""
        if not self.activate_wechat():
            return False
        
        pyautogui.hotkey('ctrl', 'f')
        time.sleep(0.5)
        
        pyperclip.copy(contact_name)
        pyautogui.hotkey('ctrl', 'v')
        time.sleep(0.3)
        
        pyautogui.press('enter')
        time.sleep(0.3)
        
        return True
    
    def send_message(self, message: str) -> bool:
        """发送消息"""
        if not self.activate_wechat():
            return False
        
        pyperclip.copy(message)
        pyautogui.hotkey('ctrl', 'v')
        time.sleep(0.3)
        
        pyautogui.press('enter')
        time.sleep(0.2)
        
        return True
    
    def get_unread_count(self) -> int:
        """获取未读消息数量"""
        if sys.platform != "win32":
            return 0
        
        def callback(hwnd, count):
            title = win32gui.GetWindowText(hwnd)
            if "微信" in title or "WeChat" in title:
                match = re.search(r'\((\d+)\)', title)
                if match:
                    count[0] = int(match.group(1))
        
        count = [0]
        win32gui.EnumWindows(callback, count)
        return count[0]


class MessageParser:
    """消息解析器"""
    
    def __init__(self):
        self.last_messages: List[str] = []
        self.max_history = 50
    
    def parse_screenshot(self, image: Image.Image) -> List[WeChatMessage]:
        """解析截图中的消息"""
        messages = []
        
        if pytesseract is None:
            return messages
        
        try:
            text = pytesseract.image_to_string(image, lang='chi_sim+eng')
            lines = [l.strip() for l in text.split('\n') if l.strip()]
            
            current_sender = None
            current_content = []
            
            for line in lines:
                if self._is_sender_line(line):
                    if current_sender and current_content:
                        content = '\n'.join(current_content)
                        msg = WeChatMessage(
                            sender=current_sender,
                            content=content,
                            is_group=':' in current_sender or '群' in current_sender,
                            is_mentioned='@' in content or '智Y' in content or '助手' in content
                        )
                        messages.append(msg)
                    
                    current_sender = line.rstrip(':：')
                    current_content = []
                else:
                    current_content.append(line)
            
            if current_sender and current_content:
                content = '\n'.join(current_content)
                msg = WeChatMessage(
                    sender=current_sender,
                    content=content,
                    is_group=':' in current_sender or '群' in current_sender,
                    is_mentioned='@' in content or '智Y' in content or '助手' in content
                )
                messages.append(msg)
        
        except Exception as e:
            print(f"解析消息失败: {e}")
        
        return messages
    
    def _is_sender_line(self, line: str) -> bool:
        """判断是否是发送者行"""
        if line.endswith(':') or line.endswith('：'):
            return True
        if re.match(r'^[\u4e00-\u9fa5a-zA-Z0-9_]+[:：]', line):
            return True
        return False
    
    def filter_new_messages(self, messages: List[WeChatMessage]) -> List[WeChatMessage]:
        """过滤出新消息"""
        new_messages = []
        
        for msg in messages:
            msg_key = f"{msg.sender}:{msg.content[:50]}"
            if msg_key not in self.last_messages:
                new_messages.append(msg)
                self.last_messages.append(msg_key)
        
        if len(self.last_messages) > self.max_history:
            self.last_messages = self.last_messages[-self.max_history:]
        
        return new_messages


class LLMResponder:
    """LLM 回复生成器"""
    
    def __init__(self, api_key: str = None, base_url: str = None):
        self.api_key = api_key or os.getenv("DEEPSEEK_API_KEY") or os.getenv("OPENAI_API_KEY")
        self.base_url = base_url or os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1")
        self.client = None
        
        if self.api_key:
            self.client = openai.OpenAI(
                api_key=self.api_key,
                base_url=self.base_url
            )
        
        self.conversation_history: Dict[str, List[Dict]] = {}
        self.max_history = 10
    
    def generate_reply(self, message: WeChatMessage, system_prompt: str = None) -> str:
        """生成回复"""
        if not self.client:
            return "抱歉，AI 服务未配置。"
        
        sender = message.sender
        if sender not in self.conversation_history:
            self.conversation_history[sender] = []
        
        self.conversation_history[sender].append({
            "role": "user",
            "content": message.content
        })
        
        if len(self.conversation_history[sender]) > self.max_history * 2:
            self.conversation_history[sender] = self.conversation_history[sender][-self.max_history * 2:]
        
        default_prompt = """你是智 Y.Ai 智能客服助手，专业、友好、高效。

你的职责：
1. 回答用户问题
2. 提供产品/服务信息
3. 处理常见问题
4. 引导用户获取帮助

回复要求：
- 简洁明了，不超过200字
- 语气友好专业
- 如无法回答，引导用户联系人工客服

当前时间：""" + datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        
        try:
            response = self.client.chat.completions.create(
                model="deepseek-chat",
                messages=[
                    {"role": "system", "content": system_prompt or default_prompt},
                    *self.conversation_history[sender]
                ],
                temperature=0.7,
                max_tokens=500
            )
            
            reply = response.choices[0].message.content
            
            self.conversation_history[sender].append({
                "role": "assistant",
                "content": reply
            })
            
            return reply
        
        except Exception as e:
            print(f"生成回复失败: {e}")
            return "抱歉，我暂时无法回复，请稍后再试。"


class WeChatSmartAssistant:
    """微信智能客服主类"""
    
    def __init__(self, config: Dict[str, Any] = None):
        self.config = config or {}
        self.controller = WeChatController()
        self.parser = MessageParser()
        self.responder = LLMResponder(
            api_key=self.config.get("api_key"),
            base_url=self.config.get("base_url")
        )
        
        self.state = AssistantState.STOPPED
        self.message_queue = queue.Queue()
        self.worker_thread = None
        self.auto_reply = self.config.get("auto_reply", True)
        self.interval = self.config.get("interval", 5)
        
        self.keywords = self.config.get("keywords", ["帮助", "客服", "问题", "咨询"])
        self.blacklist = self.config.get("blacklist", [])
        self.whitelist = self.config.get("whitelist", [])
    
    def start(self) -> Dict[str, Any]:
        """启动智能客服"""
        if self.state == AssistantState.RUNNING:
            return {"success": False, "message": "智能客服已在运行中"}
        
        if not self.controller.find_wechat_window():
            return {"success": False, "message": "未找到微信窗口，请先打开微信"}
        
        self.state = AssistantState.RUNNING
        self.worker_thread = threading.Thread(target=self._monitor_loop, daemon=True)
        self.worker_thread.start()
        
        print(f"[WeChatAssistant] 智能客服已启动，检查间隔: {self.interval}秒")
        
        return {
            "success": True,
            "message": "智能客服已启动",
            "state": self.state.value,
            "interval": self.interval
        }
    
    def stop(self) -> Dict[str, Any]:
        """停止智能客服"""
        if self.state == AssistantState.STOPPED:
            return {"success": False, "message": "智能客服未在运行"}
        
        self.state = AssistantState.STOPPED
        if self.worker_thread:
            self.worker_thread.join(timeout=2)
        
        print("[WeChatAssistant] 智能客服已停止")
        
        return {
            "success": True,
            "message": "智能客服已停止",
            "state": self.state.value
        }
    
    def get_status(self) -> Dict[str, Any]:
        """获取状态"""
        return {
            "state": self.state.value,
            "auto_reply": self.auto_reply,
            "interval": self.interval,
            "wechat_found": self.controller.find_wechat_window(),
            "unread_count": self.controller.get_unread_count(),
            "conversation_count": len(self.responder.conversation_history)
        }
    
    def _monitor_loop(self):
        """监控循环"""
        while self.state == AssistantState.RUNNING:
            try:
                self._check_and_reply()
            except Exception as e:
                print(f"[WeChatAssistant] 监控异常: {e}")
            
            time.sleep(self.interval)
    
    def _check_and_reply(self):
        """检查新消息并回复"""
        screenshot = self.controller.capture_chat_area()
        if not screenshot:
            return
        
        messages = self.parser.parse_screenshot(screenshot)
        new_messages = self.parser.filter_new_messages(messages)
        
        for msg in new_messages:
            print(f"[WeChatAssistant] 新消息: {msg.sender}: {msg.content[:50]}...")
            
            if self._should_reply(msg):
                reply = self.responder.generate_reply(msg)
                
                if self.auto_reply:
                    self.controller.send_message(reply)
                    msg.replied = True
                    print(f"[WeChatAssistant] 已回复: {reply[:50]}...")
    
    def _should_reply(self, message: WeChatMessage) -> bool:
        """判断是否应该回复"""
        if message.sender in self.blacklist:
            return False
        
        if self.whitelist and message.sender not in self.whitelist:
            if not message.is_mentioned:
                return False
        
        if message.is_mentioned:
            return True
        
        if any(kw in message.content for kw in self.keywords):
            return True
        
        return False
    
    def send_message(self, contact: str, message: str) -> Dict[str, Any]:
        """手动发送消息"""
        if not self.controller.find_wechat_window():
            return {"success": False, "message": "未找到微信窗口"}
        
        if self.controller.click_contact(contact):
            if self.controller.send_message(message):
                return {"success": True, "message": f"已发送消息给 {contact}"}
        
        return {"success": False, "message": "发送失败"}


def main():
    parser = argparse.ArgumentParser(description="微信智能客服技能")
    parser.add_argument("--action", required=True, choices=["start", "stop", "status", "reply"], help="操作类型")
    parser.add_argument("--contact", default=None, help="联系人名称")
    parser.add_argument("--message", default=None, help="消息内容")
    parser.add_argument("--interval", type=int, default=5, help="检查间隔（秒）")
    parser.add_argument("--auto-reply", type=lambda x: x.lower() == 'true', default=True, help="是否自动回复")
    parser.add_argument("--config", default=None, help="配置文件路径")
    
    args = parser.parse_args()
    
    config = {
        "interval": args.interval,
        "auto_reply": args.auto_reply
    }
    
    if args.config and os.path.exists(args.config):
        with open(args.config, 'r', encoding='utf-8') as f:
            config.update(json.load(f))
    
    assistant = WeChatSmartAssistant(config)
    
    if args.action == "start":
        result = assistant.start()
    elif args.action == "stop":
        result = assistant.stop()
    elif args.action == "status":
        result = assistant.get_status()
    elif args.action == "reply":
        if not args.contact or not args.message:
            result = {"success": False, "message": "回复需要 --contact 和 --message 参数"}
        else:
            result = assistant.send_message(args.contact, args.message)
    else:
        result = {"success": False, "message": f"未知操作: {args.action}"}
    
    print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
