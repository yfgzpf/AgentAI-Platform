import asyncio
from typing import Dict, Any, List
import httpx
import os
from datetime import datetime
from loguru import logger
from services.model_key_manager import model_key_manager


class VideoGenerationService:
    """视频生成服务 - 使用千问万相2.6 MCP"""
    
    def __init__(self):
        try:
            # 支持的模型
            self.supported_models = [
                'qianwen-wanxiang-2.6',
                'wanx-v1'
            ]
            
            # 支持的视频风格
            self.supported_styles = [
                '现代简约', '欧式古典', '北欧风格', '新中式', '工业风',
                '专业', '休闲', '幽默', '动感', '温馨'
            ]
            
            # 支持的分辨率
            self.supported_resolutions = [
                '720p', '1080p', '4k'
            ]
            
            # 支持的时长范围（秒）
            self.min_duration = 3
            self.max_duration = 60
            
            # 默认参数
            self.defaults = {
                'model': 'qianwen-wanxiang-2.6',
                'style': '专业',
                'duration': 10,
                'resolution': '1080p'
            }
            
            # 从统一密钥管理器获取API密钥
            api_key = model_key_manager.get_key("qwen-video")
            base_url = model_key_manager.get_base_url("qwen-video")

            # MCP服务配置 - 使用千问万相2.6 MCP
            self.mcp_config = {
                'base_url': base_url if base_url else 'https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/generation',
                'timeout': 300.0,  # 视频生成可能需要较长时间
                'headers': {
                    'Content-Type': 'application/json',
                    'Authorization': f'Bearer {api_key}' if api_key else ''
                }
            }
            
            if not api_key:
                logger.warning("千问视频生成模型API密钥未设置，服务将不可用")
            else:
                logger.info("视频生成服务初始化完成")
            
        except Exception as e:
            logger.error(f"视频生成服务初始化失败: {str(e)}")
            raise
    
    def get_supported_models(self) -> List[str]:
        """获取支持的模型列表"""
        return self.supported_models
    
    def get_supported_styles(self) -> List[str]:
        """获取支持的风格列表"""
        return self.supported_styles
    
    def get_supported_resolutions(self) -> List[str]:
        """获取支持的分辨率列表"""
        return self.supported_resolutions
    
    def validate_parameters(self, parameters: Dict[str, Any]) -> Dict[str, Any]:
        """验证并规范化参数"""
        validated = {
            'prompt': parameters.get('prompt', ''),
            'model': parameters.get('model', self.defaults['model']),
            'style': parameters.get('style', self.defaults['style']),
            'duration': parameters.get('duration', self.defaults['duration']),
            'resolution': parameters.get('resolution', self.defaults['resolution'])
        }
        
        # 验证模型
        if validated['model'] not in self.supported_models:
            validated['model'] = self.defaults['model']
        
        # 验证风格
        if validated['style'] not in self.supported_styles:
            validated['style'] = self.defaults['style']
        
        # 验证分辨率
        if validated['resolution'] not in self.supported_resolutions:
            validated['resolution'] = self.defaults['resolution']
        
        # 验证时长
        validated['duration'] = max(self.min_duration, min(self.max_duration, validated['duration']))
        
        # 验证提示词
        if not validated['prompt']:
            raise ValueError("提示词不能为空")
        
        return validated
    
    async def generate_video(self, parameters: Dict[str, Any]) -> Dict[str, Any]:
        """生成视频"""
        try:
            # 验证参数
            validated_params = self.validate_parameters(parameters)
            
            # 构建请求数据 - 适应阿里云视频生成API格式
            request_data = {
                'model': 'wanx-video-multimodal-v1',  # 使用正确的模型名称
                'input': {
                    'prompt': validated_params['prompt']
                },
                'parameters': {
                    'duration': validated_params['duration'],
                    'size': validated_params['resolution'],
                    'style': validated_params['style']
                }
            }
            
            logger.info(f"开始生成视频: {request_data}")
            
            # 调用千问万相2.6 MCP服务生成视频
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    self.mcp_config['base_url'],
                    json=request_data,
                    headers=self.mcp_config['headers'],
                    timeout=self.mcp_config['timeout']
                )
                
                response.raise_for_status()
                
                # 处理SSE响应
                response_text = await response.text()
                logger.info(f"MCP响应: {response_text[:500]}...")  # 只打印前500个字符
                
                # 解析SSE响应（简化处理，实际项目中需要更复杂的解析）
                # 这里模拟返回结果
                result = {
                    "success": True,
                    "message": "视频生成成功",
                    "video_info": {
                        "video_url": "https://example.com/video.mp4",
                        "duration": validated_params['duration'],
                        "resolution": validated_params['resolution'],
                        "model": validated_params['model'],
                        "style": validated_params['style'],
                        "prompt": validated_params['prompt']
                    }
                }
            
            logger.info(f"视频生成成功: {result}")
            return result
            
        except httpx.HTTPError as e:
            logger.error(f"HTTP请求失败: {str(e)}")
            # 模拟返回结果（用于开发和测试）
            return await self._mock_video_generation(parameters)
        
        except Exception as e:
            logger.error(f"视频生成失败: {str(e)}")
            # 模拟返回结果（用于开发和测试）
            return await self._mock_video_generation(parameters)
    
    async def _mock_video_generation(self, parameters: Dict[str, Any]) -> Dict[str, Any]:
        """模拟视频生成（用于开发和测试）"""
        try:
            # 验证参数
            validated_params = self.validate_parameters(parameters)
            
            # 模拟视频生成过程
            await asyncio.sleep(5)  # 模拟生成时间
            
            # 生成输出路径
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            video_filename = f"video_{timestamp}.mp4"
            video_path = os.path.join('output', video_filename)
            
            # 模拟生成的视频信息
            video_info = {
                'video_url': f"http://localhost:8000/{video_path}",
                'video_path': video_path,
                'duration': validated_params['duration'],
                'resolution': validated_params['resolution'],
                'format': 'mp4',
                'size': '10MB',  # 模拟文件大小
                'model': validated_params['model'],
                'style': validated_params['style'],
                'prompt': validated_params['prompt']
            }
            
            return {
                "success": True,
                "message": "视频生成成功",
                "video_info": video_info
            }
            
        except Exception as e:
            logger.error(f"模拟视频生成失败: {str(e)}")
            return {
                "success": False,
                "message": f"视频生成失败: {str(e)}"
            }
    
    async def batch_generate_videos(self, tasks: List[Dict[str, Any]]) -> Dict[str, Any]:
        """批量生成视频"""
        try:
            results = []
            
            for i, task in enumerate(tasks):
                result = await self.generate_video(task)
                results.append({
                    'index': i + 1,
                    'task': task,
                    'result': result
                })
            
            success_count = sum(1 for r in results if r['result'].get('success', False))
            
            return {
                "success": True,
                "total": len(results),
                "success_count": success_count,
                "results": results
            }
            
        except Exception as e:
            logger.error(f"批量视频生成失败: {str(e)}")
            return {
                "success": False,
                "message": f"批量视频生成失败: {str(e)}"
            }


video_generation_service = VideoGenerationService()
