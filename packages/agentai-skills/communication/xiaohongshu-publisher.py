"""
小红书自动发布通道 — 可执行实现
=================================
基于 browser-engine 浏览器自动化能力，封装小红书网页版发布流程。

功能清单:
  - 登录态管理（Cookie/Session 持久化）
  - 图文笔记发布（标题 + 正文 + 图片上传）
  - 视频笔记发布（视频文件 + 封面 + 标题正文）
  - 发布参数配置（话题标签、@用户、位置、定时发布）
  - 频率限制与反检测（随机延迟、操作间隔、指纹模拟）
  - 发布结果验证（发布成功确认 + 笔记链接提取）
  - 批量发布队列（多内容排队、失败重试）

依赖:
  - browser-engine (浏览器自动化引擎)
  - playwright (浏览器控制)
  - 文件系统 (图片/视频素材读取)

使用方式:
  from xiaohongshu_publisher import XiaohongshuPublisher

  pub = XiaohongshuPublisher(headless=False)  # 首次需手动登录
  result = await pub.publish_note(
      title="我的装修日记",
      content="90%的人都不知道...",
      images=["photo1.jpg", "photo2.jpg"],
      topics=["装修", "家居"],
  )
"""

from typing import Any, Optional
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from enum import Enum
import asyncio
import random
import json
import time
import logging

# ── 日志配置 ──────────────────────────────────────
logger = logging.getLogger("xiaohongshu-publisher")


class NoteType(Enum):
    """笔记类型"""
    IMAGE_TEXT = "image_text"   # 图文笔记
    VIDEO = "video"              # 视频笔记


class PublishStatus(Enum):
    """发布状态"""
    PENDING = "pending"
    UPLOADING = "uploading"
    PUBLISHING = "publishing"
    SUCCESS = "success"
    FAILED = "failed"
    RETRYING = "retrying"


@dataclass
class PublishResult:
    """发布结果"""
    success: bool
    status: PublishStatus
    output: str
    note_url: Optional[str] = None
    note_id: Optional[str] = None
    error: Optional[str] = None
    data: Optional[dict[str, Any]] = None


@dataclass
class PublishConfig:
    """发布配置"""
    # 反检测参数
    headless: bool = False                # 是否无头模式（首次登录建议 False）
    min_delay_sec: float = 1.5            # 操作最小间隔(秒)
    max_delay_sec: float = 4.0            # 操作最大间隔(秒)
    upload_timeout_sec: int = 120         # 上传超时(秒)

    # 频率限制
    max_notes_per_hour: int = 3           # 每小时最多发布数
    min_interval_min: int = 20            # 两次发布最小间隔(分钟)

    # 重试策略
    max_retries: int = 3                  # 最大重试次数
    retry_delay_sec: float = 30.0         # 重试等待(秒)

    # 内容限制
    max_title_length: int = 20            # 标题最大字数
    max_content_length: int = 1000        # 正文最大字数
    max_images: int = 18                  # 最大图片数量
    max_video_size_mb: int = 500          # 视频最大大小(MB)
    max_topics: int = 10                  # 最大话题标签数

    # 路径配置
    cookie_path: str = ".cookies/xhs.json"  # Cookie 存储路径
    screenshot_dir: str = ".screenshots"     # 截图存储目录


# ── 核心发布器 ──────────────────────────────────

class XiaohongshuPublisher:
    """
    小红书自动发布器

    使用 browser-engine 提供的浏览器自动化能力，
    封装小红书网页版 (creator.xiaohongshu.com) 的完整发布流程。
    """

    XHS_CREATOR_URL = "https://creator.xiaohongshu.com/publish/publish"
    XHS_PUBLISH_API = "https://edith.xiaohongshu.com/api/sns/web/v1/note"

    def __init__(self, config: Optional[PublishConfig] = None):
        self.config = config or PublishConfig()
        self._browser = None          # browser-engine 实例
        self._page = None             # 当前页面
        self._publish_count_today = 0  # 今日已发布计数
        self._last_publish_time: Optional[datetime] = None
        self._queue: list[dict] = []   # 待发布队列
        self._is_logged_in = False

    # ── 生命周期管理 ──────────────────────────────

    async def start(self, headless: bool = False) -> bool:
        """
        启动浏览器并恢复登录态

        Args:
            headless: 是否无头模式（首次登录必须为 False）

        Returns:
            bool: 是否成功启动并登录
        """
        try:
            # 动态导入 browser-engine（避免硬依赖）
            from packages.agentai_gateway.src.browser_engine import BrowserEngine

            self._browser = BrowserEngine(
                headless=headless,
                user_data_dir="./browser-data/xhs",
            )
            await self._browser.start()

            # 恢复 Cookie / Session
            await self._restore_session()

            # 检查登录状态
            self._is_logged_in = await self._check_login()

            if not self._is_logged_in:
                logger.warning("⚠️  未检测到登录态，请在浏览器中手动登录小红书创作者平台")
                logger.info(f"   请访问: {self.XHS_CREATOR_URL}")
                logger.info("   登录完成后，按 Enter 继续...")

                # 等待手动登录（最多 5 分钟）
                for _ in range(300):
                    await asyncio.sleep(2)
                    self._is_logged_in = await self._check_login()
                    if self._is_logged_in:
                        break

                if not self._is_logged_in:
                    logger.error("❌ 登录超时")
                    return False

                # 保存登录态
                await self._save_session()

            logger.info("✅ 小红书发布器启动成功")
            return True

        except ImportError:
            logger.warning("⚠️  browser-engine 未安装，使用模拟模式")
            self._is_logged_in = True  # 模拟模式默认已登录
            return True
        except Exception as e:
            logger.error(f"❌ 启动失败: {e}")
            return False

    async def stop(self):
        """停止浏览器并清理资源"""
        if self._browser:
            try:
                await self._browser.close()
            except Exception:
                pass
            self._browser = None
            self._page = None
        logger.info("📴 小红书发布器已停止")

    # ── 核心发布方法 ────────────────