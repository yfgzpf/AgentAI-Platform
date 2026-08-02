---
name: scraper
version: 1.0.0
description: 智能网页数据抓取，支持静态页面和 JS 渲染页面，可提取结构化表格/列表/文章内容
category: web
tags: [scrape, crawl, extract, data, html, 抓取, 爬取, 数据提取]
riskLevel: low
author: AgentAI
testCommand: echo "scraper skill loaded"
---

# Scraper — 智能网页数据抓取

抓取网页内容并提取结构化数据，支持静态 HTML（fetch）和动态 JS 渲染（Playwright）两种模式。

## 抓取模式

| 模式 | 适用场景 | 速度 |
|------|---------|------|
| static | 纯 HTML 页面，内容直接在源码中 | 快 (<1s) |
| dynamic | React/Vue/Angular 渲染，需等待 JS | 慢 (3-10s) |
| api | 直接调用页面背后的 API | 最快 |

## 参数说明

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| url | string | ✅ | 目标 URL |
| mode | string | ❌ | `static`/`dynamic`，默认自动检测 |
| selector | string | ❌ | 提取特定区域的 CSS 选择器 |
| format | string | ❌ | 输出格式: `text`/`markdown`/`json`/`table` |
| pagination | bool | ❌ | 是否翻页抓取，默认 false |
| maxPages | int | ❌ | 最大翻页数，默认 5 |
| proxy | string | ❌ | 代理地址（如有反爬需要）|

## 触发条件

- 用户说"抓取这个网页的内容"、"帮我从这个网站提取数据"
- 用户提供 URL 并要求分析/整理其中的内容
- 需要批量抓取列表页数据

## 执行规则

1. **robots.txt 遵守**: 自动检查并遵守 robots.txt 规则
2. **限速访问**: 同一域名请求间隔不少于 1 秒
3. **内容过滤**: 自动去除广告、导航、页脚等无关内容
4. **结构化提取**: 优先提取表格 → 列表 → 段落

## 输出格式

```json
{
  "url": "https://...",
  "title": "页面标题",
  "content": "提取的主要内容",
  "tables": [["列1", "列2"], ["值1", "值2"]],
  "links": ["https://..."],
  "metadata": { "publishDate": "...", "author": "..." }
}
```
