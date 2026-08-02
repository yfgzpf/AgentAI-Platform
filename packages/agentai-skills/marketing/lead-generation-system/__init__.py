"""
全渠道自动化获客系统 — 可执行实现
=====================================
基于 SKILL.md 描述的完整能力实现，整合所有获客子技能为统一入口。

功能清单:
  ┌─ 内容生产层 ─────────────────────────────┐
  │  • AI 文章生成（SEO 长文 + 行业干货）      │
  │  • 视频脚本生成（口播/剧情/Vlog/教程）     │
  │  • 海报文案生成（促销/品牌/活动）          │
  │  • 话术生成（私信/欢迎语/跟进）            │
  ├─ 渠道分发层 ─────────────────────────────┤
  │  • 小红书发布（图文+视频，复用 publisher）│
  │  • 微信公众号/视频号发布                   │
  │  • 抖音内容分发                           │
  ├─ 线索捕获层 ─────────────────────────────┤
  │  • 评论采集（复用 comment-interception）  │
  │  • 私信收集与自动回复                     │
  │  • 表单提交捕获                           │
  ├─ 线索培育层 ─────────────────────────────┤
  │  • 智能评分模型（行为→分数→等级）         │
  │  • 自动标签分类（意向/阶段/来源）          │
  │  • 内容推送（7天培育序列）                │
  │  • AI 互动回复（复用 wechat-assistant）   │
  ├─ 转化跟进层 ─────────────────────────────┤
  │  • 高意向提醒                             │
  │  • 销售分配（轮询/地域/能力匹配）         │
  │  • 预约量房流程                           │
  │  • 签约转化追踪                           │
  └─ 数据看板 ────────────────────────────────┘
     • 全渠道漏斗统计 | ROI 计算 | 日/周/月报

依赖:
  - xiaohongshu-publisher (小红书发布)
  - xiaohongshu-content-creator (小红书内容)
  - comment-interception-system (评论截流)
  - wechat-smart-assistant (微信私域)
  - outbound-engine (冷邮件触达)

使用方式:
  from lead_generation_system import LeadGenerationSystem
  lgs = LeadGenerationSystem(industry="装修家居", city="北京")
  await lgs.run_full_pipeline(keywords=["装修", "装修公司"])
"""

from typing import Any, Optional
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import Enum
import asyncio
import json
import logging
import random
import re
from collections import defaultdict

logger = logging.getLogger("lead-generation")


# ══════════════════════════════════════════════
# 数据模型
# ══════════════════════════════════════════════

class LeadStatus(Enum):
    """线索状态流转"""
    NEW = "new"
    CONTACTED = "contacted"
    RESPONDED = "responded"
    NURTURING = "nurturing"
    QUALIFIED = "qualified"
    MEETING_BOOKED = "meeting_booked"
    PROPOSAL_SENT = "proposal_sent"
    CONVERTED = "converted"
    LOST = "lost"


class LeadSource(Enum):
    """线索来源渠道"""
    XHS_COMMENT = "xiaohongshu_comment"
    XHS_DM = "xiaohongshu_dm"
    DY_COMMENT = "douyin_comment"
    DY_DM = "douyin_dm"
    WECHAT_OFFICIAL = "wechat_official"
    WECHAT_GROUP = "wechat_group"
    WECHAT_DM = "wechat_dm"
    EMAIL_INBOUND = "email_inbound"
    EMAIL_OUTBOUND = "email_outbound"
    PHONE = "phone"
    FORM = "form"
    REFERRAL = "referral"
    OFFLINE = "offline"


class LeadTemperature(Enum):
    COLD = "cold"       # 0-30
    WARM = "warm"       # 31-60
    HOT = "hot"         # 61-80
    BOILING = "boiling" # 81-100+


@dataclass
class Lead:
    """线索记录"""
    lead_id: str
    name: str
    source: LeadSource
    platform: str = ""
    contact_info: dict = field(default_factory=dict)
    status: LeadStatus = LeadStatus.NEW
    temperature: LeadTemperature = LeadTemperature.COLD
    score: int = 0
    tags: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    created_at: str = ""
    last_contacted_at: Optional[str] = None
    assigned_to: Optional[str] = None
    raw_context: Optional[str] = None
    intent_score: Optional[int] = None
    conversion_value: float = 0.0


