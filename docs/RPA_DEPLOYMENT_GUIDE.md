# RPA获客系统部署与使用指南

> 真实可运行的自动化获客系统，从安装到触发全流程

---

## 一、系统架构

```
用户对话
    ↓
AgentAI 识别获客意图
    ↓
调用 rpa-acquisition-bridge Skill
    ↓
检查并调用真实RPA工具
    ↓
执行自动化获客任务
    ↓
返回执行结果给用户
```

---

## 二、真实工具安装（必须步骤）

### 步骤1：安装 TagUI（开源免费）

```bash
# Windows
npm install -g tagui

# 验证安装
tagui --version
# 应显示: TagUI v6.x.x

# 如果npm未安装，先安装Node.js:
# https://nodejs.org/ 下载LTS版本
```

### 步骤2：安装 Playwright（开源免费）

```bash
# Python环境
pip install playwright

# 安装浏览器
playwright install chromium

# 验证
python -c "import playwright; print(playwright.__version__)"
```

### 步骤3：安装 Automa（浏览器扩展，免费）

```
1. 打开 Chrome/Edge 浏览器
2. 访问: https://chrome.google.com/webstore/detail/automa/infppggnoaenmfagbfknfkancpbljcca
3. 点击"添加至Chrome"
4. 固定到工具栏方便使用
```

### 步骤4：注册八爪鱼RPA（商业，有免费试用）

```
1. 访问: https://rpa.bazhuayu.com/
2. 注册账号
3. 进入应用市场
4. 搜索"小红书"、"抖音"等
5. 购买或试用应用
```

---

## 三、获取现成工作流

### 从 Automa 市场下载（免费）

```
1. 点击浏览器工具栏 Automa 图标
2. 点击 "Marketplace"
3. 搜索关键词:
   - "xiaohongshu" 或 "小红书"
   - "douyin" 或 "抖音"
   - "wechat" 或 "微信"
4. 找到合适的工作流，点击 "Install"
5. 工作流会自动保存到本地
```

### 推荐工作流

| 名称 | 功能 | 价格 |
|------|------|------|
| 小红书笔记发布 | 自动发布图文笔记 | 免费 |
| 抖音视频采集 | 采集指定用户视频 | 免费 |
| 微信文章采集 | 采集公众号文章 | 免费 |

### 从八爪鱼RPA购买（付费）

```
应用市场推荐:
- 小红书搜索笔记采集: ¥20/月
- 小红书数据监控: ¥200/月
- 抖音指定关键词获取视频: ¥20/月
- 微信自动拉群: ¥50/月
- 微信文章获取: ¥50/月
```

---

## 四、配置AgentAI系统

### 配置文件

创建 `config/rpa-config.json`:

```json
{
  "tools": {
    "tagui": {
      "enabled": true,
      "path": "tagui",
      "scripts_dir": "./rpa-scripts/tagui"
    },
    "playwright": {
      "enabled": true,
      "scripts_dir": "./rpa-scripts/playwright"
    },
    "automa": {
      "enabled": true,
      "extension_id": "infppggnoaenmfagbfknfkancpbljcca",
      "workflows_dir": "./rpa-scripts/automa"
    },
    "bazhuayu": {
      "enabled": false,
      "api_key": "",
      "api_secret": ""
    }
  },
  "safety": {
    "max_daily_posts": 10,
    "min_interval_seconds": 300,
    "work_hours_only": true
  }
}
```

### 创建工作流目录

```bash
mkdir -p rpa-scripts/{tagui,playwright,automa}
```

---

## 五、用户触发方式

### 方式1：自然语言触发（推荐）

用户在AgentAI对话中输入:

```
"帮我发一篇小红书笔记，标题是'装修避坑指南'"

"启动今天的自动化获客"

"采集小红书上关于装修的100篇热门笔记"

"回复所有未读的微信消息"
```

### 方式2：命令式触发

```
/rpa run automa xiaohongshu-post --params '{"title":"..."}'

/rpa check tagui

/rpa status
```

### 方式3：定时自动触发

```json
{
  "schedule": {
    "morning_post": "08:00",
    "lunch_post": "12:00",
    "evening_post": "20:00",
    "auto_reply": "every_2_hours"
  }
}
```

---

## 六、真实测试流程

### 测试1：检查工具安装

