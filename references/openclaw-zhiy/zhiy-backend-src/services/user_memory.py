"""
用户记忆和学习系统
实现用户行为记忆、上下文记忆、学习能力
"""

import json
import os
from datetime import datetime
from typing import Dict, Any, List, Optional
from loguru import logger

try:
    import chromadb
    from chromadb.config import Settings
    CHROMADB_AVAILABLE = True
except ImportError:
    CHROMADB_AVAILABLE = False
    logger.warning("ChromaDB不可用，请安装: pip install chromadb")

try:
    from sentence_transformers import SentenceTransformer
    SENTENCE_TRANSFORMERS_AVAILABLE = True
except ImportError:
    SENTENCE_TRANSFORMERS_AVAILABLE = False
    logger.warning("SentenceTransformers不可用，请安装: pip install sentence-transformers")


class UserMemory:
    """用户记忆系统"""
    
    def __init__(self, user_id: str, storage_path: str = None):
        """
        初始化用户记忆系统
        
        Args:
            user_id: 用户ID
            storage_path: 存储路径
        """
        self.user_id = user_id
        self.storage_path = storage_path or "F:\\AI系统开发原始框架\\backend\\data\\user_memory"
        os.makedirs(self.storage_path, exist_ok=True)
        
        # 记忆文件路径
        self.memory_file = os.path.join(self.storage_path, f"{user_id}_memory.json")
        self.behavior_file = os.path.join(self.storage_path, f"{user_id}_behavior.json")
        self.context_file = os.path.join(self.storage_path, f"{user_id}_context.json")
        
        # 加载记忆
        self.memory = self._load_memory()
        self.behaviors = self._load_behaviors()
        self.context = self._load_context()
        
        # 向量数据库
        self.collection = None
        self.embedding_model = None
        
        if CHROMADB_AVAILABLE and SENTENCE_TRANSFORMERS_AVAILABLE:
            self._init_vector_db()
        
        logger.info(f"用户记忆系统初始化完成，用户ID: {user_id}")
    
    def _init_vector_db(self):
        """初始化向量数据库"""
        try:
            # 初始化ChromaDB
            client = chromadb.PersistentClient(
                path=os.path.join(self.storage_path, "chroma_db"),
                settings=Settings(anonymized_telemetry=False)
            )
            
            # 获取或创建集合
            self.collection = client.get_or_create_collection(
                name=f"user_{self.user_id}_memory",
                metadata={"hnsw:space": "cosine"}
            )
            
            # 初始化嵌入模型 - 使用本地模型或跳过
            try:
                self.embedding_model = SentenceTransformer('paraphrase-multilingual-MiniLM-L12-v2')
            except Exception as e:
                logger.warning(f"无法加载嵌入模型: {str(e)}")
                self.embedding_model = None
            
            logger.info("向量数据库初始化成功")
        except Exception as e:
            logger.warning(f"向量数据库初始化失败: {str(e)}")
            self.collection = None
            self.embedding_model = None
    
    def _load_memory(self) -> Dict[str, Any]:
        """加载记忆"""
        try:
            if os.path.exists(self.memory_file):
                with open(self.memory_file, 'r', encoding='utf-8') as f:
                    return json.load(f)
        except Exception as e:
            logger.warning(f"加载记忆失败: {str(e)}")
        
        return {
            "user_id": self.user_id,
            "created_at": datetime.now().isoformat(),
            "interactions": [],
            "preferences": {},
            "frequent_queries": {},
            "learned_patterns": []
        }
    
    def _load_behaviors(self) -> List[Dict[str, Any]]:
        """加载行为记录"""
        try:
            if os.path.exists(self.behavior_file):
                with open(self.behavior_file, 'r', encoding='utf-8') as f:
                    return json.load(f)
        except Exception as e:
            logger.warning(f"加载行为记录失败: {str(e)}")
        
        return []
    
    def _load_context(self) -> Dict[str, Any]:
        """加载上下文"""
        try:
            if os.path.exists(self.context_file):
                with open(self.context_file, 'r', encoding='utf-8') as f:
                    return json.load(f)
        except Exception as e:
            logger.warning(f"加载上下文失败: {str(e)}")
        
        return {
            "current_session": {},
            "recent_topics": [],
            "ongoing_tasks": []
        }
    
    def _save_memory(self):
        """保存记忆"""
        try:
            self.memory["updated_at"] = datetime.now().isoformat()
            with open(self.memory_file, 'w', encoding='utf-8') as f:
                json.dump(self.memory, f, ensure_ascii=False, indent=2)
        except Exception as e:
            logger.error(f"保存记忆失败: {str(e)}")
    
    def _save_behaviors(self):
        """保存行为记录"""
        try:
            with open(self.behavior_file, 'w', encoding='utf-8') as f:
                json.dump(self.behaviors, f, ensure_ascii=False, indent=2)
        except Exception as e:
            logger.error(f"保存行为记录失败: {str(e)}")
    
    def _save_context(self):
        """保存上下文"""
        try:
            with open(self.context_file, 'w', encoding='utf-8') as f:
                json.dump(self.context, f, ensure_ascii=False, indent=2)
        except Exception as e:
            logger.error(f"保存上下文失败: {str(e)}")
    
    def add_interaction(self, user_input: str, ai_response: str, tool_used: str = None):
        """
        添加交互记录
        
        Args:
            user_input: 用户输入
            ai_response: AI回复
            tool_used: 使用的工具
        """
        interaction = {
            "timestamp": datetime.now().isoformat(),
            "user_input": user_input,
            "ai_response": ai_response,
            "tool_used": tool_used,
            "session_id": self.context.get("current_session", {}).get("id", "")
        }
        
        self.memory["interactions"].append(interaction)
        
        # 限制交互记录数量
        if len(self.memory["interactions"]) > 1000:
            self.memory["interactions"] = self.memory["interactions"][-1000:]
        
        # 更新频繁查询
        self._update_frequent_queries(user_input)
        
        # 添加到向量数据库
        self._add_to_vector_db(user_input, ai_response, interaction)
        
        self._save_memory()
        logger.info(f"添加交互记录: {user_input[:50]}...")
    
    def _update_frequent_queries(self, query: str):
        """更新频繁查询"""
        # 简化查询
        simplified_query = query.lower().strip()
        
        if simplified_query in self.memory["frequent_queries"]:
            self.memory["frequent_queries"][simplified_query] += 1
        else:
            self.memory["frequent_queries"][simplified_query] = 1
    
    def _add_to_vector_db(self, user_input: str, ai_response: str, metadata: Dict[str, Any]):
        """添加到向量数据库"""
        if not self.collection or not self.embedding_model:
            return
        
        try:
            # 生成嵌入向量
            text = f"用户: {user_input}\nAI: {ai_response}"
            embedding = self.embedding_model.encode(text).tolist()
            
            # 添加到集合
            self.collection.add(
                embeddings=[embedding],
                documents=[text],
                metadatas=[{
                    "user_id": self.user_id,
                    "timestamp": metadata.get("timestamp", ""),
                    "tool_used": metadata.get("tool_used", "")
                }],
                ids=[f"{self.user_id}_{len(self.memory['interactions'])}"]
            )
        except Exception as e:
            logger.warning(f"添加到向量数据库失败: {str(e)}")
    
    def record_behavior(self, behavior_type: str, details: Dict[str, Any]):
        """
        记录用户行为
        
        Args:
            behavior_type: 行为类型
            details: 行为详情
        """
        behavior = {
            "timestamp": datetime.now().isoformat(),
            "type": behavior_type,
            "details": details
        }
        
        self.behaviors.append(behavior)
        
        # 限制行为记录数量
        if len(self.behaviors) > 500:
            self.behaviors = self.behaviors[-500:]
        
        self._save_behaviors()
        logger.info(f"记录行为: {behavior_type}")
    
    def update_preferences(self, key: str, value: Any):
        """
        更新用户偏好
        
        Args:
            key: 偏好键
            value: 偏好值
        """
        self.memory["preferences"][key] = {
            "value": value,
            "updated_at": datetime.now().isoformat()
        }
        
        self._save_memory()
        logger.info(f"更新偏好: {key} = {value}")
    
    def get_preferences(self, key: str = None) -> Any:
        """
        获取用户偏好
        
        Args:
            key: 偏好键，None表示获取所有
        
        Returns:
            偏好值
        """
        if key:
            pref = self.memory["preferences"].get(key)
            return pref["value"] if pref else None
        else:
            return {k: v["value"] for k, v in self.memory["preferences"].items()}
    
    def search_memory(self, query: str, top_k: int = 5) -> List[Dict[str, Any]]:
        """
        搜索记忆
        
        Args:
            query: 搜索查询
            top_k: 返回前K个结果
        
        Returns:
            搜索结果
        """
        # 1. 向量数据库搜索
        vector_results = []
        if self.collection and self.embedding_model:
            try:
                query_embedding = self.embedding_model.encode(query).tolist()
                results = self.collection.query(
                    query_embeddings=[query_embedding],
                    n_results=top_k
                )
                
                if results["documents"] and results["documents"][0]:
                    for i, doc in enumerate(results["documents"][0]):
                        vector_results.append({
                            "type": "vector_search",
                            "content": doc,
                            "metadata": results["metadatas"][0][i] if results["metadatas"] else {},
                            "distance": results["distances"][0][i] if results["distances"] else 0
                        })
            except Exception as e:
                logger.warning(f"向量搜索失败: {str(e)}")
        
        # 2. 关键词匹配
        keyword_results = []
        query_lower = query.lower()
        
        for interaction in self.memory["interactions"][-50:]:  # 最近50条
            user_input = interaction.get("user_input", "")
            if query_lower in user_input.lower():
                keyword_results.append({
                    "type": "keyword_match",
                    "content": f"用户: {user_input}\nAI: {interaction.get('ai_response', '')}",
                    "timestamp": interaction.get("timestamp", ""),
                    "tool_used": interaction.get("tool_used", "")
                })
        
        # 3. 合并结果
        all_results = vector_results + keyword_results
        
        # 去重并排序
        seen = set()
        unique_results = []
        for result in all_results:
            content = result.get("content", "")
            if content not in seen:
                seen.add(content)
                unique_results.append(result)
        
        return unique_results[:top_k]
    
    def get_recent_interactions(self, limit: int = 10) -> List[Dict[str, Any]]:
        """
        获取最近的交互
        
        Args:
            limit: 数量限制
        
        Returns:
            交互列表
        """
        return self.memory["interactions"][-limit:]
    
    def get_frequent_queries(self, limit: int = 10) -> List[Dict[str, Any]]:
        """
        获取频繁查询
        
        Args:
            limit: 数量限制
        
        Returns:
            查询列表
        """
        queries = self.memory["frequent_queries"]
        sorted_queries = sorted(queries.items(), key=lambda x: x[1], reverse=True)
        
        return [
            {"query": query, "count": count}
            for query, count in sorted_queries[:limit]
        ]
    
    def learn_pattern(self, pattern: str, description: str):
        """
        学习模式
        
        Args:
            pattern: 模式
            description: 描述
        """
        pattern_entry = {
            "pattern": pattern,
            "description": description,
            "learned_at": datetime.now().isoformat(),
            "usage_count": 0
        }
        
        self.memory["learned_patterns"].append(pattern_entry)
        
        # 限制学习模式数量
        if len(self.memory["learned_patterns"]) > 100:
            self.memory["learned_patterns"] = self.memory["learned_patterns"][-100:]
        
        self._save_memory()
        logger.info(f"学习模式: {pattern}")
    
    def get_learned_patterns(self) -> List[Dict[str, Any]]:
        """获取学习到的模式"""
        return self.memory["learned_patterns"]
    
    def update_context(self, key: str, value: Any):
        """
        更新上下文
        
        Args:
            key: 上下文键
            value: 上下文值
        """
        self.context["current_session"][key] = value
        self._save_context()
    
    def get_context(self, key: str = None) -> Any:
        """
        获取上下文
        
        Args:
            key: 上下文键，None表示获取所有
        
        Returns:
            上下文值
        """
        if key:
            return self.context["current_session"].get(key)
        else:
            return self.context["current_session"]
    
    def get_memory_summary(self) -> Dict[str, Any]:
        """获取记忆摘要"""
        return {
            "user_id": self.user_id,
            "total_interactions": len(self.memory["interactions"]),
            "total_behaviors": len(self.behaviors),
            "preferences_count": len(self.memory["preferences"]),
            "frequent_queries_count": len(self.memory["frequent_queries"]),
            "learned_patterns_count": len(self.memory["learned_patterns"]),
            "created_at": self.memory.get("created_at", ""),
            "updated_at": self.memory.get("updated_at", ""),
            "vector_db_available": self.collection is not None
        }


# 用户记忆管理器
class UserMemoryManager:
    """用户记忆管理器"""
    
    def __init__(self):
        self.memories: Dict[str, UserMemory] = {}
        logger.info("用户记忆管理器初始化完成")
    
    def get_user_memory(self, user_id: str) -> UserMemory:
        """
        获取用户记忆
        
        Args:
            user_id: 用户ID
        
        Returns:
            用户记忆对象
        """
        if user_id not in self.memories:
            self.memories[user_id] = UserMemory(user_id)
        
        return self.memories[user_id]
    
    def get_all_users(self) -> List[str]:
        """获取所有用户ID"""
        return list(self.memories.keys())


# 创建全局实例
user_memory_manager = UserMemoryManager()
