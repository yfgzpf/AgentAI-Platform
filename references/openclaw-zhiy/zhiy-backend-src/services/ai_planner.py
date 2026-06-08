"""
智 Y.Ai 智能规划引擎
实现类似人类AI助手的规划、追问、执行能力
"""
import os
import json
import re
from typing import Dict, Any, Optional, List, Tuple
from dataclasses import dataclass, field
from enum import Enum
from loguru import logger


class SkillScope(Enum):
    GLOBAL = "global"
    PROJECT = "project"


class TaskStatus(Enum):
    PENDING = "pending"
    PLANNING = "planning"
    ASKING = "asking"
    EXECUTING = "executing"
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass
class Skill:
    name: str
    description: str
    scope: SkillScope
    category: str
    parameters: Dict[str, Any]
    executor: str
    triggers: List[str] = field(default_factory=list)
    examples: List[str] = field(default_factory=list)
    

@dataclass
class Task:
    id: str
    user_input: str
    intent: Optional[str] = None
    required_skills: List[str] = field(default_factory=list)
    missing_info: List[Dict[str, Any]] = field(default_factory=list)
    questions: List[str] = field(default_factory=list)
    plan: List[Dict[str, Any]] = field(default_factory=list)
    status: TaskStatus = TaskStatus.PENDING
    context: Dict[str, Any] = field(default_factory=dict)


