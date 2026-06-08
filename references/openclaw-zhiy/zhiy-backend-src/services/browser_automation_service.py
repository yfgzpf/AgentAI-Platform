"""
通用浏览器自动化服务
支持打开网站、搜索、提取内容、下载文件、截图等操作
"""

import asyncio
from typing import Dict, List, Optional, Any
from playwright.async_api import async_playwright, Browser, Page, BrowserContext
import logging
import os
from datetime import datetime

logger = logging.getLogger(__name__)


class BrowserAutomationService:
    """
    通用浏览器自动化服务
    """

    def __init__(self):
        self.browser: Optional[Browser] = None
        self.context: Optional[BrowserContext] = None
        self.page: Optional[Page] = None
        self.playwright = None
        self.download_dir = os.path.join(os.getcwd(), "downloads")
        self._ensure_download_dir()

    def _ensure_download_dir(self):
        """确保下载目录存在"""
        if not os.path.exists(self.download_dir):
            os.makedirs(self.download_dir)
            logger.info(f"创建下载目录: {self.download_dir}")

    async def start(self, headless: bool = False):
        """
        启动浏览器

        Args:
            headless: 是否无头模式（不显示浏览器窗口）
        """
        try:
            self.playwright = await async_playwright().start()
            self.browser = await self.playwright.chromium.launch(
                headless=headless,
                args=['--disable-blink-features=AutomationControlled']
            )
            self.context = await self.browser.new_context(
                viewport={'width': 1920, 'height': 1080},
                user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            )
            self.page = await self.context.new_page()
            logger.info("浏览器启动成功")
            return True
        except Exception as e:
            logger.error(f"浏览器启动失败: {str(e)}")
            raise

    async def close(self):
        """关闭浏览器"""
        try:
            if self.page:
                await self.page.close()
            if self.context:
                await self.context.close()
            if self.browser:
                await self.browser.close()
            if self.playwright:
                await self.playwright.stop()
            logger.info("浏览器已关闭")
        except Exception as e:
            logger.error(f"关闭浏览器时出错: {str(e)}")

    async def navigate_to(self, url: str, wait_for_load: str = "networkidle"):
        """
        导航到指定URL

        Args:
            url: 目标URL
            wait_for_load: 等待加载状态 ('load', 'domcontentloaded', 'networkidle')
        """
        try:
            logger.info(f"正在导航到: {url}")
            await self.page.goto(url, wait_until=wait_for_load, timeout=30000)
            logger.info(f"成功加载页面: {url}")
            return True
        except Exception as e:
            logger.error(f"导航失败: {str(e)}")
            raise

    async def search(self, search_query: str, search_selector: str = 'input[type="search"], input[name="search"], input[placeholder*="搜索"]'):
        """
        在当前页面执行搜索

        Args:
            search_query: 搜索关键词
            search_selector: 搜索框选择器
        """
        try:
            logger.info(f"执行搜索: {search_query}")
            
            # 查找搜索框
            search_input = await self.page.wait_for_selector(search_selector, timeout=5000)
            
            if search_input:
                await search_input.fill(search_query)
                await asyncio.sleep(0.5)
                
                # 尝试按回车或点击搜索按钮
                await search_input.press("Enter")
                await asyncio.sleep(2)
                
                logger.info(f"搜索完成: {search_query}")
                return True
            else:
                logger.warning("未找到搜索框")
                return False
                
        except Exception as e:
            logger.error(f"搜索失败: {str(e)}")
            raise

    async def extract_text(self, selector: str = "body") -> str:
        """
        提取页面文本内容

        Args:
            selector: CSS选择器，默认提取整个页面
        """
        try:
            element = await self.page.wait_for_selector(selector, timeout=10000)
            text = await element.inner_text()
            logger.info(f"提取文本成功，长度: {len(text)}")
            return text
        except Exception as e:
            logger.error(f"提取文本失败: {str(e)}")
            raise

    async def extract_images(self, selector: str = "img") -> List[Dict[str, str]]:
        """
        提取页面图片信息

        Args:
            selector: 图片选择器
        """
        try:
            images = await self.page.query_selector_all(selector)
            image_list = []
            
            for idx, img in enumerate(images):
                src = await img.get_attribute("src")
                alt = await img.get_attribute("alt") or ""
                
                if src:
                    image_list.append({
                        "index": idx,
                        "src": src,
                        "alt": alt,
                        "url": src if src.startswith("http") else None
                    })
            
            logger.info(f"提取到 {len(image_list)} 张图片")
            return image_list
            
        except Exception as e:
            logger.error(f"提取图片失败: {str(e)}")
            raise

    async def download_image(self, image_url: str, filename: Optional[str] = None) -> str:
        """
        下载图片

        Args:
            image_url: 图片URL
            filename: 保存文件名，如果不指定则自动生成
        """
        try:
            if not filename:
                timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                filename = f"image_{timestamp}.jpg"
            
            filepath = os.path.join(self.download_dir, filename)
            
            # 使用页面下载
            async with self.page.expect_download() as download_info:
                await self.page.goto(image_url)
            download = await download_info.value
            
            await download.save_as(filepath)
            logger.info(f"图片下载成功: {filepath}")
            
            return filepath
            
        except Exception as e:
            logger.error(f"下载图片失败: {str(e)}")
            raise

    async def screenshot(self, filename: Optional[str] = None, full_page: bool = False) -> str:
        """
        截图

        Args:
            filename: 保存文件名
            full_page: 是否截取整个页面
        """
        try:
            if not filename:
                timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                filename = f"screenshot_{timestamp}.png"
            
            filepath = os.path.join(self.download_dir, filename)
            
            await self.page.screenshot(
                path=filepath,
                full_page=full_page
            )
            
            logger.info(f"截图保存成功: {filepath}")
            return filepath
            
        except Exception as e:
            logger.error(f"截图失败: {str(e)}")
            raise

    async def click_element(self, selector: str):
        """
        点击元素

        Args:
            selector: CSS选择器
        """
        try:
            element = await self.page.wait_for_selector(selector, timeout=10000)
            await element.click()
            logger.info(f"点击元素成功: {selector}")
            return True
        except Exception as e:
            logger.error(f"点击元素失败: {str(e)}")
            raise

    async def fill_input(self, selector: str, value: str):
        """
        填写输入框

        Args:
            selector: CSS选择器
            value: 填写内容
        """
        try:
            element = await self.page.wait_for_selector(selector, timeout=10000)
            await element.fill(value)
            logger.info(f"填写输入框成功: {selector}")
            return True
        except Exception as e:
            logger.error(f"填写输入框失败: {str(e)}")
            raise

    async def wait_for_element(self, selector: str, timeout: int = 10000):
        """
        等待元素出现

        Args:
            selector: CSS选择器
            timeout: 超时时间（毫秒）
        """
        try:
            element = await self.page.wait_for_selector(selector, timeout=timeout)
            logger.info(f"元素已出现: {selector}")
            return element
        except Exception as e:
            logger.error(f"等待元素超时: {str(e)}")
            raise

    async def execute_javascript(self, script: str) -> Any:
        """
        执行JavaScript代码

        Args:
            script: JavaScript代码
        """
        try:
            result = await self.page.evaluate(script)
            logger.info("JavaScript执行成功")
            return result
        except Exception as e:
            logger.error(f"JavaScript执行失败: {str(e)}")
            raise

    async def get_page_info(self) -> Dict[str, Any]:
        """
        获取页面信息
        """
        try:
            info = {
                "url": self.page.url,
                "title": await self.page.title(),
                "viewport": await self.page.viewport_size(),
            }
            logger.info(f"获取页面信息: {info['title']}")
            return info
        except Exception as e:
            logger.error(f"获取页面信息失败: {str(e)}")
            raise


