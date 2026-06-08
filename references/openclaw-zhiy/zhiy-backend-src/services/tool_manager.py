import asyncio
from typing import Dict, Any, Optional, List
from loguru import logger


class ToolManager:
    """工具管理器 - 管理本地和外部工具"""
    
    def __init__(self):
        # 工具注册
        self.tools = {
            'local': {
                'ocr': {
                    'name': '本地OCR工具',
                    'description': '使用本地OCR库识别图片中的文字',
                    'capabilities': ['text_recognition'],
                    'available': True
                },
                'image_editing': {
                    'name': '本地图像编辑工具',
                    'description': '使用本地库进行图像处理和编辑',
                    'capabilities': ['crop', 'resize', 'filter', 'rotate'],
                    'available': True
                },
                'file_operations': {
                    'name': '本地文件操作工具',
                    'description': '执行本地文件的创建、读取、更新和删除操作',
                    'capabilities': ['read', 'write', 'copy', 'delete'],
                    'available': True
                },
                'desktop_automation': {
                    'name': '本地桌面自动化工具',
                    'description': '执行本地桌面自动化操作',
                    'capabilities': ['open_app', 'close_app', 'click', 'type', 'screenshot'],
                    'available': True
                }
            },
            'external': {
                'qianwen_vl': {
                    'name': '千问VL模型',
                    'description': '使用千问VL模型进行图像识别和分析',
                    'capabilities': ['text_recognition', 'image_analysis', 'object_detection'],
                    'available': True,
                    'cost_per_use': 0.01  # 每次使用的成本（元）
                },
                'deepseek_chat': {
                    'name': 'DeepSeek对话模型',
                    'description': '使用DeepSeek模型进行对话和文本生成',
                    'capabilities': ['chat', 'text_generation', 'summarization', 'translation'],
                    'available': True,
                    'cost_per_use': 0.005  # 每次使用的成本（元）
                },
                'image_generation': {
                    'name': 'AI图像生成',
                    'description': '使用AI模型生成图像',
                    'capabilities': ['image_generation', 'style_transfer'],
                    'available': True,
                    'cost_per_use': 0.05  # 每次使用的成本（元）
                }
            }
        }
        
        # 工具使用历史
        self.tool_usage_history: List[Dict[str, Any]] = []
        
        # 工具执行缓存
        self.execution_cache: Dict[str, Any] = {}
        
        logger.info("工具管理器初始化完成")
    
    def get_available_tools(self, capability: Optional[str] = None) -> Dict[str, Any]:
        """获取可用的工具"""
        try:
            available_tools = {'local': [], 'external': []}
            
            # 收集本地工具
            for tool_name, tool_info in self.tools['local'].items():
                if tool_info['available']:
                    if not capability or capability in tool_info['capabilities']:
                        available_tools['local'].append({
                            'name': tool_name,
                            'info': tool_info
                        })
            
            # 收集外部工具
            for tool_name, tool_info in self.tools['external'].items():
                if tool_info['available']:
                    if not capability or capability in tool_info['capabilities']:
                        available_tools['external'].append({
                            'name': tool_name,
                            'info': tool_info
                        })
            
            return {
                "success": True,
                "tools": available_tools
            }
        except Exception as e:
            logger.error(f"获取可用工具失败: {str(e)}")
            return {
                "success": False,
                "message": f"获取可用工具失败: {str(e)}"
            }
    
    def select_best_tool(self, capability: str, requirements: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """选择最适合的工具"""
        try:
            # 优先选择本地工具
            for tool_name, tool_info in self.tools['local'].items():
                if tool_info['available'] and capability in tool_info['capabilities']:
                    # 检查是否满足额外要求
                    if self._check_tool_requirements(tool_info, requirements):
                        return {
                            "success": True,
                            "tool_type": "local",
                            "tool_name": tool_name,
                            "tool_info": tool_info
                        }
            
            # 如果没有合适的本地工具，选择外部工具
            best_external_tool = None
            lowest_cost = float('inf')
            
            for tool_name, tool_info in self.tools['external'].items():
                if tool_info['available'] and capability in tool_info['capabilities']:
                    # 检查是否满足额外要求
                    if self._check_tool_requirements(tool_info, requirements):
                        # 选择成本最低的外部工具
                        cost = tool_info.get('cost_per_use', 0)
                        if cost < lowest_cost:
                            lowest_cost = cost
                            best_external_tool = {
                                "tool_name": tool_name,
                                "tool_info": tool_info
                            }
            
            if best_external_tool:
                return {
                    "success": True,
                    "tool_type": "external",
                    "tool_name": best_external_tool['tool_name'],
                    "tool_info": best_external_tool['tool_info']
                }
            
            return {
                "success": False,
                "message": f"没有可用的工具满足能力要求: {capability}"
            }
        except Exception as e:
            logger.error(f"选择工具失败: {str(e)}")
            return {
                "success": False,
                "message": f"选择工具失败: {str(e)}"
            }
    
    def _check_tool_requirements(self, tool_info: Dict[str, Any], requirements: Optional[Dict[str, Any]]) -> bool:
        """检查工具是否满足额外要求"""
        if not requirements:
            return True
        
        # 检查特定要求
        if 'accuracy' in requirements:
            required_accuracy = requirements['accuracy']
            tool_accuracy = tool_info.get('accuracy', 0.8)
            if tool_accuracy < required_accuracy:
                return False
        
        if 'speed' in requirements:
            required_speed = requirements['speed']
            tool_speed = tool_info.get('speed', 'medium')
            speed_levels = {'fast': 3, 'medium': 2, 'slow': 1}
            if speed_levels.get(tool_speed, 2) < speed_levels.get(required_speed, 2):
                return False
        
        if 'features' in requirements:
            required_features = requirements['features']
            tool_features = tool_info.get('capabilities', [])
            for feature in required_features:
                if feature not in tool_features:
                    return False
        
        return True
    
    async def execute_tool(self, tool_type: str, tool_name: str, parameters: Dict[str, Any]) -> Dict[str, Any]:
        """执行工具"""
        try:
            # 参数验证
            if not tool_type:
                return {
                    "success": False,
                    "message": "请提供工具类型"
                }
            if not tool_name:
                return {
                    "success": False,
                    "message": "请提供工具名称"
                }
            if parameters is None:
                parameters = {}
            
            # 生成缓存键
            cache_key = f"{tool_type}:{tool_name}:{str(sorted(parameters.items()))}"
            
            # 检查缓存
            if cache_key in self.execution_cache:
                logger.debug(f"使用缓存的工具执行结果: {cache_key}")
                return {
                    "success": True,
                    "result": self.execution_cache[cache_key],
                    "from_cache": True
                }
            
            # 检查工具是否存在
            if tool_type not in self.tools or tool_name not in self.tools[tool_type]:
                return {
                    "success": False,
                    "message": f"工具不存在: {tool_type}:{tool_name}"
                }
            
            tool_info = self.tools[tool_type][tool_name]
            
            # 检查工具是否可用
            if not tool_info['available']:
                return {
                    "success": False,
                    "message": f"工具不可用: {tool_name}"
                }
            
            # 执行工具
            result = await self._execute_tool_internal(tool_type, tool_name, parameters)
            
            # 记录工具使用
            self._record_tool_usage(tool_type, tool_name, parameters, result)
            
            # 缓存结果（仅缓存成功的结果）
            if result.get('success', False):
                self.execution_cache[cache_key] = result.get('result')
                # 限制缓存大小
                if len(self.execution_cache) > 100:
                    # 移除最早的缓存项
                    oldest_key = next(iter(self.execution_cache))
                    del self.execution_cache[oldest_key]
            
            return result
        except Exception as e:
            logger.error(f"执行工具失败: {str(e)}")
            return {
                "success": False,
                "message": f"执行工具失败: {str(e)}"
            }
    
    async def _execute_tool_internal(self, tool_type: str, tool_name: str, parameters: Dict[str, Any]) -> Dict[str, Any]:
        """内部执行工具的方法"""
        # 模拟工具执行
        await asyncio.sleep(0.5)  # 模拟执行时间
        
        if tool_type == 'local':
            if tool_name == 'ocr':
                return {
                    "success": True,
                    "result": {
                        "text": "本地OCR识别结果",
                        "confidence": 0.85,
                        "regions": []
                    }
                }
            elif tool_name == 'image_editing':
                return {
                    "success": True,
                    "result": {
                        "status": "success",
                        "message": "图像处理完成",
                        "output_path": f"processed_{parameters.get('input_path', 'image')}"
                    }
                }
            elif tool_name == 'file_operations':
                return {
                    "success": True,
                    "result": {
                        "status": "success",
                        "message": "文件操作完成"
                    }
                }
            elif tool_name == 'desktop_automation':
                return {
                    "success": True,
                    "result": {
                        "status": "success",
                        "message": "桌面自动化操作完成"
                    }
                }
        
        elif tool_type == 'external':
            if tool_name == 'qianwen_vl':
                return {
                    "success": True,
                    "result": {
                        "text": "千问VL模型识别结果",
                        "confidence": 0.95,
                        "analysis": "图像分析结果"
                    }
                }
            elif tool_name == 'deepseek_chat':
                return {
                    "success": True,
                    "result": {
                        "text": "DeepSeek模型生成的文本"
                    }
                }
            elif tool_name == 'image_generation':
                return {
                    "success": True,
                    "result": {
                        "image_url": f"https://example.com/generated_{parameters.get('prompt', 'image')}.png"
                    }
                }
        
        return {
            "success": False,
            "message": f"未知的工具: {tool_type}:{tool_name}"
        }
    
    def _record_tool_usage(self, tool_type: str, tool_name: str, parameters: Dict[str, Any], result: Dict[str, Any]):
        """记录工具使用情况"""
        usage_record = {
            "tool_type": tool_type,
            "tool_name": tool_name,
            "parameters": parameters,
            "result": result,
            "timestamp": asyncio.get_event_loop().time(),
            "success": result.get('success', False)
        }
        
        self.tool_usage_history.append(usage_record)
        
        # 限制历史记录大小
        if len(self.tool_usage_history) > 1000:
            self.tool_usage_history = self.tool_usage_history[-1000:]
        
        logger.debug(f"记录工具使用: {tool_type}:{tool_name} - {'成功' if result.get('success', False) else '失败'}")
    
    def get_tool_usage_statistics(self, time_period: Optional[int] = None) -> Dict[str, Any]:
        """获取工具使用统计信息"""
        try:
            statistics = {
                'total_usage': len(self.tool_usage_history),
                'successful_usage': sum(1 for record in self.tool_usage_history if record['success']),
                'failed_usage': sum(1 for record in self.tool_usage_history if not record['success']),
                'tool_type_breakdown': {
                    'local': sum(1 for record in self.tool_usage_history if record['tool_type'] == 'local'),
                    'external': sum(1 for record in self.tool_usage_history if record['tool_type'] == 'external')
                },
                'tool_breakdown': {}
            }
            
            # 按工具名称统计
            for record in self.tool_usage_history:
                tool_key = f"{record['tool_type']}:{record['tool_name']}"
                if tool_key not in statistics['tool_breakdown']:
                    statistics['tool_breakdown'][tool_key] = 0
                statistics['tool_breakdown'][tool_key] += 1
            
            # 计算成功率
            if statistics['total_usage'] > 0:
                statistics['success_rate'] = statistics['successful_usage'] / statistics['total_usage'] * 100
            else:
                statistics['success_rate'] = 0
            
            # 计算成本（如果有）
            total_cost = 0
            for record in self.tool_usage_history:
                if record['tool_type'] == 'external':
                    tool_info = self.tools.get('external', {}).get(record['tool_name'], {})
                    cost_per_use = tool_info.get('cost_per_use', 0)
                    total_cost += cost_per_use
            
            statistics['estimated_cost'] = total_cost
            
            return {
                "success": True,
                "statistics": statistics
            }
        except Exception as e:
            logger.error(f"获取工具使用统计信息失败: {str(e)}")
            return {
                "success": False,
                "message": f"获取工具使用统计信息失败: {str(e)}"
            }
    
    def update_tool_availability(self, tool_type: str, tool_name: str, available: bool):
        """更新工具的可用性"""
        try:
            if tool_type in self.tools and tool_name in self.tools[tool_type]:
                self.tools[tool_type][tool_name]['available'] = available
                logger.info(f"更新工具可用性: {tool_type}:{tool_name} - {'可用' if available else '不可用'}")
                return {
                    "success": True,
                    "message": f"工具可用性更新成功: {tool_type}:{tool_name} - {'可用' if available else '不可用'}"
                }
            else:
                return {
                    "success": False,
                    "message": f"工具不存在: {tool_type}:{tool_name}"
                }
        except Exception as e:
            logger.error(f"更新工具可用性失败: {str(e)}")
            return {
                "success": False,
                "message": f"更新工具可用性失败: {str(e)}"
            }


# 创建全局工具管理器实例
tool_manager = ToolManager()