class AIPlanner:
    """AI规划引擎 - 像人类助手一样规划、追问、执行"""
    
    def __init__(self, skills_dir: str = None):
        self.skills_dir = skills_dir or os.path.join(os.path.dirname(__file__), '..', '..', '..', 'skills')
        self.global_skills: Dict[str, Skill] = {}
        self.project_skills: Dict[str, Skill] = {}
        self.current_project: Optional[str] = None
        self.task_history: List[Task] = []
        
        self._load_skills()
        logger.info(f"AI规划引擎初始化完成 - 全局技能: {len(self.global_skills)}, 项目技能: {len(self.project_skills)}")
    
    def _load_skills(self):
        """加载全局技能和项目技能"""
        global_skills_dir = os.path.join(self.skills_dir, 'global')
        project_skills_dir = os.path.join(self.skills_dir, 'projects')
        
        if os.path.exists(global_skills_dir):
            self._load_skills_from_dir(global_skills_dir, SkillScope.GLOBAL)
        
        if os.path.exists(project_skills_dir):
            for project_name in os.listdir(project_skills_dir):
                project_dir = os.path.join(project_skills_dir, project_name)
                if os.path.isdir(project_dir):
                    self._load_skills_from_dir(project_dir, SkillScope.PROJECT, project_name)
        
        self._register_builtin_skills()
    
    def _register_builtin_skills(self):
        """注册内置全局技能"""
        builtin_skills = [
            Skill(
                name="browser_automation",
                description="浏览器自动化：打开网页、搜索、点击、输入、截图",
                scope=SkillScope.GLOBAL,
                category="automation",
                parameters={
                    "url": {"type": "string", "required": False, "description": "要打开的网址"},
                    "action": {"type": "string", "required": True, "description": "操作类型：open/search/click/type/screenshot"},
                    "query": {"type": "string", "required": False, "description": "搜索关键词或输入内容"},
                    "selector": {"type": "string", "required": False, "description": "CSS选择器"}
                },
                executor="openclaw_core.execute_tool",
                triggers=["打开", "访问", "搜索", "浏览", "网页", "网站", "点击", "输入"],
                examples=["打开百度", "搜索今日新闻", "访问github.com"]
            ),
            Skill(
                name="desktop_automation",
                description="桌面自动化：打开应用、截图、键盘鼠标操作",
                scope=SkillScope.GLOBAL,
                category="automation",
                parameters={
                    "action": {"type": "string", "required": True, "description": "操作类型"},
                    "app_name": {"type": "string", "required": False, "description": "应用名称"},
                    "text": {"type": "string", "required": False, "description": "输入文本"}
                },
                executor="openclaw_core.execute_tool",
                triggers=["打开应用", "截图", "输入", "点击", "运行"],
                examples=["打开记事本", "截个图", "打开微信"]
            ),
            Skill(
                name="file_operations",
                description="文件操作：创建、读取、写入、复制、移动、删除文件",
                scope=SkillScope.GLOBAL,
                category="file",
                parameters={
                    "action": {"type": "string", "required": True, "description": "操作类型"},
                    "path": {"type": "string", "required": True, "description": "文件路径"},
                    "content": {"type": "string", "required": False, "description": "文件内容"}
                },
                executor="openclaw_core.execute_tool",
                triggers=["创建", "新建", "读取", "打开", "写入", "保存", "复制", "移动", "删除", "文件", "文件夹"],
                examples=["创建一个test.txt文件", "读取config.json", "删除临时文件"]
            ),
            Skill(
                name="document_generation",
                description="文档生成：Word、Excel、PPT文档创建和编辑",
                scope=SkillScope.GLOBAL,
                category="document",
                parameters={
                    "doc_type": {"type": "string", "required": True, "description": "文档类型：word/excel/ppt"},
                    "title": {"type": "string", "required": True, "description": "文档标题"},
                    "content": {"type": "string", "required": False, "description": "文档内容"}
                },
                executor="openclaw_core.execute_tool",
                triggers=["生成", "创建", "写", "制作", "文档", "Word", "Excel", "PPT", "表格", "报告", "合同"],
                examples=["生成一份合同", "创建Word文档", "制作PPT"]
            ),
            Skill(
                name="image_generation",
                description="图像生成：使用AI生成图片",
                scope=SkillScope.GLOBAL,
                category="media",
                parameters={
                    "prompt": {"type": "string", "required": True, "description": "图像描述"},
                    "style": {"type": "string", "required": False, "description": "风格"},
                    "size": {"type": "string", "required": False, "description": "尺寸"}
                },
                executor="openclaw_core.execute_tool",
                triggers=["生成图片", "画", "创建图像", "AI画图", "画一张"],
                examples=["画一张风景图", "生成一个logo", "AI画一只猫"]
            ),
            Skill(
                name="video_generation",
                description="视频生成：使用AI生成视频",
                scope=SkillScope.GLOBAL,
                category="media",
                parameters={
                    "prompt": {"type": "string", "required": True, "description": "视频描述"},
                    "duration": {"type": "number", "required": False, "description": "时长（秒）"}
                },
                executor="openclaw_core.execute_tool",
                triggers=["生成视频", "制作视频", "AI视频"],
                examples=["生成一个10秒的视频", "制作产品宣传视频"]
            ),
            Skill(
                name="communication",
                description="通信功能：发送微信、邮件、钉钉消息",
                scope=SkillScope.GLOBAL,
                category="communication",
                parameters={
                    "platform": {"type": "string", "required": True, "description": "平台：wechat/email/dingtalk"},
                    "recipient": {"type": "string", "required": True, "description": "接收者"},
                    "message": {"type": "string", "required": True, "description": "消息内容"}
                },
                executor="openclaw_core.execute_tool",
                triggers=["发送", "发", "微信", "邮件", "钉钉", "通知", "告诉"],
                examples=["发微信给张三", "发送邮件", "钉钉通知团队"]
            ),
            Skill(
                name="code_execution",
                description="代码执行：运行Python、JavaScript代码",
                scope=SkillScope.GLOBAL,
                category="code",
                parameters={
                    "language": {"type": "string", "required": True, "description": "编程语言"},
                    "code": {"type": "string", "required": True, "description": "代码内容"}
                },
                executor="openclaw_core.execute_tool",
                triggers=["运行", "执行", "代码", "Python", "JavaScript", "脚本"],
                examples=["运行这段Python代码", "执行脚本"]
            )
        ]
        
        for skill in builtin_skills:
            self.global_skills[skill.name] = skill
    
    def _load_skills_from_dir(self, dir_path: str, scope: SkillScope, project_name: str = None):
        """从目录加载技能"""
        for skill_dir in os.listdir(dir_path):
            skill_path = os.path.join(dir_path, skill_dir)
            if os.path.isdir(skill_path):
                skill_md = os.path.join(skill_path, 'SKILL.md')
                if os.path.exists(skill_md):
                    skill = self._parse_skill_md(skill_md, scope, project_name)
                    if skill:
                        if scope == SkillScope.GLOBAL:
                            self.global_skills[skill.name] = skill
                        else:
                            key = f"{project_name}/{skill.name}"
                            self.project_skills[key] = skill
    
    def _parse_skill_md(self, skill_md_path: str, scope: SkillScope, project_name: str = None) -> Optional[Skill]:
        """解析SKILL.md文件"""
        try:
            with open(skill_md_path, 'r', encoding='utf-8') as f:
                content = f.read()
            
            name = os.path.basename(os.path.dirname(skill_md_path))
            description = ""
            category = "general"
            parameters = {}
            triggers = []
            examples = []
            
            lines = content.split('\n')
            current_section = None
            
            for line in lines:
                line = line.strip()
                if line.startswith('# '):
                    name = line[2:].strip()
                elif line.startswith('## '):
                    current_section = line[3:].strip().lower()
                elif current_section == '功能' and line:
                    description = line
                elif current_section == '分类' and line:
                    category = line
                elif current_section == '参数' and line.startswith('-'):
                    param_match = re.match(r'-\s*`?(\w+)`?\s*\((\w+)(?:,\s*(required|optional))?\)\s*:\s*(.+)', line)
                    if param_match:
                        param_name = param_match.group(1)
                        parameters[param_name] = {
                            'type': param_match.group(2),
                            'required': param_match.group(3) == 'required',
                            'description': param_match.group(4)
                        }
                elif current_section == '触发词' and line.startswith('-'):
                    triggers.append(line[1:].strip())
                elif current_section == '示例' and line.startswith('-'):
                    examples.append(line[1:].strip())
            
            return Skill(
                name=name,
                description=description,
                scope=scope,
                category=category,
                parameters=parameters,
                executor="skill_executor.execute",
                triggers=triggers,
                examples=examples
            )
        except Exception as e:
            logger.error(f"解析技能文件失败: {str(e)}")
            return None
    
    def analyze_intent(self, user_input: str, context: Dict[str, Any] = None) -> Task:
        """分析用户意图，创建任务"""
        task = Task(
            id=f"task_{len(self.task_history) + 1}",
            user_input=user_input,
            context=context or {}
        )
        
        matched_skills = self._match_skills(user_input)
        task.required_skills = [s.name for s in matched_skills]
        
        if matched_skills:
            primary_skill = matched_skills[0]
            task.intent = primary_skill.name
            
            missing_params = self._check_missing_params(user_input, primary_skill)
            if missing_params:
                task.missing_info = missing_params
                task.questions = self._generate_questions(missing_params)
                task.status = TaskStatus.ASKING
            else:
                task.plan = self._create_execution_plan(user_input, primary_skill, context)
                task.status = TaskStatus.PLANNING
        else:
            task.questions = [self._generate_clarification_question(user_input)]
            task.status = TaskStatus.ASKING
        
        self.task_history.append(task)
        return task
    
    def _match_skills(self, user_input: str) -> List[Skill]:
        """匹配用户输入与技能"""
        matched = []
        input_lower = user_input.lower()
        
        for skill in self.global_skills.values():
            for trigger in skill.triggers:
                if trigger.lower() in input_lower:
                    if skill not in matched:
                        matched.append(skill)
                    break
        
        if self.current_project:
            for key, skill in self.project_skills.items():
                if key.startswith(f"{self.current_project}/"):
                    for trigger in skill.triggers:
                        if trigger.lower() in input_lower:
                            if skill not in matched:
                                matched.append(skill)
                            break
        
        return matched
    
    def _check_missing_params(self, user_input: str, skill: Skill) -> List[Dict[str, Any]]:
        """检查缺失的参数"""
        missing = []
        
        for param_name, param_info in skill.parameters.items():
            if param_info.get('required', False):
                value = self._extract_param_value(user_input, param_name, param_info)
                if value is None:
                    missing.append({
                        'name': param_name,
                        'type': param_info.get('type', 'string'),
                        'description': param_info.get('description', ''),
                        'required': True
                    })
        
        return missing
    
    def _extract_param_value(self, user_input: str, param_name: str, param_info: Dict) -> Optional[Any]:
        """从用户输入中提取参数值"""
        patterns = {
            'url': r'https?://[^\s]+',
            'path': r'[A-Za-z]:\\[^\s]+|/[\w/-]+',
            'email': r'[\w.-]+@[\w.-]+\.\w+',
            'number': r'\d+',
            'string': None
        }
        
        param_type = param_info.get('type', 'string')
        
        if param_type in patterns and patterns[param_type]:
            match = re.search(patterns[param_type], user_input)
            if match:
                return match.group()
        
        keywords = {
            'url': ['网址', '链接', '网站', '打开'],
            'path': ['文件', '目录', '路径'],
            'query': ['搜索', '查找', '查询'],
            'message': ['消息', '内容', '发送'],
            'title': ['标题', '题目', '名字']
        }
        
        if param_name in keywords:
            for keyword in keywords[param_name]:
                if keyword in user_input:
                    idx = user_input.find(keyword)
                    rest = user_input[idx + len(keyword):].strip()
                    if rest:
                        return rest.split()[0] if ' ' in rest else rest
        
        return None
    
    def _generate_questions(self, missing_params: List[Dict[str, Any]]) -> List[str]:
        """生成追问问题"""
        questions = []
        
        for param in missing_params:
            param_type = param.get('type', 'string')
            description = param.get('description', param['name'])
            
            if param_type == 'string':
                questions.append(f"请提供{description}：")
            elif param_type == 'number':
                questions.append(f"请提供{description}（数字）：")
            elif param_type == 'choice':
                questions.append(f"请选择{description}：")
            else:
                questions.append(f"请提供{description}：")
        
        return questions
    
    def _generate_clarification_question(self, user_input: str) -> str:
        """生成澄清问题"""
        templates = [
            "我理解您想要执行某个任务，但需要更多信息。您能详细描述一下您想要做什么吗？",
            "请问您具体想要我帮您完成什么任务？",
            "我需要更多信息来帮助您。您能提供更多细节吗？"
        ]
        
        return templates[0]
    
    def _create_execution_plan(self, user_input: str, skill: Skill, context: Dict[str, Any]) -> List[Dict[str, Any]]:
        """创建执行计划"""
        plan = []
        
        extracted_params = {}
        for param_name, param_info in skill.parameters.items():
            value = self._extract_param_value(user_input, param_name, param_info)
            if value:
                extracted_params[param_name] = value
        
        plan.append({
            'step': 1,
            'action': 'execute_skill',
            'skill': skill.name,
            'params': extracted_params,
            'description': f"执行技能: {skill.description}"
        })
        
        return plan
    
    def process_response(self, task_id: str, user_response: str) -> Task:
        """处理用户回复"""
        task = next((t for t in self.task_history if t.id == task_id), None)
        if not task:
            return None
        
        if task.status == TaskStatus.ASKING:
            for missing in task.missing_info:
                value = self._extract_param_value(user_response, missing['name'], missing)
                if value:
                    task.context[missing['name']] = value
            
            remaining_missing = [m for m in task.missing_info if m['name'] not in task.context]
            
            if remaining_missing:
                task.questions = self._generate_questions(remaining_missing)
            else:
                task.status = TaskStatus.PLANNING
                task.plan = self._create_execution_plan_from_context(task)
        
        return task
    
    def _create_execution_plan_from_context(self, task: Task) -> List[Dict[str, Any]]:
        """根据上下文创建执行计划"""
        plan = []
        
        for skill_name in task.required_skills:
            skill = self.global_skills.get(skill_name)
            if skill:
                params = {}
                for param_name in skill.parameters:
                    if param_name in task.context:
                        params[param_name] = task.context[param_name]
                
                plan.append({
                    'step': len(plan) + 1,
                    'action': 'execute_skill',
                    'skill': skill_name,
                    'params': params,
                    'description': f"执行技能: {skill.description}"
                })
        
        return plan
    
    def execute_plan(self, task_id: str, executor) -> Dict[str, Any]:
        """执行计划"""
        task = next((t for t in self.task_history if t.id == task_id), None)
        if not task or not task.plan:
            return {'success': False, 'message': '任务或计划不存在'}
        
        task.status = TaskStatus.EXECUTING
        results = []
        
        for step in task.plan:
            try:
                if step['action'] == 'execute_skill':
                    result = executor.execute_tool(step['skill'], **step.get('params', {}))
                    results.append({
                        'step': step['step'],
                        'skill': step['skill'],
                        'result': result
                    })
            except Exception as e:
                task.status = TaskStatus.FAILED
                return {'success': False, 'message': f'执行失败: {str(e)}', 'results': results}
        
        task.status = TaskStatus.COMPLETED
        return {'success': True, 'message': '执行完成', 'results': results}
    
    def get_available_skills(self, scope: SkillScope = None) -> List[Dict[str, Any]]:
        """获取可用技能列表"""
        skills = []
        
        if scope in [None, SkillScope.GLOBAL]:
            for skill in self.global_skills.values():
                skills.append({
                    'name': skill.name,
                    'description': skill.description,
                    'scope': skill.scope.value,
                    'category': skill.category,
                    'triggers': skill.triggers,
                    'examples': skill.examples
                })
        
        if scope in [None, SkillScope.PROJECT]:
            for key, skill in self.project_skills.items():
                skills.append({
                    'name': key,
                    'description': skill.description,
                    'scope': skill.scope.value,
                    'category': skill.category,
                    'triggers': skill.triggers,
                    'examples': skill.examples
                })
        
        return skills
    
    def set_current_project(self, project_name: str):
        """设置当前项目"""
        self.current_project = project_name
        logger.info(f"切换到项目: {project_name}")


ai_planner = AIPlanner()
