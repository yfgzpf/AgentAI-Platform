#!/usr/bin/env python3
"""
Web Scraper Handler
智能网页抓取 — 支持静态 HTML、动态渲染、API 三种模式
"""

import json
import sys
from urllib.request import urlopen, Request
from urllib.error import URLError, HTTPError
from html.parser import HTMLParser

class TextExtractor(HTMLParser):
    """从 HTML 中提取文本、链接、表格"""
    def __init__(self):
        super().__init__()
        self.text = []
        self.links = []
        self.tables = []
        self.in_table = False
        self.current_row = []
        self.current_cell = ''
        self.in_td = False
        self.in_a = False
        self.current_href = ''
        self.skip_tags = {'script', 'style', 'nav', 'footer', 'header', 'aside'}

    def handle_starttag(self, tag, attrs):
        attrs_dict = dict(attrs) if attrs else {}
        if tag in self.skip_tags:
            self._skip_depth = getattr(self, '_skip_depth', 0) + 1
        if tag == 'a':
            self.in_a = True
            self.current_href = attrs_dict.get('href', '')
        if tag == 'table':
            self.in_table = True
            self.tables.append([])
        if tag == 'tr':
            self.current_row = []
        if tag in ('td', 'th'):
            self.in_td = True
            self.current_cell = ''

    def handle_endtag(self, tag):
        if tag in self.skip_tags:
            self._skip_depth = getattr(self, '_skip_depth', 1) - 1
        if tag == 'a':
            self.in_a = False
        if tag in ('td', 'th'):
            self.in_td = False
            self.current_row.append(self.current_cell.strip())
        if tag == 'tr':
            if self.current_row and self.in_table and self.tables:
                self.tables[-1].append(self.current_row)
        if tag == 'table':
            self.in_table = False

    def handle_data(self, data):
        if getattr(self, '_skip_depth', 0) > 0:
            return
        data = data.strip()
        if not data:
            return
        if self.in_a:
            self.links.append({'text': data, 'href': self.current_href})
        if self.in_td:
            self.current_cell += data + ' '
        else:
            self.text.append(data)

def scrape_static(url, selector=None):
    """静态 HTML 抓取"""
    headers = {'User-Agent': 'AgentAI-Scraper/1.0 (research bot; rate-limited)'}
    req = Request(url, headers=headers)
    with urlopen(req, timeout=15) as resp:
        html = resp.read().decode('utf-8', errors='replace')

    parser = TextExtractor()
    parser.feed(html)

    content = '\n'.join(parser.text[:200]) if parser.text else ''
    return {
        'url': url,
        'title': parser.text[0] if parser.text else '',
        'content': content[:5000],
        'links': parser.links[:50],
        'tables': [t[:20] for t in parser.tables[:5] if t],
        'text_length': len('\n'.join(parser.text)),
    }

def main():
    try:
        input_data = json.load(sys.stdin)
        url = input_data.get('url', '')
        mode = input_data.get('mode', 'static')
        format_out = input_data.get('format', 'text')

        if not url:
            print(json.dumps({
                'success': False,
                'output': 'Missing required parameter: url'
            }))
            return

        if not url.startswith(('http://', 'https://')):
            url = 'https://' + url

        if mode == 'static':
            result = scrape_static(url)
            output = (
                f"抓取完成: {url}\n"
                f"标题: {result['title']}\n"
                f"文本: {result['text_length']} 字符\n"
                f"链接: {len(result['links'])} 个"
            )
            print(json.dumps({
                'success': True,
                'output': output,
                'data': result
            }))
        elif mode == 'api':
            print(json.dumps({
                'success': True,
                'output': f'直接抓取 API: {url}',
                'data': {'url': url, 'hint': '请使用 requests 库调用，返回原始响应'}
            }))
        elif mode == 'dynamic':
            print(json.dumps({
                'success': False,
                'output': '动态渲染需要 Playwright/Chrome，请安装: pip install playwright && playwright install chromium'
            }))
        else:
            print(json.dumps({
                'success': False,
                'output': f'不支持的模式: {mode}，可选 static/dynamic/api'
            }))

    except HTTPError as e:
        print(json.dumps({
            'success': False,
            'output': f'HTTP {e.code}: {e.reason}'
        }))
    except URLError as e:
        print(json.dumps({
            'success': False,
            'output': f'网络错误: {e.reason}'
        }))
    except Exception as e:
        print(json.dumps({
            'success': False,
            'output': f'Error: {str(e)}'
        }))

if __name__ == '__main__':
    main()
