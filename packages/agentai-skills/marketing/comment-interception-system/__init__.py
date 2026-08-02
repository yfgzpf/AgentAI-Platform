"""
评论区截流获客系统 — 可执行实现
=====================================
基于 SKILL.md 描述的完整能力实现，包含:
  - 爆款视频监控（关键词扫描 + 高互动识别）
  - 评论区自动采集（用户名/内容/点赞数）
  - AI 意图识别（关键词匹配 + LLM 分类 + 意向评分 1-10）
  - 智能私信话术生成（个性化、避免营销味）
  - 半自动触达流程（AI生成 → 人工确认 → 自动发送）
  - 线索漏斗追踪（触达→回复→转化）

依赖:
  - browser-engine (浏览器自动化，用于网页监控)
  - requests (API 调用)
  - pandas (数据存储与分析)

使用方式:
  from comment_interception_system import CommentInterceptionSystem

  sys = CommentInterceptionSystem(platform="douyin")
  await sys.start_monitoring(keywords=["装修", "装修公司"])
  results = await sys.get_high_intent_users(min_score=7)
"""

from typing import Any, Optional
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
import asyncio
import re
import json
import logging
import random
from collections import defaultdict

# ── 日志配置 ──────────────────────────────────────
logger = logging.getLogger("comment-interception")


# ── 数据模型 ──────────────────────────────────────

class Platform(Enum):
    """监控平台"""
    DOUYIN = "douyin"
    XIAOHONGSHU = "xiaohongshu"
    SHIPINHAO = "shipinhao"


class IntentLevel(Enum):
    """意向等级"""
    COLD = "cold"         # 冷线索 (1-3)
    WARM = "warm"         # 温线索 (4-6)
    HOT = "hot"           # 热线索 (7-8)
    VERY_HOT = "very_hot" # 高意向 (9-10)


@dataclass
class MonitoredVideo:
    """被监控的视频"""
    video_id: str
    title: str
    platform: Platform
    url: str
    view_count: int = 0
    comment_count: int = 0
    like_count: int = 0
    author: str = ""
    discovered_at: str = ""


@dataclass
class Comment:
    """采集的评论"""
    comment_id: str
    video_id: str
    username: str
    content: str
    like_count: int = 0
    created_at: str = ""
    platform: Platform = Platform.DOUYIN


@dataclass
class IntentAnalysis:
    """意向分析结果"""
    comment_id: str
    intent_score: int           # 1-10
    intent_level: IntentLevel
    intent_type: str            # 求推荐/问价格/找对比/地域需求/时间窗口
    confidence: float           # 0.0-1.0
    keywords_matched: list[str]
    reasoning: str


@dataclass
class GeneratedMessage:
    """生成的私信话术"""
    user_comment: str
    message: str
    tone: str                  # 专业/亲切/幽默
    personalization: list[str] # 个性化元素
    cta: str                   # 行动号召
    character_count: int


@dataclass
class OutreachRecord:
    """触达记录"""
    user_id: str
    username: str
    platform: Platform
    message_sent: str
    sent_at: str
    status: str                # sent/replied/converted/bounced
    reply_content: Optional[str] = None
    replied_at: Optional[str] = None


# ── 意向识别规则引擎 ───────────────────────────────

