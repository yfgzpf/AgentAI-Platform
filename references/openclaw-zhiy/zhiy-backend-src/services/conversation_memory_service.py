"""
多轮对话记忆服务
实现短期记忆、长期记忆和用户记忆功能
"""

import json
import os
from typing import Dict, Any, List, Optional
from datetime import datetime, timedelta
from loguru import logger
import hashlib


class ConversationMemoryService:
    """多轮对话记忆服务"""
    
    def __init__(self, memory_dir: str = "data/memory"):
        self.memory_dir = memory_dir
        self.short_term_memory: Dict[str, Dict[str, Any]] = {}
        self.long_term_memory: Dict[str, Dict[str, Any]] = {}
        self.user_memory: Dict[str, Dict[str, Any]] = {}
        self.short_term_expiry = 3600  # 短期记忆过期时间（秒）
        self.max_short_term_entries = 50  # 短期记忆最大条目数
        
        # 确保记忆目录存在
        os.makedirs(self.memory_dir, exist_ok=True)
        os.makedirs(os.path.join(self.memory_dir, "long_term"), exist_ok=True)
        os.makedirs(os.path.join(self.memory_dir, "user"), exist_ok=True)
        
        # 加载长期记忆和用户记忆
        self._load_long_term_memory()
        self._load_user_memory()
        
        logger.info("多轮对话记忆服务初始化完成")
    
    def _load_long_term_memory(self):
        """加载长期记忆"""
        try:
            long_term_dir = os.path.join(self.memory_dir, "long_term")
            for filename in os.listdir(long_term_dir):
                if filename.endswith(".json"):
                    file_path = os.path.join(long_term_dir, filename)
                    with open(file_path, 'r', encoding='utf-8') as f:
                        memory_data = json.load(f)
                        memory_id = filename.replace(".json", "")
                        self.long_term_memory[memory_id] = memory_data
            logger.info(f"加载了 {len(self.long_term_memory)} 个长期记忆")
        except Exception as e:
            logger.error(f"加载长期记忆失败: {str(e)}")
    
    def _load_user_memory(self):
        """加载用户记忆"""
        try:
            user_dir = os.path.join(self.memory_dir, "user")
            for filename in os.listdir(user_dir):
                if filename.endswith(".json"):
                    file_path = os.path.join(user_dir, filename)
                    with open(file_path, 'r', encoding='utf-8') as f:
                        user_data = json.load(f)
                        user_id = filename.replace(".json", "")
                        self.user_memory[user_id] = user_data
            logger.info(f"加载了 {len(self.user_memory)} 个用户记忆")
        except Exception as e:
            logger.error(f"加载用户记忆失败: {str(e)}")
    
    def add_short_term_memory(self, conversation_id: str, message: Dict[str, Any]):
        """
        添加短期记忆
        
        Args:
            conversation_id: 对话ID
            message: 消息内容
        """
        try:
            if conversation_id not in self.short_term_memory:
                self.short_term_memory[conversation_id] = {
                    "messages": [],
                    "last_updated": datetime.now().timestamp()
                }
            
            # 添加消息
            self.short_term_memory[conversation_id]["messages"].append({
                "...message": message,
                "timestamp": datetime.now().timestamp()
            })
            
            # 更新时间戳
            self.short_term_memory[conversation_id]["last_updated"] = datetime.now().timestamp()
            
            # 限制短期记忆大小
            messages = self.short_term_memory[conversation_id]["messages"]
            if len(messages) > self.max_short_term_entries:
                self.short_term_memory[conversation_id]["messages"] = messages[-self.max_short_term_entries:]
            
            logger.debug(f"添加短期记忆: {conversation_id}, 当前消息数: {len(messages)}")
        except Exception as e:
            logger.error(f"添加短期记忆失败: {str(e)}")
    
    def get_short_term_memory(self, conversation_id: str) -> List[Dict[str, Any]]:
        """
        获取短期记忆
        
        Args:
            conversation_id: 对话ID
            
        Returns:
            消息列表
        """
        try:
            if conversation_id not in self.short_term_memory:
                return []
            
            # 检查是否过期
            memory = self.short_term_memory[conversation_id]
            current_time = datetime.now().timestamp()
            
            if current_time - memory["last_updated"] > self.short_term_expiry:
                # 记忆已过期
                del self.short_term_memory[conversation_id]
                return []
            
            # 更新时间戳
            memory["last_updated"] = current_time
            
            # 提取消息内容（移除内部时间戳）
            messages = []
            for msg in memory["messages"]:
                message_content = msg.get("...message", {})
                messages.append(message_content)
            
            return messages
        except Exception as e:
            logger.error(f"获取短期记忆失败: {str(e)}")
            return []
    
    def add_long_term_memory(self, memory_id: str, memory_data: Dict[str, Any]):
        """
        添加长期记忆
        
        Args:
            memory_id: 记忆ID
            memory_data: 记忆数据
        """
        try:
            # 添加到内存
            self.long_term_memory[memory_id] = {
                "...memory_data": memory_data,
                "created_at": datetime.now().timestamp(),
                "updated_at": datetime.now().timestamp()
            }
            
            # 保存到文件
            file_path = os.path.join(self.memory_dir, "long_term", f"{memory_id}.json")
            with open(file_path, 'w', encoding='utf-8') as f:
                json.dump(self.long_term_memory[memory_id], f, ensure_ascii=False, indent=2)
            
            logger.info(f"添加长期记忆: {memory_id}")
        except Exception as e:
            logger.error(f"添加长期记忆失败: {str(e)}")
    
    def get_long_term_memory(self, memory_id: str) -> Optional[Dict[str, Any]]:
        """
        获取长期记忆
        
        Args:
            memory_id: 记忆ID
            
        Returns:
            记忆数据
        """
        try:
            if memory_id not in self.long_term_memory:
                return None
            
            memory_data = self.long_term_memory[memory_id].get("...memory_data")
            return memory_data
        except Exception as e:
            logger.error(f"获取长期记忆失败: {str(e)}")
            return None
    
    def add_user_memory(self, user_id: str, user_data: Dict[str, Any]):
        """
        添加用户记忆
        
        Args:
            user_id: 用户ID
            user_data: 用户数据
        """
        try:
            if user_id not in self.user_memory:
                self.user_memory[user_id] = {
                    "...user_data": user_data,
                    "created_at": datetime.now().timestamp(),
                    "updated_at": datetime.now().timestamp()
                }
            else:
                # 更新现有用户记忆
                self.user_memory[user_id]["...user_data"] = user_data
                self.user_memory[user_id]["updated_at"] = datetime.now().timestamp()
            
            # 保存到文件
            file_path = os.path.join(self.memory_dir, "user", f"{user_id}.json")
            with open(file_path, 'w', encoding='utf-8') as f:
                json.dump(self.user_memory[user_id], f, ensure_ascii=False, indent=2)
            
            logger.info(f"添加用户记忆: {user_id}")
        except Exception as e:
            logger.error(f"添加用户记忆失败: {str(e)}")
    
    def get_user_memory(self, user_id: str) -> Optional[Dict[str, Any]]:
        """
        获取用户记忆
        
        Args:
            user_id: 用户ID
            
        Returns:
            用户数据
        """
        try:
            if user_id not in self.user_memory:
                return None
            
            user_data = self.user_memory[user_id].get("...user_data")
            return user_data
        except Exception as e:
            logger.error(f"获取用户记忆失败: {str(e)}")
            return None
    
    def update_user_memory(self, user_id: str, key: str, value: Any):
        """
        更新用户记忆中的特定字段
        
        Args:
            user_id: 用户ID
            key: 字段名
            value: 字段值
        """
        try:
            user_data = self.get_user_memory(user_id)
            if user_data:
                user_data[key] = value
                self.add_user_memory(user_id, user_data)
                logger.debug(f"更新用户记忆: {user_id}, {key}")
        except Exception as e:
            logger.error(f"更新用户记忆失败: {str(e)}")
    
    def search_memory(self, query: str, memory_type: str = "all", limit: int = 10) -> List[Dict[str, Any]]:
        """
        搜索记忆
        
        Args:
            query: 搜索关键词
            memory_type: 记忆类型 (all, short_term, long_term, user)
            limit: 结果数量限制
            
        Returns:
            搜索结果
        """
        try:
            results = []
            query_lower = query.lower()
            
            # 搜索短期记忆
            if memory_type in ["all", "short_term"]:
                for conversation_id, memory in self.short_term_memory.items():
                    for msg in memory["messages"]:
                        message_content = msg.get("...message", {})
                        content = str(message_content.get("content", ""))
                        if query_lower in content.lower():
                            results.append({
                                "type": "short_term",
                                "conversation_id": conversation_id,
                                "message": message_content,
                                "timestamp": msg.get("timestamp")
                            })
            
            # 搜索长期记忆
            if memory_type in ["all", "long_term"]:
                for memory_id, memory in self.long_term_memory.items():
                    memory_data = memory.get("...memory_data", {})
                    content = str(memory_data)
                    if query_lower in content.lower():
                        results.append({
                            "type": "long_term",
                            "memory_id": memory_id,
                            "data": memory_data,
                            "timestamp": memory.get("created_at")
                        })
            
            # 搜索用户记忆
            if memory_type in ["all", "user"]:
                for user_id, memory in self.user_memory.items():
                    user_data = memory.get("...user_data", {})
                    content = str(user_data)
                    if query_lower in content.lower():
                        results.append({
                            "type": "user",
                            "user_id": user_id,
                            "data": user_data,
                            "timestamp": memory.get("created_at")
                        })
            
            # 按时间戳排序
            results.sort(key=lambda x: x.get("timestamp", 0), reverse=True)
            
            # 限制结果数量
            return results[:limit]
        except Exception as e:
            logger.error(f"搜索记忆失败: {str(e)}")
            return []
    
    def clear_short_term_memory(self, conversation_id: str = None):
        """
        清除短期记忆
        
        Args:
            conversation_id: 对话ID（如果为None，清除所有短期记忆）
        """
        try:
            if conversation_id:
                if conversation_id in self.short_term_memory:
                    del self.short_term_memory[conversation_id]
                    logger.info(f"清除短期记忆: {conversation_id}")
            else:
                self.short_term_memory.clear()
                logger.info("清除所有短期记忆")
        except Exception as e:
            logger.error(f"清除短期记忆失败: {str(e)}")
    
    def clear_long_term_memory(self, memory_id: str = None):
        """
        清除长期记忆
        
        Args:
            memory_id: 记忆ID（如果为None，清除所有长期记忆）
        """
        try:
            if memory_id:
                if memory_id in self.long_term_memory:
                    del self.long_term_memory[memory_id]
                    # 删除文件
                    file_path = os.path.join(self.memory_dir, "long_term", f"{memory_id}.json")
                    if os.path.exists(file_path):
                        os.remove(file_path)
                    logger.info(f"清除长期记忆: {memory_id}")
            else:
                # 清除所有长期记忆
                self.long_term_memory.clear()
                # 清空目录
                long_term_dir = os.path.join(self.memory_dir, "long_term")
                for filename in os.listdir(long_term_dir):
                    file_path = os.path.join(long_term_dir, filename)
                    if os.path.isfile(file_path):
                        os.remove(file_path)
                logger.info("清除所有长期记忆")
        except Exception as e:
            logger.error(f"清除长期记忆失败: {str(e)}")
    
    def clear_user_memory(self, user_id: str = None):
        """
        清除用户记忆
        
        Args:
            user_id: 用户ID（如果为None，清除所有用户记忆）
        """
        try:
            if user_id:
                if user_id in self.user_memory:
                    del self.user_memory[user_id]
                    # 删除文件
                    file_path = os.path.join(self.memory_dir, "user", f"{user_id}.json")
                    if os.path.exists(file_path):
                        os.remove(file_path)
                    logger.info(f"清除用户记忆: {user_id}")
            else:
                # 清除所有用户记忆
                self.user_memory.clear()
                # 清空目录
                user_dir = os.path.join(self.memory_dir, "user")
                for filename in os.listdir(user_dir):
                    file_path = os.path.join(user_dir, filename)
                    if os.path.isfile(file_path):
                        os.remove(file_path)
                logger.info("清除所有用户记忆")
        except Exception as e:
            logger.error(f"清除用户记忆失败: {str(e)}")
    
    def get_status(self) -> Dict[str, Any]:
        """
        获取服务状态
        
        Returns:
            状态信息
        """
        try:
            # 统计短期记忆
            short_term_stats = {
                "conversations": len(self.short_term_memory),
                "total_messages": sum(len(m["messages"]) for m in self.short_term_memory.values())
            }
            
            return {
                "short_term_memory": short_term_stats,
                "long_term_memory_count": len(self.long_term_memory),
                "user_memory_count": len(self.user_memory),
                "memory_dir": self.memory_dir,
                "short_term_expiry": self.short_term_expiry,
                "max_short_term_entries": self.max_short_term_entries
            }
        except Exception as e:
            logger.error(f"获取状态失败: {str(e)}")
            return {}
    
    def generate_memory_id(self, content: str) -> str:
        """
        生成记忆ID
        
        Args:
            content: 内容
            
        Returns:
            记忆ID
        """
        try:
            # 使用内容的哈希值作为ID
            hash_obj = hashlib.md5(content.encode('utf-8'))
            memory_id = hash_obj.hexdigest()
            return memory_id
        except Exception as e:
            logger.error(f"生成记忆ID失败: {str(e)}")
            # 返回时间戳作为备用
            return str(int(datetime.now().timestamp()))


# 创建全局实例
conversation_memory_service = ConversationMemoryService()
