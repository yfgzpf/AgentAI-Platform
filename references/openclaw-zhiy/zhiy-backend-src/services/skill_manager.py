"""
技能管理器
统一管理所有技能，提供技能注册、发现、调用等核心功能
"""
import os
import sys
import json
import logging
import subprocess
from typing import Dict, List, Optional, Any
from pathlib import Path

# 添加当前目录到路径
CURRENT_DIR = Path(__file__).parent
if str(CURRENT_DIR) not in sys.path:
    sys.path.insert(0, str(CURRENT_DIR))

# 设置日志
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class Skill:
    """技能类"""
    def __init__(self, name: str, description: str, category: str, parameters: Dict[str, Any], returns: Dict[str, Any], path: str):
        self.name = name
        self.description = description
        self.category = category
        self.parameters = parameters
        self.returns = returns
        self.path = path
        self.status = "available"

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "category": self.category,
            "parameters": self.parameters,
            "returns": self.returns,
            "path": self.path,
            "status": self.status
        }

class SkillManager:
    """技能管理器"""
    def __init__(self):
        self.skills: Dict[str, Skill] = {}
        logger.info("技能管理器初始化完成")

    def register_skill(self, skill: Skill):
        self.skills[skill.name] = skill
        logger.info(f"技能注册成功: {skill.name}")

    def list_skills(self) -> List[Dict[str, Any]]:
        return [skill.to_dict() for skill in self.skills.values()]

# 全局技能管理器实例
skill_manager = SkillManager()
