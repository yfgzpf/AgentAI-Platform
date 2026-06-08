#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
智 Y.Ai Python 服务桥接层
连接 Node.js 后端与 Python 服务
"""

import os
import sys
import json
import argparse
import asyncio
import subprocess
from pathlib import Path
from typing import Dict, Any, Optional

# 设置输出编码为 UTF-8
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

# 添加服务目录到路径
SERVICES_DIR = Path(__file__).parent
SRC_DIR = SERVICES_DIR.parent  # src 目录
BACKEND_DIR = SRC_DIR.parent   # packages/zhiy-backend 目录

# 添加所有需要的目录到路径
for dir_path in [SERVICES_DIR, SRC_DIR, BACKEND_DIR]:
    if str(dir_path) not in sys.path:
        sys.path.insert(0, str(dir_path))

# 导入所有服务
try:
    from tool_manager import ToolManager
    from tool_executor import ToolExecutor
    from skill_manager import skill_manager
    from browser_automation_service import BrowserAutomationService
    from desktop_automation_service import DesktopAutomationService
    from enhanced_ai_writer_service import EnhancedAIWriterService
    from wechat_bot_service import WeChatBotService
    from video_generation_service import VideoGenerationService
    from image_generation_service import ImageGenerationService
    from deepseek_service import DeepSeekClient
    from workflow_planner import WorkflowPlanner
    from agent_framework import AgentFrameworkService
    from intent_to_action_mapper import SuperAgentOrchestrator
    from context_memory import ContextMemory
    from user_memory import UserMemory
    from social_media_promotion import SocialMediaPromotionService
    from code_executor_service import CodeExecutorService
    
    SERVICES_LOADED = True
    print("[OK] All services loaded successfully")
except ImportError as e:
    SERVICES_LOADED = False
    print(f"[WARN] Some services failed to load: {e}")

class ZhiYServiceBridge:
    """智 Y 服务桥接器"""
    
    def __init__(self):
        self.tool_manager = ToolManager() if SERVICES_LOADED else None
        self.tool_executor = ToolExecutor() if SERVICES_LOADED else None
        self.browser_service = BrowserAutomationService() if SERVICES_LOADED else None
        self.desktop_service = DesktopAutomationService() if SERVICES_LOADED else None
        self.writer_service = EnhancedAIWriterService() if SERVICES_LOADED else None
        self.wechat_service = WeChatBotService() if SERVICES_LOADED else None
        self.video_service = VideoGenerationService() if SERVICES_LOADED else None
        self.image_service = ImageGenerationService() if SERVICES_LOADED else None
        self.workflow_planner = WorkflowPlanner() if SERVICES_LOADED else None
        self.agent_framework = AgentFrameworkService() if SERVICES_LOADED else None
        self.super_agent = SuperAgentOrchestrator() if SERVICES_LOADED else None
        self.social_service = SocialMediaPromotionService() if SERVICES_LOADED else None
        self.code_executor = CodeExecutorService() if SERVICES_LOADED else None
        
    def list_tools(self) -> Dict[str, Any]:
        """列出所有可用工具"""
        if not self.tool_manager:
            return {"tools": []}
        
        tools = []
        for category, tool_list in self.tool_manager.tools.items():
            for tool_id, tool_info in tool_list.items():
                tools.append({
                    "id": tool_id,
                    "category": category,
                    "name": tool_info.get("name", tool_id),
                    "capabilities": tool_info.get("capabilities", [])
                })
        
        return {"tools": tools}
    
    def list_skills(self) -> Dict[str, Any]:
        """列出所有可用技能"""
        skills = skill_manager.list_skills()
        return {"skills": skills}
    
    def execute_tool(self, tool_id: str, params: Dict[str, Any]) -> Dict[str, Any]:
        """执行工具"""
        if not self.tool_executor:
            return {"success": False, "error": "工具执行器未加载"}
        
        try:
            method_name = f"_execute_{tool_id}"
            if hasattr(self.tool_executor, method_name):
                method = getattr(self.tool_executor, method_name)
                result = method(**params)
                return {"success": True, "result": result}
            else:
                return {"success": False, "error": f"未知工具: {tool_id}"}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def execute_skill(self, skill_name: str, params: Dict[str, Any]) -> Dict[str, Any]:
        """执行技能"""
        try:
            result = skill_manager.execute_skill(skill_name, **params)
            return result
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    async def open_browser(self, url: str, search_query: str = None) -> Dict[str, Any]:
        """打开浏览器"""
        if not self.browser_service:
            return {"success": False, "error": "浏览器服务未加载"}
        
        try:
            result = await self.browser_service.open_and_search(url, search_query)
            return {"success": True, "result": result}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def desktop_automation(self, action: str, params: Dict[str, Any]) -> Dict[str, Any]:
        """桌面自动化"""
        if not self.desktop_service:
            return {"success": False, "error": "桌面自动化服务未加载"}
        
        try:
            if action == "open_app":
                self.desktop_service.open_application(params.get("app_name"))
            elif action == "click":
                self.desktop_service.click(params.get("x"), params.get("y"))
            elif action == "type":
                self.desktop_service.type_text(params.get("text"))
            elif action == "screenshot":
                path = self.desktop_service.take_screenshot()
                return {"success": True, "screenshot_path": path}
            
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    async def generate_document(self, doc_type: str, content: str, title: str = None) -> Dict[str, Any]:
        """生成文档"""
        if not self.writer_service:
            return {"success": False, "error": "写作服务未加载"}
        
        try:
            result = await self.writer_service.write_content(
                app_type=doc_type,
                content=content,
                position="end"
            )
            return {"success": True, "result": result}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    async def send_wechat_message(self, contact: str, message: str) -> Dict[str, Any]:
        """发送微信消息"""
        if not self.wechat_service:
            return {"success": False, "error": "微信服务未加载"}
        
        try:
            result = await self.wechat_service.send_message(contact, message)
            return {"success": True, "result": result}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    async def generate_video(self, prompt: str, duration: int = 10) -> Dict[str, Any]:
        """生成视频"""
        if not self.video_service:
            return {"success": False, "error": "视频服务未加载"}
        
        try:
            result = await self.video_service.generate(prompt, duration)
            return {"success": True, "result": result}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    async def generate_image(self, prompt: str, style: str = None) -> Dict[str, Any]:
        """生成图片"""
        if not self.image_service:
            return {"success": False, "error": "图像服务未加载"}
        
        try:
            result = await self.image_service.generate(prompt, style)
            return {"success": True, "result": result}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def analyze_intent(self, user_input: str) -> Dict[str, Any]:
        """分析用户意图"""
        if not self.workflow_planner:
            return {"intent": "chat", "confidence": 0.5}
        
        try:
            result = self.workflow_planner.analyze_task(user_input)
            return result
        except Exception as e:
            return {"intent": "chat", "error": str(e)}
    
    async def process_user_request(self, user_input: str) -> Dict[str, Any]:
        """处理用户请求（超级智能体）"""
        if not self.super_agent:
            return {"success": False, "error": "超级智能体未加载"}
        
        try:
            result = await self.super_agent.process_user_request(user_input)
            return result
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def social_promotion(self, platform: str, content: str) -> Dict[str, Any]:
        """社交推广"""
        if not self.social_service:
            return {"success": False, "error": "社交推广服务未加载"}
        
        try:
            result = self.social_service.publish(platform, content)
            return {"success": True, "result": result}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    async def execute_code(self, code: str, language: str = "python") -> Dict[str, Any]:
        """执行代码"""
        if not self.code_executor:
            return {"success": False, "error": "代码执行器未加载"}
        
        try:
            result = await self.code_executor.execute(code, language)
            return {"success": True, "result": result}
        except Exception as e:
            return {"success": False, "error": str(e)}


def main():
    parser = argparse.ArgumentParser(description='智 Y.Ai Python 服务桥接层')
    parser.add_argument('--action', required=True, choices=[
        'list_tools', 'list_skills', 'execute_tool', 'execute_skill',
        'open_browser', 'desktop_automation', 'generate_document',
        'send_wechat', 'generate_video', 'generate_image',
        'analyze_intent', 'process_request', 'social_promotion', 'execute_code'
    ])
    parser.add_argument('--params', type=str, help='JSON 格式的参数')
    parser.add_argument('--params-base64', type=str, help='Base64 编码的 JSON 参数')
    
    args = parser.parse_args()
    bridge = ZhiYServiceBridge()
    
    if args.params_base64:
        import base64
        params = json.loads(base64.b64decode(args.params_base64).decode('utf-8'))
    elif args.params:
        params = json.loads(args.params)
    else:
        params = {}
    
    if args.action == 'list_tools':
        result = bridge.list_tools()
    elif args.action == 'list_skills':
        result = bridge.list_skills()
    elif args.action == 'execute_tool':
        result = bridge.execute_tool(params.get('tool_id'), params.get('params', {}))
    elif args.action == 'execute_skill':
        result = bridge.execute_skill(params.get('skill_name'), params.get('params', {}))
    elif args.action == 'open_browser':
        result = asyncio.run(bridge.open_browser(
            params.get('url'), params.get('search_query')
        ))
    elif args.action == 'desktop_automation':
        result = bridge.desktop_automation(
            params.get('action'), params.get('params', {})
        )
    elif args.action == 'generate_document':
        result = asyncio.run(bridge.generate_document(
            params.get('doc_type'), params.get('content'), params.get('title')
        ))
    elif args.action == 'send_wechat':
        result = asyncio.run(bridge.send_wechat_message(
            params.get('contact'), params.get('message')
        ))
    elif args.action == 'generate_video':
        result = asyncio.run(bridge.generate_video(
            params.get('prompt'), params.get('duration', 10)
        ))
    elif args.action == 'generate_image':
        result = asyncio.run(bridge.generate_image(
            params.get('prompt'), params.get('style')
        ))
    elif args.action == 'analyze_intent':
        result = bridge.analyze_intent(params.get('user_input', ''))
    elif args.action == 'process_request':
        result = asyncio.run(bridge.process_user_request(params.get('user_input', '')))
    elif args.action == 'social_promotion':
        result = bridge.social_promotion(
            params.get('platform'), params.get('content')
        )
    elif args.action == 'execute_code':
        result = asyncio.run(bridge.execute_code(
            params.get('code'), params.get('language', 'python')
        ))
    else:
        result = {"success": False, "error": "未知操作"}
    
    print("##RESULT## " + json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
