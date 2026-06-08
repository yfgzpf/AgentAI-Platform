# AgentAI Platform — 品牌与 Logo 设计规范 v1.0

> 最后更新: 2026-06-08
> 富哥指令: "系统图标你也要主动设计"

---

## 〇、设计原则 (梁文锋"找结构"原则)

1. **几何 + 抽象**: 不堆装饰, 用最少元素表达 AI 智能
2. **可缩放**: 16x16 favicon → 1024x1024 应用图标都能识别
3. **可识别**: 单色/灰度也能识别 (测试黑白剪影)
4. **文化兼容**: 中英文版本都自然
5. **可生成**: SVG 描述 → 设计师或 AI 生图工具可还原

---

## 一、Logo 方案 A: 智能蓝极简（推荐）

### 1.1 概念
- 主体: 几何化大写字母 **A** (Agent / 智)
- 寓意: A 字顶部开口向上 → 持续学习 / 无限可能
- 颜色: 智能蓝 `#4F46E5` 主色 + 玫瑰金 `#F472B6` 强调
- 形状: 圆角矩形容器 (8px 圆角)

### 1.2 ASCII 草图

```
┌─────────────────┐
│                 │
│      ▄▄▄        │   ← 顶部开口
│     █   █       │
│    █  ▲  █      │   ▲ = 抽象的"开眼"或"向上的箭头"
│   █  ▲▲▲  █     │
│  █▲▲▲▲▲▲▲▲▲█    │   ▲▲▲ = 神经网络节点
│                 │
└─────────────────┘

A 字 + 内部 5 个三角形(节点)
底色: 智能蓝渐变 (#4F46E5 → #6366F1)
节点: 玫瑰金 (#F472B6)
```

### 1.3 SVG 描述 (供设计师/Figma)

```svg
<svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#4F46E5"/>
      <stop offset="100%" stop-color="#6366F1"/>
    </linearGradient>
  </defs>

  <!-- 圆角矩形背景 -->
  <rect width="1024" height="1024" rx="160" fill="url(#bg)"/>

  <!-- A 字主体 (大三角) -->
  <path d="M 512 200 L 800 800 L 650 800 L 600 700 L 424 700 L 374 800 L 224 800 Z"
        fill="white" opacity="0.95"/>

  <!-- A 字横杠 (中横) -->
  <rect x="450" y="580" width="124" height="40" fill="#4F46E5"/>

  <!-- 内部节点 (神经网络) -->
  <circle cx="512" cy="350" r="20" fill="#F472B6"/>
  <circle cx="430" cy="500" r="16" fill="#F472B6"/>
  <circle cx="594" cy="500" r="16" fill="#F472B6"/>
  <circle cx="512" cy="500" r="22" fill="#F472B6"/>

  <!-- 节点连线 -->
  <line x1="512" y1="350" x2="430" y2="500" stroke="#F472B6" stroke-width="3" opacity="0.6"/>
  <line x1="512" y1="350" x2="594" y2="500" stroke="#F472B6" stroke-width="3" opacity="0.6"/>
  <line x1="430" y1="500" x2="512" y2="500" stroke="#F472B6" stroke-width="3" opacity="0.6"/>
  <line x1="594" y1="500" x2="512" y2="500" stroke="#F472B6" stroke-width="3" opacity="0.6"/>
</svg>
```

### 1.4 应用场景
- **Tauri 桌面图标**: 1024x1024 PNG / ICO
- **Web favicon**: 32x32, 64x64
- **GitHub 仓库**: 460x460
- **VSCode 扩展**: 128x128
- **技能市场图标**: 256x256

---

## 二、Logo 方案 B: 科技粒子（备选）

### 2.1 概念
- 主体: 多边形化的 **A** 字
- 装饰: 神经网络粒子点阵
- 颜色: 渐变 (蓝→粉紫)
- 形状: 圆形容器 (100% 圆)

### 2.2 ASCII 草图

```
    ╭─────────────╮
   ╱   · · · · ·    ╲
  │   ·  A  ·  ·    │   粒子点阵背景
  │  ·  ▲▲▲  ·  ·  │   A 字 + 内嵌粒子
  │   ·  ▲▲  · ·   │
   ╲   ·  ▲  ·    ╱
    ╰─────────────╯
```

### 2.3 适用
- 偏科技/未来感
- 大屏展示
- 营销物料

---

## 三、Logo 方案 C: 中文意境（备选）

### 3.1 概念
- 主体: 「智」字篆刻风
- 装饰: 八卦环外圈
- 颜色: 单色 (深蓝) + 极简
- 形状: 圆形/方形