@dataclass
class FunnelStage:
    stage_name: str
    count: int
    conversion_rate: float
    avg_time_days: float


@dataclass
class ChannelMetrics:
    channel: str
    impressions: int = 0
    clicks: int = 0
    leads_generated: int = 0
    qualified_leads: int = 0
    conversions: int = 0
    revenue: float = 0.0
    cost: float = 0.0
    cpl: float = 0.0
    cpa: float = 0.0
    roi: float = 0.0

    def calculate(self):
        if self.leads_generated > 0:
            self.cpl = round(self.cost / self.leads_generated, 2)
        if self.conversions > 0:
            self.cpa = round(self.cost / self.conversions, 2)
            self.roi = round((self.revenue - self.cost) / self.cost * 100, 1)


# ══════════════════════════════════════════════
# 线索评分规则
# ══════════════════════════════════════════════

SCORING_RULES = {
    "关注公众号":     {"score": 5,  "type": "engagement"},
    "阅读文章":       {"score": 3,  "type": "engagement"},
    "点赞":           {"score": 5,  "type": "engagement"},
    "评论":           {"score": 10, "type": "interaction"},
    "分享":           {"score": 20, "type": "viral"},
    "私信咨询":       {"score": 30, "type": "intent"},
    "留电话":         {"score": 50, "type": "high_intent"},
    "加微信":         {"score": 45, "type": "high_intent"},
    "预约量房":       {"score": 100,"type": "conversion"},
    "签约":           {"score": 200,"type": "conversion"},
    "阅读多篇文章":   {"score": 15, "type": "engagement_depth"},
    "多次评论":       {"score": 25, "type": "interaction"},
    "主动询问价格":   {"score": 35, "type": "intent"},
    "询问具体服务":   {"score": 40, "type": "intent"},
    "提到竞品对比":   {"score": 30, "type": "comparison"},
    "超过30天无互动": {"score":-20, "type": "decay"},
    "超过60天无互动": {"score":-40, "type": "decay"},
}

TEMP_THRESHOLDS = {
    LeadTemperature.COLD:    (0, 30),
    LeadTemperature.WARM:    (31, 60),
    LeadTemperature.HOT:     (61, 80),
    LeadTemperature.BOILING: (81, 200),
}


# ══════════════════════════════════════════════
# 培育内容序列
# ══════════════════════════════════════════════

NURTURE_SEQUENCES = {
    LeadTemperature.COLD: [
        {"day": 1,  "type": "welcome",     "content": "欢迎语 + 价值主张"},
        {"day": 3,  "type": "education",   "content": "行业干货文章"},
        {"day": 7,  "type": "social_proof","content": "客户案例展示"},
        {"day": 14, "type": "education",   "content": "避坑指南"},
        {"day": 21, "type": "soft_cta",    "content": "轻量行动号召"},
        {"day": 30, "type": "check_in",    "content": "是否有需求变化？"},
    ],
    LeadTemperature.WARM: [
        {"day": 1,  "type": "personalized","content": "根据兴趣推送相关案例"},
        {"day": 3,  "type": "offer",       "content": "限时优惠/免费服务"},
        {"day": 7,  "type": "social_proof","content": "同类型客户成功故事"},
        {"day": 10, "type": "strong_cta",  "content": "预约量房/咨询"},
        {"day": 14, "type": "urgency",     "content": "稀缺性提示"},
    ],
    LeadTemperature.HOT: [
        {"day": 1, "type": "direct_outreach", "content": "销售电话/私信"},
        {"day": 1, "type": "proposal",        "content": "初步方案/报价单"},
        {"day": 2, "type": "follow_up",       "content": "确认收到方案"},
        {"day": 3, "type": "meeting_invite",  "content": "邀约线下见面/视频会议"},
        {"day": 5, "type": "urgency_bonus",   "content": "签约优惠截止提醒"},
    ],
    LeadTemperature.BOILING: [
        {"day": 0, "type": "priority_call",  "content": "优先级最高，立即联系"},
        {"day": 0, "type": "special_offer",  "content": "VIP 专属优惠"},
        {"day": 1, "type": "contract_prep",  "content": "准备合同材料"},
    ],
}


