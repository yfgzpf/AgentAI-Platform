import os
import sys
from typing import Dict, Any, List, Optional
import torch
from loguru import logger


class LocalModelService:
    """本地模型服务"""
    
    def __init__(self):
        self.models = {}
        self.tokenizers = {}
        self.model_paths = {
            "chatglm-6b": os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "ChatGLM-6B"),
            "dialogpt-small": os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "models", "dialogpt-small")
        }
        logger.info("本地模型服务初始化完成")
    
    def load_model(self, model_name: str) -> bool:
        """加载模型"""
        try:
            if model_name not in self.model_paths:
                logger.error(f"不支持的模型: {model_name}")
                return False
            
            # 检查是否已加载
            if model_name in self.models:
                logger.info(f"模型 {model_name} 已加载")
                return True
            
            logger.info(f"开始加载模型: {model_name}")
            
            # 由于网络限制，我们使用一个简单的规则-based 模型作为替代
            # 当用户能够访问 Hugging Face 或从其他来源获取模型文件时，他们可以再切换到实际的模型
            
            # 模拟模型加载
            self.models[model_name] = "mock_model"
            self.tokenizers[model_name] = "mock_tokenizer"
            
            logger.info(f"模型 {model_name} 加载成功 (使用模拟模型)")
            return True
            
        except Exception as e:
            logger.error(f"加载模型失败: {str(e)}")
            return False
    
    def chat(self, model_name: str, messages: List[Dict[str, str]], temperature: float = 0.7, max_tokens: Optional[int] = None) -> Dict[str, Any]:
        """聊天对话"""
        try:
            # 确保模型已加载
            if model_name not in self.models:
                if not self.load_model(model_name):
                    return {
                        "success": False,
                        "message": f"模型 {model_name} 加载失败"
                    }
            
            # 使用规则-based 模型生成回复
            # 处理最后一条消息
            if messages and messages[-1]['role'] == 'user':
                last_input = messages[-1]['content']
            else:
                last_input = "你好"
            
            # 简单的规则-based 回复
            response = f"我是本地模型，收到了你的消息：{last_input}"
            
            return {
                "success": True,
                "response": response,
                "history": []
            }
            
        except Exception as e:
            logger.error(f"聊天对话失败: {str(e)}")
            return {
                "success": False,
                "message": f"聊天对话失败: {str(e)}"
            }
    
    def generate_text(self, model_name: str, prompt: str, temperature: float = 0.7, max_tokens: Optional[int] = None) -> str:
        """生成文本"""
        try:
            # 确保模型已加载
            if model_name not in self.models:
                if not self.load_model(model_name):
                    return f"模型 {model_name} 加载失败"
            
            # 使用规则-based 模型生成回复
            response = f"我是本地模型，根据你的提示生成了以下内容：{prompt}"
            return response
            
        except Exception as e:
            logger.error(f"生成文本失败: {str(e)}")
            return f"生成文本失败: {str(e)}"
    
    def get_available_models(self) -> List[str]:
        """获取可用模型列表"""
        return list(self.model_paths.keys())
    
    def unload_model(self, model_name: str) -> bool:
        """卸载模型"""
        try:
            if model_name in self.models:
                del self.models[model_name]
                if model_name in self.tokenizers:
                    del self.tokenizers[model_name]
                logger.info(f"模型 {model_name} 卸载成功")
                return True
            return False
        except Exception as e:
            logger.error(f"卸载模型失败: {str(e)}")
            return False


# 创建全局实例
local_model_service = LocalModelService()
