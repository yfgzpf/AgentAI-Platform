"""
智能体技能集成
将技能调用集成到智能体框架中，让智能体能够自动调用技能
"""
import logging
from typing import Dict, Any, List, Optional
from pathlib import Path

from services.skill_manager import skill_manager
from services.skill_discovery import skill_discovery
from services.skill_parameter_processor import skill_parameter_processor
from services.skill_result_processor import skill_result_processor

# 设置日志
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


class AgentSkillIntegration:
    """智能体技能集成类"""
    def __init__(self):
        logger.info("智能体技能集成初始化完成")

    def find_relevant_skills(self, user_input: str) -> List[Dict[str, Any]]:
        """
        查找与用户输入相关的技能

        Args:
            user_input: 用户输入

        Returns:
            List[Dict[str, Any]]: 相关技能列表
        """
        try:
            # 获取所有技能
            all_skills = skill_manager.list_skills()
            relevant_skills = []

            # 遍历技能，判断是否与用户输入相关
            for skill in all_skills:
                skill_name = skill["name"]
                skill_description = skill["description"]
                skill_category = skill["category"]

                # 简单的相关性判断
                if self._is_skill_relevant(user_input, skill_name, skill_description, skill_category):
                    relevant_skills.append(skill)

            logger.info(f"找到 {len(relevant_skills)} 个相关技能")
            return relevant_skills

        except Exception as e:
            logger.error(f"查找相关技能失败: {str(e)}")
            return []

    def _is_skill_relevant(self, user_input: str, skill_name: str, skill_description: str, skill_category: str) -> bool:
        """
        判断技能是否与用户输入相关

        Args:
            user_input: 用户输入
            skill_name: 技能名称
            skill_description: 技能描述
            skill_category: 技能分类

        Returns:
            bool: 是否相关
        """
        # 提取关键词的辅助函数
        def extract_keywords(text):
            # 简单的关键词提取
            keywords = set()
            # 移除特殊字符
            import re
            clean_text = re.sub(r'[^\w\s]', '', text)
            # 分词
            words = clean_text.lower().split()
            # 过滤停用词
            stop_words = {'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'with', 'by', 'from'}
            keywords.update(word for word in words if word not in stop_words and len(word) > 2)
            return keywords

        # 提取用户输入的关键词
        user_keywords = extract_keywords(user_input)
        if not user_keywords:
            return False

        # 提取技能相关的关键词
        skill_text = f"{skill_name} {skill_description} {skill_category}"
        skill_keywords = extract_keywords(skill_text)
        if not skill_keywords:
            return False

        # 计算关键词匹配率
        matched_keywords = user_keywords.intersection(skill_keywords)
        if matched_keywords:
            # 如果有匹配的关键词，认为相关
            return True

        # 检查特定的技能类型关键词
        skill_type_keywords = {
            'docx': ['word', '文档', 'docx'],
            'pdf': ['pdf', '文档'],
            'pptx': ['ppt', '演示', '幻灯片'],
            'design': ['设计', 'design'],
            'backend': ['后端', 'backend', '服务器'],
            'frontend': ['前端', 'frontend', '界面'],
            'error': ['错误', 'error', 'bug'],
            'quotation': ['报价', '报价表', '报价单'],
            'contract': ['合同', '装修合同', '建材合同']
        }

        # 检查用户输入是否包含特定技能类型的关键词
        user_input_lower = user_input.lower()
        for skill_type, keywords in skill_type_keywords.items():
            if any(keyword in user_input_lower for keyword in keywords):
                # 检查技能是否属于该类型
                skill_lower = f"{skill_name} {skill_description}".lower()
                if skill_type in skill_lower:
                    return True

        return False

    def generate_skill_call(self, user_input: str) -> Dict[str, Any]:
        """
        生成技能调用

        Args:
            user_input: 用户输入

        Returns:
            Dict[str, Any]: 技能调用信息
        """
        try:
            # 查找相关技能
            relevant_skills = self.find_relevant_skills(user_input)
            if not relevant_skills:
                return {
                    "success": False,
                    "message": "未找到相关技能",
                    "skill_call": None
                }

            # 选择最相关的技能
            best_skill = relevant_skills[0]
            skill_name = best_skill["name"]
            skill_parameters = best_skill.get("parameters", {})

            # 提取技能参数
            extracted_params = skill_parameter_processor.extract_parameters_from_input(
                user_input, skill_name, skill_parameters
            )

            # 验证参数
            validation_result = skill_parameter_processor.validate_parameters(
                extracted_params, skill_parameters
            )

            if not validation_result["success"]:
                return {
                    "success": False,
                    "message": f"参数验证失败: {validation_result['errors']}",
                    "skill_call": None
                }

            # 构建技能调用信息
            skill_call = {
                "skill_name": skill_name,
                "parameters": validation_result["parameters"]
            }

            logger.info(f"生成技能调用: {skill_call}")
            return {
                "success": True,
                "message": f"找到相关技能: {skill_name}",
                "skill_call": skill_call
            }

        except Exception as e:
            logger.error(f"生成技能调用失败: {str(e)}")
            return {
                "success": False,
                "message": f"生成技能调用失败: {str(e)}",
                "skill_call": None
            }

    def execute_skill_call(self, skill_call: Dict[str, Any]) -> Dict[str, Any]:
        """
        执行技能调用

        Args:
            skill_call: 技能调用信息

        Returns:
            Dict[str, Any]: 技能执行结果
        """
        try:
            skill_name = skill_call["skill_name"]
            parameters = skill_call["parameters"]

            # 执行技能
            execution_result = skill_manager.execute_skill(skill_name, **parameters)

            # 处理执行结果
            processed_result = skill_result_processor.process_result(skill_name, execution_result)

            logger.info(f"执行技能调用结果: {processed_result}")
            return processed_result

        except Exception as e:
            logger.error(f"执行技能调用失败: {str(e)}")
            return {
                "success": False,
                "message": f"执行技能调用失败: {str(e)}",
                "data": None
            }

    def integrate_skill_to_agent(self, agent_message: str) -> Dict[str, Any]:
        """
        将技能集成到智能体

        Args:
            agent_message: 智能体消息

        Returns:
            Dict[str, Any]: 集成结果
        """
        try:
            # 生成技能调用
            skill_call_result = self.generate_skill_call(agent_message)
            if not skill_call_result["success"]:
                return {
                    "success": False,
                    "message": skill_call_result["message"],
                    "skill_used": False,
                    "skill_result": None
                }

            # 执行技能调用
            skill_call = skill_call_result["skill_call"]
            skill_result = self.execute_skill_call(skill_call)

            return {
                "success": True,
                "message": "技能调用成功",
                "skill_used": True,
                "skill_result": skill_result
            }

        except Exception as e:
            logger.error(f"集成技能到智能体失败: {str(e)}")
            return {
                "success": False,
                "message": f"集成技能到智能体失败: {str(e)}",
                "skill_used": False,
                "skill_result": None
            }


# 全局智能体技能集成实例
agent_skill_integration = AgentSkillIntegration()