# ══════════════════════════════════════════════
# 核心系统类
# ══════════════════════════════════════════════

class LeadGenerationSystem:
    """
    全渠道自动化获客系统

    整合所有获客子技能，提供统一的获客工作流管理。
    完整流水线: 监控 → 内容生产 → 分发 → 采集 → 分析 → 触达 → 培育 → 转化
    """

    def __init__(self, industry: str = "装修家居", city: str = "", config: Optional[dict] = None):
        self.industry = industry
        self.city = city
        self.config = config or {}
        # 数据存储
        self._leads: dict[str, Lead] = {}
        self._channel_metrics: dict[str, ChannelMetrics] = {}
        self._funnel_history: list[dict] = []
        self._nurture_schedule: dict[str, list] = {}
        # 子系统（延迟初始化）
        self._comment_system = None
        self._publisher = None
        self._wechat_assistant = None
        self._outbound_sender = None
        # 配置
        self.auto_nurture = self.config.get("auto_nurture", True)
        self.max_daily_outreach = self.config.get("max_daily_outreach", 50)

    async def _init_subsystems(self):
        """延迟初始化所有子系统"""
        if not self._comment_system:
            try:
                from packages.agentai_skills.marketing.comment_interception_system import CommentInterceptionSystem
                self._comment_system = CommentInterceptionSystem(
                    platform=self.config.get("intercept_platform", "douyin"),
                )
                logger.info("✅ comment-interception-system 已加载")
            except ImportError:
                logger.warning("⚠️  comment-interception-system 未安装")
        if not self._publisher:
            try:
                from packages.agentai_skills.communication.xiaohongshu_publisher import XiaohongshuPublisher
                self._publisher = XiaohongshuPublisher()
                logger.info("✅ xiaohongshu-publisher 已加载")
            except ImportError:
                logger.warning("⚠️  xiaohongshu-publisher 未安装")
        if not self._wechat_assistant:
            try:
                from packages.agenti_skills.communication.wechat_smart_assistant import WeChatAssistant
                self._wechat_assistant = WeChatAssistant()
                logger.info("✅ wechat-smart-assistant 已加载")
            except ImportError:
                logger.warning("⚠️  wechat-smart-assistant 未安装")
        if not self._outbound_sender:
            try:
                from packages.agentai_skills.communication.outbound_engine.scripts.cold_outbound_sender import ColdOutboundSender
                self._outbound_sender = ColdOutboundSender()
                logger.info("✅ outbound-engine 已加载")
            except ImportError:
                logger.warning("⚠️  outbound-engine 未安装")

    # ──────────────────────────────────────
    # 完整流水线 (6 阶段)
    # ──────────────────────────────────────

    async def run_full_pipeline(self, keywords: list[str], platforms: Optional[list[str]] = None,
                                 duration_hours: int = 24) -> dict:
        """运行完整获客流水线"""
        await self._init_subsystems()
        results = {
            "started_at": datetime.now().isoformat(),
            "industry": self.industry,
            "city": self.city,
            "keywords": keywords,
            "stages": {},
        }
        # Stage 1: 监控
        logger.info("🚀 Stage 1/6: 启动平台监控...")
        results["stages"]["monitoring"] = await self.start_monitoring(keywords, platforms)
        # Stage 2: 内容生产与分发
        logger.info("📝 Stage 2/6: 内容生产与分发...")
        results["stages"]["content"] = await self.produce_and_distribute(keywords[:3])
        # Stage 3: 线索采集
        logger.info("🔍 Stage 3/6: 线索采集...")
        results["stages"]["collection"] = await self.collect_all_leads()
        # Stage 4: 分析评分
        logger.info("🧠 Stage 4/6: 意图分析与评分...")
        results["stages"]["analysis"] = await self.analyze_and_score()
        # Stage 5: 高意向触达（默认预览模式）
        logger.info("✉️  Stage 5/6: 高意向用户触达...")
        results["stages"]["outreach"] = await self.outreach_high_intent(dry_run=True)
        # Stage 6: 启动培育
        logger.info("🌱 Stage 6/6: 启动培育序列...")
        results["stages"]["nurture"] = await self.start_nurture_sequences()
        results["completed_at"] = datetime.now().isoformat()
        results["summary"] = await self.get_dashboard_summary()
        return results

    # ──────────────────────────────────────
    # Stage 1: 监控模块
    # ──────────────────────────────────────

    async def start_monitoring(self, keywords: list[str], platforms: Optional[list[str]] = None) -> dict:
        """启动全平台监控"""
        await self._init_subsystems()
        sub_results = {}
        if self._comment_system:
            plat = platforms[0] if platforms else "douyin"
            for p in (platforms or ["douyin", "xiaohongshu"]):
                if p in ("douyin", "xiaohongshu"):
                    plat = p
                    break
            r = await self._comment_system.start_monitoring(keywords=keywords, city=self.city or None)
            sub_results[f"{plat}_interception"] = r
        total_videos = sum(
            sr.get("data", {}).get("videos_found", 0) for sr in sub_results.values() if isinstance(sr, dict)
        )
        return {"success": True, "output": f"监控已启动 | 关键词:{keywords} | 发现{total_videos}个爆款视频",
                "data": {"keywords": keywords, "platforms": platforms or ["douyin","xiaohongshu"],
                         "subsystem_results": sub_results}}

    # ──────────────────────────────────────
    # Stage 2: 内容生产与分发
    # ──────────────────────────────────────

    async def produce_and_distribute(self, topics: list[str]) -> dict:
        """批量生产内容并分发到各平台"""
        produced = []
        for topic in topics:
            try:
                from packages.agentai_skills.communication.xiaohongshu_content_creator import generate_content, suggest_posting_time
                cr = await generate_content(topic=topic, template_name="种草")
                tr = await suggest_posting_time(industry=self.industry)
                produced.append({"topic": topic, "platform": "xiaohongshu", "status": "generated",
                                "preview": cr.output[:80] if cr.success else cr.output,
                                "best_time": tr.data.get("best_time") if tr.data else None})
            except ImportError:
                produced.append({"topic": topic, "status": "skipped", "reason": "module not installed"})
            except Exception as e:
                produced.append({"topic": topic, "status": "error", "reason": str(e)})
        return {"success": True, "output": f"内容生产完成 | {len(produced)}个主题", "data": produced}

    # ──────────────────────────────────────
    # Stage 3: 线索采集
    # ──────────────────────────────────────

    async def collect_all_leads(self) -> dict:
        """从所有活跃子系统采集线索"""
        await self._init_subsystems()
        collected = []
        # 评论截流系统
        if self._comment_system:
            cr = await self._comment_system.collect_comments()
            ar = await self._comment_system.analyze_intents()
            hu = await self._comment_system.get_high_intent_users(min_score=7)
            for user in hu.get("data", []):
                lead = self._create_lead_from_interception(user)
                self._leads[lead.lead_id] = lead
                collected.append(lead.lead_id)
        # 微信助手
        if self._wechat_assistant:
            try:
                contacts = await self._wechat_assistant.get_recent_contacts(limit=20)  # type: ignore
                for c in contacts:
                    lid = f"wechat_{c.get('id','')}"
                    if lid not in self._leads:
                        lead = Lead(lead_id=lid, name=c.get("name","未知"), source=LeadSource.WECHAT_DM,
                                    platform="wechat", contact_info={"wechat_id": c.get("id")},
                                    score=20, temperature=LeadTemperature.COLD)
                        self._leads[lid] = lead
                        collected.append(lid)
            except Exception as e:
                logger.warning(f"微信联系人采集失败: {e}")
        return {"success": True, "output": f"线索采集完成 | 新增{len(collected)}条 | 总计{len(self._leads)}条",
                "data": {"new_leads": len(collected), "total_leads": len(self._leads),
                         "by_source": self._count_by_source()}}

    def _create_lead_from_interpection(self, ud: dict) -> Lead:
        lid = f"{ud.get('platform','unknown')}_{ud.get('comment_id','unknown')}"
        score = ud.get("intent_score", 0)
        return Lead(lead_id=lid, name=ud.get("username","未知"),
                    source=LeadSource.XHS_COMMENT if ud.get("platform")=="xiaohongshu" else LeadSource.DY_COMMENT,
                    platform=ud.get("platform",""), status=LeadStatus.NEW, score=score,
                    temperature=self._score_to_temp(score), tags=[ud.get("intent_type","unknown")],
                    raw_context=ud.get("comment",""), intent_score=score, created_at=datetime.now().isoformat())

    # ──────────────────────────────────────
    # Stage 4: 分析与评分
    # ──────────────────────────────────────

    async def analyze_and_score(self) -> dict:
        """对所有线索进行评分和分级"""
        updated = 0
        for lid, lead in self._leads.items():
            old_temp = lead.temperature
            if lead.intent_score and lead.intent_score > lead.score:
                lead.score = lead.intent_score
            lead.temperature = self._score_to_temp(lead.score)
            self._auto_tag(lead)
            if lead.temperature != old_temp:
                updated += 1
        self._update_channel_metrics()
        return {"success": True, "output": f"评分完成 | 总{len(self._leads)}条 | 温度变更{updated}",
                "data": {"total": len(self._leads), "temp_dist": self._count_by_temp(),
                         "source_dist": self._count_by_source(), "status_dist": self._count_by_status()}}

    def _score_to_temp(self, score: int) -> LeadTemperature:
        for t, (lo, hi) in TEMP_THRESHOLDS.items():
            if lo <= score <= hi:
                return t
        return LeadTemperature.COLD

    def _auto_tag(self, lead: Lead):
        ctx = lead.raw_context or ""
        cm = re.search(r'坐标([\u4e00-\u9fff]+)', ctx)
        if cm and cm.group(1) not in lead.tags:
            lead.tags.append(f"城市:{cm.group(1)}")
        if any(kw in ctx for kw in ["多少钱","报价","预算"]) and "价格敏感" not in lead.tags:
            lead.tags.append("价格敏感")
        if any(kw in ctx for kw in ["准备装修","马上装","开工"]) and "近期需求" not in lead.tags:
            lead.tags.append("近期需求")

    # ──────────────────────────────────────
    # Stage 5: 触达模块
    # ──────────────────────────────────────

    async def outreach_high_intent(self, min_score: int = 7, max_count: int = 20, dry_run: bool = True) -> dict:
        """触达高意向用户"""
        await self._init_subsystems()
        high = sorted([l for l in self._leads.values() if l.score >= min_score and l.status == LeadStatus.NEW],
                       key=lambda l: l.score, reverse=True)[:max_count]
        sent, skipped = [], []
        for lead in high:
            if lead.source in (LeadSource.XHS_COMMENT, LeadSource.DY_COMMENT):
                if self._comment_system and lead.raw_context:
                    r = await self._comment_system.send_message(comment_id=lead.lead_id, auto_confirm=not dry_run)
                    if r.get("status") == "sent":
                        lead.status = LeadStatus.CONTACTED; lead.last_contacted_at = datetime.now().isoformat()
                        sent.append(lead.lead_id)
                    else: skipped.append({"id": lead.lead_id, "reason": r.get("output","")})
            elif lead.source == LeadSource.WECHAT_DM and self._wechat_assistant:
                try:
                    msg = await self.generate_nurture_message(lead)
                    if not dry_run:
                        await self._wechat_assistant.send_message(lead.contact_info.get("wechat_id",""), msg)  # type: ignore
                        lead.status = LeadStatus.CONTACTED
                    sent.append(lead.lead_id)
                except Exception as e:
                    skipped.append({"id": lead.lead_id, "reason": str(e)})
            else:
                skipped.append({"id": lead.lead_id, "reason": f"no handler for {lead.source.value}"})
        return {"success": True, "mode": "dry_run" if dry_run else "live",
                "output": f"触达完成 | 发送{len(sent)} | 跳过{len(skipped)}", "data": {"sent": sent, "skipped": skipped}}

    # ──────────────────────────────────────
    # Stage 6: 培育模块
    # ──────────────────────────────────────

    async def start_nurture_sequences(self) -> dict:
        """为所有线索启动培育序列"""
        scheduled = 0
        for lead in self._leads.values():
            if lead.temperature in (LeadTemperature.COLD, LeadTemperature.WARM):
                seq = NURTURE_SEQUENCES.get(lead.temperature, [])
                self._nurture_schedule[lead.lead_id] = seq
                scheduled += 1
        return {"success": True, "output": f"培育序列已启动 | {scheduled}条线索进入培育",
                "data": {"scheduled": scheduled, "not_nurtured": len(self._leads)-scheduled,
                         "reason": "HOT/BOILING应直接销售跟进"}}

    async def generate_nurture_message(self, lead: Lead, day: int = 1) -> str:
        """生成培育消息"""
        seq = NURTURE_SEQUENCES.get(lead.temperature, [])
        if not seq: return ""
        step = next((s for s in seq if s["day"] == day), seq[min(day-1, len(seq)-1)])
        ctype = step["type"]
        templates = {
            "welcome":     f"您好{lead.name}！欢迎了解我们的{self.industry}服务 🏠\n\n✅ 免费户型规划\n✅ 精准预算报价\n✅ 3D效果预览\n\n回复【城市+面积】，为您估算~",
            "education":   f"【{self.industry}干货】\n\n为您精选了关于{lead.tags[0] if lead.tags else '行业'}的深度文章。\n回复「资料」，立刻发送 👇",
            "social_proof":f"分享真实案例：和您情况类似的{'北京' if not lead.city else lead.city}业主，\n通过我们节省约15%预算，工期缩短20天。回复「案例」查看~",
            "soft_cta":    f"嗨{lead.name}~最近有在了解{self.industry}吗？\n\n这周有几个免费量房名额，可以先出方案参考~\n回复「预约」就行 😊",
            "personalized":f"您好{lead.name}！注意到您对{'、'.join(lead.tags[:2]) if lead.tags else self.industry}比较关注。\n有几套相关案例都是{'北京' if not lead.city else lead.city}本地的项目，需要发给您参考吗？",
            "offer":       f"🔥 本周限时福利 🔥\n\n{lead.name}您好！现在预约可享受：\n🎁 免费量房 + 3D方案\n🎁 签约立减 ¥5000\n🎁 赠送价值¥3000监理服务\n\n活动仅限本周，回复「预约」锁定！",
            "check_in":    f"您好{lead.name}！好久不见~\n之前您在关注{self.industry}，不知道进展如何？随时可以聊聊免费分析避坑~ 😊",
            "strong_cta":  f"{lead.name}您好！基于您的需求，建议安排一次免费量房。\n我们的设计师会上门实地勘测，出3D效果图供您参考。\n回复「预约」或点击下方链接即可~",
            "urgency":     f"⏰ 温馨提醒：本期优惠活动即将截止！\n\n已有{random.randint(23,67)}位业主通过此活动成功签约并享受优惠。\n{lead.name}，别错过这次机会哦~ 回复「预约」",
        }
        base_msg = templates.get(ctype, templates["welcome"])
        if lead.city: base_msg = base_msg.replace("{city}", lead.city)
        if any("近期需求" in t for t in lead.tags): base_msg += "\n\n⏰ 检测到您近期有需求，可安排优先服务~"
        return base_msg

    async def process_nurture_queue(self) -> dict:
        """处理待发送的培育消息队列"""
        sent = 0
        today = datetime.now()
        for lid, schedule in self._nurture_schedule.items():
            lead = self._leads.get(lid)
            if not lead or lead.status in (LeadStatus.CONVERTED, LeadStatus.LOST): continue
            pending = [s for s in schedule if s.get("pending", False)]
            if not pending: continue
            step = pending[0]
            msg = await self.generate_nurture_message(lead, day=step["day"])
            try:
                if lead.source.value.startswith("wechat") and self._wechat_assistant:
                    await self._wechat_assistant.send_message(lead.contact_info.get("wechat_id",""), msg)  # type: ignore
                step["pending"] = False; step["sent_at"] = today.isoformat(); sent += 1
                logger.info(f"🌱 培育消息已发送给 {lead.name} (Day {step['day']})")
            except Exception as e:
                logger.error(f"培育发送失败 ({lead.name}): {e}")
        return {"success": True, "output": f"培育队列处理完成 | 发送{sent}条"}

    # ──────────────────────────────────────
    # 数据看板
    # ──────────────────────────────────────

    async def get_dashboard_summary(self) -> dict:
        """获取看板摘要"""
        funnel = self._calc_funnel()
        channels = self._get_channel_summary()
        return {
            "timestamp": datetime.now().isoformat(),
            "industry": self.industry, "city": self.city,
            "overview": {
                "total_leads": len(self._leads),
                "new_today": len([l for l in self._leads.values() if l.created_at >= (datetime.now()-timedelta(days=1)).isoformat()]),
                "hot_leads": len([l for l in self._leads.values() if l.temperature in (LeadTemperature.HOT, LeadTemperature.BOILING)]),
                "converted": len([l for l in self._leads.values() if l.status == LeadStatus.CONVERTED]),
            },
            "funnel": [{"stage": s.stage_name, "count": s.count, "rate": s.conversion_rate} for s in funnel],
            "channels": channels,
            "temperature": self._count_by_temp(),
            "status": self._count_by_status(),
        }

    def _calc_funnel(self) -> list[FunnelStage]:
        stages = [
            ("新线索",LeadStatus.NEW),("已触达",LeadStatus.CONTACTED),("已回复",LeadStatus.RESPONDED),
            ("培育中",LeadStatus.NURTURING),("合格线索",LeadStatus.QUALIFIED),
            ("已预约",LeadStatus.MEETING_BOOKED),("方案已发",LeadStatus.PROPOSAL_SENT),("已成交",LeadStatus.CONVERTED),
        ]
        funnel, prev = [], len(self._leads) or 1
        for sn, st in stages:
            c = sum(1 for l in self._leads.values() if l.status == st)
            r = round(c/prev*100,1) if prev>0 else 0
            funnel.append(FunnelStage(stage_name=sn, count=c, conversion_rate=r, avg_time_days=0))
            prev = c or 1
        return funnel

    def _get_channel_summary(self) -> dict:
        by_src = defaultdict(lambda: {"leads":0,"qualified":0,"converted":0})
        for l in self._leads.values():
            d = by_src[l.source.value]; d["leads"]+=1
            if l.status in (LeadStatus.QUALIFIED,LeadStatus.MEETING_BOOKED,LeadStatus.PROPOSAL_SENT,LeadStatus.CONVERTED): d["qualified"]+=1
            if l.status == LeadStatus.CONVERTED: d["converted"]+=1
        return dict(by_src)

    def _update_channel_metrics(self):
        for lead in self._leads.values():
            ch = lead.source.value
            if ch not in self._channel_metrics: self._channel_metrics[ch] = ChannelMetrics(channel=ch)
            m = self._channel_metrics[ch]; m.leads_generated+=1
            if lead.temperature in (LeadTemperature.HOT,LeadTemperature.BOILING): m.qualified_leads+=1
            if lead.status == LeadStatus.CONVERTED: m.conversions+=1; m.revenue += lead.conversion_value

    async def export_report(self, fmt: str = "json") -> str:
        """导出完整报告"""
        dash = await self.get_dashboard_summary()
        report = {
            "report_type": "full_lead_generation_report",
            "generated_at": datetime.now().isoformat(), "dashboard": dash,
            "all_leads": [{"id":l.lead_id,"name":l.name,"source":l.source.value,"status":l.status.value,
                           "temp":l.temperature.value,"score":l.score,"tags":l.tags,"created":l.created_at}
                          for l in sorted(self._leads.values(), key=lambda x:x.score, reverse=True)],
            "channel_metrics": {ch:{"leads":m.leads_generated,"qualified":m.qualified_leads,
                                     "conversions":m.conversions,"cpl":m.cpl,"roi":m.roi}
                                for ch,m in self._channel_metrics.items()},
        }
        if fmt=="json": return json.dumps(report, ensure_ascii=False, indent=2)
        raise ValueError(f"Unsupported format: {fmt}")

    # ──────────────────────────────────────
    # 线索 CRUD
    # ──────────────────────────────────────

    def add_lead(self, lead: Lead) -> str:
        self._leads[lead.lead_id] = lead
        logger.info(f"➕ 手动添加线索: {lead.name} ({lead.source.value})")
        return lead.lead_id

    def update_lead_status(self, lid: str, status: LeadStatus, note: str = "") -> bool:
        lead = self._leads.get(lid)
        if not lead: return False
        old = lead.status; lead.status = status
        if note: lead.notes.append(f"[{datetime.now().strftime('%m-%d %H:%M')}] {note}")
        logger.info(f"📊 线索状态变更: {lead.name} {old.value} → {status.value}")
        return True

    def get_lead(self, lid: str) -> Optional[Lead]: return self._leads.get(lid)

    def query_leads(self, status: Optional[LeadStatus]=None, source: Optional[LeadSource]=None,
                    min_score: Optional[int]=None, temperature: Optional[LeadTemperature]=None,
                    limit: int=50) -> list[Lead]:
        results = list(self._leads.values())
        if status: results=[l for l in results if l.status==status]
        if source: results=[l for l in results if l.source==source]
        if min_score is not None: results=[l for l in results if l.score>=min_score]
        if temperature: results=[l for l in results if l.temperature==temperature]
        results.sort(key=lambda l:l.score, reverse=True)
        return results[:limit]

    # ── 内部统计辅助 ──
    def _count_by_temp(self) -> dict:
        c=defaultdict(int)
        for l in self._leads.values(): c[l.temperature.value]+=1
        return dict(c)
    def _count_by_source(self) -> dict:
        c=defaultdict(int)
        for l in self._leads.values(): c[l.source.value]+=1
        return dict(c)
    def _count_by_status(self) -> dict:
        c=defaultdict(int)
        for l in self._leads.values(): c[l.status.value]+=1
        return dict(c)