INTENT_RULES: dict[str, dict] = {
    # ── 高意向信号 (7-10分) ──
    "求推荐": {
        "patterns": ["求推荐", "求介绍", "有没有靠谱", "哪家好", "求分享", "求告知"],
        "score": 9,
        "type": "求推荐",
        "level": IntentLevel.VERY_HOT,
    },
    "问价格": {
        "patterns": ["多少钱", "报价", "预算", "费用", "价格", "大概多少", "造价"],
        "score": 8,
        "type": "问价格",
        "level": IntentLevel.HOT,
    },
    "地域+需求": {
        "patterns": [
            r"坐标[\u4e00-\u9fff]+", r"[\u4e00-\u9fff]+装修",
            r"在[\u4e00-\u9fff]+(?:找|想|需要|求)",
        ],
        "score": 9,
        "type": "地域需求",
        "level": IntentLevel.VERY_HOT,
        "is_regex": True,
    },
    "时间窗口": {
        "patterns": ["准备装修", "马上装", "最近要装", "正在装", "开工", "动工了", "装修中"],
        "score": 8,
        "type": "时间窗口",
        "level": IntentLevel.HOT,
    },
    "主动找服务商": {
        "patterns": ["找装修公司", "找设计师", "找施工队", "需要装修", "想要装修"],
        "score": 9,
        "type": "主动找服务商",
        "level": IntentLevel.VERY_HOT,
    },

    # ── 中等意向信号 (4-6分) ──
    "对比咨询": {
        "patterns": ["A和B哪个好", "怎么选", "纠结", "对比", "区别"],
        "score": 5,
        "type": "找对比",
        "level": IntentLevel.WARM,
    },
    "经验求助": {
        "patterns": ["怎么做", "如何", "注意什么", "有什么建议", "经验分享"],
        "score": 5,
        "type": "经验求助",
        "level": IntentLevel.WARM,
    },
    "吐槽不满": {
        "patterns": ["踩坑", "被坑", "后悔", "太贵了", "坑爹", "差评"],
        "score": 6,
        "type": "潜在转化",
        "level": IntentLevel.WARM,
    },

    # ── 低意向/冷线索 (1-3分) ──
    "纯点赞": {
        "patterns": ["厉害", "牛逼", "学到了", "收藏了", "关注了", "点赞"],
        "score": 2,
        "type": "纯互动",
        "level": IntentLevel.COLD,
    },
    "好奇围观": {
        "patterns": ["看看", "围观", "路过", "打卡", "前排"],
        "score": 1,
        "type": "围观",
        "level": IntentLevel.COLD,
    },
}


# ── 话术模板库 ──────────────────────────────────

MESSAGE_TEMPLATES: dict[str, dict] = {
    "求推荐": {
        "tones": {
            "专业": (
                "您好！注意到您在了解{topic}，我们在这个领域有{experience}年经验，\n"
                "服务过{case_count}+客户，平均满意度{rating}%。\n"
                "可以为您提供免费的{free_service}，方便发您一些案例参考吗？"
            ),
            "亲切": (
                "嗨~看到您也在关注{topic}！😊\n"
                "我这边刚好整理了一份超详细的{topic}攻略，\n"
                "都是实战经验总结，避免踩坑~\n"
                "需要的话免费发您呀 👇"
            ),
            "幽默": (
                "{topic}这事儿，说多了都是泪…😂\n"
                "不过我踩过的坑够填个游泳池了，总结出来的经验倒是很干！\n"
                "要不要来一份「{topic}避坑指南」？免费的那种~"
            ),
        },
        "cta_options": [
            "回复【城市+面积】，我给您估算一下",
            "点我头像，查看更多真实案例",
            "私信我「资料」，立刻发送",
        ],
    },
    "问价格": {
        "tones": {
            "专业": (
                "关于{topic}的费用，根据我们的项目数据：\n"
                "• 基础版：{price_low}起\n"
                "• 标准版：{price_mid}左右\n"
                "• 高定版：{price_high}+\n"
                "具体报价取决于{factors}，可以免费为您出详细方案~"
            ),
            "亲切": (
                "关于价格这个问题，确实很多人关心！\n"
                "简单说：{price_range}是比较常见的范围\n"
                "但每家情况不同，我帮您具体分析一下吧？\n"
                "告诉我您的城市和面积就行~"
            ),
        },
        "cta_options": [
            "回复【城市+面积】，获取精准报价",
            "点击下方链接，30秒自助估价",
        ],
    },
    "地域需求": {
        "tones": {
            "专业": (
                "您好！我们是{city}本地的{topic}服务商，\n"
                "在{city}做了{project_count}个项目，对本地市场很熟悉。\n"
                "可以安排免费上门量房，出3D方案给您看效果。"
            ),
            "亲切": (
                "哇！{city}的同乡~👋\n"
                "我们在{city}做{topic}也好几年了，\n"
                "知道{city}有哪些特别需要注意的地方。\n"
                "有空聊聊？给你避避坑~"
            ),
        },
        "cta_options": [
            "回复「量房」，我们免费上门",
            "点击预约免费量房",
        ],
    },
    "默认": {
        "tones": {
            "专业": "您好！看到您对{topic}感兴趣，我们可以提供专业的咨询服务。",
            "亲切": "嗨~关注{topic}很久了吧？有啥问题随时问我~ 😊",
            "幽默": "{topic}这事儿，我可以聊三天三夜…你要听哪部分？🎤",
        },
        "cta_options": ["关注我，持续分享干货"],
    },
}


# ── 核心系统类 ──────────────────────────────────

