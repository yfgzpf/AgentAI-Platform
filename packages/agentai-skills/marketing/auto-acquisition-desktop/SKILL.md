---
name: auto-acquisition-desktop
description: 桌面自动化获客系统。通过PyAutoGUI、Playwright、Selenium真实控制微信、抖音、小红书等桌面客户端，实现一键自动化获客。包含内容发布、消息回复、数据采集、定时任务等真实可执行功能。
description_zh: "桌面自动化获客系统，真实控制微信抖音小红书客户端实现自动化"
description_en: "Desktop automation acquisition system with real app control"
version: 1.0.0
metadata:
  category: marketing
  tags:
    - desktop-automation
    - pyautogui
    - wechat
    - douyin
    - xiaohongshu
    - rpa
    - 桌面自动化
    - 获客
    - 一键运行
  author: AgentAI Team
  requires:
    bins:
      - python3
    python_packages:
      - pyautogui
      - playwright
      - selenium
      - opencv-python
      - pillow
      - numpy
  parallelSafe: false
  riskLevel: high
  triggers:
    - "一键获客"
    - "自动发布"
    - "桌面自动化"
    - "RPA.*获客"
    - "定时.*发布"
    - "批量.*操作"
---

# 桌面自动化获客系统 🤖

**真实控制桌面应用，不是模拟，是真操作！**

## 核心特性

### 1. 真实桌面控制
- **PyAutoGUI**: 控制鼠标键盘，真实操作微信/抖音客户端
- **Playwright**: 自动化浏览器，操作网页版小红书/公众号
- **OpenCV**: 图像识别，定位按钮和输入框
- **真实执行**: 不是API调用，是真实模拟人工操作

### 2. 一键自动化脚本
```bash
# 一键启动全天获客
python scripts/daily_acquisition.py

# 一键发布多平台
python scripts/multi_platform_post.py --content "夏季装修攻略"

# 一键回复所有消息
python scripts/auto_reply.py --platform wechat

# 一键采集竞品数据
python scripts/competitor_scraper.py --platform xiaohongshu
```

### 3. 多平台支持
| 平台 | 控制方式 | 功能 |
|------|---------|------|
| 微信 | PC客户端+PyAutoGUI | 发朋友圈、回复消息、加好友 |
| 抖音 | 网页版+Playwright | 发视频、回复评论、私信 |
| 小红书 | 网页版+Playwright | 发笔记、回复评论、采集 |
| 百度 | 浏览器+Selenium | 发帖、回答问题 |

## 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                    一键运行入口                              │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐        │
│  │ daily_run.py │ │ post_now.py  │ │ reply_all.py │        │
│  └──────┬───────┘ └──────┬───────┘ └──────┬───────┘        │
└─────────┼────────────────┼────────────────┼────────────────┘
          │                │                │
          └────────────────┴────────────────┘
                          │
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
┌─────────────────┐ ┌──────────┐ ┌──────────────┐
│  DesktopController │ │ BrowserController │ │ ImageRecognizer │
│  (PyAutoGUI)     │ │ (Playwright)      │ │ (OpenCV)       │
└────────┬────────┘ └────┬─────┘ └──────┬───────┘
         │               │              │
         ▼               ▼              ▼
    ┌─────────┐    ┌──────────┐   ┌──────────┐
    │ 微信PC  │    │ 抖音网页 │   │ 屏幕截图 │
    │ 抖音PC  │    │ 小红书网页│   │ 图像匹配 │
    └─────────┘    └──────────┘   └──────────┘
```

## 一键运行脚本

### 脚本 1: 全天自动化获客 (daily_acquisition.py)
```python
#!/usr/bin/env python3
"""
全天自动化获客脚本
定时执行：内容发布、消息回复、数据采集
"""

schedule = {
    "08:00": "wechat_morning_post",      # 微信早安内容
    "09:00": "xiaohongshu_post",          # 小红书上午笔记
    "12:00": "douyin_lunch_post",         # 抖音午餐时间发视频
    "14:00": "reply_all_messages",        # 回复所有平台消息
    "16:00": "wechat_case_share",         # 微信案例分享
    "19:00": "xiaohongshu_evening",       # 小红书晚间笔记
    "20:00": "douyin_prime_time",         # 抖音黄金时间发视频
    "21:00": "reply_all_messages",        # 晚间消息回复
    "22:00": "data_backup",               # 数据备份
}
```

### 脚本 2: 多平台一键发布 (multi_platform_post.py)
```bash
# 发布到所有平台
python multi_platform_post.py --file content/summer_tips.md

# 只发布到指定平台
python multi_platform_post.py --platform wechat,xiaohongshu --file content.md
```

### 脚本 3: 智能消息回复 (auto_reply.py)
```bash
# 回复所有平台未读消息
python auto_reply.py --all

# 只回复微信
python auto_reply.py --platform wechat --keyword "报价"

# 使用AI生成回复
python auto_reply.py --ai --platform all
```

### 脚本 4: 竞品数据采集 (competitor_scraper.py)
```bash
# 采集小红书竞品笔记
python competitor_scraper.py --platform xiaohongshu --keyword "装修" --count 100

# 采集抖音热门视频
python competitor_scraper.py --platform douyin --keyword "装修避坑" --count 50
```

## 核心模块

### 1. DesktopController (桌面控制)
```python
class DesktopController:
    """控制桌面应用程序"""
    
    def launch_wechat(self):
        """启动微信PC版"""
        # 真实点击微信图标或快捷键
        pyautogui.keyDown('ctrl')
        pyautogui.keyDown('alt')
        pyautogui.keyDown('w')
        pyautogui.keyUp('w')
        pyautogui.keyUp('alt')
        pyautogui.keyUp('ctrl')
    
    def click_image(self, image_path):
        """点击屏幕上的图片"""
        # 使用OpenCV识别图像位置
        location = self.find_image(image_path)
        if location:
            pyautogui.click(location)
    
    def type_text(self, text):
        """输入文本"""
        pyautogui.typewrite(text, interval=0.01)
