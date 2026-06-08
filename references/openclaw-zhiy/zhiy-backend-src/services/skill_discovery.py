"""
技能自动发现机制
自动发现系统中的技能，无需手动注册
"""
import os
import re
import logging
import yaml
from typing import List, Dict, Any
from pathlib import Path
from .skill_manager import skill_manager, Skill

# 设置日志
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


class SkillDiscovery:
    """技能自动发现类"""
    def __init__(self):
        self.skill_directories = [
            "skills/document_processing",
            "skills/design",
            "skills/internal_communication",
            "skills/development_support",
            "skills/image_generation",
            "skills/material_recognition",
            "skills/text_processing",
            "skills/quotation",
            "skills/contract"
        ]
        self.auto_scan = True
        logger.info("技能自动发现机制初始化完成")

    def scan_skill_directories(self) -> List[str]:
        """
        扫描技能目录

        Returns:
            List[str]: 技能文件列表
        """
        skill_files = []
        backend_path = Path(__file__).parent.parent

        if self.auto_scan:
            skills_base_path = backend_path / "skills"
            if skills_base_path.exists():
                for skill_file in skills_base_path.rglob("SKILL.md"):
                    skill_files.append(str(skill_file))
                logger.info(f"自动扫描发现 {len(skill_files)} 个技能文件")
            else:
                logger.warning(f"技能目录不存在: {skills_base_path}")
        else:
            for skill_dir in self.skill_directories:
                full_path = backend_path / skill_dir
                if not full_path.exists():
                    logger.warning(f"技能目录不存在: {full_path}")
                    continue

                for root, dirs, files in os.walk(full_path):
                    for file in files:
                        if file == "SKILL.md":
                            skill_files.append(os.path.join(root, file))

            logger.info(f"发现 {len(skill_files)} 个技能文件")
        return skill_files

    def parse_skill_metadata(self, skill_file: str) -> Dict[str, Any]:
        """
        解析技能元数据

        Args:
            skill_file: 技能文件路径

        Returns:
            Dict[str, Any]: 技能元数据
        """
        try:
            with open(skill_file, 'r', encoding='utf-8') as f:
                content = f.read()

            name = "Unknown Skill"
            description = "No description"
            category = "Other"

            if content.startswith('---'):
                front_matter_end = content.find('---', 3)
                if front_matter_end != -1:
                    front_matter = content[3:front_matter_end]
                    
                    try:
                        metadata = yaml.safe_load(front_matter)
                        name = metadata.get('name', name)
                        description = metadata.get('description', description)
                    except:
                        pass

            if name == "Unknown Skill":
                name_match = re.search(r'#\s*(.+)', content)
                name = name_match.group(1).strip() if name_match else "Unknown Skill"

            if description == "No description":
                desc_match = re.search(r'##\s*(?:描述|Description|Overview)\s*(.*?)(?=##|$)', content, re.DOTALL)
                description = desc_match.group(1).strip() if desc_match else "No description"

            category_match = re.search(r'##\s*(?:分类|Category)\s*(.+)', content)
            category = category_match.group(1).strip() if category_match else "Other"

            parameters = {}
            returns = {"description": "No return value specified"}

            metadata = {
                "name": name,
                "description": description,
                "category": category,
                "parameters": parameters,
                "returns": returns,
                "path": os.path.dirname(skill_file)
            }

            return metadata

        except Exception as e:
            logger.error(f"解析技能文件失败 {skill_file}: {str(e)}")
            return {
                "name": "Unknown Skill",
                "description": "Parse error",
                "category": "Other",
                "parameters": {},
                "returns": {},
                "path": os.path.dirname(skill_file)
            }

    def discover_skills(self) -> int:
        """
        发现并注册技能

        Returns:
            int: 注册的技能数量
        """
        try:
            # 扫描技能文件
            skill_files = self.scan_skill_directories()
            registered_count = 0

            # 解析并注册技能
            for skill_file in skill_files:
                metadata = self.parse_skill_metadata(skill_file)
                
                # 创建技能对象
                skill = Skill(
                    name=metadata["name"],
                    description=metadata["description"],
                    category=metadata["category"],
                    parameters=metadata["parameters"],
                    returns=metadata["returns"],
                    path=metadata["path"]
                )

                # 注册技能
                if skill_manager.register_skill(skill):
                    registered_count += 1

            logger.info(f"成功注册 {registered_count} 个技能")
            return registered_count

        except Exception as e:
            logger.error(f"发现技能失败: {str(e)}")
            return 0

    def refresh_skills(self) -> int:
        """
        刷新技能列表

        Returns:
            int: 注册的技能数量
        """
        # 清除现有技能
        for skill_name in list(skill_manager.skills.keys()):
            skill_manager.unregister_skill(skill_name)

        # 重新发现技能
        return self.discover_skills()


# 全局技能发现实例
skill_discovery = SkillDiscovery()