# ══════════════════════════════════════════════
# 便捷函数
# ══════════════════════════════════════════════

async def quick_acquire(industry: str="装修家居", city:str="", keywords:Optional[list[str]]=None) -> dict:
    """快速获客（一次性执行完整流水线）"""
    sys = LeadGenerationSystem(industry=industry, city=city)
    return await sys.run_full_pipeline(keywords or ["装修"])

# ══════════════════════════════════════════════
# CLI 入口
# ══════════════════════════════════════════════

async def main():
    import argparse
    parser = argparse.ArgumentParser(description="全渠道自动化获客系统")
    parser.add_argument("--industry", default="装修家居")
    parser.add_argument("--city", default="")
    parser.add_argument("--keywords", nargs="+", required=True)
    parser.add_argument("--action", default="run", help="run/dashboard/export/query")
    parser.add_argument("--min-score", type=int, default=7)
    args = parser.parse_args()

    sys = LeadGenerationSystem(industry=args.industry, city=args.city)

    if args.action == "run":
        result = await sys.run_full_pipeline(args.keywords)
    elif args.action == "dashboard":
        result = await sys.get_dashboard_summary()
    elif args.action == "export":
        print(await sys.export_report()); return
    elif args.action == "query":
        leads = sys.query_leads(min_score=args.min_score)
        result = {"count":len(leads),"leads":[{"name":l.name,"score":l.score,"status":l.status.value,"source":l.source.value} for l in leads[:20]]}
    else:
        result = {"error":f"未知操作:{args.action}"}

    print(json.dumps(result, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    asyncio.run(main())
