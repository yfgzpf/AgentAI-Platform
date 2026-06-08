import asyncio
import os
import time
import json
from typing import Dict, Any, List, Optional
from datetime import datetime
from loguru import logger
import aiohttp


class WeChatBotWCF:
    """基于 WeChatFerry (WCF) 的微信机器人实现"""
    
    def __init__(self, deepseek_service=None):
        self.wcf_url = "http://localhost:10086"
        self.is_logged_in = False
        self.is_running = False
        self.deepseek_service = deepseek_service
        self.auto_reply_enabled = True
        self.reply_whitelist: List[str] = []
        self.reply_blacklist: List[str] = []
        self.reply_keywords: Dict[str, str] = {}
        self.conversation_context: Dict[str, List[Dict[str, Any]]] = {}
        self.max_context_length = 10
        self.message_handlers = []
        self.session = None  # aiohttp会话
        
    async def initialize(self) -> Dict[str, Any]:
        """初始化微信机器人"""
        try:
            # 初始化 aiohttp 会话
            if not self.session:
                self.session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=10))
            
            # 检查 WCF 服务是否可用
            try:
                async with self.session.get(f"{self.wcf_url}/wx/version", timeout=3) as response:
                    if response.status == 200:
                        logger.info("WeChatFerry (WCF) 服务可用")
                    else:
                        logger.warning("WeChatFerry (WCF) 服务响应异常")
            except Exception as e:
                logger.warning(f"WeChatFerry (WCF) 服务不可用: {str(e)}")
                return {
                    "success": False,
                    "message": f"WeChatFerry (WCF) 服务不可用: {str(e)}"
                }
            
            logger.info("基于 WeChatFerry (WCF) 的微信机器人初始化成功")
            
            return {
                "success": True,
                "message": "基于 WeChatFerry (WCF) 的微信机器人初始化成功"
            }
        except Exception as e:
            logger.error(f"初始化失败: {str(e)}")
            return {
                "success": False,
                "message": f"初始化失败: {str(e)}"
            }
    
    async def open_wechat(self) -> Dict[str, Any]:
        """打开微信（WCF 方式）"""
        try:
            # 初始化会话（如果未初始化）
            if not self.session:
                self.session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=10))
            
            # 检查 WCF 服务
            try:
                async with self.session.get(f"{self.wcf_url}/wx/version", timeout=3) as response:
                    if response.status != 200:
                        return {
                            "success": False,
                            "message": "WeChatFerry (WCF) 服务未启动"
                        }
            except Exception as e:
                return {
                    "success": False,
                    "message": f"WeChatFerry (WCF) 服务连接失败: {str(e)}"
                }
            
            # 检查微信状态
            try:
                async with self.session.get(f"{self.wcf_url}/wx/status", timeout=3) as response:
                    status_data = await response.json()
                    if status_data.get("code") == 1:
                        self.is_logged_in = True
                        logger.info("微信已登录 (WCF)")
                        return {
                            "success": True,
                            "message": "微信已登录 (WCF)",
                            "status": "logged_in"
                        }
                    else:
                        logger.warning("微信未登录 (WCF)")
                        return {
                            "success": False,
                            "message": "微信未登录，请先启动微信并登录"
                        }
            except Exception as e:
                logger.error(f"检查微信状态失败: {str(e)}")
                return {
                    "success": False,
                    "message": f"检查微信状态失败: {str(e)}"
                }
                
        except Exception as e:
            logger.error(f"打开微信失败: {str(e)}")
            return {
                "success": False,
                "message": f"打开微信失败: {str(e)}"
            }
    
    async def check_login_status(self) -> Dict[str, Any]:
        """检查登录状态"""
        try:
            # 初始化会话（如果未初始化）
            if not self.session:
                self.session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=10))
            
            # 检查 WCF 服务
            try:
                async with self.session.get(f"{self.wcf_url}/wx/status", timeout=3) as response:
                    status_data = await response.json()
                    if status_data.get("code") == 1:
                        self.is_logged_in = True
                        return {
                            "success": True,
                            "message": "微信已登录 (WCF)",
                            "status": "logged_in"
                        }
                    else:
                        self.is_logged_in = False
                        return {
                            "success": False,
                            "message": "微信未登录 (WCF)",
                            "status": "not_logged_in"
                        }
            except Exception as e:
                logger.error(f"检查登录状态失败: {str(e)}")
                return {
                    "success": False,
                    "message": f"检查登录状态失败: {str(e)}"
                }
        except Exception as e:
            logger.error(f"检查登录状态失败: {str(e)}")
            return {
                "success": False,
                "message": f"检查登录状态失败: {str(e)}"
            }
    
    async def send_message(self, recipient: str, message: str) -> Dict[str, Any]:
        """发送消息 (WCF 方式)"""
        try:
            # 检查登录状态
            if not self.is_logged_in:
                status_result = await self.check_login_status()
                if not status_result.get("success"):
                    return status_result
            
            # 初始化会话（如果未初始化）
            if not self.session:
                self.session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=10))
            
            # 查找联系人
            try:
                # 获取好友列表
                async with self.session.get(f"{self.wcf_url}/wx/contact/list", timeout=5) as response:
                    contacts = await response.json()
                    contacts = contacts.get("data", [])
                
                # 查找目标联系人
                target_contact = None
                for contact in contacts:
                    if recipient in contact.get("name", "") or recipient in contact.get("remark", ""):
                        target_contact = contact
                        break
                
                if not target_contact:
                    return {
                        "success": False,
                        "message": "未找到联系人"
                    }
                
                # 发送消息
                send_data = {
                    "wxid": target_contact.get("wxid"),
                    "msg": message
                }
                async with self.session.post(f"{self.wcf_url}/wx/send/text", json=send_data, timeout=5) as response:
                    send_result = await response.json()
                
                if send_result.get("code") == 1:
                    logger.info(f"发送消息成功 (WCF): {recipient} -> {message}")
                    return {
                        "success": True,
                        "message": "消息发送成功 (WCF)"
                    }
                else:
                    logger.error(f"发送消息失败 (WCF): {send_result.get('msg')}")
                    return {
                        "success": False,
                        "message": f"发送消息失败 (WCF): {send_result.get('msg')}"
                    }
                    
            except Exception as e:
                logger.error(f"发送消息失败: {str(e)}")
                return {
                    "success": False,
                    "message": f"发送消息失败: {str(e)}"
                }
        except Exception as e:
            logger.error(f"发送消息失败: {str(e)}")
            return {
                "success": False,
                "message": f"发送消息失败: {str(e)}"
            }
    
    async def _handle_message(self, msg):
        """处理接收到的消息"""
        try:
            # 获取消息信息
            msg_type = msg.get('type')
            sender_wxid = msg.get('wxid')
            content = msg.get('content')
            
            # 初始化会话（如果未初始化）
            if not self.session:
                self.session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=10))
            
            # 查找发送者信息
            try:
                async with self.session.get(f"{self.wcf_url}/wx/contact/detail", params={"wxid": sender_wxid}, timeout=3) as response:
                    sender_info = await response.json()
                    sender_info = sender_info.get("data", {})
                    sender_name = sender_info.get("name", "") or sender_info.get("remark", "")
            except Exception:
                sender_name = "未知"
            
            # 检查是否为群消息
            if sender_wxid.endswith("@chatroom"):
                logger.info(f"收到群消息，跳过回复: {sender_name}")
                return
            
            # 检查黑名单
            if sender_name in self.reply_blacklist:
                logger.info(f"发送者在黑名单中，跳过回复: {sender_name}")
                return
            
            # 检查白名单
            if self.reply_whitelist and sender_name not in self.reply_whitelist:
                logger.info(f"发送者不在白名单中，跳过回复: {sender_name}")
                return
            
            # 处理不同类型的消息
            if msg_type == "txt":
                logger.info(f"收到文本消息 (WCF): {sender_name} -> {content}")
                
                # 智能判断是否需要回复
                if await self._should_reply_to_message(sender_name, content):
                    # 生成回复
                    reply_result = await self.auto_reply(sender_name, content)
                    if reply_result.get('success'):
                        reply_content = reply_result.get('reply')
                        # 发送回复
                        send_data = {
                            "wxid": sender_wxid,
                            "msg": reply_content
                        }
                        async with self.session.post(f"{self.wcf_url}/wx/send/text", json=send_data, timeout=5) as response:
                            send_result = await response.json()
                            if send_result.get("code") == 1:
                                logger.info(f"自动回复成功 (WCF): {sender_name} -> {reply_content}")
                            else:
                                logger.error(f"自动回复失败 (WCF)")
            else:
                logger.info(f"收到{msg_type}消息，跳过回复: {sender_name}")
                
        except Exception as e:
            logger.error(f"处理消息失败 (WCF): {str(e)}")
    
    async def _should_reply_to_message(self, contact_name: str, message_content: str) -> bool:
        """智能判断是否需要回复消息"""
        try:
            # 检查消息内容
            if not message_content or len(message_content.strip()) == 0:
                logger.info(f"消息内容为空，跳过回复: {contact_name}")
                return False
            
            # 检查消息类型（简单消息优先回复）
            if self._is_simple_message(message_content):
                logger.info(f"检测到简单消息，准备回复: {contact_name}")
                return True
            
            # 智能判断消息重要性
            important_keywords = ["紧急", "重要", "需要", "请", "帮", "能不能", "可不可以", "希望", "想要"]
            for keyword in important_keywords:
                if keyword in message_content:
                    logger.info(f"检测到重要消息，准备回复: {contact_name}")
                    return True
            
            # 默认策略：对于非简单消息，根据联系人重要性决定
            logger.info(f"普通消息，准备回复: {contact_name}")
            return True
            
        except Exception as e:
            logger.error(f"判断是否需要回复失败: {str(e)}")
            # 出错时默认返回True，确保消息不会被忽略
            return True
    
    def _is_simple_message(self, message: str) -> bool:
        """智能判断消息复杂度"""
        try:
            # 简单消息判断条件
            message = message.strip()
            
            # 1. 长度判断
            if len(message) > 50:
                return False
            
            # 2. 内容判断
            simple_patterns = [
                # 问候类
                "你好", "您好", "hi", "hello", "早上好", "中午好", "晚上好",
                # 询问类
                "在吗", "在不在", "有人吗", "忙吗", "在忙吗",
                # 感谢类
                "谢谢", "感谢", "谢了", "多谢", "谢谢啦",
                # 道别类
                "再见", "拜拜", "回见", "晚安", "拜拜啦",
                # 确认类
                "好的", "是的", "对的", "没错", "可以", "行", "没问题",
                # 疑问类
                "在吗", "在不在", "有人吗", "忙吗", "在忙吗",
                # 其他简单词
                "嗯", "哦", "好", "行", "可以", "没问题", "知道了", "明白", "收到",
            ]
            
            # 检查是否匹配简单模式
            for pattern in simple_patterns:
                if pattern in message:
                    return True
            
            # 3. 复杂度判断
            complex_patterns = [
                # 复杂问题
                "为什么", "怎么", "如何", "怎样", "怎么办", "怎么回事",
                "为什么", "原因", "理由", "解释", "说明",
                # 详细请求
                "请帮我", "能不能", "可不可以", "希望", "想要",
                # 装修相关复杂问题
                "装修报价", "装修预算", "装修设计", "装修风格", "装修材料",
                "户型设计", "效果图", "装修方案",
                # 其他复杂内容
                "详细", "具体", "方案", "计划", "安排",
            ]
            
            # 检查是否匹配复杂模式
            for pattern in complex_patterns:
                if pattern in message:
                    return False
            
            # 4. 默认判断
            # 如果包含多个句子或标点，可能是复杂消息
            if len(message.split('。')) > 2 or len(message.split('？')) > 1:
                return False
            
            # 默认认为是简单消息
            return True
            
        except Exception as e:
            logger.error(f"判断消息复杂度失败: {str(e)}")
            return True  # 出错时默认认为是简单消息
    
    async def auto_reply(self, recipient: str, message: str) -> Dict[str, Any]:
        """智能自动回复"""
        try:
            if not self.auto_reply_enabled:
                return {
                    "success": False,
                    "message": "自动回复已禁用"
                }
            
            # 检查黑名单
            if recipient in self.reply_blacklist:
                return {
                    "success": False,
                    "message": "联系人在黑名单中"
                }
            
            # 检查白名单（如果有白名单，则只回复白名单中的联系人）
            if self.reply_whitelist and recipient not in self.reply_whitelist:
                return {
                    "success": False,
                    "message": "联系人不在白名单中"
                }
            
            logger.info(f"智能处理消息 (WCF): {recipient} -> {message}")
            
            # 1. 检查关键词回复（最高优先级）
            reply_content = None
            for keyword, reply in self.reply_keywords.items():
                if keyword in message:
                    reply_content = reply
                    logger.info(f"匹配关键词回复: {keyword} -> {reply}")
                    break
            
            if reply_content:
                logger.info(f"关键词回复: {recipient} -> {reply_content}")
                return {
                    "success": True,
                    "message": "关键词回复成功",
                    "reply": reply_content
                }
            
            # 2. 智能判断消息复杂度
            is_simple_message = self._is_simple_message(message)
            
            if is_simple_message:
                # 简单消息使用预设回复
                logger.info(f"处理简单消息: {message}")
                simple_reply = await self._get_simple_reply(message, recipient)
                if simple_reply:
                    logger.info(f"简单消息回复: {recipient} -> {simple_reply}")
                    return {
                        "success": True,
                        "message": "简单消息回复成功",
                        "reply": simple_reply
                    }
            else:
                # 复杂消息使用AI智能回复
                logger.info(f"处理复杂消息: {message}")
                ai_reply = await self._get_ai_reply(message, recipient)
                if ai_reply:
                    logger.info(f"AI智能回复: {recipient} -> {ai_reply}")
                    return {
                        "success": True,
                        "message": "AI智能回复成功",
                        "reply": ai_reply
                    }
            
            # 3. 默认回复（兜底）
            default_reply = "您好，我现在不方便回复，请稍后联系我，谢谢！"
            logger.info(f"默认回复: {recipient} -> {default_reply}")
            return {
                "success": True,
                "message": "默认回复成功",
                "reply": default_reply
            }
                
        except Exception as e:
            logger.error(f"自动回复失败: {str(e)}")
            return {
                "success": False,
                "message": f"自动回复失败: {str(e)}"
            }
    
    async def _get_ai_reply(self, message: str, recipient: str) -> Optional[str]:
        """获取AI智能回复"""
        try:
            # 预设的智能回复库
            preset_replies = {
                # 问候类
                "你好": "您好！很高兴为您服务，请问有什么可以帮助您的吗？",
                "您好": "您好！很高兴为您服务，请问有什么可以帮助您的吗？",
                "hi": "您好！很高兴为您服务，请问有什么可以帮助您的吗？",
                "hello": "您好！很高兴为您服务，请问有什么可以帮助您的吗？",
                "早上好": "早上好！祝您今天工作顺利！",
                "中午好": "中午好！记得按时吃饭哦！",
                "晚上好": "晚上好！辛苦了一天，好好休息吧！",
                "晚安": "晚安！祝您做个好梦！",
                
                # 询问类
                "在吗": "在的，请问有什么可以帮助您的吗？",
                "在不在": "在的，请问有什么可以帮助您的吗？",
                "有人吗": "在的，请问有什么可以帮助您的吗？",
                "忙吗": "现在不忙，请问有什么可以帮助您的吗？",
                "在忙吗": "现在不忙，请问有什么可以帮助您的吗？",
                
                # 感谢类
                "谢谢": "不客气！很高兴能够帮助到您！",
                "感谢": "不客气！很高兴能够帮助到您！",
                "非常感谢": "不客气！很高兴能够帮助到您！",
                
                # 道别类
                "再见": "再见！祝您生活愉快！",
                "拜拜": "再见！祝您生活愉快！",
                "回见": "再见！祝您生活愉快！",
                
                # 时间类
                "几点": f"现在是{datetime.now().strftime('%H:%M')}，请问有什么可以帮助您的吗？",
                "时间": f"现在是{datetime.now().strftime('%H:%M')}，请问有什么可以帮助您的吗？",
                "今天": f"今天是{datetime.now().strftime('%Y年%m月%d日')}，{datetime.now().strftime('%A')}，请问有什么可以帮助您的吗？",
                
                # 功能询问类
                "能做什么": "我可以帮您进行装修报价、生成效果图、识别户型图、在线设计等功能。请问您需要什么服务？",
                "功能": "我可以帮您进行装修报价、生成效果图、识别户型图、在线设计等功能。请问您需要什么服务？",
                "帮助": "我可以帮您进行装修报价、生成效果图、识别户型图、在线设计等功能。请问您需要什么服务？",
                
                # 装修相关
                "报价": "您好！我可以为您提供装修报价服务。请告诉我您的房屋类型、面积和装修风格，我会为您生成详细的报价单。",
                "装修": "您好！我可以为您提供装修相关的服务，包括报价、效果图生成、户型识别等。请问您需要什么服务？",
                "效果图": "您好！我可以为您生成装修效果图。请告诉我您想要的风格和房间类型，我会为您生成合适的效果图。",
                "设计": "您好！我可以为您提供设计服务。请上传您的手绘草图或描述您的设计需求，我会帮您进行设计。",
                
                # 其他常见问题
                "你是谁": "我是智能装修助手，可以帮您进行装修相关的各种服务。请问有什么可以帮助您的吗？",
                "名字": "我是智能装修助手，可以帮您进行装修相关的各种服务。请问有什么可以帮助您的吗？",
                "介绍": "我是智能装修助手，可以帮您进行装修报价、生成效果图、识别户型图、在线设计等功能。请问您需要什么服务？",
            }
            
            # 检查预设回复
            for keyword, reply in preset_replies.items():
                if keyword in message:
                    return reply
            
            # 如果没有匹配的预设回复，使用智能分析
            return await self._analyze_and_reply(message, recipient)
            
        except Exception as e:
            logger.error(f"获取AI回复失败: {str(e)}")
            return None
    
    async def _get_simple_reply(self, message: str, recipient: str) -> Optional[str]:
        """获取简单消息的预设回复"""
        try:
            message = message.strip()
            
            # 智能预设回复库
            simple_replies = {
                # 问候类回复
                "你好": "您好！很高兴为您服务，请问有什么可以帮助您的吗？",
                "您好": "您好！很高兴为您服务，请问有什么可以帮助您的吗？",
                "hi": "您好！很高兴为您服务，请问有什么可以帮助您的吗？",
                "hello": "您好！很高兴为您服务，请问有什么可以帮助您的吗？",
                "早上好": "早上好！祝您今天工作顺利！",
                "中午好": "中午好！记得按时吃饭哦！",
                "晚上好": "晚上好！辛苦了一天，好好休息吧！",
                
                # 询问类回复
                "在吗": "在的，请问有什么可以帮助您的吗？",
                "在不在": "在的，请问有什么可以帮助您的吗？",
                "有人吗": "在的，请问有什么可以帮助您的吗？",
                "忙吗": "现在不忙，请问有什么可以帮助您的吗？",
                "在忙吗": "现在不忙，请问有什么可以帮助您的吗？",
                
                # 感谢类回复
                "谢谢": "不客气！很高兴能够帮助到您！",
                "感谢": "不客气！很高兴能够帮助到您！",
                "谢了": "不客气！很高兴能够帮助到您！",
                "多谢": "不客气！很高兴能够帮助到您！",
                "谢谢啦": "不客气！很高兴能够帮助到您！",
                
                # 道别类回复
                "再见": "再见！祝您生活愉快！",
                "拜拜": "再见！祝您生活愉快！",
                "回见": "再见！祝您生活愉快！",
                "晚安": "晚安！祝您做个好梦！",
                "拜拜啦": "再见！祝您生活愉快！",
                
                # 确认类回复
                "好的": "好的，请问还有什么可以帮助您的吗？",
                "是的": "好的，请问还有什么可以帮助您的吗？",
                "对的": "好的，请问还有什么可以帮助您的吗？",
                "没错": "好的，请问还有什么可以帮助您的吗？",
                "可以": "好的，请问还有什么可以帮助您的吗？",
                "行": "好的，请问还有什么可以帮助您的吗？",
                "没问题": "好的，请问还有什么可以帮助您的吗？",
                
                # 其他简单词回复
                "嗯": "好的，请问还有什么可以帮助您的吗？",
                "哦": "好的，请问还有什么可以帮助您的吗？",
                "好": "好的，请问还有什么可以帮助您的吗？",
                "行": "好的，请问还有什么可以帮助您的吗？",
                "知道了": "好的，请问还有什么可以帮助您的吗？",
                "明白": "好的，请问还有什么可以帮助您的吗？",
                "收到": "好的，请问还有什么可以帮助您的吗？",
            }
            
            # 检查是否匹配预设回复
            for keyword, reply in simple_replies.items():
                if keyword in message:
                    return reply
            
            # 智能分析简单消息
            # 检查是否包含疑问词
            question_words = ["吗", "呢", "吧", "啊", "？", "?"]
            is_question = any(word in message for word in question_words)
            
            # 检查是否包含感谢词
            thanks_words = ["谢谢", "感谢", "谢了", "多谢"]
            is_thanks = any(word in message for word in thanks_words)
            
            # 检查是否包含道别词
            goodbye_words = ["再见", "拜拜", "回见", "晚安"]
            is_goodbye = any(word in message for word in goodbye_words)
            
            # 根据分析结果生成回复
            if is_thanks:
                return "不客气！很高兴能够帮助到您！"
            elif is_goodbye:
                return "再见！祝您生活愉快！"
            elif is_question:
                return "您好！请问有什么可以帮助您的吗？"
            else:
                # 默认简单回复
                return "您好！我收到了您的消息。请问有什么可以帮助您的吗？"
                
        except Exception as e:
            logger.error(f"获取简单回复失败: {str(e)}")
            return None
    
    async def _analyze_and_reply(self, message: str, recipient: str) -> Optional[str]:
        """分析消息并生成智能回复"""
        try:
            # 简单的智能回复逻辑
            message_lower = message.lower()
            
            # 检查是否包含疑问词
            question_words = ["吗", "呢", "吧", "啊", "？", "?", "什么", "怎么", "如何", "为什么"]
            is_question = any(word in message for word in question_words)
            
            # 检查是否包含请求词
            request_words = ["请", "帮", "能", "可以", "需要", "想要", "希望"]
            is_request = any(word in message for word in request_words)
            
            # 检查是否包含感谢词
            thanks_words = ["谢谢", "感谢", "谢了", "多谢"]
            is_thanks = any(word in message for word in thanks_words)
            
            # 检查是否包含道别词
            goodbye_words = ["再见", "拜拜", "回见", "晚安"]
            is_goodbye = any(word in message for word in goodbye_words)
            
            # 检查是否包含装修相关词
            decoration_words = ["装修", "报价", "设计", "效果图", "户型", "材料", "预算", "风格"]
            is_decoration = any(word in message for word in decoration_words)
            
            # 根据分析结果生成回复
            if is_thanks:
                return "不客气！很高兴能够帮助到您！"
            elif is_goodbye:
                return "再见！祝您生活愉快！"
            elif is_decoration:
                return "您好！我可以为您提供装修相关的服务。请告诉我您的具体需求，比如房屋类型、面积、风格等，我会为您提供专业的建议和服务。"
            elif is_question:
                return "您好！我理解您的问题。请问您需要什么帮助？我可以为您提供装修报价、效果图生成、户型识别等服务。"
            elif is_request:
                return "您好！我很乐意帮助您。请告诉我您的具体需求，我会尽力为您提供满意的服务。"
            else:
                # 默认智能回复
                return "您好！我收到了您的消息。请问有什么可以帮助您的吗？我可以为您提供装修相关的各种服务。"
                
        except Exception as e:
            logger.error(f"分析消息失败: {str(e)}")
            return None
    
    async def start_listening(self) -> Dict[str, Any]:
        """开始监听消息 (WCF 方式)"""
        try:
            # 检查 WCF 服务
            try:
                response = requests.get(f"{self.wcf_url}/wx/version", timeout=3)
                if response.status_code != 200:
                    return {
                        "success": False,
                        "message": "WeChatFerry (WCF) 服务未启动"
                    }
            except Exception as e:
                return {
                    "success": False,
                    "message": f"WeChatFerry (WCF) 服务连接失败: {str(e)}"
                }
            
            # 检查登录状态
            status_result = await self.check_login_status()
            if not status_result.get("success"):
                return status_result
            
            # 启动消息监听
            self.is_running = True
            logger.info("开始监听微信消息 (基于 WCF)")
            
            # 启动后台监听任务
            asyncio.create_task(self._background_listen())
            
            return {
                "success": True,
                "message": "开始监听微信消息 (基于 WCF)"
            }
        except Exception as e:
            logger.error(f"开始监听失败: {str(e)}")
            return {
                "success": False,
                "message": f"开始监听失败: {str(e)}"
            }
    
    async def _background_listen(self):
        """后台监听消息"""
        try:
            last_msg_id = 0
            # 初始化会话（如果未初始化）
            if not self.session:
                self.session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=10))
            
            while self.is_running:
                try:
                    # 获取最新消息
                    async with self.session.get(f"{self.wcf_url}/wx/msg/list", params={"last_msg_id": last_msg_id}, timeout=3) as response:
                        msg_data = await response.json()
                        
                        if msg_data.get("code") == 1:
                            messages = msg_data.get("data", [])
                            for msg in messages:
                                if msg.get("id") > last_msg_id:
                                    last_msg_id = msg.get("id")
                                    # 处理消息
                                    await self._handle_message(msg)
                except Exception as e:
                    logger.debug(f"后台监听异常: {str(e)}")
                
                # 短暂休眠
                await asyncio.sleep(1)
        except Exception as e:
            logger.error(f"后台监听失败: {str(e)}")
    
    async def stop_listening(self) -> Dict[str, Any]:
        """停止监听消息"""
        try:
            self.is_running = False
            logger.info("停止监听微信消息 (基于 WCF)")
            
            # 关闭 aiohttp 会话
            if self.session:
                try:
                    await self.session.close()
                    self.session = None
                    logger.info("aiohttp 会话已关闭")
                except Exception as e:
                    logger.warning(f"关闭会话失败: {str(e)}")
            
            return {
                "success": True,
                "message": "停止监听微信消息 (基于 WCF)"
            }
        except Exception as e:
            logger.error(f"停止监听失败: {str(e)}")
            return {
                "success": False,
                "message": f"停止监听失败: {str(e)}"
            }
    
    async def get_friends(self) -> Dict[str, Any]:
        """获取好友列表 (WCF 方式)"""
        try:
            # 检查登录状态
            if not self.is_logged_in:
                status_result = await self.check_login_status()
                if not status_result.get("success"):
                    return status_result
            
            # 初始化会话（如果未初始化）
            if not self.session:
                self.session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=10))
            
            # 获取好友列表
            try:
                async with self.session.get(f"{self.wcf_url}/wx/contact/list", timeout=5) as response:
                    contacts = await response.json()
                    contacts = contacts.get("data", [])
                
                # 过滤出好友
                friends = []
                for contact in contacts:
                    if contact.get("type") == 1:  # 1 表示好友
                        friend_name = contact.get("name") or contact.get("remark")
                        if friend_name:
                            friends.append(friend_name)
                
                return {
                    "success": True,
                    "friends": friends
                }
            except Exception as e:
                logger.error(f"获取好友列表失败: {str(e)}")
                return {
                    "success": False,
                    "message": f"获取好友列表失败: {str(e)}"
                }
        except Exception as e:
            logger.error(f"获取好友列表失败: {str(e)}")
            return {
                "success": False,
                "message": f"获取好友列表失败: {str(e)}"
            }
    
    async def get_groups(self) -> Dict[str, Any]:
        """获取群聊列表 (WCF 方式)"""
        try:
            # 检查登录状态
            if not self.is_logged_in:
                status_result = await self.check_login_status()
                if not status_result.get("success"):
                    return status_result
            
            # 初始化会话（如果未初始化）
            if not self.session:
                self.session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=10))
            
            # 获取群聊列表
            try:
                async with self.session.get(f"{self.wcf_url}/wx/contact/list", timeout=5) as response:
                    contacts = await response.json()
                    contacts = contacts.get("data", [])
                
                # 过滤出群聊
                groups = []
                for contact in contacts:
                    if contact.get("type") == 2:  # 2 表示群聊
                        group_name = contact.get("name")
                        if group_name:
                            groups.append(group_name)
                
                return {
                    "success": True,
                    "groups": groups
                }
            except Exception as e:
                logger.error(f"获取群聊列表失败: {str(e)}")
                return {
                    "success": False,
                    "message": f"获取群聊列表失败: {str(e)}"
                }
        except Exception as e:
            logger.error(f"获取群聊列表失败: {str(e)}")
            return {
                "success": False,
                "message": f"获取群聊列表失败: {str(e)}"
            }
    
    async def add_keyword_reply(self, keyword: str, reply: str) -> Dict[str, Any]:
        """添加关键词回复"""
        try:
            self.reply_keywords[keyword] = reply
            logger.info(f"添加关键词回复: {keyword} -> {reply}")
            
            return {
                "success": True,
                "message": "关键词回复添加成功"
            }
        except Exception as e:
            logger.error(f"添加关键词回复失败: {str(e)}")
            return {
                "success": False,
                "message": f"添加关键词回复失败: {str(e)}"
            }
    
    async def remove_keyword_reply(self, keyword: str) -> Dict[str, Any]:
        """移除关键词回复"""
        try:
            if keyword in self.reply_keywords:
                del self.reply_keywords[keyword]
                logger.info(f"移除关键词回复: {keyword}")
                return {
                    "success": True,
                    "message": "关键词回复移除成功"
                }
            else:
                return {
                    "success": False,
                    "message": "关键词不存在"
                }
        except Exception as e:
            logger.error(f"移除关键词回复失败: {str(e)}")
            return {
                "success": False,
                "message": f"移除关键词回复失败: {str(e)}"
            }
    
    async def add_whitelist(self, contact: str) -> Dict[str, Any]:
        """添加白名单"""
        try:
            if contact not in self.reply_whitelist:
                self.reply_whitelist.append(contact)
                logger.info(f"添加白名单: {contact}")
                return {
                    "success": True,
                    "message": "白名单添加成功"
                }
            else:
                return {
                    "success": False,
                    "message": "联系人已在白名单中"
                }
        except Exception as e:
            logger.error(f"添加白名单失败: {str(e)}")
            return {
                "success": False,
                "message": f"添加白名单失败: {str(e)}"
            }
    
    async def remove_whitelist(self, contact: str) -> Dict[str, Any]:
        """移除白名单"""
        try:
            if contact in self.reply_whitelist:
                self.reply_whitelist.remove(contact)
                logger.info(f"移除白名单: {contact}")
                return {
                    "success": True,
                    "message": "白名单移除成功"
                }
            else:
                return {
                    "success": False,
                    "message": "联系人不在白名单中"
                }
        except Exception as e:
            logger.error(f"移除白名单失败: {str(e)}")
            return {
                "success": False,
                "message": f"移除白名单失败: {str(e)}"
            }
    
    async def add_blacklist(self, contact: str) -> Dict[str, Any]:
        """添加黑名单"""
        try:
            if contact not in self.reply_blacklist:
                self.reply_blacklist.append(contact)
                logger.info(f"添加黑名单: {contact}")
                return {
                    "success": True,
                    "message": "黑名单添加成功"
                }
            else:
                return {
                    "success": False,
                    "message": "联系人已在黑名单中"
                }
        except Exception as e:
            logger.error(f"添加黑名单失败: {str(e)}")
            return {
                "success": False,
                "message": f"添加黑名单失败: {str(e)}"
            }
    
    async def remove_blacklist(self, contact: str) -> Dict[str, Any]:
        """移除黑名单"""
        try:
            if contact in self.reply_blacklist:
                self.reply_blacklist.remove(contact)
                logger.info(f"移除黑名单: {contact}")
                return {
                    "success": True,
                    "message": "黑名单移除成功"
                }
            else:
                return {
                    "success": False,
                    "message": "联系人不在黑名单中"
                }
        except Exception as e:
            logger.error(f"移除黑名单失败: {str(e)}")
            return {
                "success": False,
                "message": f"移除黑名单失败: {str(e)}"
            }
