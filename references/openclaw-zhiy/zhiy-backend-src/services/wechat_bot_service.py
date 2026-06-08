"""
微信自动化服务
支持微信登录、消息检测、智能回复等功能
"""

import asyncio
import json
import time
from typing import Dict, Any, List, Optional
from loguru import logger


class WeChatBotService:
    """微信机器人服务类"""
    
    def __init__(self):
        self.is_logged_in = False
        self.is_monitoring = False
        self.current_user = None
        self.message_queue = []
        self.reply_queue = []
        self.auto_reply_enabled = False
        self.auto_reply_rules = {}
        self.current_bot = None
        self.bot_implementations = {}
        
        self._initialize_bot_implementations()
        logger.info("微信机器人服务初始化完成")
    
    def _initialize_bot_implementations(self):
        """初始化所有可用的微信机器人实现"""
        try:
            # 尝试初始化 Gewechat 实现
            try:
                from services.wechat_bot_gewechat import WeChatBotGewechat
                gewechat_bot = WeChatBotGewechat()
                self.bot_implementations['gewechat'] = gewechat_bot
                logger.info("Gewechat 机器人实现已加载")
            except Exception as e:
                logger.debug(f"Gewechat 实现加载失败: {str(e)}")
            
            # 尝试初始化 WCF 实现
            try:
                from services.wechat_bot_wcf import WeChatBotWCF
                wcf_bot = WeChatBotWCF()
                self.bot_implementations['wcf'] = wcf_bot
                logger.info("WCF 机器人实现已加载")
            except Exception as e:
                logger.debug(f"WCF 实现加载失败: {str(e)}")
            
            # 尝试初始化 itchat 实现
            try:
                from services.wechat_bot_itchat import WeChatBotItchat
                itchat_bot = WeChatBotItchat()
                self.bot_implementations['itchat'] = itchat_bot
                logger.info("Itchat 机器人实现已加载")
            except Exception as e:
                logger.debug(f"Itchat 实现加载失败: {str(e)}")
            
            # 选择可用的机器人实现
            self._select_available_bot()
        except Exception as e:
            logger.error(f"初始化机器人实现失败: {str(e)}")
    
    def _select_available_bot(self):
        """选择可用的微信机器人实现"""
        # 优先顺序: gewechat > wcf > itchat
        for bot_type in ['gewechat', 'wcf', 'itchat']:
            if bot_type in self.bot_implementations:
                try:
                    bot = self.bot_implementations[bot_type]
                    # 测试机器人是否可用
                    if hasattr(bot, 'check_login_status'):
                        # 修复：在同步方法中不使用asyncio.run()
                        # 由于我们不能在这里运行异步方法，我们只是检查方法是否存在
                        # 实际的可用性检查将在需要时进行
                        self.current_bot = bot
                        self.current_bot_type = bot_type
                        logger.info(f"已选择 {bot_type} 机器人实现")
                        return
                except Exception as e:
                    logger.debug(f"{bot_type} 机器人测试失败: {str(e)}")

        logger.warning("没有可用的微信机器人实现，将使用默认实现")
    
    def check_wechat_installed(self) -> Dict[str, Any]:
        """
        检查微信是否安装
        
        Returns:
            检查结果
        """
        try:
            import os
            import subprocess
            
            # Windows路径
            wechat_paths = [
                r"C:\Program Files (x86)\Tencent\WeChat\WeChat.exe",
                r"C:\Program Files\Tencent\WeChat\WeChat.exe",
                os.path.expanduser(r"~\AppData\Roaming\Tencent\WeChat\WeChat.exe")
            ]
            
            for path in wechat_paths:
                if os.path.exists(path):
                    return {
                        "success": True,
                        "installed": True,
                        "path": path,
                        "message": "微信已安装"
                    }
            
            return {
                "success": True,
                "installed": False,
                "message": "微信未安装"
            }
            
        except Exception as e:
            logger.error(f"检查微信安装状态失败: {str(e)}")
            return {
                "success": False,
                "message": f"检查失败: {str(e)}"
            }
    
    def open_wechat(self) -> Dict[str, Any]:
        """
        打开微信
        
        Returns:
            操作结果
        """
        try:
            check_result = self.check_wechat_installed()
            
            if not check_result.get("installed"):
                return {
                    "success": False,
                    "message": "微信未安装，请先安装微信"
                }
            
            import subprocess
            wechat_path = check_result.get("path")
            
            subprocess.Popen([wechat_path])
            
            logger.info("微信已启动")
            return {
                "success": True,
                "message": "微信已启动",
                "path": wechat_path
            }
            
        except Exception as e:
            logger.error(f"打开微信失败: {str(e)}")
            return {
                "success": False,
                "message": f"打开微信失败: {str(e)}"
            }
    
    def check_login_status(self) -> Dict[str, Any]:
        """
        检查登录状态

        Returns:
            登录状态
        """
        try:
            # 如果有选定的机器人实现，使用它来检查登录状态
            if self.current_bot and hasattr(self.current_bot, 'check_login_status'):
                # 修复：在同步方法中不使用asyncio.run()
                # 对于异步方法，返回一个表示需要异步调用的信息
                return {
                    "success": True,
                    "logged_in": self.is_logged_in,
                    "requires_async": True,
                    "message": "需要异步调用check_login_status方法"
                }
            else:
                # 默认实现
                if self.is_logged_in:
                    return {
                        "success": True,
                        "logged_in": True,
                        "user": self.current_user,
                        "message": "已登录"
                    }
                else:
                    return {
                        "success": True,
                        "logged_in": False,
                        "message": "未登录"
                    }

        except Exception as e:
            logger.error(f"检查登录状态失败: {str(e)}")
            return {
                "success": False,
                "message": f"检查失败: {str(e)}"
            }
    
    async def login_with_qrcode(self) -> Dict[str, Any]:
        """
        使用二维码登录
        
        Returns:
            登录结果
        """
        try:
            # 如果有选定的机器人实现，使用它来登录
            if self.current_bot and hasattr(self.current_bot, 'login_with_qrcode'):
                result = await self.current_bot.login_with_qrcode()
                self.is_logged_in = result.get('success', False)
                if self.is_logged_in:
                    self.current_user = result.get('user')
                return result
            else:
                # 默认使用itchat实现
                try:
                    import itchat
                    
                    logger.info("开始微信扫码登录...")
                    
                    # 登录回调
                    def login_callback():
                        logger.info("微信登录成功")
                        self.is_logged_in = True
                    
                    # 退出回调
                    def exit_callback():
                        logger.info("微信已退出")
                        self.is_logged_in = False
                    
                    # 启动登录
                    itchat.auto_login(
                        hotReload=True,
                        loginCallback=login_callback,
                        exitCallback=exit_callback
                    )
                    
                    # 获取当前用户信息
                    self.current_user = itchat.search_friends()[0]
                    
                    return {
                        "success": True,
                        "message": "微信登录成功",
                        "user": {
                            "nickname": self.current_user.get("NickName"),
                            "remark": self.current_user.get("RemarkName"),
                            "username": self.current_user.get("UserName")
                        }
                    }
                    
                except ImportError:
                    return {
                        "success": False,
                        "message": "itchat库未安装，请先安装: pip install itchat"
                    }
            
        except Exception as e:
            logger.error(f"微信登录失败: {str(e)}")
            return {
                "success": False,
                "message": f"登录失败: {str(e)}"
            }
    
    async def start_message_monitor(self) -> Dict[str, Any]:
        """
        开始消息监控
        
        Returns:
            操作结果
        """
        try:
            if not self.is_logged_in:
                return {
                    "success": False,
                    "message": "请先登录微信"
                }
            
            if self.is_monitoring:
                return {
                    "success": False,
                    "message": "消息监控已在运行"
                }
            
            import itchat
            
            # 消息处理函数
            @itchat.msg_register(itchat.content.TEXT)
            def text_reply(msg):
                try:
                    message_data = {
                        "from_user": msg.get("FromUserName"),
                        "to_user": msg.get("ToUserName"),
                        "content": msg.get("Content"),
                        "time": time.time(),
                        "type": "text"
                    }
                    
                    self.message_queue.append(message_data)
                    logger.info(f"收到消息: {message_data}")
                    
                    # 如果启用了自动回复
                    if self.auto_reply_enabled:
                        asyncio.create_task(self.process_auto_reply(message_data))
                    
                except Exception as e:
                    logger.error(f"处理消息失败: {str(e)}")
            
            # 启动消息监听
            itchat.run(debug=False, blockThread=False)
            
            self.is_monitoring = True
            
            return {
                "success": True,
                "message": "消息监控已启动"
            }
            
        except Exception as e:
            logger.error(f"启动消息监控失败: {str(e)}")
            return {
                "success": False,
                "message": f"启动失败: {str(e)}"
            }
    
    def stop_message_monitor(self) -> Dict[str, Any]:
        """
        停止消息监控
        
        Returns:
            操作结果
        """
        try:
            if not self.is_monitoring:
                return {
                    "success": False,
                    "message": "消息监控未运行"
                }
            
            import itchat
            itchat.logout()
            
            self.is_monitoring = False
            self.is_logged_in = False
            
            return {
                "success": True,
                "message": "消息监控已停止"
            }
            
        except Exception as e:
            logger.error(f"停止消息监控失败: {str(e)}")
            return {
                "success": False,
                "message": f"停止失败: {str(e)}"
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
    
    async def send_message(self, to_user: str, content: str) -> Dict[str, Any]:
        """
        发送消息
        
        Args:
            to_user: 接收用户
            content: 消息内容
        
        Returns:
            操作结果
        """
        try:
            if not self.is_logged_in:
                return {
                    "success": False,
                    "message": "请先登录微信"
                }
            
            import itchat
            
            # 发送消息
            itchat.send(content, toUserName=to_user)
            
            logger.info(f"发送消息到 {to_user}: {content}")
            
            return {
                "success": True,
                "message": "消息发送成功",
                "to_user": to_user,
                "content": content
            }
            
        except Exception as e:
            logger.error(f"发送消息失败: {str(e)}")
            return {
                "success": False,
                "message": f"发送失败: {str(e)}"
            }
    
    async def process_auto_reply(self, message: Dict[str, Any]) -> Dict[str, Any]:
        """
        处理自动回复
        
        Args:
            message: 收到的消息
        
        Returns:
            回复结果
        """
        try:
            content = message.get("content", "")
            from_user = message.get("from_user", "")
            
            # 检查是否有匹配的规则
            reply_content = None
            
            for pattern, reply in self.auto_reply_rules.items():
                if pattern in content:
                    reply_content = reply
                    break
            
            # 如果没有匹配规则，使用AI生成回复
            if not reply_content:
                reply_content = await self.generate_ai_reply(content)
            
            # 发送回复
            if reply_content:
                result = await self.send_message(from_user, reply_content)
                
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
    
    async def generate_ai_reply(self, message: str) -> Optional[str]:
        """
        使用AI生成回复
        
        Args:
            message: 收到的消息
        
        Returns:
            AI生成的回复
        """
        try:
            from services.qianwen_image_service_wrapper import qianwen_image_service
            
            prompt = f"请根据以下微信消息生成一个友好、自然的回复：{message}"
            
            response = await qianwen_image_service.generate_text(prompt)
            
            return response
            
        except Exception as e:
            logger.error(f"AI生成回复失败: {str(e)}")
            return None
    
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
            
            logger.info(f"添加自动回复规则: {pattern} -> {reply}")
            
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
                
                logger.info(f"删除自动回复规则: {pattern}")
                
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
            
            logger.info("自动回复已启用")
            
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
            
            logger.info("自动回复已禁用")
            
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
    
    def get_friends(self) -> Dict[str, Any]:
        """
        获取好友列表
        
        Returns:
            好友列表
        """
        try:
            if not self.is_logged_in:
                return {
                    "success": False,
                    "message": "请先登录微信"
                }
            
            import itchat
            
            friends = itchat.get_friends(update=True)[1:]
            
            friend_list = []
            for friend in friends:
                friend_list.append({
                    "nickname": friend.get("NickName"),
                    "remark": friend.get("RemarkName"),
                    "username": friend.get("UserName")
                })
            
            return {
                "success": True,
                "friends": friend_list,
                "total": len(friend_list)
            }
            
        except Exception as e:
            logger.error(f"获取好友列表失败: {str(e)}")
            return {
                "success": False,
                "message": f"获取失败: {str(e)}"
            }
    
    def get_groups(self) -> Dict[str, Any]:
        """
        获取群聊列表
        
        Returns:
            群聊列表
        """
        try:
            if not self.is_logged_in:
                return {
                    "success": False,
                    "message": "请先登录微信"
                }
            
            import itchat
            
            groups = itchat.get_chatrooms(update=True)
            
            group_list = []
            for group in groups:
                group_list.append({
                    "nickname": group.get("NickName"),
                    "username": group.get("UserName"),
                    "member_count": group.get("MemberCount", 0)
                })
            
            return {
                "success": True,
                "groups": group_list,
                "total": len(group_list)
            }
            
        except Exception as e:
            logger.error(f"获取群聊列表失败: {str(e)}")
            return {
                "success": False,
                "message": f"获取失败: {str(e)}"
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
                    "logged_in": self.is_logged_in,
                    "monitoring": self.is_monitoring,
                    "auto_reply_enabled": self.auto_reply_enabled,
                    "current_user": self.current_user,
                    "message_queue_size": len(self.message_queue),
                    "auto_reply_rules_count": len(self.auto_reply_rules)
                }
            }
            
        except Exception as e:
            logger.error(f"获取服务状态失败: {str(e)}")
            return {
                "success": False,
                "message": f"获取失败: {str(e)}"
            }


# 创建全局实例
wechat_bot_service = WeChatBotService()