### 3.2 ASCII 草图

```
        ┌──┐
        │  │
   ─── ┤  ├───
        │  │  智 (篆刻风)
   ─── ┤  ├───
        │  │
        └──┘
```

### 3.3 适用
- 偏文化/东方感
- 中文用户群
- 高端品牌

---

## 四、Logo 变体 (Variant)

### 4.1 全版 (Full)
- A 字 + 神经网络节点 + 中英文
- 用法: 营销物料、官网首页

```
┌──────────────────┐
│                  │
│    [A Logo]      │
│                  │
│   AgentAI        │   ← 英文名
│   智 Y.AI        │   ← 中文名
│                  │
└──────────────────┘
```

### 4.2 简版 (Mark Only)
- 仅 A 字 + 节点
- 用法: favicon, 应用图标, 头像

### 4.3 单色版 (Monochrome)
- 黑色或白色单色
- 用法: 印刷 / 黑白场景

### 4.4 文字版 (Wordmark)
- 仅文字 "AgentAI"
- 用法: 文档头、邮件签名

---

## 五、色彩系统 (Color Tokens)

### 5.1 主色板 (Primary)

| 名称 | HEX | RGB | 用途 |
|------|-----|-----|------|
| 智能蓝-100 | `#EEF2FF` | 238, 242, 255 | 浅背景 |
| 智能蓝-300 | `#A5B4FC` | 165, 180, 252 | 边框 |
| 智能蓝-500 | `#6366F1` | 99, 102, 241 | 次按钮 |
| **智能蓝-600** | **`#4F46E5`** | **79, 70, 229** | **主色 / Logo** |
| 智能蓝-700 | `#4338CA` | 67, 56, 202 | 悬停态 |
| 智能蓝-900 | `#312E81` | 49, 46, 129 | 文本强调 |

### 5.2 强调色板 (Accent)

| 名称 | HEX | 用途 |
|------|-----|------|
| 玫瑰金-400 | `#F472B6` | Logo 节点 / 强调色 |
| 玫瑰金-500 | `#EC4899` | 悬停态 |
| 玫瑰金-600 | `#DB2777` | 错误状态 |

### 5.3 中性色 (Neutral)

| 名称 | HEX | 用途 |
|------|-----|------|
| 白 | `#FFFFFF` | 背景 |
| 灰-50 | `#F9FAFB` | 二级背景 |
| 灰-100 | `#F3F4F6` | 卡片背景 |
| 灰-300 | `#D1D5DB` | 边框 |
| 灰-500 | `#6B7280` | 二级文本 |
| 灰-700 | `#374151` | 一级文本 |
| 灰-900 | `#111827` | 标题 |

### 5.4 语义色 (Semantic)

| 名称 | HEX | 用途 |
|------|-----|------|
| 成功-500 | `#10B981` | 成功提示 |
| 警告-500 | `#F59E0B` | 警告提示 |
| 错误-500 | `#EF4444` | 错误提示 |
| 信息-500 | `#3B82F6` | 信息提示 |

---

## 六、字体系统 (Typography)

### 6.1 字体栈

```css
:root {
  --font-sans: 'Inter', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', monospace;
  --font-display: 'Inter', 'Source Han Sans CN', sans-serif;
}
```

### 6.2 字号阶梯 (Type Scale)

| 名称 | 像素 | rem | 用途 |
|------|------|-----|------|
| text-xs | 12px | 0.75rem | 脚注 / 标签 |
| text-sm | 14px | 0.875rem | 辅助文本 |
| text-base | 16px | 1rem | 正文 |
| text-lg | 18px | 1.125rem | 强调 |
| text-xl | 20px | 1.25rem | 小标题 |
| text-2xl | 24px | 1.5rem | 副标题 |
| text-3xl | 30px | 1.875rem | 主标题 |
| text-4xl | 36px | 2.25rem | 大标题 |
| text-5xl | 48px | 3rem | 落地页 |

### 6.3 行高 + 字间距

- 标题: `line-height: 1.2` / `letter-spacing: -0.02em`
- 正文: `line-height: 1.6` / `letter-spacing: 0`
- 数字: `font-feature-settings: 'tnum'` (等宽数字)

---

## 七、应用图标 (App Icons)

### 7.1 桌面端 (Tauri 打包)

| 平台 | 格式 | 尺寸 |
|------|------|------|
| Windows | .ico + .png | 256x256, 512x512, 1024x1024 |
| macOS | .icns + .png | 16, 32, 64, 128, 256, 512, 1024 |
| Linux | .png | 512x512 |

