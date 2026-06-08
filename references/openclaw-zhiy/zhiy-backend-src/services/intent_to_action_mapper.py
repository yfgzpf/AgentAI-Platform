"""
意图到操作映射服务
将用户意图转换为具体的操作序列
"""

import re
import logging
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass
from enum import Enum

logger = logging.getLogger(__name__)


class ActionType(Enum):
    """操作类型枚举"""
    BROWSER_OPEN = "open_website"
    BROWSER_SEARCH = "search_content"
    BROWSER_EXTRACT_IMAGES = "extract_images"
    BROWSER_DOWNLOAD_IMAGES = "download_images"
    BROWSER_SCREENSHOT = "screenshot"
    BROWSER_EXTRACT_TEXT = "extract_text"

    APP_OPEN = "open_app"
    APP_CREATE_DOC = "create_document"
    APP_EDIT_DOC = "edit_document"
    APP_SAVE_DOC = "save_document"
    APP_CLOSE = "close_app"

    DOC_GENERATE = "generate_document"


@dataclass
class Intent:
    """意图数据类"""
    primary_intent: str
    secondary_intent: Optional[str]
    entities: Dict[str, Any]
    confidence: float
    action_sequence: List[Dict[str, Any]]


class IntentAnalyzer:
    """
    意图分析器
    """

    def __init__(self):
        self.intent_patterns = {
            "browser_search": [
                r"去(.+?)找(.+)",
                r"在(.+?)搜索(.+)",
                r"打开(.+?)搜索(.+)",
                r"去(.+?)搜(.+)",
            ],
            "browser_open": [
                r"打开(.+)",
                r"访问(.+)",
                r"去(.+)",
            ],
            "browser_extract_images": [
                r"找(.+?)效果图",
                r"找(.+?)图片",
                r"下载(.+?)图片",
                r"提取(.+?)图片",
            ],
            "document_create": [
                r"制作(.+?)合同",
                r"生成(.+?)文档",
                r"写(.+?)合同",
                r"创建(.+?)文档",
            ],
            "document_edit": [
                r"编辑(.+?)文档",
                r"修改(.+?)合同",
            ],
            "app_open": [
                r"打开(.+)",
                r"启动(.+)",
            ],
        }

        self.entity_patterns = {
            "website": [
                r"(建E网|淘宝|京东|百度|谷歌|知乎|B站|微博)",
                r"(https?://[^\s]+)",
            ],
            "style": [
                r"(现代|简约|欧式|美式|中式|日式|北欧|地中海|工业|田园|轻奢|复古)",
            ],
            "content_type": [
                r"(效果图|图片|照片|素材)",
            ],
            "document_type": [
                r"(装修合同|设计合同|施工合同|采购合同|服务合同)",
            ],
            "app_name": [
                r"(WPS|Word|Excel|PowerPoint|PPT|记事本)",
            ],
        }

    def analyze(self, user_input: str) -> Intent:
        """
        分析用户意图

        Args:
            user_input: 用户输入

        Returns:
            Intent对象
        """
        primary_intent, confidence = self._detect_primary_intent(user_input)
        entities = self._extract_entities(user_input)

        action_sequence = self._generate_action_sequence(
            primary_intent,
            entities,
            user_input
        )

        return Intent(
            primary_intent=primary_intent,
            secondary_intent=None,
            entities=entities,
            confidence=confidence,
            action_sequence=action_sequence
        )

    def _detect_primary_intent(self, user_input: str) -> Tuple[str, float]:
        """
        检测主要意图

        Returns:
            (意图类型, 置信度)
        """
        max_confidence = 0.0
        detected_intent = "unknown"

        for intent_type, patterns in self.intent_patterns.items():
            for pattern in patterns:
                if re.search(pattern, user_input):
                    confidence = 0.8
                    if confidence > max_confidence:
                        max_confidence = confidence
                        detected_intent = intent_type

        return detected_intent, max_confidence

    def _extract_entities(self, user_input: str) -> Dict[str, Any]:
        """
        提取实体

        Returns:
            实体字典
        """
        entities = {}

        for entity_type, patterns in self.entity_patterns.items():
            for pattern in patterns:
                matches = re.findall(pattern, user_input)
                if matches:
                    entities[entity_type] = matches[0] if isinstance(matches[0], str) else matches
                    break

        # 提取搜索关键词
        if "找" in user_input or "搜索" in user_input:
            search_match = re.search(r"找\s*(.+?)(?:效果图|图片|素材|$)", user_input)
            if search_match:
                entities["search_keyword"] = search_match.group(1).strip()

        return entities

    def _generate_action_sequence(
        self,
        intent_type: str,
        entities: Dict[str, Any],
        user_input: str
    ) -> List[Dict[str, Any]]:
        """
        生成操作序列

        Args:
            intent_type: 意图类型
            entities: 实体字典
            user_input: 用户输入

        Returns:
            操作序列列表
        """
        action_sequence = []

        if intent_type == "browser_search":
            action_sequence = self._generate_browser_search_actions(entities, user_input)
        elif intent_type == "browser_open":
            action_sequence = self._generate_browser_open_actions(entities, user_input)
        elif intent_type == "browser_extract_images":
            action_sequence = self._generate_extract_images_actions(entities, user_input)
        elif intent_type == "document_create":
            action_sequence = self._generate_document_create_actions(entities, user_input)
        elif intent_type == "app_open":
            action_sequence = self._generate_app_open_actions(entities, user_input)

        return action_sequence

    def _generate_browser_search_actions(
        self,
        entities: Dict[str, Any],
        user_input: str
    ) -> List[Dict[str, Any]]:
        """生成浏览器搜索操作序列"""
        actions = []

        # 确定网站
        website = entities.get("website", "百度")
        website_urls = {
            "建E网": "https://www.sheji.com",
            "淘宝": "https://www.taobao.com",
            "京东": "https://www.jd.com",
            "百度": "https://www.baidu.com",
            "谷歌": "https://www.google.com",
            "知乎": "https://www.zhihu.com",
            "B站": "https://www.bilibili.com",
            "微博": "https://weibo.com",
        }

        url = website_urls.get(website, f"https://www.{website}.com")

        # 打开网站
        actions.append({
            "type": ActionType.BROWSER_OPEN.value,
            "parameters": {
                "url": url,
                "headless": False
            }
        })

        # 搜索内容
        search_keyword = entities.get("search_keyword", "")
        if search_keyword:
            actions.append({
                "type": ActionType.BROWSER_SEARCH.value,
                "parameters": {
                    "search_query": search_keyword
                }
            })

        # 如果是找图片，添加提取图片操作
        if "效果图" in user_input or "图片" in user_input:
            actions.append({
                "type": ActionType.BROWSER_EXTRACT_IMAGES.value,
                "parameters": {
                    "selector": "img"
                }
            })

            actions.append({
                "type": ActionType.BROWSER_DOWNLOAD_IMAGES.value,
                "parameters": {
                    "max_count": 5
                }
            })

        return actions

    def _generate_browser_open_actions(
        self,
        entities: Dict[str, Any],
        user_input: str
    ) -> List[Dict[str, Any]]:
        """生成打开网站操作序列"""
        actions = []

        # 提取URL或网站名
        url = entities.get("website")
        if url:
            if not url.startswith("http"):
                website_urls = {
                    "建E网": "https://www.sheji.com",
                    "淘宝": "https://www.taobao.com",
                    "京东": "https://www.jd.com",
                    "百度": "https://www.baidu.com",
                }
                url = website_urls.get(url, f"https://www.{url}.com")

            actions.append({
                "type": ActionType.BROWSER_OPEN.value,
                "parameters": {
                    "url": url,
                    "headless": False
                }
            })

        return actions

    def _generate_extract_images_actions(
        self,
        entities: Dict[str, Any],
        user_input: str
    ) -> List[Dict[str, Any]]:
        """生成提取图片操作序列"""
        actions = []

        # 如果指定了网站，先打开网站
        website = entities.get("website")
        if website:
            website_urls = {
                "建E网": "https://www.sheji.com",
            }
            url = website_urls.get(website, f"https://www.{website}.com")

            actions.append({
                "type": ActionType.BROWSER_OPEN.value,
                "parameters": {
                    "url": url,
                    "headless": False
                }
            })

            # 搜索
            search_keyword = entities.get("search_keyword", "")
            if search_keyword:
                actions.append({
                    "type": ActionType.BROWSER_SEARCH.value,
                    "parameters": {
                        "search_query": search_keyword
                    }
                })

        # 提取图片
        actions.append({
            "type": ActionType.BROWSER_EXTRACT_IMAGES.value,
            "parameters": {
                "selector": "img"
            }
        })

        # 下载图片
        actions.append({
            "type": ActionType.BROWSER_DOWNLOAD_IMAGES.value,
            "parameters": {
                "max_count": 5
            }
        })

        return actions

    def _generate_document_create_actions(
        self,
        entities: Dict[str, Any],
        user_input: str
    ) -> List[Dict[str, Any]]:
        """生成创建文档操作序列"""
        actions = []

        # 提取文档类型
        doc_type = entities.get("document_type", "文档")

        # 先生成文档内容
        actions.append({
            "type": ActionType.DOC_GENERATE.value,
            "parameters": {
                "document_type": doc_type,
                "user_input": user_input
            }
        })

        # 打开Word应用
        actions.append({
            "type": ActionType.APP_OPEN.value,
            "parameters": {
                "app_type": "word"
            }
        })

        # 创建并编辑文档
        actions.append({
            "type": ActionType.APP_CREATE_DOC.value,
            "parameters": {
                "content": "{{generated_content}}",
                "app_type": "word"
            }
        })

        return actions

    def _generate_app_open_actions(
        self,
        entities: Dict[str, Any],
        user_input: str
    ) -> List[Dict[str, Any]]:
        """生成打开应用操作序列"""
        actions = []

        app_name = entities.get("app_name", "Word")

        app_type_map = {
            "WPS": "wps",
            "Word": "word",
            "Excel": "excel",
            "PowerPoint": "powerpoint",
            "PPT": "powerpoint",
            "记事本": "notepad",
        }

        app_type = app_type_map.get(app_name, "word")

        actions.append({
            "type": ActionType.APP_OPEN.value,
            "parameters": {
                "app_type": app_type
            }
        })

        return actions