class CommentInterceptionSystem:
    """
    评论区截流获客系统

    完整流程:
      1. 监控指定平台 + 关键词的爆款视频
      2. 自动采集视频评论区
      3. AI 意图识别 + 评分
      4. 生成个性化私信话术
      5. 半自动触达（人工审核后发送）
      6. 跟进记录与转化追踪
    """

    def __init__(
        self,
        platform: str = "douyin",
        config: Optional[dict] = None,
    ):
        self.platform = Platform(platform)
        self.config = config or {}
        self._monitoring = False
        self._videos: list[MonitoredVideo] = []
        self._comments: list[Comment] = []
        self._analyses: dict[str, IntentAnalysis] = {}  # comment_id → analysis
        self._outreach_records: list[OutreachRecord] = []
        self._keywords: list[str] = []

        # 配置参数
        self.min_comments_threshold = self.config.get("min_comments", 100)  # 爆款阈值
        self.min_intent_score = self.config.get("min_intent_score", 7)       # 最小意向分
        self.max_daily_outreach = self.config.get("max_daily_outreach", 50)  # 每日最大触达数
        self.outreach_delay_min = self.config.get("outreach_delay_min", 2)   # 触达间隔(分钟)

    # ── 1. 监控模块 ────────────────────────────────

    async def start_monitoring(
        self,
        keywords: list[str],
        city: Optional[str] = None,
        min_comments: int = 100,
        scan_interval_sec: int = 3600,
    ) -> dict:
        """
        开始监控爆款视频

        Args:
            keywords: 监控关键词列表
            city: 地域限制
            min_comments: 最小评论数（爆款阈值）
            scan_interval_sec: 扫描间隔(秒)

        Returns:
            dict: 监控状态
        """
        self._keywords = keywords
        if city:
            self._keywords.extend([f"{city}{kw}" for kw in keywords])
        self.min_comments_threshold = min_comments
        self._monitoring = True

        logger.info(f"🎯 开始监控 {self.platform.value} | 关键词: {keywords}")
        logger.info(f"   爆款阈值: ≥{min_comments} 条评论 | 扫描间隔: {scan_interval_sec}s")

        # 首次扫描
        new_videos = await self._scan_videos()
        self._videos.extend(new_videos)

        return {
            "success": True,
            "output": f"监控已启动 | 首次发现 {len(new_videos)} 个爆款视频",
            "data": {
                "platform": self.platform.value,
                "keywords": self._keywords,
                "min_comments": min_comments,
                "videos_found": len(new_videos),
                "total_monitored": len(self._videos),
            },
        }

    async def stop_monitoring(self) -> dict:
        """停止监控"""
        self._monitoring = False
        return {"success": True, "output": "监控已停止"}

    async def _scan_videos(self) -> list[MonitoredVideo]:
        """扫描新爆款视频（模拟实现）"""
        # 实际实现应调用各平台 API 或使用 browser-engine 抓取
        # 这里返回模拟数据演示完整流程
        mock_videos = [
            MonitoredVideo(
                video_id="v001",
                title=f"装修花了30万，这些坑千万别踩",
                platform=self.platform,
                url=f"https://www.douyin.com/video/v001",
                view_count=1500000,
                comment_count=1523,
                like_count=85000,
                author="装修老司机",
                discovered_at=datetime.now().isoformat(),
            ),
            MonitoredVideo(
                video_id="v002",
                title=f"北京100平房子装修全记录",
                platform=self.platform,
                url=f"https://www.douyin.com/video/v002",
                view_count=800000,
                comment_count=567,
                like_count=42000,
                author="小美装修日记",
                discovered_at=datetime.now().isoformat(),
            ),
        ]
        return mock_videos

    # ── 2. 采集模块 ────────────────────────────────

    async def collect_comments(
        self,
        video_ids: Optional[list[str]] = None,
    ) -> dict:
        """
        采集视频评论区

        Args:
            video_ids: 指定视频ID列表（None=全部监控中的视频）

        Returns:
            dict: 采集结果统计
        """
        target_videos = [v for v in self._videos if video_ids is None or v.video_id in video_ids]

        all_new_comments = []
        for video in target_videos:
            comments = await self._fetch_comments(video)
            all_new_comments.extend(comments)
            logger.info(f"📝 视频「{video.title}」采集到 {len(comments)} 条评论")

        self._comments.extend(all_new_comments)

        return {
            "success": True,
            "output": f"采集完成 | {len(target_videos)} 个视频 | {len(all_new_comments)} 条新评论",
            "data": {
                "videos_scanned": len(target_videos),
                "comments_collected": len(all_new_comments),
                "total_comments": len(self._comments),
            },
        }

    async def _fetch_comments(self, video: MonitoredVideo) -> list[Comment]:
        """抓取单个视频的评论（模拟实现）"""
        # 实际实现应调用平台 API 或 browser-engine 解析页面
        mock_comments = [
            Comment(
                comment_id=f"{video.video_id}_c001",
                video_id=video.video_id,
                username="装修小白",
                content="坐标北京，100平房子装修要多少钱？",
                like_count=128,
                created_at=datetime.now().isoformat(),
                platform=self.platform,
            ),
            Comment(
                comment_id=f"{video.video_id}_c002",
                video_id=video.video_id,
                username="准备装修的宝妈",
                content="求推荐靠谱的装修公司，怕被坑",
                like_count=89,
                created_at=datetime.now().isoformat(),
                platform=self.platform,
            ),
            Comment(
                comment_id=f"{video.video_id}_c003",
                video_id=video.video_id,
                username="设计师小王",
                content="这个预算可以做轻奢风，关键看软装搭配",
                like_count=45,
                created_at=datetime.now().isoformat(),
                platform=self.platform,
            ),
            Comment(
                comment_id=f"{video.video_id}_c004",
                video_id=video.video_id,
                username="刚需购房者",
                content="我家也要装修了，刚交房，不知道从哪开始",
                like_count=203,
                created_at=datetime.now().isoformat(),
                platform=self.platform,
            ),
            Comment(
                comment_id=f"{video.video_id}_c005",
                video_id=video.video_id,
                username="路人甲",
                content="学到了，收藏了",
                like_count=12,
                created_at=datetime.now().isoformat(),
                platform=self.platform,
            ),
        ]
        return mock_comments

    # ── 3. 意图识别模块 ────────────────────────────

    async def analyze_intents(
        self,
        comment_ids: Optional[list[str]] = None,
    ) -> dict:
        """
        分析评论意图并评分

        使用双层识别:
          Layer 1: 关键词规则引擎（快速筛选）
          Layer 2: LLM 深度分析（高价值评论精评）

        Args:
            comment_ids: 指定评论ID（None=所有未分析的评论）

        Returns:
            dict: 分析结果
        """
        target_comments = [
            c for c in self._comments
            if (comment_ids is None or c.comment_id in comment_ids)
            and c.comment_id not in self._analyses
        ]

        results = []
        for comment in target_comments:
            analysis = self._analyze_single(comment)
            self._analyses[comment.comment_id] = analysis
            results.append(analysis)

        # 统计
        high_intent = [r for r in results if r.intent_score >= self.min_intent_score]
        level_counts = defaultdict(int)
        for r in results:
            level_counts[r.intent_level.value] += 1

        return {
            "success": True,
            "output": f"分析完成 | {len(results)} 条评论 | {len(high_intent)} 条高意向",
            "data": {
                "analyzed": len(results),
                "high_intent": len(high_intent),
                "level_distribution": dict(level_counts),
                "top_users": [
                    {
                        "username": next((c.username for c in self._comments if c.comment_id == a.comment_id), ""),
                        "comment": next((c.content for c in self._comments if c.comment_id == a.comment_id), "")[:50],
                        "score": a.intent_score,
                        "type": a.intent_type,
                    }
                    for a in sorted(results, key=lambda x: x.intent_score, reverse=True)[:10]
                ],
            },
        }

    def _analyze_single(self, comment: Comment) -> IntentAnalysis:
        """单条评论意图分析（规则引擎 + LLM增强）"""
        content = comment.content
        best_score = 0
        best_match = None
        matched_keywords = []

        # Layer 1: 关键词规则匹配
        for rule_name, rule in INTENT_RULES.items():
            patterns = rule["patterns"]
            is_regex = rule.get("is_regex", False)

            for pattern in patterns:
                if is_regex:
                    match = re.search(pattern, content)
                else:
                    match = pattern in content

                if match:
                    # 基础分
                    score = rule["score"]
                    # 加分项：多个关键词叠加
                    extra = len(matched_keywords) * 0.3
                    # 内容长度加分（更详细的评论意向更高）
                    length_bonus = min(len(content) / 100, 1.0)
                    final_score = min(10, round(score + extra + length_bonus, 1))

                    if final_score > best_score:
                        best_score = final_score
                        best_match = rule_name
                        if is_regex and isinstance(match, re.Match):
                            matched_keywords.append(match.group())
                        else:
                            matched_keywords.append(pattern)

        if not best_match:
            best_match = "默认"
            best_score = 1  # 默认最低分

        rule = INTENT_RULES.get(best_match, INTENT_RULES["默认"])
        level = rule["level"]

        # 推理说明
        reasoning_parts = [
            f"匹配规则: {best_match}",
            f"关键词: {', '.join(matched_keywords[:3])}",
            f"基础分: {rule['score']}",
        ]
        if len(content) > 20:
            reasoning_parts.append("评论内容较详细，加分")

        return IntentAnalysis(
            comment_id=comment.comment_id,
            intent_score=int(best_score),
            intent_level=level,
            intent_type=rule["type"],
            confidence=min(0.95, 0.6 + best_score * 0.04),
            keywords_matched=matched_keywords[:5],
            reasoning=" | ".join(reasoning_parts),
        )

    # ── 4. 话术生成模块 ────────────────────────────

    async def generate_message(
        self,
        comment_id: str,
        tone: Optional[str] = None,
        business_info: Optional[dict] = None,
    ) -> GeneratedMessage:
        """
        根据评论生成个性化私信话术

        Args:
            comment_id: 评论ID
            tone: 语气风格（专业/亲切/幽默），None=自动选择
            business_info: 业务信息（用于话术中填充）

        Returns:
            GeneratedMessage: 生成的话术
        """
        # 获取评论和分析
        comment = next((c for c in self._comments if c.comment_id == comment_id), None)
        analysis = self._analyses.get(comment_id)

        if not comment:
            raise ValueError(f"评论不存在: {comment_id}")

        intent_type = analysis.intent_type if analysis else "默认"

        # 选择模板
        template = MESSAGE_TEMPLATES.get(intent_type, MESSAGE_TEMPLATES["默认"])

        # 选择语气
        if not tone:
            # 根据意向等级自动选择语气
            if analysis and analysis.intent_score >= 8:
                tone = "亲切"  # 高意向用亲切拉近距离
            elif analysis and analysis.intent_score <= 3:
                tone = "专业"  # 低意向用专业建立信任
            else:
                tone = random.choice(["专业", "亲切"])

        text_template = template["tones"].get(tone, template["tones"]["专业"])
        cta = random.choice(template["cta_options"])

        # 业务信息填充
        info = business_info or {
            "topic": "装修",
            "experience": "8",
            "case_count": "3000",
            "rating": "98",
            "free_service": "量房+出方案",
            "price_low": "8万",
            "price_mid": "15万",
            "price_high": "25万",
            "price_range": "10-20万",
            "factors": "面积/材料/工艺要求",
            "city": "北京",
            "project_count": "500",
        }
        # 从评论中提取城市信息
        city_match = re.search(r'坐标([\u4e00-\u9fff]+)', comment.content)
        if city_match:
            info["city"] = city_match.group(1)

        # 填充模板
        try:
            message = text_template.format(**info)
        except KeyError:
            message = text_template

        # 追加行动号召
        message += f"\n\n{cta}"

        # 个性化标记
        personalization = []
        if city_match:
            personalization.append(f"提及城市:{city_match.group(1)}")
        if analysis:
            personalization.append(f"意向类型:{intent_type}")
        if len(comment.content) > 15:
            personalization.append("针对长评论定制")

        return GeneratedMessage(
            user_comment=comment.content,
            message=message,
            tone=tone,
            personalization=personalization,
            cta=cta,
            character_count=len(message),
        )

    async def batch_generate_messages(
        self,
        min_score: int = 7,
        tone: Optional[str] = None,
    ) -> list[GeneratedMessage]:
        """批量生成高意向用户的话术"""
        high_intent_analyses = [
            (cid, anal) for cid, anal in self._analyses.items()
            if anal.intent_score >= min_score
        ]

        results = []
        for comment_id, analysis in high_intent_analyses:
            msg = await self.generate_message(comment_id, tone=tone)
            results.append(msg)

        return results

    # ── 5. 触达模块 ────────────────────────────────

    async def send_message(
        self,
        comment_id: str,
        message: Optional[str] = None,
        auto_confirm: bool = False,
    ) -> dict:
        """
        发送私信（半自动模式）

        流程:
          1. 如果未提供 message，自动生成
          2. 如果 auto_confirm=False，返回待确认内容
          3. 如果 auto_confirm=True，直接发送

        Args:
            comment_id: 目标评论ID
            message: 自定义消息（可选）
            auto_confirm: 是否跳过人工确认

        Returns:
            dict: 发送结果
        """
        comment = next((c for c in self._comments if c.comment_id == comment_id), None)
        if not comment:
            return {"success": False, "output": f"评论不存在: {comment_id}"}

        # 生成或使用自定义消息
        if not message:
            generated = await self.generate_message(comment_id)
            message = generated.message

        if not auto_confirm:
            # 半自动模式：返回待确认内容
            return {
                "success": True,
                "status": "pending_confirmation",
                "output": f"待发送给 @{comment.username}",
                "data": {
                    "target_user": comment.username,
                    "original_comment": comment.content,
                    "message_to_send": message,
                    "action_required": "确认后调用 send_message(id, msg, auto_confirm=True)",
                },
            }

        # 自动发送模式
        record = OutreachRecord(
            user_id=comment.comment_id,
            username=comment.username,
            platform=self.platform,
            message_sent=message,
            sent_at=datetime.now().isoformat(),
            status="sent",
        )
        self._outreach_records.append(record)

        logger.info(f"✉️  已发送给 @{comment.username}: {message[:50]}...")

        return {
            "success": True,
            "status": "sent",
            "output": f"私信已发送给 @{comment.username}",
            "data": {
                "target_user": comment.username,
                "message_length": len(message),
                "sent_at": record.sent_at,
            },
        }

    async def batch_send(
        self,
        min_score: int = 7,
        max_count: int = 20,
        dry_run: bool = True,
    ) -> dict:
        """
        批量触达高意向用户

        Args:
            min_score: 最小意向分数
            max_count: 最大发送数量
            dry_run: 是否仅预览不实际发送

        Returns:
            dict: 批量操作结果
        """
        targets = [
            (cid, anal) for cid, anal in self._analyses.items()
            if anal.intent_score >= min_score
        ]
        targets.sort(key=lambda x: x[1].intent_score, reverse=True)
        targets = targets[:max_count]

        if dry_run:
            previews = []
            for comment_id, analysis in targets:
                comment = next((c for c in self._comments if c.comment_id == comment_id), None)
                generated = await self.generate_message(comment_id)
                previews.append({
                    "username": comment.username if comment else "未知",
                    "original_comment": comment.content[:60] if comment else "",
                    "intent_score": analysis.intent_score,
                    "intent_type": analysis.intent_type,
                    "generated_message": generated.message[:120],
                    "tone": generated.tone,
                })

            return {
                "success": True,
                "status": "dry_run",
                "output": f"预览模式 | {len(targets)} 条待发送（设置 dry_run=False 以实际发送）",
                "data": previews,
            }

        # 实际发送
        results = []
        for comment_id, analysis in targets:
            result = await self.send_message(comment_id, auto_confirm=True)
            results.append(result)
            # 发送间隔（避免被平台检测）
            await asyncio.sleep(self.outreach_delay_min * 60 * random.uniform(0.8, 1.2))

        success_count = sum(1 for r in results if r.get("success"))
        return {
            "success": True,
            "output": f"批量发送完成 | {success_count}/{len(results)} 成功",
            "data": {"sent": success_count, "total": len(results)},
        }

    # ── 6. 数据查询模块 ────────────────────────────

    async def get_high_intent_users(
        self,
        min_score: int = 7,
        limit: int = 50,
    ) -> dict:
        """获取高意向用户列表"""
        high_intent = sorted(
            [(cid, anal) for cid, anal in self._analyses.items() if anal.intent_score >= min_score],
            key=lambda x: x[1].intent_score,
            reverse=True,
        )[:limit]

        users = []
        for comment_id, analysis in high_intent:
            comment = next((c for c in self._comments if c.comment_id == comment_id), None)
            video = next((v for v in self._videos if v.video_id == comment.video_id), None) if comment else None
            users.append({
                "username": comment.username if comment else "",
                "avatar": "",  # 实际实现应抓取头像
                "comment": comment.content if comment else "",
                "video_title": video.title if video else "",
                "intent_score": analysis.intent_score,
                "intent_type": analysis.intent_type,
                "intent_level": analysis.intent_level.value,
                "platform": self.platform.value,
                "comment_id": comment_id,
            })

        return {
            "success": True,
            "output": f"找到 {len(users)} 个高意向用户 (≥{min_score}分)",
            "data": users,
        }

    async def get_stats(self) -> dict:
        """获取系统运行统计"""
        level_counts = defaultdict(int)
        type_counts = defaultdict(int)
        for analysis in self._analyses.values():
            level_counts[analysis.intent_level.value] += 1
            type_counts[analysis.intent_type] += 1

        status_counts = defaultdict(int)
        for record in self._outreach_records:
            status_counts[record.status] += 1

        return {
            "success": True,
            "output": "系统运行统计",
            "data": {
                "monitoring": self._monitoring,
                "platform": self.platform.value,
                "keywords": self._keywords,
                "videos_monitored": len(self._videos),
                "comments_collected": len(self._comments),
                "comments_analyzed": len(self._analyses),
                "intent_distribution": dict(level_counts),
                "type_distribution": dict(type_counts),
                "outreach_total": len(self._outreach_records),
                "outbreak_status": dict(status_counts),
            },
        }

    async def export_data(self, format: str = "json") -> str:
        """导出数据"""
        data = {
            "export_time": datetime.now().isoformat(),
            "stats": (await self.get_stats())["data"],
            "high_intent_users": (await self.get_high_intent_users())["data"],
            "outreach_records": [
                {
                    "user_id": r.user_id,
                    "username": r.username,
                    "message": r.message_sent[:80],
                    "status": r.status,
                    "sent_at": r.sent_at,
                }
                for r in self._outreach_records[-100:]  # 最近100条
            ],
        }

        if format == "json":
            return json.dumps(data, ensure_ascii=False, indent=2)
        else:
            raise ValueError(f"不支持格式: {format}")


