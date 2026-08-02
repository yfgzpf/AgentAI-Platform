---
name: browser-auto
version: 1.1.0
description: Playwright 驱动的浏览器自动化，支持网页操作、截图、数据抓取、表单填写
category: web
tags: [playwright, browser, automation, screenshot, scraping, 浏览器自动化, 网页操作, 截图]
riskLevel: medium
author: AgentAI
testCommand: echo "browser-auto skill loaded"
---

# Browser Auto — 浏览器自动化

使用 Playwright 驱动 Chromium 执行网页操作，支持点击、输入、截图、内容提取等操作。

## 支持操作

| action | 说明 | 必填参数 |
|--------|------|---------|
| screenshot | 截取当前页面截图 | url |
| click | 点击指定元素 | url, selector |
| type | 在输入框输入文本 | url, selector, text |
| extract | 提取页面文本/HTML | url, selector |
| wait | 等待元素出现 | url, selector |
| scroll | 滚动页面 | url |
| fill_form | 批量填写表单 | url, formData |

## 参数说明

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| url | string | ✅ | 目标网页 URL |
| action | string | ✅ | 操作类型（见上表）|
| selector | string | ❌ | CSS 选择器，如 `#submit-btn` |
| text | string | ❌ | 输入的文字（type 操作）|
| waitFor | string | ❌ | 等待元素出现再操作 |
| timeout | int | ❌ | 超时秒数，默认 30s |
| headless | bool | ❌ | 无头模式，默认 true |

## 触发条件

- 用户说"打开网页"、"截图"、"帮我填表"、"自动化操作浏览器"
- 需要从网页提取动态数据（JS 渲染页面）
- 需要模拟用户操作

## 执行规则

1. **沙箱隔离**: 每次操作启动新的浏览器实例，完成后关闭
2. **超时保护**: 超过 timeout 自动终止并返回已收集数据
3. **截图路径**: 自动保存到 `~/.agentai/screenshots/` 目录
4. **敏感数据**: 不记录密码、Token 等敏感输入到日志

## 输出格式

```json
{
  "success": true,
  "action": "screenshot",
  "screenshotPath": "~/.agentai/screenshots/2026-06-26-xxx.png",
  "extractedText": "...",
  "url": "https://example.com",
  "timing": { "total": 2340 }
}
```
