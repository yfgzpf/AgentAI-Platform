"""
轻量级模型服务（外部API模式）
使用外部API模型替代本地模型，避免模型加载和下载
"""

import os
import sys
import json
import re
from typing import Dict, Any, List, Optional
from loguru import logger

# 导入模型配置
try:
    from config.model_config import MODEL_CONFIGS, DEFAULT_MODEL, DOWNLOAD_CONFIG, INFERENCE_CONFIG, CACHE_CONFIG
    logger.info("成功加载模型配置文件")
except ImportError as e:
    logger.warning(f"无法加载模型配置文件，使用默认配置: {str(e)}")
    MODEL_CONFIGS = {}
    DEFAULT_MODEL = "qwen-1.8b"
    DOWNLOAD_CONFIG = {"auto_download": False, "download_timeout": 3600}
    INFERENCE_CONFIG = {"max_new_tokens": 512, "temperature": 0.7}
    CACHE_CONFIG = {"enable_cache": True}


class LightweightModelService:
    """轻量级模型服务（外部API模式）"""
    
    def __init__(self):
        self.device = "cpu"  # 外部API模式下不使用本地设备
        self.model_configs = {}
        
        # 移除所有本地模型配置，只保留外部API模型
        self.model_configs = {
            "external-api": {
                "name": "外部API模型",
                "description": "使用外部API模型提供服务，避免本地模型加载",
                "requires_gpu": False,
                "memory_gb": 0,
                "max_length": 2048,
                "temperature": 0.7,
                "top_p": 0.9,
                "do_sample": True
            }
        }
        
        self.default_model = "external-api"

        logger.info(f"轻量级模型服务（外部API模式）初始化完成，默认模型: {self.default_model}")

    def _preload_common_models(self):
        """预加载模型（外部API模式下无需预加载）"""
        logger.info("外部API模式下无需预加载模型")
    
    def load_model(self, model_name: str, lora_path: Optional[str] = None) -> bool:
        """
        加载模型（外部API模式下模拟加载）
        
        Args:
            model_name: 模型名称
            lora_path: LoRA权重路径（可选，外部API模式下忽略）
        
        Returns:
            是否加载成功
        """
        try:
            if model_name not in self.model_configs:
                logger.error(f"不支持的模型: {model_name}")
                return False
            
            logger.info(f"外部API模式: 模拟加载模型 {model_name}")
            logger.info("使用外部API模型，避免本地模型加载和下载")
            
            return True
        except Exception as e:
            logger.error(f"加载模型失败: {str(e)}")
            return False
    
    def chat(self, model_name: str, messages: List[Dict[str, str]], temperature: Optional[float] = None, max_tokens: Optional[int] = None, lora_path: Optional[str] = None, tools: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
        """
        聊天对话（外部API模式）

        Args:
            model_name: 模型名称
            messages: 对话消息列表
            temperature: 温度参数（可选，默认使用配置文件中的值）
            max_tokens: 最大token数（可选，默认使用配置文件中的值）
            lora_path: LoRA权重路径（可选，外部API模式下忽略）
            tools: 工具列表（可选）

        Returns:
            对话响应
        """
        try:
            # 获取模型配置
            if model_name not in self.model_configs:
                return {
                    "success": False,
                    "message": f"不支持的模型: {model_name}"
                }

            config = self.model_configs[model_name]

            # 使用配置文件中的默认值
            temperature = temperature or config.get("temperature", INFERENCE_CONFIG.get("temperature", 0.7))
            max_tokens = max_tokens or config.get("max_length", INFERENCE_CONFIG.get("max_new_tokens", 128))

            logger.info(f"外部API模式: 处理聊天请求，模型: {model_name}")
            logger.info(f"消息数量: {len(messages)}")
            logger.info(f"参数: temperature={temperature}, max_tokens={max_tokens}")

            # 模拟外部API响应
            # 在实际应用中，这里应该调用真实的外部API
            response = "我是外部API模型的响应。由于您配置了使用外部API模型，本地模型已被禁用。"
            
            # 构建用户消息内容摘要
            user_messages = [msg for msg in messages if msg.get("role") == "user"]
            if user_messages:
                last_user_message = user_messages[-1].get("content", "").strip()
                if last_user_message:
                    response = f"您的请求: {last_user_message}\n\n我是外部API模型的响应。本地模型已被禁用，所有请求将通过外部API处理。"

            return {
                "success": True,
                "response": response,
                "model": model_name,
                "history": messages,
                "tool_calls": None,
                "raw_response": response
            }

        except Exception as e:
            logger.error(f"聊天对话失败: {str(e)}")
            return {
                "success": False,
                "message": f"聊天对话失败: {str(e)}"
            }
    
    def generate_text(self, model_name: str, prompt: str, temperature: Optional[float] = None, max_tokens: Optional[int] = None, lora_path: Optional[str] = None) -> str:
        """
        生成文本（外部API模式）

        Args:
            model_name: 模型名称
            prompt: 提示词
            temperature: 温度参数（可选，默认使用配置文件中的值）
            max_tokens: 最大token数（可选，默认使用配置文件中的值）
            lora_path: LoRA权重路径（可选，外部API模式下忽略）

        Returns:
            生成的文本
        """
        try:
            # 获取模型配置
            if model_name not in self.model_configs:
                return f"不支持的模型: {model_name}"

            config = self.model_configs[model_name]

            # 使用配置文件中的默认值
            temperature = temperature or config.get("temperature", INFERENCE_CONFIG.get("temperature", 0.7))
            max_tokens = max_tokens or config.get("max_length", INFERENCE_CONFIG.get("max_new_tokens", 512))

            logger.info(f"外部API模式: 处理文本生成请求，模型: {model_name}")
            logger.info(f"提示词长度: {len(prompt)}")
            logger.info(f"参数: temperature={temperature}, max_tokens={max_tokens}")

            # 模拟外部API响应
            # 在实际应用中，这里应该调用真实的外部API
            response = f"外部API模型响应:\n\n提示词: {prompt[:100]}...\n\n本地模型已被禁用，所有文本生成请求将通过外部API处理。"

            return response

        except Exception as e:
            logger.error(f"生成文本失败: {str(e)}")
            return f"生成文本失败: {str(e)}"
    
    def get_available_models(self) -> List[Dict[str, Any]]:
        """
        获取可用模型列表
        
        Returns:
            模型配置列表
        """
        return [
            {
                "name": model_name,
                "description": config["description"],
                "requires_gpu": config["requires_gpu"],
                "memory_gb": config["memory_gb"],
                "loaded": True  # 外部API模式下所有模型都视为已加载
            }
            for model_name, config in self.model_configs.items()
        ]
    
    def unload_model(self, model_name: str, lora_path: Optional[str] = None) -> bool:
        """
        卸载模型（外部API模式下模拟卸载）
        
        Args:
            model_name: 模型名称
            lora_path: LoRA权重路径（可选，外部API模式下忽略）
        
        Returns:
            是否卸载成功
        """
        try:
            logger.info(f"外部API模式: 模拟卸载模型 {model_name}")
            logger.info("外部API模式下无需实际卸载模型")
            return True
        except Exception as e:
            logger.error(f"卸载模型失败: {str(e)}")
            return False
    
    def get_model_info(self, model_name: str, lora_path: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """
        获取模型信息
        
        Args:
            model_name: 模型名称
            lora_path: LoRA权重路径（可选，外部API模式下忽略）
        
        Returns:
            模型配置信息
        """
        if model_name in self.model_configs:
            return {
                "name": self.model_configs[model_name]["name"],
                "description": self.model_configs[model_name]["description"],
                "requires_gpu": self.model_configs[model_name]["requires_gpu"],
                "memory_gb": self.model_configs[model_name]["memory_gb"],
                "loaded": True,  # 外部API模式下所有模型都视为已加载
                "lora_path": lora_path,
                "lora_available": False  # 外部API模式下不支持LoRA
            }
        return None


# 创建全局实例
lightweight_model_service = LightweightModelService()
