"""
钉钉机器人服务
支持钉钉群机器人Webhook消息接收、处理和回复
"""

import asyncio
import hashlib
import hmac
import base64
import time
import json
import urllib.parse
from typing import Dict, Any, List, Optional
from datetime import datetime
from loguru import logger
import aiohttp


class DingTalkService:
    """钉钉机器人服务类"""
    
    def __init__(self):
        self.enabled = False
        self.webhook_url = ""
        self.secret = ""
        self.keyword = "智Y"
        self.access_token = ""
        self.is_monitoring = False
        self.message_queue: List[Dict[str, Any]] = []
        self.auto_reply_enabled = True
        self.auto_reply_rules: Dict[str, str] = {}
        self.conversation_context: Dict[str, List[Dict[str, Any]]] = {}
        self.max_context_length = 10
        self.message_handlers: List = []
        self.session = None
        self.llm_service = None
        self.agent_orchestrator = None
        
        logger.info("钉钉机器人服务初始化完成")
    
    def configure(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """
        配置钉钉机器人
        
        Args:
            config: 配置字典，包含 webhook, secret, keyword 等
        
        Returns:
            配置结果
        """
        try:
            self.enabled = config.get('enabled', False)
            self.webhook_url = config.get('webhook', '')
            self.secret = config.get('secret', '')
            self.keyword = config.get('keyword', '智Y')
            
            if self.webhook_url:
                parsed = urllib.parse.urlparse(self.webhook_url)
                query_params = urllib.parse.parse_qs(parsed.query)
                self.access_token = query_params.get('access_token', [''])[0]
            
            logger.info(f"钉钉机器人配置完成: enabled={self.enabled}, keyword={self.keyword}")
            
            return {
                "success": True,
                "message": "钉钉机器人配置成功",
                "config": {
                    "enabled": self.enabled,
                    "webhook_configured": bool(self.webhook_url),
                    "secret_configured": bool(self.secret),
                    "keyword": self.keyword
                }
            }
            
        except Exception as e:
            logger.error(f"配置钉钉机器人失败: {str(e)}")
            return {
                "success": False,
                "message": f"配置失败: {str(e)}"
            }
    
    def set_llm_service(self, llm_service):
        """设置LLM服务"""
        self.llm_service = llm_service
        logger.info("钉钉服务已关联LLM服务")
    
    def set_agent_orchestrator(self, agent_orchestrator):
        """设置智能体编排器"""
        self.agent_orchestrator = agent_orchestrator
        logger.info("钉钉服务已关联智能体编排器")
    
    def _generate_sign(self, timestamp: int) -> str:
        """
        生成钉钉签名
        
        Args:
            timestamp: 时间戳（毫秒）
        
        Returns:
            签名字符串
        """
        if not self.secret:
            return ""
        
        string_to_sign = f"{timestamp}\n{self.secret}"
        hmac_code = hmac.new(
            self.secret.encode('utf-8'),
            string_to_sign.encode('utf-8'),
            digestmod=hashlib.sha256
        ).digest()
        
        sign = urllib.parse.quote_plus(base64.b64encode(hmac_code))
        return sign
    
    def verify_signature(self, timestamp: str, sign: str) -> bool:
        """
        验证钉钉签名
        
        Args:
            timestamp: 时间戳字符串
            sign: 签名字符串
        
        Returns:
            验证结果
        """
        if not self.secret:
            return True
        
        try:
            current_time = int(time.time() * 1000)
            msg_time = int(timestamp)
            
            if abs(current_time - msg_time) > 3600000:
                logger.warning(f"钉钉消息时间戳过期: {timestamp}")
                return False
            
            expected_sign = self._generate_sign(msg_time)
            
            if sign == expected_sign:
                return True
            else:
                logger.warning(f"钉钉签名验证失败: expected={expected_sign}, got={sign}")
                return False
                
        except Exception as e:
            logger.error(f"验证签名异常: {str(e)}")
            return False
    
    async def handle_webhook(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """
        处理Webhook消息
        
        Args:
            data: 钉钉推送的消息数据
        
        Returns:
            处理结果
        """
        try:
            msg_type = data.get('msgtype', '')
            
            if msg_type == 'verification':
                challenge = data.get('challenge', '')
                logger.info(f"钉钉验证请求: {challenge}")
                return {
                    "success": True,
                    "challenge": challenge
                }
            
            timestamp = data.get('timestamp', '')
            sign = data.get('sign', '')
            
            if not self.verify_signature(timestamp, sign):
                return {
                    "success": False,
                    "message": "签名验证失败"
                }
            
            message_data = self._parse_message(data)
            
            if not message_data:
                return {
                    "success": False,
                    "message": "无法解析消息"
                }
            
            self.message_queue.append(message_data)
            logger.info(f"收到钉钉消息: {message_data}")
            
            if self.auto_reply_enabled:
                asyncio.create_task(self._process_auto_reply(message_data))
            
            return {
                "success": True,
                "message": "消息已接收"
            }
            
        except Exception as e:
            logger.error(f"处理Webhook消息失败: {str(e)}")
            return {
                "success": False,
                "message": f"处理失败: {str(e)}"
            }
    
    def _parse_message(self, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """
        解析钉钉消息
        
        Args:
            data: 原始消息数据
        
        Returns:
            解析后的消息字典
        """
        try:
            msg_type = data.get('msgtype', 'text')
            
            message_data = {
                "msgtype": msg_type,
                "sender_id": data.get('senderId', ''),
                "sender_nick": data.get('senderNick', ''),
                "sender_corp_id": data.get('corpId', ''),
                "conversation_id": data.get('conversationId', ''),
                "conversation_type": data.get('conversationType', '1'),
                "create_time": data.get('createAt', int(time.time() * 1000)),
                "raw_data": data
            }
            
            if msg_type == 'text':
                content = data.get('text', {}).get('content', '')
                message_data['content'] = content.strip()
                
                if self.keyword and self.keyword not in content:
                    logger.debug(f"消息不包含关键词 '{self.keyword}'，跳过处理")
                    return None
                    
            elif msg_type == 'picture':
                message_data['content'] = '[图片]'
                message_data['pic_url'] = data.get('content', {}).get('picURL', '')
                
            elif msg_type == 'richText':
                rich_text_content = data.get('content', {}).get('richText', [])
                text_parts = []
                for item in rich_text_content:
                    if isinstance(item, dict) and 'text' in item:
                        text_parts.append(item['text'])
                message_data['content'] = ' '.join(text_parts)
                
            else:
                message_data['content'] = f'[{msg_type}类型消息]'
            
            return message_data
            
        except Exception as e:
            logger.error(f"解析消息失败: {str(e)}")
            return None
    
    async def _process_auto_reply(self, message: Dict[str, Any]) -> Dict[str, Any]:
        """
        处理自动回复
        
        Args:
            message: 收到的消息
        
        Returns:
            回复结果
        """
        try:
            content = message.get("content", "")
            conversation_id = message.get("conversation_id", "")
            sender_nick = message.get("sender_nick", "")
            
            reply_content = None
            
            for pattern, reply in self.auto_reply_rules.items():
                if pattern in content:
                    reply_content = reply
                    break
            
            if not reply_content and self.agent_orchestrator:
                reply_content = await self._generate_ai_reply(content, message)
            
            if not reply_content and self.llm_service:
                reply_content = await self._generate_llm_reply(content)
            
            if reply_content:
                result = await self.send_message(conversation_id, reply_content)
                
                return {
                    "success": True,
                    "message": "自动回复已发送",
                    "reply": reply_content,
                    "original_message": content
                }
            else:
                return {
                    "success": False,
                    "message": "未生成回复"
                }
            
        except Exception as e:
            logger.error(f"处理自动回复失败: {str(e)}")
            return {
                "success": False,
                "message": f"处理失败: {str(e)}"
            }
    
    async def _generate_ai_reply(self, message: str, context: Dict[str, Any]) -> Optional[str]:
        """
        使用智能体生成回复
        
        Args:
            message: 收到的消息
            context: 消息上下文
        
        Returns:
            AI生成的回复
        """
        try:
            if not self.agent_orchestrator:
                return None
            
            conversation_id = context.get("conversation_id", "")
            sender_nick = context.get("sender_nick", "用户")
            
            if conversation_id not in self.conversation_context:
                self.conversation_context[conversation_id] = []
            
            self.conversation_context[conversation_id].append({
                "role": "user",
                "content": message,
                "timestamp": datetime.now().isoformat()
            })
            
            if len(self.conversation_context[conversation_id]) > self.max_context_length:
                self.conversation_context[conversation_id] = \
                    self.conversation_context[conversation_id][-self.max_context_length:]
            
            response = await self.agent_orchestrator.process_message(
                message,
                conversation_id,
                self.conversation_context[conversation_id],
                "deepseek-chat"
            )
            
            reply = response if isinstance(response, str) else response.get("message", "")
            
            self.conversation_context[conversation_id].append({
                "role": "assistant",
                "content": reply,
                "timestamp": datetime.now().isoformat()
            })
            
            return reply
            
        except Exception as e:
            logger.error(f"智能体生成回复失败: {str(e)}")
            return None
    
    async def _generate_llm_reply(self, message: str) -> Optional[str]:
        """
        使用LLM服务生成回复
        
        Args:
            message: 收到的消息
        
        Returns:
            LLM生成的回复
        """
        try:
            if not self.llm_service:
                return None
            
            prompt = f"请根据以下钉钉消息生成一个友好、专业的回复：{message}"
            
            response = await self.llm_service.chat(prompt)
            
            return response
            
        except Exception as e:
            logger.error(f"LLM生成回复失败: {str(e)}")
            return None
    
    async def send_message(self, conversation_id: str, content: str, 
                          msg_type: str = "text") -> Dict[str, Any]:
        """
        发送钉钉消息
        
        Args:
            conversation_id: 会话ID（可选，用于群聊回复）
            content: 消息内容
            msg_type: 消息类型（text, markdown, link等）
        
        Returns:
            发送结果
        """
        try:
            if not self.webhook_url:
                return {
                    "success": False,
                    "message": "Webhook URL未配置"
                }
            
            timestamp = int(time.time() * 1000)
            sign = self._generate_sign(timestamp)
            
            url = self.webhook_url
            if sign:
                url = f"{self.webhook_url}&timestamp={timestamp}&sign={sign}"
            
            if msg_type == "text":
                payload = {
                    "msgtype": "text",
                    "text": {
                        "content": content
                    }
                }
            elif msg_type == "markdown":
                payload = {
                    "msgtype": "markdown",
                    "markdown": {
                        "title": "智Y.Ai回复",
                        "text": content
                    }
                }
            elif msg_type == "link":
                payload = {
                    "msgtype": "link",
                    "link": content
                }
            else:
                payload = {
                    "msgtype": "text",
                    "text": {
                        "content": content
                    }
                }
            
            if not self.session:
                self.session = aiohttp.ClientSession()
            
            async with self.session.post(
                url,
                json=payload,
                headers={"Content-Type": "application/json"}
            ) as response:
                result = await response.json()
                
                if result.get("errcode") == 0:
                    logger.info(f"钉钉消息发送成功: {content[:50]}...")
                    return {
                        "success": True,
                        "message": "消息发送成功",
                        "data": result
                    }
                else:
                    logger.error(f"钉钉消息发送失败: {result}")
                    return {
                        "success": False,
                        "message": f"发送失败: {result.get('errmsg', '未知错误')}",
                        "data": result
                    }
                    
        except Exception as e:
            logger.error(f"发送钉钉消息失败: {str(e)}")
            return {
                "success": False,
                "message": f"发送失败: {str(e)}"
            }
    
    async def send_markdown(self, title: str, text: str) -> Dict[str, Any]:
        """
        发送Markdown格式消息
        
        Args:
            title: 消息标题
            text: Markdown文本内容
        
        Returns:
            发送结果
        """
        return await self.send_message("", f"### {title}\n\n{text}", "markdown")
    
    async def send_link(self, title: str, text: str, pic_url: str, 
                       message_url: str) -> Dict[str, Any]:
        """
        发送链接消息
        
        Args:
            title: 链接标题
            text: 链接描述
            pic_url: 图片URL
            message_url: 跳转URL
        
        Returns:
            发送结果
        """
        link_content = {
            "title": title,
            "text": text,
            "picUrl": pic_url,
            "messageUrl": message_url
        }
        return await self.send_message("", link_content, "link")
    
    def add_auto_reply_rule(self, pattern: str, reply: str) -> Dict[str, Any]:
        """
        添加自动回复规则
        
        Args:
            pattern: 匹配模式
            reply: 回复内容
        
        Returns:
            操作结果
        """
        try:
            self.auto_reply_rules[pattern] = reply
            
            logger.info(f"添加钉钉自动回复规则: {pattern} -> {reply}")
            
            return {
                "success": True,
                "message": "自动回复规则已添加",
                "pattern": pattern,
                "reply": reply
            }
            
        except Exception as e:
            logger.error(f"添加自动回复规则失败: {str(e)}")
            return {
                "success": False,
                "message": f"添加失败: {str(e)}"
            }
    
    def remove_auto_reply_rule(self, pattern: str) -> Dict[str, Any]:
        """
        删除自动回复规则
        
        Args:
            pattern: 匹配模式
        
        Returns:
            操作结果
        """
        try:
            if pattern in self.auto_reply_rules:
                del self.auto_reply_rules[pattern]
                
                logger.info(f"删除钉钉自动回复规则: {pattern}")
                
                return {
                    "success": True,
                    "message": "自动回复规则已删除",
                    "pattern": pattern
                }
            else:
                return {
                    "success": False,
                    "message": "规则不存在"
                }
            
        except Exception as e:
            logger.error(f"删除自动回复规则失败: {str(e)}")
            return {
                "success": False,
                "message": f"删除失败: {str(e)}"
            }
    
    def get_auto_reply_rules(self) -> Dict[str, Any]:
        """
        获取自动回复规则
        
        Returns:
            规则列表
        """
        try:
            return {
                "success": True,
                "rules": self.auto_reply_rules,
                "count": len(self.auto_reply_rules)
            }
            
        except Exception as e:
            logger.error(f"获取自动回复规则失败: {str(e)}")
            return {
                "success": False,
                "message": f"获取失败: {str(e)}"
            }
    
    def enable_auto_reply(self) -> Dict[str, Any]:
        """
        启用自动回复
        
        Returns:
            操作结果
        """
        try:
            self.auto_reply_enabled = True
            
            logger.info("钉钉自动回复已启用")
            
            return {
                "success": True,
                "message": "自动回复已启用"
            }
            
        except Exception as e:
            logger.error(f"启用自动回复失败: {str(e)}")
            return {
                "success": False,
                "message": f"启用失败: {str(e)}"
            }
    
    def disable_auto_reply(self) -> Dict[str, Any]:
        """
        禁用自动回复
        
        Returns:
            操作结果
        """
        try:
            self.auto_reply_enabled = False
            
            logger.info("钉钉自动回复已禁用")
            
            return {
                "success": True,
                "message": "自动回复已禁用"
            }
            
        except Exception as e:
            logger.error(f"禁用自动回复失败: {str(e)}")
            return {
                "success": False,
                "message": f"禁用失败: {str(e)}"
            }
    
    def get_messages(self, limit: int = 10) -> Dict[str, Any]:
        """
        获取消息列表
        
        Args:
            limit: 返回消息数量限制
        
        Returns:
            消息列表
        """
        try:
            messages = self.message_queue[-limit:] if len(self.message_queue) > limit else self.message_queue
            
            return {
                "success": True,
                "messages": messages,
                "total": len(self.message_queue)
            }
            
        except Exception as e:
            logger.error(f"获取消息失败: {str(e)}")
            return {
                "success": False,
                "message": f"获取失败: {str(e)}"
            }
    
    def clear_messages(self) -> Dict[str, Any]:
        """
        清空消息队列
        
        Returns:
            操作结果
        """
        try:
            count = len(self.message_queue)
            self.message_queue.clear()
            
            logger.info(f"清空钉钉消息队列: {count}条消息")
            
            return {
                "success": True,
                "message": f"已清空 {count} 条消息"
            }
            
        except Exception as e:
            logger.error(f"清空消息队列失败: {str(e)}")
            return {
                "success": False,
                "message": f"清空失败: {str(e)}"
            }
    
    def get_status(self) -> Dict[str, Any]:
        """
        获取服务状态
        
        Returns:
            服务状态
        """
        try:
            return {
                "success": True,
                "status": {
                    "enabled": self.enabled,
                    "webhook_configured": bool(self.webhook_url),
                    "secret_configured": bool(self.secret),
                    "keyword": self.keyword,
                    "auto_reply_enabled": self.auto_reply_enabled,
                    "message_queue_size": len(self.message_queue),
                    "auto_reply_rules_count": len(self.auto_reply_rules),
                    "active_conversations": len(self.conversation_context),
                    "llm_service_connected": self.llm_service is not None,
                    "agent_orchestrator_connected": self.agent_orchestrator is not None
                }
            }
            
        except Exception as e:
            logger.error(f"获取服务状态失败: {str(e)}")
            return {
                "success": False,
                "message": f"获取失败: {str(e)}"
            }
    
    async def close(self):
        """关闭服务，清理资源"""
        try:
            if self.session:
                await self.session.close()
                self.session = None
            
            logger.info("钉钉服务已关闭")
            
        except Exception as e:
            logger.error(f"关闭钉钉服务失败: {str(e)}")


dingtalk_service = DingTalkService()
