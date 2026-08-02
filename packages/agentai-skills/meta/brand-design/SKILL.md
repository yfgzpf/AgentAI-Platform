# 品牌设计技能 — LOGO 与启动页设计

## 技能概述
为 ATLAS 平台设计品牌视觉系统，包括 LOGO 设计、启动欢迎页动画、品牌命名规范。

## 核心能力

### 1. LOGO 设计原则
- **几何极简**：使用基础几何形状（三角形、圆形、线条）构建
- **品牌色一致**：使用系统主题色 `--accent: #CD7A3A`（铜橙色）
- **多尺寸适配**：确保 16px/32px/64px/128px 都清晰可辨
- **暗色背景优化**：LOGO 背景使用 `#1a1a1e`，与系统主题融合

### 2. 升维塔 LOGO 结构
```svg
<!-- 升维塔 — 层叠三角 + 光点顶 -->
<svg viewBox="0 0 64 64">
  <!-- 背景圆角矩形 -->
  <rect width="64" height="64" rx="14" fill="#1a1a1e"/>
  
  <!-- 外层大三角（渐变透明） -->
  <path d="M32 10 L50 46 L42 46 L32 26 L22 46 L14 46 Z" fill="url(#tower-gradient)"/>
  
  <!-- 内层小三角（实心） -->
  <path d="M32 24 L40 44 L32 38 L24 44 Z" fill="#CD7A3A"/>
  
  <!-- 顶点光点 -->
  <circle cx="32" cy="14" r="3" fill="#E89055"/>
</svg>
```

**设计含义**：
- 层叠三角 = 升维、进化、AI 能力层级
- 光点顶 = 智慧核心、指引方向
- 渐变 = 动态感、温度感

### 3. 启动欢迎页规范

#### 动画序列（总时长 1.5s）
| 时间 | 元素 | 动画 |
|------|------|------|
| 0ms | 双环脉冲 | ring-expand (2s 循环) |
| 600ms | 第二环脉冲 | ring-expand-2 (延迟启动) |
| 0ms | LOGO | atlas-pulse (呼吸缩放) |
| 300ms | 品牌名 | fade-in-up (淡入上滑) |
| 1500ms | 整体淡出 | 进入主界面 |

#### CSS 动画关键帧
```css
/* LOGO 呼吸脉冲 */
@keyframes atlas-pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.08); opacity: 0.85; }
}

/* 外环扩散 */
@keyframes ring-expand {
  0% { transform: scale(0.8); opacity: 0.6; }
  100% { transform: scale(2.2); opacity: 0; }
}

/* 内环扩散（延迟） */
@keyframes ring-expand-2 {
  0% { transform: scale(0.8); opacity: 0; }
  30% { opacity: 0.4; }
  100% { transform: scale(2.5); opacity: 0; }
}

/* 文字淡入 */
@keyframes fade-in-up {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
}
```

#### 布局结构
```html
<div class="splash-screen">
  <div class="logo-wrap">
    <div class="pulse-ring"></div>      <!-- 外环 -->
    <div class="pulse-ring delay"></div> <!-- 内环 -->
    <svg class="logo">...</svg>          <!-- LOGO -->
  </div>
  <div class="brand-text">
    <div class="brand">ATLAS</div>
    <div class="slogan">AI Task & Logic Agent System</div>
  </div>
</div>
```

### 4. 品牌命名规范

| 场景 | 规范 | 示例 |
|------|------|------|
| 产品名 | 全大写 | **ATLAS** |
| 中文名 | 擎天 | "擎天 AI" |
| 引擎名 | Agnes | Agnes 2.0 Flash（保留不变） |
| 窗口标题 | ATLAS | "ATLAS" |
| 系统提示词 | 自称 ATLAS | "我是 ATLAS..." |

### 5. 文件输出清单

设计确认后需生成：
- `favicon.svg` — 主 SVG 源文件
- `favicon-32.png` — 浏览器标签
- `favicon-64.png` — 桌面快捷方式
- `favicon-128.png` — 高 DPI 显示
- `favicon-192.png` — PWA 图标
- `favicon-512.png` — 大图标
- `icon.ico` — Windows 桌面端
- `icon.icns` — macOS 桌面端
- `Splash.tsx` — 启动页组件

## 使用示例

用户说："设计一个新 LOGO，要体现 AI 进化感"

AI 应该：
1. 提供 3-4 个几何极简方案
2. 使用品牌色 #CD7A3A
3. 展示多尺寸效果
4. 说明设计含义
5. 等待用户确认后再集成

## 注意事项
- 不要直接修改代码，先出预览供确认
- LOGO 必须在 16px 尺寸下仍可辨识
- 动画不要过长（1.5s 内完成）
- 保持极简，不要堆砌功能列表
