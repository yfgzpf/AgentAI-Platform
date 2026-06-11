#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
浏览器自动化 Skill
基于 Playwright 的浏览器控制
"""

import os
import sys
import json
import argparse
from pathlib import Path

try:
    from playwright.sync_api import sync_playwright
    PLAYWRIGHT_AVAILABLE = True
except ImportError:
    PLAYWRIGHT_AVAILABLE = False
    print("[WARN] Playwright not installed. Install with: pip install playwright")


class BrowserAutomation:
    """浏览器自动化控制器"""
    
    def __init__(self):
        self.browser = None
        self.page = None
        self.playwright = None
        
    def start(self, headless: bool = False):
        """启动浏览器"""
        if not PLAYWRIGHT_AVAILABLE:
            return {"success": False, "message": "Playwright 未安装"}
            
        try:
            self.playwright = sync_playwright().start()
            self.browser = self.playwright.chromium.launch(headless=headless)
            self.page = self.browser.new_page()
            return {"success": True, "message": "浏览器已启动"}
        except Exception as e:
            return {"success": False, "message": f"启动失败: {str(e)}"}
    
    def navigate(self, url: str):
        """导航到URL"""
        if not self.page:
            self.start()
        
        try:
            self.page.goto(url, wait_until="networkidle")
            title = self.page.title()
            return {
                "success": True, 
                "message": f"已打开: {url}",
                "title": title,
                "url": url
            }
        except Exception as e:
            return {"success": False, "message": f"导航失败: {str(e)}"}
    
    def search(self, query: str, engine: str = "baidu"):
        """搜索"""
        search_engines = {
            "baidu": "https://www.baidu.com/s?wd={query}",
            "google": "https://www.google.com/search?q={query}",
            "bing": "https://www.bing.com/search?q={query}"
        }
        
        url = search_engines.get(engine, search_engines["baidu"]).format(
            query=query
        )
        return self.navigate(url)
    
    def click(self, selector: str):
        """点击元素"""
        if not self.page:
            return {"success": False, "message": "浏览器未启动"}
        
        try:
            self.page.click(selector)
            return {"success": True, "message": f"已点击: {selector}"}
        except Exception as e:
            return {"success": False, "message": f"点击失败: {str(e)}"}
    
    def type(self, selector: str, text: str):
        """输入文本"""
        if not self.page:
            return {"success": False, "message": "浏览器未启动"}
        
        try:
            self.page.fill(selector, text)
            return {"success": True, "message": f"已输入: {text}"}
        except Exception as e:
            return {"success": False, "message": f"输入失败: {str(e)}"}
    
    def screenshot(self, path: str = None):
        """截图"""
        if not self.page:
            return {"success": False, "message": "浏览器未启动"}
        
        try:
            if not path:
                path = os.path.join(
                    os.path.expanduser("~"), 
                    "Pictures", 
                    f"screenshot_{int(os.times().elapsed * 1000)}.png"
                )
            
            self.page.screenshot(path=path)
            return {"success": True, "message": f"截图已保存: {path}", "path": path}
        except Exception as e:
            return {"success": False, "message": f"截图失败: {str(e)}"}
    
    def extract(self, selector: str = None, xpath: str = None):
        """提取数据"""
        if not self.page:
            return {"success": False, "message": "浏览器未启动"}
        
        try:
            if xpath:
                elements = self.page.query_selector_all(xpath)
                data = [el.inner_text() for el in elements]
            elif selector:
                elements = self.page.query_selector_all(selector)
                data = [el.inner_text() for el in elements]
            else:
                data = self.page.content()
            
            return {"success": True, "data": data, "count": len(data)}
        except Exception as e:
            return {"success": False, "message": f"提取失败: {str(e)}"}
    
    def get_html(self):
        """获取页面HTML"""
        if not self.page:
            return {"success": False, "message": "浏览器未启动"}
        
        try:
            html = self.page.content()
            return {"success": True, "html": html[:5000]}  # 限制长度
        except Exception as e:
            return {"success": False, "message": f"获取失败: {str(e)}"}
    
    def close(self):
        """关闭浏览器"""
        try:
            if self.browser:
                self.browser.close()
            if self.playwright:
                self.playwright.stop()
            return {"success": True, "message": "浏览器已关闭"}
        except Exception as e:
            return {"success": False, "message": f"关闭失败: {str(e)}"}


def main():
    parser = argparse.ArgumentParser(description='浏览器自动化 Skill')
    parser.add_argument('--action', required=True, help='操作类型')
    parser.add_argument('--url', default='', help='网址')
    parser.add_argument('--query', default='', help='搜索关键词')
    parser.add_argument('--selector', default='', help='CSS选择器')
    parser.add_argument('--text', default='', help='输入文本')
    parser.add_argument('--xpath', default='', help='XPath表达式')
    parser.add_argument('--path', default='', help='输出路径')
    
    args = parser.parse_args()
    
    browser = BrowserAutomation()
    result = {"success": False, "message": "未知操作"}
    
    if args.action == 'start':
        result = browser.start()
    elif args.action == 'navigate':
        result = browser.navigate(args.url)
    elif args.action == 'search':
        result = browser.search(args.query)
    elif args.action == 'click':
        result = browser.click(args.selector)
    elif args.action == 'type':
        result = browser.type(args.selector, args.text)
    elif args.action == 'screenshot':
        result = browser.screenshot(args.path)
    elif args.action == 'extract':
        result = browser.extract(args.selector, args.xpath)
    elif args.action == 'get_html':
        result = browser.get_html()
    elif args.action == 'close':
        result = browser.close()
    
    print(json.dumps(result, ensure_ascii=False))
    browser.close()


if __name__ == '__main__':
    main()
