---
name: rpa-acquisition-bridge
description: RPA获客桥接器。集成TagUI、Automa、Playwright等真实RPA工具，通过统一的API接口调用，实现一键自动化获客。不重复造轮子，直接调用成熟工具。
description_zh: "RPA获客桥接器，集成TagUI/Automa/Playwright等真实工具"
description_en: "RPA acquisition bridge integrating real automation tools"
version: 1.0.0
metadata:
  category: marketing
  tags:
    - rpa
    - tagui
    - automa
    - playwright
    - integration
    - bridge
    - 获客
  author: AgentAI Team
  requires:
    bins:
      - python3
      - node
      - tagui
    python_packages:
      - playwright
      - pyautogui
  parallelSafe: false
  riskLevel: high
  triggers:
    - "启动RPA"
    - "运行.*脚本"
    - "调用.*自动化"
---

# RPA 获客桥接器 🔌

**不重复造轮子，直接集成业界成熟的RPA工具**

## 设计理念

与其从零开发不可靠的自动化脚本，不如桥接已经成熟的RPA工具：
- **TagUI**: 开源，自然语言编写，跨平台
- **Automa**: 浏览器扩展，可视化，社区丰富
- **Playwright**: 微软出品，稳定可靠
- **八爪鱼RPA**: 商业平台，现成应用

## 架构设计

```
AgentAI Skill
     │
     ▼
┌─────────────────────────────────────┐
│      RPA Acquisition Bridge         │
│  ┌─────────┐ ┌─────────┐ ┌────────┐ │
│  │  TagUI  │ │ Automa  │ │ 八爪鱼 │ │
│  │ Adapter │ │ Adapter │ │ Adapter│ │
│  └────┬────┘ └────┬────┘ └───┬────┘ │
└───────┼───────────┼──────────┼──────┘
        │           │          │
        ▼           ▼          ▼
    ┌───────┐   ┌───────┐  ┌───────┐
    │TagUI  │   │Automa │  │八爪鱼 │
    │Engine │   │Browser│  │Cloud  │
    └───────┘   └───────┘  └───────┘
```

## 支持的RPA工具

### 1. TagUI (推荐，开源免费)
```bash
# 安装
npm install -g tagui

# 使用自然语言编写脚本
click login_button.png
type username_field.png as myusername
type password_field.png as mypassword
click submit_button.png
```

### 2. Automa (浏览器扩展，免费)
```javascript
// 从市场下载工作流，通过API调用
{
  "workflowId": "xiaohongshu-post",
  "params": {
    "title": "装修避坑指南",
    "content": "...",
    "images": ["img1.jpg"]
  }
}
```

### 3. Playwright (微软开源)
```python
# Python脚本，稳定可靠
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    page.goto("https://www.xiaohongshu.com")
    # ...
```

### 4. 八爪鱼RPA (商业，现成应用)
```python
# 调用八爪鱼API
# 小红书搜索笔记采集: ¥20/月
# 抖音视频采集: ¥20/月
# 微信自动拉群: ¥50/月
```

## 使用方式

### 方式1: 直接调用现成工作流
```json
{
  "tool": "automa",
  "workflow": "xiaohongshu-post",
  "params": {
    "title": "2024装修避坑指南",
    "content": "...",
    "images": ["img1.jpg", "img2.jpg"]
  }
}
```

### 方式2: 运行TagUI脚本
```json
{
  "tool": "tagui",
  "script": "scripts/wechat-post.tag",
  "params": {
    "content": "今日案例分享...",
    "images": ["case1.jpg"]
  }
}
```

### 方式3: 调用Playwright
```json
{
  "tool": "playwright",
  "script": "douyin_upload.py",
  "params": {
    "video": "video.mp4",
    "title": "装修避坑",
    "tags": ["装修", "避坑"]
  }
}
```

## 输入参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| tool | string | 是 | rpa工具: tagui/automa/playwright/bazhuayu |
| action | string | 是 | 操作类型 |
| workflow/script | string | 是 | 工作流ID或脚本路径 |
| params | object | 否 | 执行参数 |

## 操作类型

### 发布内容
```json
{
  "tool": "automa",
  "action": "run_workflow",
  "workflow": "xiaohongshu-post",
  "params": {
    "title": "装修避坑",
    "content": "...",
    "images": ["img1.jpg"]
  }
}
```