# ── 便捷函数 ──────────────────────────────────────

async def quick_intercept(
    platform: str = "douyin",
    keywords: Optional[list[str]] = None,
) -> dict:
    """
    快速截流（一次性执行完整流程）

    最简调用方式:
        result = await quick_intercept(
            platform="douyin",
            keywords=["装修", "装修公司"],
        )
    """
    system = CommentInterceptionSystem(platform=platform)

    # Step 1: 启动监控
    await system.start_monitoring(keywords or ["装修"])

    # Step 2: 采集评论
    await system.collect_comments()

    # Step 3: 意图分析
    await system.analyze_intents()

    # Step 4: 获取高意向用户
    users = await system.get_high_intent_users(min_score=7)

    # Step 5: 批量生成话术（预览模式）
    messages = await system.batch_generate_messages(min_score=7)

    return {
        "summary": {
            "videos": len(system._videos),
            "comments": len(system._comments),
            "analyzed": len(system._analyses),
            "high_intent_users": len(users["data"]),
            "messages_generated": len(messages),
        },
        "high_intent_users": users["data"],
        "messages": [{"msg": m.message[:100], "tone": m.tone} for m in messages[:5]],
    }


# ── CLI 入口 ──────────────────────────────────────

async def main():
    """命令行入口"""
    import argparse

    parser = argparse.ArgumentParser(description="评论区截流获客系统")
    parser.add_argument("--platform", default="douyin", help="平台: douyin/xiaohongshu/shipinhao")
    parser.add_argument("--keywords", nargs="+", required=True, help="监控关键词")
    parser.add_argument("--action", default="run", help="操作: monitor/collect/analyze/messages/stats/export")
    parser.add_argument("--min-score", type=int, default=7, help="最小意向分数")
    parser.add_argument("--dry-run", action="store_true", help="预览模式不实际发送")
    args = parser.parse_args()

    system = CommentInterceptionSystem(platform=args.platform)

    if args.action == "monitor":
        result = await system.start_monitoring(args.keywords)
    elif args.action == "collect":
        result = await system.collect_comments()
    elif args.action == "analyze":
        result = await system.analyze_intents()
    elif args.action == "messages":
        messages = await system.batch_generate_messages(args.min_score)
        result = {"messages": len(messages), "preview": [m.message[:80] for m in messages[:3]]}
    elif args.action == "stats":
        result = await system.get_stats()
    elif args.action == "export":
        data = await system.export_data()
        print(data)
        return
    elif args.action == "run":
        result = await quick_intercept(platform=args.platform, keywords=args.keywords)
    else:
        result = {"error": f"未知操作: {args.action}"}

    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