class BrowserActionExecutor:
    """
    浏览器操作执行器
    将意图转换为具体的浏览器操作序列
    """

    def __init__(self):
        self.browser_service = BrowserAutomationService()
        self.action_templates = {
            "open_website": self._open_website,
            "search_content": self._search_content,
            "extract_images": self._extract_images,
            "download_images": self._download_images,
            "screenshot": self._screenshot,
            "extract_text": self._extract_text,
        }

    async def execute(self, action: Dict[str, Any]) -> Dict[str, Any]:
        """
        执行浏览器操作

        Args:
            action: 操作字典，包含type和parameters
        """
        action_type = action.get("type")
        parameters = action.get("parameters", {})

        if action_type not in self.action_templates:
            raise ValueError(f"不支持的操作类型: {action_type}")

        try:
            result = await self.action_templates[action_type](**parameters)
            return {
                "success": True,
                "action_type": action_type,
                "result": result
            }
        except Exception as e:
            logger.error(f"执行操作失败: {str(e)}")
            return {
                "success": False,
                "action_type": action_type,
                "error": str(e)
            }

    async def _open_website(self, url: str, headless: bool = False):
        """打开网站"""
        await self.browser_service.start(headless=headless)
        await self.browser_service.navigate_to(url)
        return await self.browser_service.get_page_info()

    async def _search_content(self, search_query: str):
        """搜索内容"""
        await self.browser_service.search(search_query)
        await asyncio.sleep(2)
        return await self.browser_service.get_page_info()

    async def _extract_images(self, selector: str = "img"):
        """提取图片"""
        images = await self.browser_service.extract_images(selector)
        return {"images": images, "count": len(images)}

    async def _download_images(self, image_urls: List[str], max_count: int = 5):
        """下载图片"""
        downloaded = []
        for idx, url in enumerate(image_urls[:max_count]):
            try:
                filepath = await self.browser_service.download_image(url)
                downloaded.append(filepath)
            except Exception as e:
                logger.error(f"下载图片失败 {url}: {str(e)}")
        return {"downloaded": downloaded, "count": len(downloaded)}

    async def _screenshot(self, full_page: bool = False):
        """截图"""
        filepath = await self.browser_service.screenshot(full_page=full_page)
        return {"screenshot": filepath}

    async def _extract_text(self, selector: str = "body"):
        """提取文本"""
        text = await self.browser_service.extract_text(selector)
        return {"text": text, "length": len(text)}

    async def cleanup(self):
        """清理资源"""
        await self.browser_service.close()


# 全局实例
browser_executor = BrowserActionExecutor()