### 采集数据
```json
{
  "tool": "tagui",
  "action": "run_script",
  "script": "scrape-xiaohongshu.tag",
  "params": {
    "keyword": "装修",
    "count": 100,
    "output": "data.csv"
  }
}
```

### 自动回复
```json
{
  "tool": "playwright",
  "action": "run_script",
  "script": "auto-reply.py",
  "params": {
    "platform": "wechat",
    "reply_text": "感谢您的咨询..."
  }
}
```

## 输出示例

```json
{
  "success": true,
  "output": "RPA执行完成",
  "data": {
    "tool": "automa",
    "workflow": "xiaohongshu-post",
    "status": "completed",
    "duration": 45,
    "result": {
      "post_url": "https://www.xiaohongshu.com/...",
      "views": 0,
      "likes": 0
    },
    "logs": [
      "2024-07-08 20:30:15 - 启动工作流",
      "2024-07-08 20:30:20 - 登录小红书",
      "2024-07-08 20:30:30 - 上传图片",
      "2024-07-08 20:30:45 - 发布成功"
    ]
  }
}
```

## 使用教程

### 第一步：安装RPA工具
```bash
# 安装 TagUI
npm install -g tagui

# 安装 Playwright
pip install playwright
playwright install chromium

# 安装 Automa (Chrome扩展)
# 访问 Chrome Web Store 搜索 Automa
```

### 第二步：获取现成工作流
```bash
# Automa 市场
# https://www.automa.site/marketplace
# 搜索: 小红书、抖音、微信

# 八爪鱼RPA 市场
# https://rpa.bazhuayu.com/appstore
# 搜索: 小红书采集、抖音获客
```

### 第三步：配置桥接器
```json
{
  "tools": {
    "tagui": {
      "path": "/usr/local/bin/tagui",
      "scripts_dir": "./tagui-scripts"
    },
    "automa": {
      "extension_id": "infppggnoaenmfagbfknfkancpbljcca",
      "workflows_dir": "./automa-workflows"
    },
    "playwright": {
      "scripts_dir": "./playwright-scripts"
    },
    "bazhuayu": {
      "api_key": "your_api_key",
      "app_ids": {
        "xiaohongshu_search": "app_xxx",
        "douyin_scrape": "app_yyy"
      }
    }
  }
}
```

### 第四步：一键运行
```bash
# 通过AgentAI调用
python handler.py < request.json

# 或直接运行
python -m rpa_bridge run --tool automa --workflow xiaohongshu-post
```

## 现成可用资源

### Automa 工作流 (免费)
| 名称 | 功能 | 来源 |
|------|------|------|
| 小红书发布 | 自动发布图文笔记 | Automa市场 |
| 抖音采集 | 采集视频信息 | Automa市场 |
| 微信文章 | 采集公众号文章 | Automa市场 |

### 八爪鱼RPA应用 (付费)
| 名称 | 价格 | 功能 |
|------|------|------|
| 小红书搜索笔记采集 | ¥20/月 | 搜索关键词采集笔记 |
| 小红书数据监控 | ¥200/月 | 监控博主数据变化 |
| 抖音视频采集 | ¥20/月 | 指定关键词采集视频 |
| 微信自动拉群 | ¥50/月 | 自动添加好友并拉群 |
| 微信文章获取 | ¥50/月 | 采集公众号文章 |

### TagUI 脚本示例 (开源)
```tagui
// wechat-post.tag
// 微信发朋友圈

click wechat_icon.png
wait 2
click moments_button.png
wait 1
click camera_icon.png
click album_option.png
select photo1.jpg,photo2.jpg
click done_button.png
type content_field.png as [content]
click post_button.png
echo "发布成功"
```

## 优势

| 方案 | 开发成本 | 稳定性 | 维护成本 | 推荐度 |
|------|---------|--------|---------|--------|
| 自研脚本 | 高 | 低 | 高 | ⭐ |
| **RPA桥接** | **低** | **高** | **低** | **⭐⭐⭐⭐⭐** |
| 纯人工 | 无 | 高 | 极高 | ⭐⭐ |

## 风险提示

1. **账号安全**: 控制操作频率，避免封号
2. **平台更新**: RPA工具需要随平台更新
3. **成本**: 商业RPA工具需要付费
4. **合规**: 遵守平台用户协议

## 下一步

1. 安装 Automa，测试现成工作流
2. 注册八爪鱼RPA，试用现成应用
3. 集成到 AgentAI 系统
4. 开发调度系统，实现定时任务
