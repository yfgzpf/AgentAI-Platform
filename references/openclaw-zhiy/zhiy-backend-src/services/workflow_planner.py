"""
工作流规划器
负责任务分析、计划制定、执行跟踪和文本总结
"""

import json
from typing import Dict, Any, List, Optional
from loguru import logger


class WorkflowPlanner:
    """工作流规划器"""
    
    def __init__(self):
        logger.info("工作流规划器初始化完成")
    
    def analyze_task(self, user_message: str) -> Dict[str, Any]:
        """
        分析用户任务
        
        Args:
            user_message: 用户消息
        
        Returns:
            任务分析结果
        """
        try:
            logger.info(f"分析用户任务: {user_message}")
            
            # 任务类型识别
            task_type = self._identify_task_type(user_message)
            
            # 任务复杂度评估
            complexity = self._evaluate_complexity(user_message)
            
            # 所需工具识别
            required_tools = self._identify_required_tools(user_message)
            
            analysis_result = {
                "intent": task_type,
                "complexity": complexity,
                "requires_agent": complexity == "complex",
                "requires_tool": len(required_tools) > 0,
                "suggested_agent": self._get_suggested_agent(task_type),
                "suggested_tools": required_tools,
                "confidence": self._calculate_confidence(user_message)
            }
            
            logger.info(f"任务分析结果: {analysis_result}")
            return analysis_result
            
        except Exception as e:
            logger.error(f"任务分析失败: {str(e)}")
            return {
                "intent": "general_chat",
                "complexity": "simple",
                "requires_agent": False,
                "requires_tool": False,
                "suggested_agent": "general",
                "suggested_tools": [],
                "confidence": 0.5
            }
    
    def create_plan(self, user_message: str, analysis: Dict[str, Any]) -> List[Dict[str, Any]]:
        """
        制定执行计划
        
        Args:
            user_message: 用户消息
            analysis: 任务分析结果
        
        Returns:
            执行计划步骤列表
        """
        try:
            logger.info(f"为任务制定执行计划: {user_message}")
            
            plan = []
            task_type = analysis.get("intent", "general_chat")
            complexity = analysis.get("complexity", "simple")
            required_tools = analysis.get("suggested_tools", [])
            
            # 步骤1: 确认任务理解
            plan.append({
                "step": 1,
                "description": "确认任务理解",
                "status": "pending",
                "details": f"分析用户请求: {user_message}"
            })
            
            # 步骤2: 确定处理策略
            plan.append({
                "step": 2,
                "description": "确定处理策略",
                "status": "pending",
                "details": f"任务类型: {task_type}, 复杂度: {complexity}"
            })
            
            # 步骤3: 执行核心任务
            if required_tools:
                for tool in required_tools:
                    plan.append({
                        "step": len(plan) + 1,
                        "description": f"执行工具: {tool}",
                        "status": "pending",
                        "details": f"使用{tool}工具完成核心任务"
                    })
            else:
                plan.append({
                    "step": 3,
                    "description": "执行任务",
                    "status": "pending",
                    "details": "根据任务类型执行相应操作"
                })
            
            # 步骤4: 验证执行结果
            plan.append({
                "step": len(plan) + 1,
                "description": "验证执行结果",
                "status": "pending",
                "details": "检查任务执行是否成功"
            })
            
            # 步骤5: 生成总结报告
            plan.append({
                "step": len(plan) + 1,
                "description": "生成总结报告",
                "status": "pending",
                "details": "汇总任务执行过程和结果"
            })
            
            logger.info(f"执行计划制定完成，共 {len(plan)} 个步骤")
            return plan
            
        except Exception as e:
            logger.error(f"制定执行计划失败: {str(e)}")
            return [
                {
                    "step": 1,
                    "description": "分析用户请求",
                    "status": "pending",
                    "details": f"分析用户请求: {user_message}"
                },
                {
                    "step": 2,
                    "description": "执行任务",
                    "status": "pending",
                    "details": "执行用户请求的任务"
                },
                {
                    "step": 3,
                    "description": "返回结果",
                    "status": "pending",
                    "details": "返回任务执行结果"
                }
            ]
    
    def track_execution(self, plan: List[Dict[str, Any]], step_index: int, status: str, details: str = "") -> List[Dict[str, Any]]:
        """
        跟踪执行过程
        
        Args:
            plan: 执行计划
            step_index: 当前执行步骤索引
            status: 执行状态 (pending, in_progress, success, failed)
            details: 执行详情
        
        Returns:
            更新后的执行计划
        """
        try:
            updated_plan = plan.copy()
            if 0 <= step_index < len(updated_plan):
                updated_plan[step_index]["status"] = status
                if details:
                    updated_plan[step_index]["details"] = details
                logger.info(f"更新执行计划步骤 {step_index + 1} 状态: {status}, 详情: {details}")
            return updated_plan
        except Exception as e:
            logger.error(f"跟踪执行过程失败: {str(e)}")
            return plan
    
    def generate_summary(self, user_message: str, plan: List[Dict[str, Any]], execution_result: Dict[str, Any]) -> str:
        """
        生成文本总结
        
        Args:
            user_message: 用户消息
            plan: 执行计划
            execution_result: 执行结果
        
        Returns:
            文本总结
        """
        try:
            logger.info(f"为任务生成文本总结: {user_message}")
            
            # 构建总结
            summary_parts = []
            
            # 任务概述
            summary_parts.append(f"# 任务执行总结")
            summary_parts.append(f"")
            summary_parts.append(f"## 任务概述")
            summary_parts.append(f"用户请求: {user_message}")
            summary_parts.append(f"")
            
            # 执行过程
            summary_parts.append(f"## 执行过程")
            for step in plan:
                status_emoji = "✓" if step.get("status") == "success" else "✗" if step.get("status") == "failed" else "⏳"
                summary_parts.append(f"{status_emoji} **步骤 {step.get('step')}: {step.get('description')}**")
                summary_parts.append(f"   - 状态: {step.get('status', 'pending')}")
                summary_parts.append(f"   - 详情: {step.get('details', '')}")
            summary_parts.append(f"")
            
            # 执行结果
            summary_parts.append(f"## 执行结果")
            if execution_result.get("success"):
                summary_parts.append(f"✅ **执行成功**")
                if execution_result.get("message"):
                    summary_parts.append(f"   - 结果: {execution_result.get('message')}")
                if execution_result.get("tool_result"):
                    tool_result = execution_result.get("tool_result")
                    if tool_result.get("success"):
                        summary_parts.append(f"   - 工具执行: 成功")
                        if tool_result.get("message"):
                            summary_parts.append(f"   - 工具消息: {tool_result.get('message')}")
                    else:
                        summary_parts.append(f"   - 工具执行: 失败")
                        if tool_result.get("message"):
                            summary_parts.append(f"   - 错误信息: {tool_result.get('message')}")
            else:
                summary_parts.append(f"❌ **执行失败**")
                if execution_result.get("message"):
                    summary_parts.append(f"   - 错误信息: {execution_result.get('message')}")
            summary_parts.append(f"")
            
            # 总结
            summary_parts.append(f"## 总结")
            if execution_result.get("success"):
                summary_parts.append(f"任务已成功完成，所有步骤均已执行完毕。")
            else:
                summary_parts.append(f"任务执行过程中遇到问题，部分步骤未能成功完成。")
            
            summary = "\n".join(summary_parts)
            logger.info("文本总结生成完成")
            return summary
            
        except Exception as e:
            logger.error(f"生成文本总结失败: {str(e)}")
            return f"# 任务执行总结\n\n## 任务概述\n用户请求: {user_message}\n\n## 执行结果\n任务执行过程中遇到错误，无法生成详细总结。"
    
    def _identify_task_type(self, user_message: str) -> str:
        """识别任务类型"""
        user_message_lower = user_message.lower()
        
        # 工具任务
        tool_keywords = [
            '播放', '音乐', '歌曲',
            '打开', '浏览器', '搜索',
            '截图', '屏幕',
            '通知', '提醒',
            '打开文件', '文件',
            '打开文件夹', '文件夹', '桌面', '我的电脑',
            '移动鼠标', '点击', '双击', '右键',
            '滚动', '拖拽', '输入',
            '时间', '日期'
        ]
        
        # 生成任务
        generation_keywords = [
            '生成', '图片', '图像', '效果图', '设计图',
            '视频', '动画', '报价单', '合同', '文档'
        ]
        
        # 识别任务
        recognition_keywords = [
            '识别', '手稿', '图纸', '照片', '户型'
        ]
        
        # 编辑任务
        editing_keywords = [
            '编辑', '修改', '调整', '优化', '重绘'
        ]
        
        # 对话任务
        chat_keywords = [
            '你好', '在吗', '早上好', '晚上好',
            '谢谢', '再见', '如何', '怎么', '为什么'
        ]
        
        if any(keyword in user_message_lower for keyword in tool_keywords):
            return "tool_operation"
        elif any(keyword in user_message_lower for keyword in generation_keywords):
            return "content_generation"
        elif any(keyword in user_message_lower for keyword in recognition_keywords):
            return "content_recognition"
        elif any(keyword in user_message_lower for keyword in editing_keywords):
            return "content_editing"
        elif any(keyword in user_message_lower for keyword in chat_keywords):
            return "general_chat"
        else:
            return "general_chat"
    
    def _evaluate_complexity(self, user_message: str) -> str:
        """评估任务复杂度"""
        user_message_lower = user_message.lower()
        
        # 复杂任务关键词
        complex_keywords = [
            '生成', '图片', '图像', '效果图', '设计图',
            '视频', '动画', '报价单', '合同', '文档',
            '识别', '手稿', '图纸', '照片', '户型',
            '编辑', '修改', '调整', '优化', '重绘',
            '在线设计', '3D'
        ]
        
        if any(keyword in user_message_lower for keyword in complex_keywords):
            return "complex"
        else:
            return "simple"
    
    def _identify_required_tools(self, user_message: str) -> List[str]:
        """识别所需工具"""
        user_message_lower = user_message.lower()
        required_tools = []
        
        # 工具映射
        tool_mappings = {
            'play_music': ['播放', '音乐', '歌曲'],
            'open_browser': ['打开', '浏览器', '网站', '访问', '网址'],
            'search_web': ['搜索', '查一下', '找一下', '百度', '谷歌'],
            'open_file': ['打开文件', '文件'],
            'open_folder': ['打开文件夹', '文件夹', '桌面', '我的电脑', '此电脑', '计算机'],
            'screenshot': ['截图', '截屏', '屏幕'],
            'send_notification': ['通知', '提醒'],
            'get_time': ['时间', '几点'],
            'get_date': ['日期', '几号']
        }
        
        for tool_id, keywords in tool_mappings.items():
            if any(keyword in user_message_lower for keyword in keywords):
                required_tools.append(tool_id)
        
        return required_tools
    
    def _get_suggested_agent(self, task_type: str) -> str:
        """获取推荐的智能体"""
        agent_mappings = {
            'tool_operation': 'tool_agent',
            'content_generation': 'image_generator',
            'content_recognition': 'recognition_agent',
            'content_editing': 'editing_agent',
            'general_chat': 'general'
        }
        return agent_mappings.get(task_type, 'general')
    
    def _calculate_confidence(self, user_message: str) -> float:
        """计算任务分析置信度"""
        # 简单的置信度计算，基于消息长度和关键词匹配
        message_length = len(user_message)
        if message_length < 5:
            return 0.6
        elif message_length < 20:
            return 0.8
        else:
            return 0.9


# 创建工作流规划器实例
workflow_planner = WorkflowPlanner()
