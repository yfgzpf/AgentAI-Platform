from typing import Dict, Any, List, Optional
from datetime import datetime
import json
from loguru import logger


class ContextMemory:
    """上下文长记忆管理器"""
    
    def __init__(self, max_context_length: int = 10000):
        self.max_context_length = max_context_length
        self.conversation_history: List[Dict[str, Any]] = []
        self.user_preferences: Dict[str, Any] = {}
        self.session_context: Dict[str, Any] = {}
        self.long_term_memory: Dict[str, List[Dict[str, Any]]] = {}
        
        logger.info("上下文记忆管理器初始化完成")
    
    def add_message(
        self,
        role: str,
        content: str,
        metadata: Optional[Dict[str, Any]] = None
    ):
        """添加消息到对话历史"""
        message = {
            "role": role,
            "content": content,
            "timestamp": datetime.now().isoformat(),
            "metadata": metadata or {}
        }
        
        self.conversation_history.append(message)
        
        if len(self.conversation_history) > self.max_context_length:
            self.conversation_history = self.conversation_history[-self.max_context_length:]
        
        self._extract_context_from_message(message)
        
        logger.debug(f"添加消息到对话历史: {role}")
    
    def get_recent_context(
        self,
        limit: int = 10
    ) -> List[Dict[str, Any]]:
        """获取最近的对话上下文"""
        return self.conversation_history[-limit:]
    
    def get_full_context(self) -> List[Dict[str, Any]]:
        """获取完整的对话上下文"""
        return self.conversation_history.copy()
    
    def get_context_summary(
        self,
        max_tokens: int = 2000
    ) -> str:
        """获取上下文摘要"""
        if not self.conversation_history:
            return ""
        
        summary_parts = []
        total_tokens = 0
        
        for message in reversed(self.conversation_history):
            message_text = f"{message['role']}: {message['content']}\n"
            estimated_tokens = len(message_text.split())
            
            if total_tokens + estimated_tokens > max_tokens:
                break
            
            summary_parts.insert(0, message_text)
            total_tokens += estimated_tokens
        
        return "".join(summary_parts)
    
    def _extract_context_from_message(
        self,
        message: Dict[str, Any]
    ):
        """从消息中提取上下文信息"""
        content = message.get("content", "")
        role = message.get("role", "")
        
        if role == "user":
            self._extract_user_preferences(content)
            self._extract_session_context(content)
    
    def _extract_user_preferences(
        self,
        content: str
    ):
        """提取用户偏好"""
        keywords = {
            "风格": ["现代简约", "欧式", "中式", "北欧", "工业风", "日式"],
            "预算": ["便宜", "实惠", "中等", "高端", "豪华"],
            "颜色": ["红色", "蓝色", "绿色", "黄色", "白色", "黑色", "灰色"],
            "材料": ["实木", "瓷砖", "大理石", "不锈钢", "玻璃", "布艺"]
        }
        
        for category, keyword_list in keywords.items():
            for keyword in keyword_list:
                if keyword in content:
                    if category not in self.user_preferences:
                        self.user_preferences[category] = []
                    
                    if keyword not in self.user_preferences[category]:
                        self.user_preferences[category].append(keyword)
                        logger.debug(f"提取用户偏好: {category} = {keyword}")
    
    def _extract_session_context(
        self,
        content: str
    ):
        """提取会话上下文"""
        import re
        
        area_match = re.search(r'(\d+)\s*(平方|平米|㎡|m2)', content)
        if area_match:
            self.session_context["area"] = int(area_match.group(1))
        
        room_types = ["客厅", "卧室", "厨房", "卫生间", "书房", "阳台", "餐厅"]
        for room_type in room_types:
            if room_type in content:
                if "rooms" not in self.session_context:
                    self.session_context["rooms"] = []
                if room_type not in self.session_context["rooms"]:
                    self.session_context["rooms"].append(room_type)
        
        logger.debug(f"更新会话上下文: {self.session_context}")
    
    def get_user_preferences(self) -> Dict[str, Any]:
        """获取用户偏好"""
        return self.user_preferences.copy()
    
    def get_session_context(self) -> Dict[str, Any]:
        """获取会话上下文"""
        return self.session_context.copy()
    
    def update_session_context(self, updates: Dict[str, Any]):
        """更新会话上下文"""
        self.session_context.update(updates)
        logger.debug(f"更新会话上下文: {updates}")
    
    def add_to_long_term_memory(
        self,
        category: str,
        data: Dict[str, Any]
    ):
        """添加到长期记忆"""
        if category not in self.long_term_memory:
            self.long_term_memory[category] = []
        
        memory_item = {
            "data": data,
            "timestamp": datetime.now().isoformat(),
            "access_count": 0
        }
        
        self.long_term_memory[category].append(memory_item)
        
        if len(self.long_term_memory[category]) > 100:
            self.long_term_memory[category] = self.long_term_memory[category][-100:]
        
        logger.debug(f"添加到长期记忆: {category}")
    
    def retrieve_from_long_term_memory(
        self,
        category: str,
        limit: int = 5
    ) -> List[Dict[str, Any]]:
        """从长期记忆中检索"""
        if category not in self.long_term_memory:
            return []
        
        memories = self.long_term_memory[category]
        
        for memory in memories:
            memory["access_count"] += 1
        
        return memories[-limit:]
    
    def search_long_term_memory(
        self,
        query: str,
        category: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """搜索长期记忆"""
        results = []
        
        categories_to_search = [category] if category else self.long_term_memory.keys()
        
        for cat in categories_to_search:
            if cat not in self.long_term_memory:
                continue
            
            for memory in self.long_term_memory[cat]:
                data_str = json.dumps(memory["data"], ensure_ascii=False)
                if query.lower() in data_str.lower():
                    results.append({
                        "category": cat,
                        "memory": memory
                    })
        
        results.sort(key=lambda x: x["memory"]["access_count"], reverse=True)
        
        return results[:10]
    
    def clear_conversation_history(self):
        """清除对话历史"""
        self.conversation_history.clear()
        logger.info("对话历史已清除")
    
    def clear_session_context(self):
        """清除会话上下文"""
        self.session_context.clear()
        logger.info("会话上下文已清除")
    
    def export_memory(self) -> Dict[str, Any]:
        """导出记忆数据"""
        return {
            "conversation_history": self.conversation_history,
            "user_preferences": self.user_preferences,
            "session_context": self.session_context,
            "long_term_memory": self.long_term_memory
        }
    
    def import_memory(
        self,
        memory_data: Dict[str, Any]
    ):
        """导入记忆数据"""
        if "conversation_history" in memory_data:
            self.conversation_history = memory_data["conversation_history"]
        
        if "user_preferences" in memory_data:
            self.user_preferences = memory_data["user_preferences"]
        
        if "session_context" in memory_data:
            self.session_context = memory_data["session_context"]
        
        if "long_term_memory" in memory_data:
            self.long_term_memory = memory_data["long_term_memory"]
        
        logger.info("记忆数据已导入")
    
    def get_context_for_ai(
        self,
        max_tokens: int = 3000
    ) -> str:
        """获取用于AI的上下文"""
        context_parts = []
        
        if self.user_preferences:
            context_parts.append("用户偏好:")
            for category, preferences in self.user_preferences.items():
                context_parts.append(f"- {category}: {', '.join(preferences)}")
            context_parts.append("")
        
        if self.session_context:
            context_parts.append("当前会话上下文:")
            for key, value in self.session_context.items():
                context_parts.append(f"- {key}: {value}")
            context_parts.append("")
        
        recent_context = self.get_context_summary(max_tokens - len("\n".join(context_parts)))
        
        if recent_context:
            context_parts.append("最近对话:")
            context_parts.append(recent_context)
        
        return "\n".join(context_parts)
    
    def get_last_assistant_message(self) -> Optional[str]:
        """获取最后一条助手消息"""
        for message in reversed(self.conversation_history):
            if message['role'] == 'assistant':
                return message['content']
        return None


context_memory = ContextMemory()
