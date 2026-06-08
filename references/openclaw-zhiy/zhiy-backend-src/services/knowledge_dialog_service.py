"""
知识库增强对话服务
结合本地AI模型和向量数据库，实现基于知识库的智能对话
"""
import asyncio
from typing import Dict, Any, List
from services.local_ai_service import LocalAIService
from services.vector_db_service import KnowledgeBaseService, VectorDBService
from loguru import logger


class KnowledgeEnhancedDialogService:
    """知识库增强对话服务类"""
    
    def __init__(self):
        """初始化服务"""
        # 初始化向量数据库
        self.vector_db = VectorDBService()
        
        # 初始化知识库服务
        self.kb_service = KnowledgeBaseService(self.vector_db)
        
        # 初始化本地AI服务
        try:
            self.ai_service = LocalAIService()
        except Exception as e:
            logger.error(f"本地AI模型初始化失败: {e}")
            raise
    
    def query_knowledge_base(self, query: str, category: str = "", top_k: int = 3) -> List[Dict[str, Any]]:
        """
        查询知识库
        
        Args:
            query: 查询内容
            category: 知识类别
            top_k: 返回结果数量
            
        Returns:
            查询结果列表
        """
        if category:
            # 如果指定了类别，可以进一步过滤结果
            all_results = self.kb_service.search_knowledge(query, top_k * 2)  # 获取更多结果以供筛选
            filtered_results = [r for r in all_results if r.get('category', '').lower() == category.lower()]
            return filtered_results[:top_k] if filtered_results else all_results[:top_k]
        else:
            return self.kb_service.search_knowledge(query, top_k)
    
    def generate_response_with_knowledge(self, query: str, context: str = "") -> str:
        """
        基于知识库生成回答
        
        Args:
            query: 用户查询
            context: 对话上下文
            
        Returns:
            生成的回答
        """
        # 首先从知识库中检索相关信息
        knowledge_results = self.query_knowledge_base(query)
        
        if knowledge_results:
            # 构建包含知识库信息的提示
            knowledge_context = "\\n".join([
                f"参考信息{i+1}: {result['content']}" 
                for i, result in enumerate(knowledge_results)
            ])
            
            full_prompt = f"请基于以下参考信息回答问题:\\n\\n{knowledge_context}\\n\\n问题: {query}\\n回答:"
        else:
            # 如果没有找到相关知识，使用通用提示
            full_prompt = f"问题: {query}\\n回答:"
        
        # 如果有对话上下文，加入上下文
        if context:
            full_prompt = f"上下文: {context}\\n{full_prompt}"
        
        # 使用本地AI模型生成回答
        try:
            response = self.ai_service.generate_response_with_knowledge(query, max_length=512)
            return response
        except Exception as e:
            logger.error(f"本地AI服务生成回答失败: {e}")
            # 返回知识库中的信息
            if knowledge_results:
                return f"根据知识库信息：\\n\\n" + "\\n\\n".join([
                    f"• {result['title']}: {result['content'][:200]}..."
                    for result in knowledge_results
                ])
            else:
                return "抱歉，我无法找到相关信息来回答您的问题。"
    
    def chat_with_knowledge(self, messages: List[Dict[str, str]]) -> str:
        """
        基于知识库的对话
        
        Args:
            messages: 对话消息列表
            
        Returns:
            生成的回复
        """
        if not messages:
            return "请提出您的问题。"
        
        # 获取最新消息作为查询
        latest_message = messages[-1]
        if latest_message.get("role") == "user":
            query = latest_message.get("content", "")
        else:
            return "请提出您的问题。"
        
        # 获取对话上下文（除了最后一条消息）
        context_messages = messages[:-1] if len(messages) > 1 else []
        context = "\\n".join([f"{msg.get('role')}: {msg.get('content')}" for msg in context_messages])
        
        # 生成基于知识库的回复
        try:
            # 使用本地AI服务进行对话
            return self.ai_service.chat(messages)
        except Exception as e:
            logger.error(f"本地AI服务对话失败: {e}")
            # 回退到基于知识库的简单回复
            knowledge_results = self.query_knowledge_base(query)
            if knowledge_results:
                return f"根据知识库信息：\\n\\n" + "\\n\\n".join([
                    f"• {result['title']}: {result['content'][:200]}..."
                    for result in knowledge_results
                ])
            else:
                return "我暂时没有找到相关信息。您可以问我其他装修相关的问题。"
    
    def add_knowledge(self, content: str, category: str = "", subcategory: str = "", 
                     title: str = "", tags: List[str] = None, source: str = ""):
        """
        添加知识到知识库
        
        Args:
            content: 知识内容
            category: 类别
            subcategory: 子类别
            title: 标题
            tags: 标签列表
            source: 来源
        """
        self.kb_service.add_knowledge(content, category, subcategory, title, tags, source)
    
    def get_knowledge_stats(self) -> Dict[str, Any]:
        """获取知识库统计信息"""
        return self.kb_service.get_stats()


# 单例模式的全局服务实例（延迟初始化）
dialog_service = None

def get_dialog_service():
    """获取对话服务实例（延迟初始化）"""
    global dialog_service
    if dialog_service is None:
        dialog_service = KnowledgeEnhancedDialogService()
    return dialog_service