打包命令:
```bash
# Tauri 自动生成
pnpm --filter @agentai/desktop tauri icon ./assets/logo-1024.png
# → 自动生成全平台图标
```

### 7.2 Web Favicon

```html
<link rel="icon" type="image/svg+xml" href="/logo.svg">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16.png">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
```

### 7.3 VSCode 扩展图标

`package.json`:
```json
{
  "icon": "assets/vscode-icon-128.png",
  "badges": [
    [{ "url": "assets/badge-preview.png", "description": "Preview" }],
    [{ "url": "assets/badge-stable.png", "description": "Stable" }]
  ]
}
```

---

## 八、资产目录 (Assets)

```
F:\agentai-platform\
├── assets/
│   ├── logo.svg                    # 主 Logo SVG
│   ├── logo-1024.png              # 1024 应用图标
│   ├── logo-512.png
│   ├── logo-256.png
│   ├── logo-mono-black.svg        # 单色黑
│   ├── logo-mono-white.svg        # 单色白
│   ├── favicon.ico                # 浏览器图标
│   ├── favicon-16.png
│   ├── favicon-32.png
│   ├── apple-touch-icon.png       # 180x180
│   ├── wordmark.svg               # 纯文字版
│   ├── banner.png                 # GitHub 仓库 banner
│   ├── screenshots/               # 界面截图
│   │   ├── desktop-main.png
│   │   ├── wizard.png
│   │   ├── chat.png
│   │   └── skills.png
│   └── docs/                      # 文档插图
│       ├── architecture.svg
│       ├── workflow.svg
│       └── tutorial-1.png
└── ...
```

---

## 九、品牌使用规范

### 9.1 正确用法 ✅
- Logo 周围留白 >= Logo 宽度的 25%
- 不要拉伸/压缩 Logo
- 不要改变 Logo 主色
- 暗色背景用单色白版
- 浅色背景用全彩版

### 9.2 错误用法 ❌
- ❌ 在 Logo 上加文字/装饰
- ❌ 旋转 Logo (允许 90° 倍数)
- ❌ 用低分辨率图
- ❌ 用 Logo 当背景
- ❌ 改 Logo 颜色 (除非品牌指南明确允许)

---

## 十、应用图标准则 (Tauri + Mac + Win)

### 10.1 必填素材

| 文件 | 用途 |
|------|------|
| `icon.png` (1024x1024) | 主图标源 |
| `32x32.png` | favicon |
| `128x128.png` | VSCode |
| `128x128@2x.png` | Mac Retina |
| `icon.icns` | macOS .icns |
| `icon.ico` | Windows .ico |

### 10.2 Tauri 配置文件 (`tauri.conf.json`)

```json
{
  "bundle": {
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ]
  }
}
```

### 10.3 自动生成 (Tauri CLI)

```bash
pnpm --filter @agentai/desktop tauri icon ./assets/logo-1024.png
# → 自动生成上面所有尺寸
```

---

## 十一、文档/网站用图

### 11.1 README.md 头图

```markdown
![AgentAI Platform](./assets/banner.png)

# AgentAI Platform
> 智 Y.AI · 羽你同行
```

### 11.2 架构图

```svg
<!-- docs/architecture.svg (用 Mermaid 或 draw.io 导出) -->
```

### 11.3 截图规范

- 暗色背景: `#0F172A` + 智能蓝元素
- 浅色背景: `#FFFFFF` + 智能蓝元素
- 截图前清空演示数据
- 标注: 顶部加 AgentAI Logo 水印

---

## 十二、Logo 决策记录 (Reasonix 8 步对冲)

1. **49 候选方案** → 列举 49 种 logo 风格 (极简/几何/手绘/...)
2. **与现有架构比对** → 桌面/Web/VSCode 三端复用 → 必须可缩放 + 简版
3. **读 Hermes/ZhiY 经验** → ZhiY 是「羽翼」风, 我们差异化用「智能 A 字」
4. **Top5 过滤** → 智能蓝极简 / 科技粒子 / 中文意境 / 黑白单色 / 抽象字母
5. **多方案共识** → 富哥强调"主动设计", 选 A (智能蓝极简, 最稳)
6. **反向扫描** → 避免太像 OpenAI / Anthropic / Cursor 等竞品
7. **加权综合** → 智能蓝 #4F46E5 (避开 OpenAI 绿 / Anthropic 橙)
8. **质证** → 黑白剪影测试 → A 字 + 节点仍可识别 ✅

---

**v1.0 完, 富哥验收 + 拍板开阶段 1 时同步落地 assets/ 目录**
