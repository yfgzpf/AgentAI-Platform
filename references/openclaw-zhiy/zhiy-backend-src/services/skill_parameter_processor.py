"""
技能参数处理器
从用户输入中自动提取技能参数，验证参数正确性
"""
import re
import logging
from typing import Dict, Any, Optional
from pathlib import Path

# 设置日志
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


class SkillParameterProcessor:
    """技能参数处理器"""
    def __init__(self):
        logger.info("技能参数处理器初始化完成")

    def extract_parameters_from_input(self, user_input: str, skill_name: str, skill_parameters: Dict[str, Any]) -> Dict[str, Any]:
        """
        从用户输入中提取技能参数

        Args:
            user_input: 用户输入
            skill_name: 技能名称
            skill_parameters: 技能参数定义

        Returns:
            Dict[str, Any]: 提取的参数
        """
        try:
            extracted_params = {}

            # 遍历技能参数
            for param_name, param_info in skill_parameters.items():
                param_description = param_info.get("description", "")
                param_type = param_info.get("type", "string")

                # 根据参数类型提取参数值
                if param_type == "string":
                    # 对于字符串参数，尝试从用户输入中提取
                    extracted_value = self._extract_string_parameter(user_input, param_name, param_description)
                    if extracted_value:
                        extracted_params[param_name] = extracted_value
                elif param_type == "number":
                    # 对于数字参数，尝试从用户输入中提取数字
                    extracted_value = self._extract_number_parameter(user_input)
                    if extracted_value is not None:
                        extracted_params[param_name] = extracted_value
                elif param_type == "boolean":
                    # 对于布尔参数，尝试从用户输入中提取
                    extracted_value = self._extract_boolean_parameter(user_input, param_name)
                    if extracted_value is not None:
                        extracted_params[param_name] = extracted_value
                elif param_type == "list":
                    # 对于列表参数，尝试从用户输入中提取
                    extracted_value = self._extract_list_parameter(user_input, param_name)
                    if extracted_value:
                        extracted_params[param_name] = extracted_value

            # 处理默认参数值
            for param_name, param_info in skill_parameters.items():
                if param_name not in extracted_params and "default" in param_info:
                    extracted_params[param_name] = param_info["default"]

            logger.info(f"从用户输入中提取参数: {extracted_params}")
            return extracted_params

        except Exception as e:
            logger.error(f"提取参数失败: {str(e)}")
            return {}

    def _extract_string_parameter(self, user_input: str, param_name: str, param_description: str) -> Optional[str]:
        """
        提取字符串参数

        Args:
            user_input: 用户输入
            param_name: 参数名称
            param_description: 参数描述

        Returns:
            Optional[str]: 提取的参数值
        """
        # 简单的字符串参数提取逻辑
        # 这里可以根据需要扩展更复杂的提取逻辑
        return user_input

    def _extract_number_parameter(self, user_input: str) -> Optional[float]:
        """
        提取数字参数

        Args:
            user_input: 用户输入

        Returns:
            Optional[float]: 提取的参数值
        """
        # 从用户输入中提取数字
        numbers = re.findall(r'\d+(?:\.\d+)?', user_input)
        if numbers:
            return float(numbers[0])
        return None

    def _extract_boolean_parameter(self, user_input: str, param_name: str) -> Optional[bool]:
        """
        提取布尔参数

        Args:
            user_input: 用户输入
            param_name: 参数名称

        Returns:
            Optional[bool]: 提取的参数值
        """
        # 简单的布尔参数提取逻辑
        # 这里可以根据需要扩展更复杂的提取逻辑
        if "是" in user_input or "true" in user_input.lower() or "yes" in user_input.lower():
            return True
        elif "否" in user_input or "false" in user_input.lower() or "no" in user_input.lower():
            return False
        return None

    def _extract_list_parameter(self, user_input: str, param_name: str) -> Optional[list]:
        """
        提取列表参数

        Args:
            user_input: 用户输入
            param_name: 参数名称

        Returns:
            Optional[list]: 提取的参数值
        """
        # 简单的列表参数提取逻辑
        # 这里可以根据需要扩展更复杂的提取逻辑
        if "," in user_input:
            return [item.strip() for item in user_input.split(",")]
        return None

    def validate_parameters(self, parameters: Dict[str, Any], skill_parameters: Dict[str, Any]) -> Dict[str, Any]:
        """
        验证参数正确性

        Args:
            parameters: 提取的参数
            skill_parameters: 技能参数定义

        Returns:
            Dict[str, Any]: 验证结果，包含成功状态和错误信息
        """
        try:
            errors = []

            # 验证必填参数
            for param_name, param_info in skill_parameters.items():
                if param_info.get("required", False) and param_name not in parameters:
                    errors.append(f"缺少必要参数: {param_name}")

            # 验证参数类型
            for param_name, param_value in parameters.items():
                if param_name in skill_parameters:
                    param_info = skill_parameters[param_name]
                    param_type = param_info.get("type", "string")

                    if param_type == "number" and not isinstance(param_value, (int, float)):
                        errors.append(f"参数 {param_name} 类型错误，期望数字类型")
                    elif param_type == "boolean" and not isinstance(param_value, bool):
                        errors.append(f"参数 {param_name} 类型错误，期望布尔类型")
                    elif param_type == "list" and not isinstance(param_value, list):
                        errors.append(f"参数 {param_name} 类型错误，期望列表类型")

            # 验证参数范围
            for param_name, param_value in parameters.items():
                if param_name in skill_parameters:
                    param_info = skill_parameters[param_name]
                    if "min" in param_info and param_value < param_info["min"]:
                        errors.append(f"参数 {param_name} 小于最小值 {param_info['min']}")
                    if "max" in param_info and param_value > param_info["max"]:
                        errors.append(f"参数 {param_name} 大于最大值 {param_info['max']}")

            if errors:
                return {
                    "success": False,
                    "errors": errors
                }
            else:
                return {
                    "success": True,
                    "parameters": parameters
                }

        except Exception as e:
            logger.error(f"验证参数失败: {str(e)}")
            return {
                "success": False,
                "errors": [f"验证参数失败: {str(e)}"]
            }


# 全局技能参数处理器实例
skill_parameter_processor = SkillParameterProcessor()