class IntentToActionMapper:
    """
    意图到操作映射器
    """

    def __init__(self):
        self.intent_analyzer = IntentAnalyzer()

    def map(self, user_input: str) -> Dict[str, Any]:
        """
        将用户输入映射为操作序列

        Args:
            user_input: 用户输入

        Returns:
            映射结果
        """
        try:
            # 分析意图
            intent = self.intent_analyzer.analyze(user_input)

            logger.info(f"意图分析结果: {intent.primary_intent}, 置信度: {intent.confidence}")

            # 如果置信度太低，返回澄清请求
            if intent.confidence < 0.5:
                return {
                    "success": False,
                    "error": "未能理解您的意图，请提供更详细的信息",
                    "intent": intent.primary_intent,
                    "confidence": intent.confidence
                }

            return {
                "success": True,
                "intent": intent.primary_intent,
                "confidence": intent.confidence,
                "entities": intent.entities,
                "action_sequence": intent.action_sequence,
                "message": f"已识别意图: {intent.primary_intent}"
            }

        except Exception as e:
            logger.error(f"意图映射失败: {str(e)}")
            return {
                "success": False,
                "error": str(e)
            }


class SuperAgentOrchestrator:
    """
    超级智能体编排器
    协调意图理解、操作执行和结果返回
    """

    def __init__(self):
        self.intent_mapper = IntentToActionMapper()

    async def process_user_request(self, user_input: str) -> Dict[str, Any]:
        """
        处理用户请求

        Args:
            user_input: 用户输入

        Returns:
            处理结果
        """
        try:
            logger.info(f"处理用户请求: {user_input}")

            # 1. 意图映射
            mapping_result = self.intent_mapper.map(user_input)

            if not mapping_result["success"]:
                return mapping_result

            action_sequence = mapping_result["action_sequence"]
            logger.info(f"生成操作序列: {len(action_sequence)} 个操作")

            # 2. 执行操作序列
            execution_results = []
            for action in action_sequence:
                result = await self._execute_action(action)
                execution_results.append(result)

                # 如果某个操作失败，停止执行
                if not result["success"]:
                    logger.warning(f"操作执行失败，停止后续操作: {action['type']}")
                    break

            # 3. 返回结果
            return {
                "success": True,
                "user_input": user_input,
                "intent": mapping_result["intent"],
                "action_sequence": action_sequence,
                "execution_results": execution_results,
                "message": "请求处理完成"
            }

        except Exception as e:
            logger.error(f"处理用户请求失败: {str(e)}")
            return {
                "success": False,
                "error": str(e)
            }

    async def _execute_action(self, action: Dict[str, Any]) -> Dict[str, Any]:
        """
        执行单个操作

        Args:
            action: 操作字典
        """
        from services.browser_automation_service import browser_executor
        from services.local_application_service import app_executor

        action_type = action["type"]
        parameters = action.get("parameters", {})

        # 浏览器操作
        if action_type.startswith("browser_"):
            return await browser_executor.execute(action)

        # 应用操作
        elif action_type.startswith("app_"):
            return await app_executor.execute(action)

        # 文档生成操作
        elif action_type == "generate_document":
            return await self._generate_document(parameters)

        else:
            return {
                "success": False,
                "error": f"不支持的操作类型: {action_type}"
            }

    async def _generate_document(self, parameters: Dict[str, Any]) -> Dict[str, Any]:
        """
        生成文档内容

        Args:
            parameters: 参数字典
        """
        try:
            document_type = parameters.get("document_type", "文档")
            user_input = parameters.get("user_input", "")

            # 这里可以调用文档生成技能
            # 暂时返回示例内容
            content = f"""
{document_type}

生成时间: {__import__('datetime').datetime.now().strftime('%Y-%m-%d %H:%M:%S')}

根据您的要求: {user_input}

[此处为AI生成的{document_type}内容]
            """

            return {
                "success": True,
                "content": content,
                "document_type": document_type
            }

        except Exception as e:
            logger.error(f"生成文档失败: {str(e)}")
            return {
                "success": False,
                "error": str(e)
            }


# 全局实例
super_agent_orchestrator = SuperAgentOrchestrator()