```

### 2. BrowserController (浏览器控制)
```python
class BrowserController:
    """控制浏览器"""
    
    def __init__(self):
        self.playwright = sync_playwright().start()
        self.browser = self.playwright.chromium.launch()
    
    def post_xiaohongshu(self, title, content, images):
        """发布小红书笔记"""
        page = self.browser.new_page()
        page.goto("https://www.xiaohongshu.com")
        # 真实登录、上传图片、填写内容、发布
        page.click("[data-testid='publish-btn']")
        page.fill("[placeholder='填写标题']", title)
        page.fill("[placeholder='填写正文']", content)
        # 上传图片...
        page.click("[data-testid='publish-submit']")
```

### 3. ImageRecognizer (图像识别)
```python
class ImageRecognizer:
    """屏幕图像识别"""
    
    def find_button(self, button_image):
        """在屏幕上找到按钮"""
        screenshot = pyautogui.screenshot()
        # OpenCV模板匹配
        result = cv2.matchTemplate(screenshot, button_image, cv2.TM_CCOEFF_NORMED)
        min_val, max_val, min_loc, max_loc = cv2.minMaxLoc(result)
        if max_val > 0.8:  # 置信度>80%
            return max_loc
        return None
```

## 使用教程

### 第一步：环境准备
```bash
# 安装依赖
pip install pyautogui playwright selenium opencv-python pillow numpy

# 安装浏览器
playwright install chromium

# 下载微信PC版、抖音PC版
```

### 第二步：配置账号
```bash
# 编辑配置文件
cp config.template.json config.json

# 填写账号信息
{
  "wechat": {
    "shortcut": "ctrl+alt+w",
    "auto_reply": true
  },
  "xiaohongshu": {
    "username": "your_phone",
    "password": "your_password"
  },
  "douyin": {
    "cookies": "..."
  }
}
```

### 第三步：一键运行
```bash
# 启动全天自动化获客
python scripts/daily_acquisition.py

# 或单独运行某个功能
python scripts/wechat_auto_post.py --file content.md
python scripts/xiaohongshu_auto_post.py --file note.md --images img1.jpg,img2.jpg
python scripts/douyin_auto_upload.py --video video.mp4 --title "装修避坑"
```

## 安全与合规

### 防检测机制
- 随机延迟：操作间隔随机 1-3 秒
- 鼠标轨迹：模拟真实鼠标移动轨迹
- 点击偏移：每次点击位置有微小随机偏移
- 操作时间：只在正常工作时间操作

### 风险提示
⚠️ **使用本系统需遵守各平台用户协议**
⚠️ **建议控制操作频率，避免账号封禁**
⚠️ **重要账号请先测试小号**

## 输入参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| action | string | 是 | 操作类型 |
| platform | string | 是 | 目标平台 |
| content | string | 否 | 内容文件路径 |
| schedule | boolean | 否 | 是否定时执行 |

## 操作类型

### 一键发布
```json
{
  "action": "one_click_post",
  "platforms": ["wechat", "xiaohongshu", "douyin"],
  "content_file": "content/summer_tips.md",
  "images": ["img1.jpg", "img2.jpg"]
}
```

### 自动回复
```json
{
  "action": "auto_reply",
  "platforms": ["wechat"],
  "reply_mode": "ai",  // ai 或 template
  "keywords": ["报价", "设计", "咨询"]
}
```

### 数据采集
```json
{
  "action": "scrape_data",
  "platform": "xiaohongshu",
  "keyword": "装修",
  "count": 100,
  "output": "data/xiaohongshu_装修.csv"
}
```

## 输出示例

```json
{
  "success": true,
  "output": "✅ 桌面自动化执行完成\n\n📊 执行结果:\n  • 微信: 发布1条朋友圈 ✓\n  • 小红书: 发布1条笔记 ✓\n  • 抖音: 上传1个视频 ✓\n  • 消息回复: 回复5条消息 ✓\n\n⏱️ 耗时: 3分25秒\n📸 截图记录: logs/20240708_203045/",
  "data": {
    "wechat": {"posted": 1, "replied": 3},
    "xiaohongshu": {"posted": 1, "collected": 0},
    "douyin": {"uploaded": 1, "replied": 2},
    "screenshots": ["logs/20240708_203045/wechat_post.png", "..."],
    "duration": 205
  }
}
```

## 使用示例

### 示例 1: 一键多平台发布
```
执行一键发布，内容文件是content/summer.md，配图summer1.jpg和summer2.jpg，发布到微信、小红书、抖音
```

### 示例 2: 启动全天自动化
```
启动全天自动化获客，按预设时间表执行
```

### 示例 3: 采集竞品数据
```
采集小红书上前100篇关于"装修"的热门笔记，保存到csv
```

## 故障排查

| 问题 | 解决方案 |
|------|---------|
| 微信无法启动 | 检查微信快捷键配置 |
| 图像识别失败 | 更新截图模板，确保分辨率一致 |
| 浏览器登录失效 | 重新获取cookies或扫码登录 |
| 操作被平台限制 | 降低操作频率，增加随机延迟 |

## 更新计划

- [ ] 支持更多平台（快手、B站、知乎）
- [ ] AI智能内容生成+自动发布
- [ ] 智能客服自动回复
- [ ] 数据分析和优化建议
