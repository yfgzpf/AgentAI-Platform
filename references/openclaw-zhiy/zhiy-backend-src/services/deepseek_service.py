import httpx
from typing import Dict, Any, List, Optional
from loguru import logger


class DeepSeekClient:
    def __init__(self, api_key: str, base_url: str = "https://api.deepseek.com"):
        self.api_key = api_key
        self.base_url = base_url
        self.client = httpx.Client(
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json"
            },
            timeout=60.0
        )
        logger.info("DeepSeek客户端初始化完成")
    
    def chat(
        self,
        messages: List[Dict[str, str]],
        model: str = "deepseek-chat",
        temperature: float = 0.7,
        max_tokens: Optional[int] = None,
        stream: bool = False,
        thinking: Optional[Dict[str, Any]] = None,
        tools: Optional[List[Dict[str, Any]]] = None
    ) -> Dict[str, Any]:
        """聊天对话"""
        try:
            url = f"{self.base_url}/v1/chat/completions"
            
            payload = {
                "model": model,
                "messages": messages,
                "temperature": temperature,
                "stream": stream
            }
            
            if max_tokens:
                payload["max_tokens"] = max_tokens
            
            if thinking:
                payload["thinking"] = thinking
            
            if tools:
                payload["tools"] = tools
            
            response = self.client.post(url, json=payload)
            response.raise_for_status()
            
            result = response.json()
            
            logger.info(f"DeepSeek调用成功，模型: {model}, 思考模式: {thinking is not None}")
            return result
            
        except Exception as e:
            logger.error(f"DeepSeek调用失败: {str(e)}")
            raise
    
    def generate_text(
        self,
        prompt: str,
        model: str = "deepseek-chat",
        temperature: float = 0.7,
        max_tokens: Optional[int] = None
    ) -> str:
        """生成文本"""
        messages = [
            {"role": "user", "content": prompt}
        ]
        
        result = self.chat(messages, model, temperature, max_tokens)
        
        return result["choices"][0]["message"]["content"]
    
    def analyze_requirements(
        self,
        requirements: str,
        context: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """分析装修需求"""
        prompt = f"""
        请分析以下装修需求，提取关键信息：
        
        需求描述：{requirements}
        
        请提取以下信息：
        1. 房间类型
        2. 设计风格
        3. 预算范围
        4. 时间要求
        5. 特殊需求
        6. 关键关注点
        
        以JSON格式返回结果。
        """
        
        if context:
            prompt += f"\n\n附加信息：{context}"
        
        response = self.generate_text(prompt, temperature=0.3)
        
        try:
            import json
            analysis = json.loads(response)
            return analysis
        except:
            return {
                "raw_response": response,
                "error": "无法解析JSON响应"
            }
    
    def generate_design_suggestion(
        self,
        analysis: Dict[str, Any]
    ) -> Dict[str, Any]:
        """生成设计建议"""
        prompt = f"""
        基于以下需求分析，生成装修设计建议：
        
        {analysis}
        
        请提供：
        1. 空间布局建议
        2. 色彩搭配方案
        3. 材料推荐
        4. 功能分区建议
        5. 灯光设计建议
        
        以JSON格式返回结果。
        """
        
        response = self.generate_text(prompt, temperature=0.7)
        
        try:
            import json
            suggestion = json.loads(response)
            return suggestion
        except:
            return {
                "raw_response": response,
                "error": "无法解析JSON响应"
            }
    
    def generate_material_recommendation(
        self,
        room_type: str,
        style: str,
        budget: str,
        requirements: List[str]
    ) -> List[Dict[str, Any]]:
        """生成材料推荐"""
        prompt = f"""
        为以下装修需求推荐材料：
        
        房间类型：{room_type}
        设计风格：{style}
        预算：{budget}
        特殊要求：{', '.join(requirements)}
        
        请推荐5-8种材料，每种材料包含：
        - 材料名称
        - 品牌
        - 规格
        - 价格范围
        - 优点
        - 适用场景
        
        以JSON数组格式返回结果。
        """
        
        response = self.generate_text(prompt, temperature=0.5)
        
        try:
            import json
            materials = json.loads(response)
            return materials
        except:
            return [{
                "raw_response": response,
                "error": "无法解析JSON响应"
            }]
    
    def generate_cost_estimate(
        self,
        area: int,
        room_type: str,
        style: str,
        quality: str
    ) -> Dict[str, Any]:
        """生成成本估算"""
        prompt = f"""
        为以下装修项目估算成本：
        
        面积：{area}平方米
        房间类型：{room_type}
        设计风格：{style}
        质量等级：{quality}
        
        请提供详细的成本估算，包括：
        1. 材料费
        2. 人工费
        3. 设计费
        4. 管理费
        5. 其他费用
        6. 总计
        
        以JSON格式返回结果。
        """
        
        response = self.generate_text(prompt, temperature=0.3)
        
        try:
            import json
            estimate = json.loads(response)
            return estimate
        except:
            return {
                "raw_response": response,
                "error": "无法解析JSON响应"
            }
    
    def generate_marketing_copy(
        self,
        product_name: str,
        features: List[str],
        target_audience: str
    ) -> str:
        """生成营销文案"""
        prompt = f"""
        为以下产品生成营销文案：
        
        产品名称：{product_name}
        产品特点：{', '.join(features)}
        目标客户：{target_audience}
        
        请生成：
        1. 产品标题（吸引人）
        2. 产品简介（100字左右）
        3. 产品亮点（3-5个）
        4. 营销口号
        
        文案风格：专业、有吸引力、突出产品优势
        """
        
        response = self.generate_text(prompt, temperature=0.8)
        return response
    
    def summarize_text(
        self,
        text: str,
        max_length: int = 200
    ) -> str:
        """文本摘要"""
        prompt = f"""
        请对以下文本进行摘要，字数控制在{max_length}字以内：
        
        {text}
        """
        
        summary = self.generate_text(prompt, temperature=0.3)
        return summary
    
    def translate_text(
        self,
        text: str,
        target_language: str = "中文"
    ) -> str:
        """文本翻译"""
        prompt = f"""
        请将以下文本翻译成{target_language}：
        
        {text}
        """
        
        translation = self.generate_text(prompt, temperature=0.3)
        return translation
    
    def close(self):
        """关闭客户端"""
        self.client.close()
        logger.info("DeepSeek客户端已关闭")
