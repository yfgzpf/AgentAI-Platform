#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
浏览器自动化技能
使用 Playwright 打开浏览器并执行搜索
"""

import asyncio
import argparse
import json
import sys
import os

try:
    from playwright.async_api import async_playwright
    HAS_PLAYWRIGHT = True
except ImportError:
    HAS_PLAYWRIGHT = False
    print("##RESULT## " + json.dumps({
        "status": "error",
        "message": "playwright 未安装，请运行: pip install playwright && playwright install chromium"
    }, ensure_ascii=False))
    sys.exit(1)


async def open_browser_and_search(url: str, keyword: str = None, headless: bool = False):
    """
    打开浏览器并访问指定网址，可选择搜索关键词
    
    Args:
        url: 要访问的网址
        keyword: 可选的搜索关键词
        headless: 是否无头模式
    """
    try:
        print(f"正在启动浏览器...", file=sys.stderr)
        
        playwright = await async_playwright().start()
        browser = await playwright.chromium.launch(
            headless=headless,
            args=['--disable-blink-features=AutomationControlled']
        )
        
        context = await browser.new_context(
            viewport={'width': 1920, 'height': 1080},
            user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        )
        
        page = await context.new_page()
        
        print(f"正在访问: {url}", file=sys.stderr)
        await page.goto(url, wait_until='networkidle', timeout=30000)
        
        if keyword:
            print(f"正在搜索: {keyword}", file=sys.stderr)
            
            # 尝试多种搜索框选择器
            search_selectors = [
                '#kw',  # 百度
                'input[name="wd"]',  # 百度备选
                'input[type="search"]',
                'input[name="q"]',  # Google, Bing
                'input[placeholder*="搜索"]',
                'input[placeholder*="Search"]'
            ]
            
            search_input = None
            for selector in search_selectors:
                try:
                    search_input = await page.wait_for_selector(selector, timeout=2000)
                    if search_input:
                        break
                except:
                    continue
            
            if search_input:
                await search_input.fill(keyword)
                await asyncio.sleep(0.3)
                await search_input.press('Enter')
                await page.wait_for_load('networkidle')
                print(f"搜索完成", file=sys.stderr)
            else:
                print(f"未找到搜索框", file=sys.stderr)
        
        # 获取页面标题
        title = await page.title()
        
        # 保持浏览器打开
        print(f"浏览器已打开，页面标题: {title}", file=sys.stderr)
        print(f"浏览器将保持打开状态，您可以手动操作。关闭浏览器窗口以结束程序。", file=sys.stderr)
        
        # 等待用户关闭浏览器
        try:
            while True:
                await asyncio.sleep(1)
        except KeyboardInterrupt:
            pass
        finally:
            await browser.close()
            await playwright.stop()
        
        return {
            "status": "success",
            "message": f"已打开浏览器访问 {url}" + (f" 并搜索 '{keyword}'" if keyword else ""),
            "data": {
                "url": url,
                "keyword": keyword,
                "title": title
            }
        }
        
    except Exception as e:
        return {
            "status": "error",
            "message": f"执行失败: {str(e)}"
        }


def main():
    parser = argparse.ArgumentParser(description='浏览器自动化技能')
    parser.add_argument('--url', default='https://www.baidu.com', help='要访问的网址')
    parser.add_argument('--keyword', '-k', default=None, help='搜索关键词')
    parser.add_argument('--headless', action='store_true', help='无头模式')
    
    args = parser.parse_args()
    
    result = asyncio.run(open_browser_and_search(args.url, args.keyword, args.headless))
    
    print("##RESULT## " + json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
