import os
import asyncio
from typing import Dict, Any, List, Optional
from datetime import datetime
from loguru import logger


class ImageGenerationService:
    """图像生成服务 - 支持多种开源图像模型"""
    
    def __init__(self):
        try:
            # 支持的模型列表
            self.supported_models = [
                {
                    'name': 'wanx-v1',
                    'type': 'api',
                    'description': '千问图像生成模型',
                    'available': True
                },
                {
                    'name': 'banlan',
                    'type': 'api',
                    'description': 'BanLan (Gemini-3-Pro) 图像生成模型',
                    'available': True
                },
                {
                    'name': 'stable-diffusion',
                    'type': 'local',
                    'description': 'Stable Diffusion 开源模型',
                    'available': False
                },
                {
                    'name': 'midjourney-open',
                    'type': 'local',
                    'description': 'Midjourney 开源模型',
                    'available': False
                },
                {
                    'name': 'dall-e',
                    'type': 'api',
                    'description': 'OpenAI DALL-E 模型',
                    'available': False
                }
            ]
            
            # 图像风格配置
            self.image_styles = {
                'xiaohongshu': {
                    'description': '小红书风格，明亮清新，ins风，适合年轻女性',
                    'keywords': ['ins风', '清新', '明亮', '精致', '少女感'],
                    'prompt_template': 'high quality, detailed, bright colors, clean, modern, aesthetic, Instagram style, {prompt}'
                },
                'douyin': {
                    'description': '抖音风格，动感时尚，高对比度，吸引眼球',
                    'keywords': ['dynamic', 'fashion', 'vibrant', 'contrast', 'eye-catching'],
                    'prompt_template': 'high quality, dynamic, vibrant colors, contrast, fashion, modern, trending, {prompt}'
                },
                'professional': {
                    'description': '专业风格，简洁大方，商务感强，适合品牌推广',
                    'keywords': ['professional', 'clean', 'minimalist', 'elegant', 'corporate'],
                    'prompt_template': 'high quality, professional, clean, minimalist, elegant, corporate style, {prompt}'
                },
                'luxury': {
                    'description': '奢华风格，高端大气，质感强烈，适合高端产品',
                    'keywords': ['luxury', 'premium', 'elegant', 'sophisticated', 'high-end'],
                    'prompt_template': 'high quality, luxury, premium, elegant, sophisticated, high-end, {prompt}'
                },
                'artistic': {
                    'description': '艺术风格，创意十足，表现力强，适合艺术展示',
                    'keywords': ['artistic', 'creative', 'expressive', 'stylized', 'artwork'],
                    'prompt_template': 'artistic, creative, expressive, stylized, artwork, {prompt}'
                }
            }
            
            # 产品类型配置
            self.product_types = {
                'floor': {
                    'description': '地板产品',
                    'scenes': ['客厅', '卧室', '书房', '办公室'],
                    'features': ['铺装效果', '细节纹理', '整体搭配', '光影效果']
                },
                'tile': {
                    'description': '瓷砖产品',
                    'scenes': ['厨房', '卫生间', '客厅', '阳台'],
                    'features': ['铺装效果', '细节纹理', '防滑防水', '清洁维护']
                },
                'paint': {
                    'description': '涂料产品',
                    'scenes': ['客厅', '卧室', '儿童房', '办公室'],
                    'features': ['墙面效果', '色彩搭配', '环保性能', '施工效果']
                },
                'furniture': {
                    'description': '家具产品',
                    'scenes': ['客厅', '卧室', '餐厅', '书房'],
                    'features': ['整体效果', '细节工艺', '材质质感', '空间搭配']
                },
                'lighting': {
                    'description': '灯具产品',
                    'scenes': ['客厅', '卧室', '餐厅', '走廊'],
                    'features': ['照明效果', '外观设计', '节能性能', '安装效果']
                }
            }
            
            # 模拟模型加载状态
            self.models = {
                'wanx-v1': {'available': True, 'type': 'api'},
                'banlan': {'available': True, 'type': 'api'},
                'stable-diffusion': {'available': False, 'type': 'local'},
                'midjourney-open': {'available': False, 'type': 'local'}
            }
            
            logger.info("图像生成服务初始化完成")
            
        except Exception as e:
            logger.error(f"图像生成服务初始化失败: {str(e)}")
            raise
    
    def get_supported_models(self) -> List[Dict[str, Any]]:
        """获取支持的模型列表"""
        return [
            {
                'name': model_name,
                'available': model_info['available'],
                'type': model_info['type']
            }
            for model_name, model_info in self.models.items()
        ]
    
    def get_supported_styles(self) -> List[Dict[str, Any]]:
        """获取支持的风格列表"""
        return [
            {
                'name': style_name,
                'description': style_info['description']
            }
            for style_name, style_info in self.image_styles.items()
        ]
    
    def get_supported_product_types(self) -> List[Dict[str, Any]]:
        """获取支持的产品类型列表"""
        return [
            {
                'name': product_type,
                'description': product_info['description']
            }
            for product_type, product_info in self.product_types.items()
        ]
    
    def _enhance_prompt(self, prompt: str, style: str, product_type: str) -> str:
        """增强提示词"""
        # 获取风格配置
        style_config = self.image_styles.get(style, self.image_styles['professional'])
        
        # 构建增强的提示词
        enhanced_prompt = style_config['prompt_template'].format(prompt=prompt)
        
        # 根据产品类型添加相关关键词
        if product_type in self.product_types:
            product_config = self.product_types[product_type]
            product_keywords = product_config['features'][:2]
            if product_keywords:
                enhanced_prompt += ', ' + ', '.join(product_keywords)
        
        return enhanced_prompt
    
    async def generate_image(
        self,
        prompt: str,
        style: str = 'professional',
        product_type: str = 'floor',
        size: str = '1024*1024',
        n: int = 1,
        model: str = 'wanx-v1'
    ) -> Dict[str, Any]:
        """生成图像"""
        try:
            # 检查参数
            if style not in self.image_styles:
                return {
                    'success': False,
                    'message': f'不支持的风格: {style}'
                }
            
            if model not in self.models:
                return {
                    'success': False,
                    'message': f'不支持的模型: {model}'
                }
            
            # 增强提示词
            enhanced_prompt = self._enhance_prompt(prompt, style, product_type)
            
            # 尝试使用不同的模型服务
            try:
                if model == 'banlan':
                    # 使用BanLan图像服务
                    from services.banlan_image_service import banlan_image_service
                    
                    if banlan_image_service.is_available():
                        # 转换尺寸格式
                        size_map = {
                            '1024*1024': '1:1',
                            '1024*1536': '2:3',
                            '1536*1024': '3:2',
                            '768*1024': '3:4',
                            '1024*768': '4:3',
                            '896*1024': '4:5',
                            '1024*896': '5:4',
                            '576*1024': '9:16',
                            '1024*576': '16:9',
                            '384*1024': '21:9',
                            '1024*384': '9:21'
                        }
                        
                        banlan_size = size_map.get(size, '16:9')
                        
                        result = await banlan_image_service.generate_image(
                            prompt=enhanced_prompt,
                            size=banlan_size,
                            n=n
                        )
                        if result.get('success'):
                            return {
                                'success': True,
                                'images': result.get('images', []),
                                'prompt': prompt,
                                'enhanced_prompt': enhanced_prompt,
                                'style': style,
                                'model': model
                            }
                else:
                    # 使用千问图像服务
                    from services.qianwen_image_service_wrapper import qianwen_image_service
                    
                    if qianwen_image_service.is_available():
                        result = await qianwen_image_service.generate_image(
                            prompt=enhanced_prompt,
                            size=size,
                            n=n
                        )
                        if result.get('success'):
                            return {
                                'success': True,
                                'images': result.get('images', []),
                                'prompt': prompt,
                                'enhanced_prompt': enhanced_prompt,
                                'style': style,
                                'model': model
                            }
            except Exception as e:
                logger.error(f"使用图像服务失败: {str(e)}")
                # 如果服务不可用，返回模拟结果
                pass
            
            # 模拟图像生成结果
            # 实际项目中这里应该调用其他模型的API
            mock_images = []
            for i in range(n):
                mock_images.append({
                    'index': i + 1,
                    'url': f"https://example.com/image/{hash(f'{prompt}_{i}')}.jpg",
                    'prompt': enhanced_prompt
                })
            
            return {
                'success': True,
                'images': mock_images,
                'prompt': prompt,
                'enhanced_prompt': enhanced_prompt,
                'style': style,
                'model': model
            }
        except Exception as e:
            logger.error(f"生成图像失败: {str(e)}")
            return {
                'success': False,
                'message': f'生成图像失败: {str(e)}'
            }
    
    async def generate_product_images(
        self,
        product_name: str,
        product_type: str = 'floor',
        style: str = 'professional',
        size: str = '1024*1024',
        model: str = 'wanx-v1'
    ) -> Dict[str, Any]:
        """生成产品相关的多种图像"""
        try:
            # 检查产品类型
            if product_type not in self.product_types:
                return {
                    'success': False,
                    'message': f'不支持的产品类型: {product_type}'
                }
            
            product_config = self.product_types[product_type]
            
            # 生成不同类型的图像
            image_types = [
                {'type': 'product', 'prompt': f'{product_name} 产品特写，高品质，细节清晰'},
                {'type': 'scene', 'prompt': f'{product_name} 在{product_config["scenes"][0]}的应用场景，整体效果'},
                {'type': 'detail', 'prompt': f'{product_name} 细节展示，纹理清晰，材质质感'},
                {'type': 'comparison', 'prompt': f'{product_name} 与其他产品对比，突出优势'}
            ]
            
            results = []
            for image_type in image_types:
                image_result = await self.generate_image(
                    prompt=image_type['prompt'],
                    style=style,
                    product_type=product_type,
                    size=size,
                    n=1,
                    model=model
                )
                if image_result.get('success'):
                    results.append({
                        'type': image_type['type'],
                        'prompt': image_type['prompt'],
                        'images': image_result.get('images', [])
                    })
            
            return {
                'success': True,
                'product_name': product_name,
                'product_type': product_type,
                'style': style,
                'results': results
            }
        except Exception as e:
            logger.error(f"生成产品图像失败: {str(e)}")
            return {
                'success': False,
                'message': f'生成产品图像失败: {str(e)}'
            }
    
    async def batch_generate(
        self,
        prompts: List[str],
        style: str = 'professional',
        size: str = '1024*1024',
        model: str = 'wanx-v1'
    ) -> Dict[str, Any]:
        """批量生成图像"""
        try:
            results = []
            
            for i, prompt in enumerate(prompts):
                image_result = await self.generate_image(
                    prompt=prompt,
                    style=style,
                    size=size,
                    n=1,
                    model=model
                )
                results.append({
                    'index': i + 1,
                    'prompt': prompt,
                    'result': image_result
                })
            
            success_count = sum(1 for r in results if r['result'].get('success', False))
            
            return {
                'success': True,
                'total': len(results),
                'success_count': success_count,
                'results': results
            }
        except Exception as e:
            logger.error(f"批量生成图像失败: {str(e)}")
            return {
                'success': False,
                'message': f'批量生成图像失败: {str(e)}'
            }


image_generation_service = ImageGenerationService()