```bash
# 用户输入: "检查RPA工具安装状态"

# 系统执行:
cd packages/agentai-skills/marketing/rpa-acquisition-bridge
echo '{"tool": "tagui", "action": "check"}' | python handler.py

# 预期输出:
{
  "success": true,
  "output": "✅ TAGUI 已安装\n版本: v6.46.0",
  "data": {"installed": true, "version": "v6.46.0"}
}
```

### 测试2：执行真实任务

```bash
# 用户输入: "用Automa发布小红书测试笔记"

# 系统执行:
echo '{
  "tool": "automa",
  "workflow": "xiaohongshu-post",
  "params": {
    "title": "测试笔记",
    "content": "这是通过AgentAI自动发布的内容",
    "images": ["test.jpg"]
  }
}' | python handler.py

# 预期输出:
{
  "success": true,
  "output": "✅ AUTOMA 执行成功\n📝 工作流已加载\n💡 说明: 请在浏览器中确认发布",
  "data": {
    "workflow": "xiaohongshu-post",
    "params": {...},
    "note": "Automa将在浏览器中执行"
  }
}
```

---

## 七、用户操作流程图

```
┌─────────────────────────────────────────────────────────────┐
│ 用户打开 AgentAI 聊天界面                                    │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 用户输入: "帮我发一篇小红书笔记"                              │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ AgentAI 识别意图 → 触发 rpa-acquisition-bridge Skill        │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 系统检查:                                                    │
│   1. Automa是否安装? → 是/提示安装                          │
│   2. 工作流是否存在? → 是/提示下载                          │
│   3. 用户是否登录? → 是/提示登录                            │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 系统请求更多信息:                                            │
│   "请提供笔记标题和内容"                                     │
│   "是否需要配图?"                                           │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 用户提供:                                                   │
│   标题: "2024装修避坑指南"                                  │
│   内容: "..."                                               │
│   图片: 上传3张图片                                          │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 系统执行:                                                   │
│   1. 保存图片到临时目录                                      │
│   2. 调用Automa工作流                                        │
│   3. 打开小红书网页                                          │
│   4. 自动填写标题、内容                                      │
│   5. 自动上传图片                                            │
│   6. 等待用户确认或自动发布                                   │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 系统返回结果:                                               │
│   "✅ 小红书笔记发布成功!"                                   │
│   "链接: https://www.xiaohongshu.com/..."                   │
│   "预计曝光: 3000-5000次"                                   │
└─────────────────────────────────────────────────────────────┘
```

---

## 八、关键触发词配置

在 `SKILL.md` 中配置:

```yaml
triggers:
  # 发布内容
  - "发.*小红书"
  - "发.*抖音"
  - "发.*朋友圈"
  - "发布.*笔记"
  - "发布.*视频"
  
  # 采集数据
  - "采集.*小红书"
  - "采集.*抖音"
  - "抓取.*数据"
  - "获取.*笔记"
  
  # 自动回复
  - "回复.*消息"
  - "自动回复"
  - "回复.*微信"
  
  # 启动自动化
  - "启动.*获客"
  - "启动.*自动化"
  - "开始.*RPA"
  - "运行.*脚本"
  
  # 检查状态
  - "检查.*工具"
  - "RPA.*状态"
  - "工具.*安装"
```

---

## 九、安全与合规

### 防封号策略

```json
{
  "safety": {
    "max_daily_posts": 5,
    "min_interval_minutes": 30,
    "random_delay": true,
    "work_hours": "09:00-21:00",
    "avoid_weekends": false
  }
}
```

### 风险提示

每次执行前显示:

```
⚠️ 安全提示:
1. 本次操作将模拟人工发布内容
2. 请确保内容符合平台规范
3. 频繁操作可能导致账号限制
4. 建议每日发布不超过5条

是否继续? (是/否)
```

---

## 十、故障排查

### 常见问题

| 问题 | 原因 | 解决方案 |
|------|------|---------|
| TagUI未找到 | 未安装Node.js/npm | 安装Node.js后重新安装TagUI |
| Automa工作流不存在 | 未从市场下载 | 打开Automa marketplace下载 |
| 浏览器未打开 | Playwright未安装浏览器 | 运行 `playwright install` |
| 登录状态失效 | Cookie过期 | 重新登录获取新Cookie |
| 操作被拦截 | 平台风控 | 降低操作频率，增加随机延迟 |

---

## 十一、下一步行动

1. **立即**: 安装Node.js和TagUI
2. **今天**: 安装Automa扩展并下载工作流
3. **本周**: 配置AgentAI系统并测试
4. **本月**: 建立完整的内容库和自动化流程

---

**需要我协助安装配置吗？**
