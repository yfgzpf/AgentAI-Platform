import asyncio
import os
from typing import Dict, Any, List, Optional
from datetime import datetime
from loguru import logger

try:
    from services.deepseek_service_wrapper import deepseek_service
    DEEPSEEK_AVAILABLE = True
except ImportError:
    DEEPSEEK_AVAILABLE = False
    logger.warning("DeepSeek服务未可用")

try:
    from services.qianwen_image_service_wrapper import qianwen_image_service
    QIANWEN_AVAILABLE = True
except ImportError:
    QIANWEN_AVAILABLE = False
    logger.warning("千问图像服务未可用")

try:
    from services.desktop_automation import desktop_automation_service
    DESKTOP_AUTOMATION_AVAILABLE = True
except ImportError:
    DESKTOP_AUTOMATION_AVAILABLE = False
    logger.warning("桌面自动化服务未可用")


class SocialMediaPromotion:
    """社交媒体推广服务"""
    
    def __init__(self):
        self.promotion_counter = 0
        self.supported_platforms = ['douyin', 'xiaohongshu', 'weibo', 'bilibili']
        
    async def generate_promotion_content(
        self,
        product_name: str,
        product_features: List[str],
        platform: str = 'xiaohongshu',
        style: str = 'professional'
    ) -> Dict[str, Any]:
        """生成推广内容（文案+配图）"""
        try:
            if platform not in self.supported_platforms:
                return {
                    "success": False,
                    "message": f"不支持的平台: {platform}"
                }
            
            self.promotion_counter += 1
            promotion_id = f"PR{datetime.now().strftime('%Y%m%d')}{self.promotion_counter:04d}"
            
            # 1. 使用DeepSeek生成文案
            copywriting = await self._generate_copywriting(
                product_name,
                product_features,
                platform,
                style
            )
            
            # 2. 使用千问生成配图
            images = await self._generate_promotion_images(
                product_name,
                platform,
                style
            )
            
            # 3. 生成视频（可选）
            video = None
            if platform in ['douyin', 'bilibili']:
                video = await self._generate_promotion_video(
                    product_name,
                    platform,
                    style
                )
            
            promotion_data = {
                'promotion_id': promotion_id,
                'platform': platform,
                'product_name': product_name,
                'copywriting': copywriting,
                'images': images,
                'video': video,
                'style': style,
                'created_at': datetime.now().isoformat()
            }
            
            logger.info(f"生成推广内容成功: {promotion_id}")
            
            return {
                "success": True,
                "promotion_data": promotion_data,
                "message": "推广内容生成成功"
            }
        except Exception as e:
            logger.error(f"生成推广内容失败: {str(e)}")
            return {
                "success": False,
                "message": f"生成推广内容失败: {str(e)}"
            }
    
    async def _generate_copywriting(
        self,
        product_name: str,
        product_features: List[str],
        platform: str,
        style: str
    ) -> str:
        """生成推广文案"""
        try:
            if not DEEPSEEK_AVAILABLE:
                return f"{product_name} - 高品质建材，值得信赖！"
            
            platform_styles = {
                'xiaohongshu': '小红书风格，包含emoji，适合年轻女性，突出生活美学',
                'douyin': '抖音风格，节奏明快，吸引眼球，适合短视频',
                'weibo': '微博风格，简洁有力，适合快速传播',
                'bilibili': 'B站风格，幽默风趣，适合年轻群体'
            }
            
            platform_style = platform_styles.get(platform, '专业风格')
            
            features_text = '\n'.join([f"• {feature}" for feature in product_features])
            
            prompt = f"""请为{product_name}生成一篇{platform}平台的推广文案。

产品特点：
{features_text}

风格要求：
{platform_style}
{style}风格

要求：
1. 标题吸引人，包含关键词
2. 正文简洁有力，突出卖点
3. 适当使用emoji表情
4. 包含行动号召（CTA）
5. 字数控制在200-300字

请直接输出文案内容，不要包含其他说明。"""
            
            response = await deepseek_service.chat(prompt)
            
            if response and 'content' in response:
                return response['content']
            else:
                return f"{product_name} - 高品质建材，值得信赖！"
        except Exception as e:
            logger.error(f"生成文案失败: {str(e)}")
            return f"{product_name} - 高品质建材，值得信赖！"
    
    async def _generate_promotion_images(
        self,
        product_name: str,
        platform: str,
        style: str
    ) -> List[str]:
        """生成推广配图"""
        try:
            if not QIANWEN_AVAILABLE:
                return []
            
            image_prompts = self._get_image_prompts(product_name, platform, style)
            images = []
            
            for i, prompt in enumerate(image_prompts):
                try:
                    image_result = await qianwen_image_service.generate_image(
                        prompt=prompt,
                        width=1024,
                        height=1024
                    )
                    
                    if image_result and 'image_url' in image_result:
                        images.append({
                            'index': i + 1,
                            'prompt': prompt,
                            'url': image_result['image_url']
                        })
                except Exception as e:
                    logger.error(f"生成图片{i+1}失败: {str(e)}")
            
            return images
        except Exception as e:
            logger.error(f"生成推广配图失败: {str(e)}")
            return []
    
    def _get_image_prompts(
        self,
        product_name: str,
        platform: str,
        style: str
    ) -> List[str]:
        """获取图像生成提示词"""
        base_prompts = [
            f"高质量{product_name}产品展示图，{style}风格，专业摄影，明亮光线，细节清晰",
            f"{product_name}应用场景图，{style}风格，室内设计，温馨舒适，真实感",
            f"{product_name}细节特写图，{style}风格，高清质感，材质纹理，专业展示"
        ]
        
        platform_specific = {
            'xiaohongshu': [
                f"{product_name}小红书风格，ins风，滤镜柔和，生活美学，精致细节",
                f"{product_name}小红书风格，ins风，滤镜柔和，生活美学，精致细节"
            ],
            'douyin': [
                f"{product_name}抖音风格，动感效果，吸引眼球，色彩鲜艳",
                f"{product_name}抖音风格，动感效果，吸引眼球，色彩鲜艳"
            ],
            'weibo': [
                f"{product_name}微博风格，简洁大方，专业展示，清晰明了"
            ],
            'bilibili': [
                f"{product_name}B站风格，二次元元素，年轻活力，创意设计"
            ]
        }
        
        return base_prompts + platform_specific.get(platform, [])
    
    async def _generate_promotion_video(
        self,
        product_name: str,
        platform: str,
        style: str
    ) -> Optional[Dict[str, Any]]:
        """生成推广视频"""
        try:
            if not QIANWEN_AVAILABLE:
                return None
            
            prompt = f"{product_name}产品展示视频，{style}风格，{platform}平台，专业制作"
            
            video_result = await qianwen_image_service.generate_video(
                prompt=prompt,
                duration=10
            )
            
            if video_result and 'video_url' in video_result:
                return {
                    'prompt': prompt,
                    'url': video_result['video_url'],
                    'duration': video_result.get('duration', 10)
                }
            
            return None
        except Exception as e:
            logger.error(f"生成推广视频失败: {str(e)}")
            return None
    
    async def publish_to_platform(
        self,
        platform: str,
        content: Dict[str, Any]
    ) -> Dict[str, Any]:
        """发布到社交媒体平台"""
        try:
            if not DESKTOP_AUTOMATION_AVAILABLE:
                return {
                    "success": False,
                    "message": "桌面自动化服务未可用"
                }
            
            platform_configs = {
                'douyin': {
                    'app_name': '抖音',
                    'action': 'open_application'
                },
                'xiaohongshu': {
                    'app_name': '小红书',
                    'action': 'open_application'
                },
                'weibo': {
                    'app_name': '微博',
                    'action': 'open_application'
                },
                'bilibili': {
                    'app_name': '哔哩哔哩',
                    'action': 'open_application'
                }
            }
            
            if platform not in platform_configs:
                return {
                    "success": False,
                    "message": f"不支持的平台: {platform}"
                }
            
            config = platform_configs[platform]
            
            # 1. 打开应用
            await desktop_automation_service.execute_desktop_action(
                config['action'],
                {'app_name': config['app_name']}
            )
            
            # 2. 模拟发布操作
            await asyncio.sleep(2)
            
            # 3. 输入文案
            copywriting = content.get('copywriting', '')
            await desktop_automation_service.execute_desktop_action(
                'type_text',
                {'text': copywriting}
            )
            
            # 4. 上传图片（如果有）
            images = content.get('images', [])
            if images:
                for image in images[:9]:  # 限制最多9张图片
                    await desktop_automation_service.execute_desktop_action(
                        'upload_image',
                        {'image_url': image['url']}
                    )
            
            # 5. 发布
            await desktop_automation_service.execute_desktop_action(
                'press_key',
                {'key': 'Enter'}
            )
            
            logger.info(f"发布到{platform}成功")
            
            return {
                "success": True,
                "platform": platform,
                "message": f"发布到{platform}成功"
            }
        except Exception as e:
            logger.error(f"发布到平台失败: {str(e)}")
            return {
                "success": False,
                "message": f"发布失败: {str(e)}"
            }
    
    async def batch_publish(
        self,
        platforms: List[str],
        content: Dict[str, Any]
    ) -> Dict[str, Any]:
        """批量发布到多个平台"""
        try:
            results = []
            
            for platform in platforms:
                if platform in self.supported_platforms:
                    result = await self.publish_to_platform(platform, content)
                    results.append(result)
            
            success_count = sum(1 for r in results if r.get('success', False))
            
            return {
                "success": True,
                "total": len(results),
                "success_count": success_count,
                "failed_count": len(results) - success_count,
                "results": results,
                "message": f"批量发布完成，成功{success_count}个，失败{len(results)-success_count}个"
            }
        except Exception as e:
            logger.error(f"批量发布失败: {str(e)}")
            return {
                "success": False,
                "message": f"批量发布失败: {str(e)}"
            }
    
    async def get_promotion_templates(
        self,
        product_type: str
    ) -> Dict[str, Any]:
        """获取推广模板"""
        try:
            templates = {
                'floor': {
                    'copywriting_templates': [
                        '🏠 打造完美家居，从地面开始！{product}让您的家更温馨舒适',
                        '✨ 高品质地板，品质生活从脚下开始！{product}值得拥有',
                        '🌟 选择{product}，选择品质生活！环保耐用，美观大方'
                    ],
                    'image_prompts': [
                        '地板铺装效果，温馨家居，明亮光线',
                        '地板细节展示，纹理清晰，质感上乘',
                        '地板应用场景，客厅卧室，整体协调'
                    ]
                },
                'tile': {
                    'copywriting_templates': [
                        '🎨 精美瓷砖，打造理想家居！{product}让空间更有质感',
                        '💎 高端瓷砖，品质生活从细节开始！{product}值得信赖',
                        '🌈 选择{product}，选择品质生活！防滑耐磨，美观实用'
                    ],
                    'image_prompts': [
                        '瓷砖铺装效果，现代简约，干净整洁',
                        '瓷砖细节展示，釉面光滑，色彩均匀',
                        '瓷砖应用场景，厨房卫生间，防水防滑'
                    ]
                },
                'paint': {
                    'copywriting_templates': [
                        '🎨 环保涂料，健康生活从墙面开始！{product}让家更温馨',
                        '🌿 绿色涂料，品质生活从细节开始！{product}值得信赖',
                        '🌸 选择{product}，选择品质生活！无毒无味，色彩持久'
                    ],
                    'image_prompts': [
                        '墙面涂料效果，色彩柔和，质感细腻',
                        '涂料细节展示，遮盖力强，不易脱落',
                        '涂料应用场景，卧室客厅，温馨舒适'
                    ]
                }
            }
            
            return {
                "success": True,
                "product_type": product_type,
                "templates": templates.get(product_type, {})
            }
        except Exception as e:
            logger.error(f"获取推广模板失败: {str(e)}")
            return {
                "success": False,
                "message": f"获取推广模板失败: {str(e)}"
            }
    
    async def get_platform_stats(self) -> Dict[str, Any]:
        """获取平台统计信息"""
        return {
            "success": True,
            "supported_platforms": self.supported_platforms,
            "total_promotions": self.promotion_counter,
            "services": {
                "deepseek_available": DEEPSEEK_AVAILABLE,
                "qianwen_available": QIANWEN_AVAILABLE,
                "desktop_automation_available": DESKTOP_AUTOMATION_AVAILABLE
            }
        }


social_media_promotion = SocialMediaPromotion()
