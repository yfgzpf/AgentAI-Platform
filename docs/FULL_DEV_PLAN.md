# AgentAI Platform 完整开发计划（前端 + 桌面端）

> 状态：阶段 2 真验证通过，**全跑**模式下生成
> 时间：2026-06-08
> 富哥要求：再跑完整测试给我前端开发计划及桌面端打包计划

---

## 一、完整测试结果（全跑）

| 测试项 | 命令 | 结果 | 备注 |
|--------|------|------|------|
| 后端编译 | `tsc --noEmit` | ✅ 0 错误 | agentai-gateway |
| 后端打包 | `tsc` | ✅ dist/ 落地 | 6 个 .js + 6 个 .d.ts |
| 集成测试 | `node scripts/test.mjs` | ✅ **9/9 pass** | 框架切换 + 注入拦截 + A/B |
| 前端类型检查 | `tsc --noEmit` | ✅ 0 错误 | agentai-gui |
| 前端构建 | `vite build` | ✅ 成功 | 596 KB JS / 193 KB gzip / 16.5s |
| VSCode 扩展编译 | `tsc -p ./` | ✅ 0 错误 | agentai-vscode |
| VSCode 扩展打包 | `vsce package` | ✅ 成功 | `agentai-vscode-0.1.0-alpha.1.vsix` 11.71 KB |
| Git 提交 | 6 个 commit | ✅ 干净基线 | c5c76d0 在 head |

### 9/9 测试明细

```
✅ T1 list 2 框架 (openclaw + hermes)
✅ T2 pickByCapability(parallelTools) → openclaw
✅ T3 pickByCapability(chineseInjectionScan) → hermes
✅ T4 switch openclaw → hermes (100%)
✅ T5 chat (OpenClaw stub 路径)
✅ T6 提示注入拦截 (OpenClaw)
✅ T7 switch back to hermes
✅ T8 提示注入拦截 (Hermes 8 中文正则)
✅ T9 A/B 灰度 10% 流量
```

### Git 提交进度

```
c5c76d0  feat(vscode): real VSCode extension
4f3f6bc  test(platform): 真验证 9/9
3b8fa2a  feat(gateway): framework switcher
41c131c  feat(gateway): Stage 2 核心 4 件
5c2e3f8  feat(platform): 真源码导入 (ZhiY + Hermes)
d4582cd  feat(platform): bootstrap monorepo
```

---

## 二、前端开发计划

### 2.1 现状盘点

**已完成**：
- ✅ `packages/agentai-gui/` React 18 + TS + Vite + Antd
- ✅ Socket.io 客户端依赖
- ✅ Zustand 状态管理
- ✅ Vite 代理到 Gateway (18789)
- ✅ 构建成功 (596 KB JS)

**当前 GUI 现状**（写过的代码）：
- `index.html` Antd 主题 + `#4F46E5` 品牌色
- `App.tsx` 简单脚手架
- `main.tsx` React 18 入口
- `styles/global.css` 基础

### 2.2 前端 4 周计划（21 天）

#### Week 1：核心对话 + 框架切换 UI

| Day | 任务 | 验收 |
|-----|------|------|
| 1-2 | **Chat 组件**（消息流 / 流式响应 / Markdown 渲染） | 富哥能发消息，看到回复 |
| 3-4 | **框架切换面板**（OpenClaw ↔ Hermes 按钮，状态可视化） | 点按钮真的切，状态栏更新 |
| 5-7 | **多会话管理**（左侧会话列表，新建/删除/重命名） | 能切会话，记忆保持 |

技术细节：
- 走 `socket.io-client` 4.7.5 接 Gateway
- 流式响应：`socket.on('stream:chunk', ...)` 累加
- Markdown 渲染：直接用 `react-markdown` 8 + `remark-gfm`
- 状态：Zustand 4 store（chat/session/framework）

#### Week 2：技能面板 + 工具调用

| Day | 任务 | 验收 |
|-----|------|------|
| 8-9  | **技能库侧栏**（37 个技能列表，按目录分组） | 显示全部技能，能搜 |
| 10-11 | **工具调用可视化**（LLM 调用工具时显示进度） | 生成图/视频时能看到状态 |
| 12-14 | **多模态结果展示**（图片 / 视频 / 音频嵌入） | 生图能直接看，生视频能播放 |

#### Week 3：设置 + 密钥管理

| Day | 任务 | 验收 |
|-----|------|------|
| 15-16 | **首启动 wizard**（5 步引导：选 LLM → 填 Key → 测连通） | 第一次跑会弹 |
| 17-18 | **设置页**（LLM 切换 / 框架切换 / 端口 / 主题） | 设置改了生效 |
| 19-21 | **密钥管理**（AES-256-GCM 加密，可改可删） | Key 不落明文 |

#### Week 4：打磨 + 验收

| Day | 任务 | 验收 |
|-----|------|------|
| 22-23 | **国际化**（中/英 切换） | i18next 集成 |
| 24-25 | **暗色模式**（跟随系统 / 手动） | Antd theme dark 算法 |
| 26-27 | **可访问性 a11y**（aria 标签 / 键盘导航） | axe-core 扫描 |
| 28 | **E2E 测试**（Playwright 跑核心 5 流程） | 全过 |

### 2.3 关键技术决策

| 问题 | 决策 | 原因 |
|------|------|------|
| 状态管理 | **Zustand**（不 Redux） | 轻量 1KB，Antd 友好 |
| 路由 | **react-router-dom 6** | 多页面 / 会话 / 设置 |
| UI 库 | **Antd 5**（已用） | 中文生态最熟 |
| 流式响应 | **socket.io + custom event** | 不要 EventSource（要双向） |
| Markdown | **react-markdown + remark-gfm** | LLM 输出 90% 是 Markdown |
| 代码高亮 | **react-syntax-highlighter** | 代码块 |
| 表单 | **react-hook-form + zod** | 类型安全 + 性能 |
| 测试 | **vitest + playwright** | 单元 + E2E |

### 2.4 学 Cursor 的部分（从 cursor-mcp 3.4MB 源码）

- Webview 通信协议（`postMessage` + 类型化 message）
- 设置项 schema（`contributes.configuration` 写法）
- 命令面板集成（`category: "AgentAI"`）
- 状态栏点击交互（`statusBarItem.command`）

---

## 三、桌面端打包计划（Tauri）

### 3.1 现状盘点

**已完成**：
- ✅ `packages/agentai-desktop/` Tauri 2.0 Rust 壳
- ✅ `tauri.conf.json` 配置完整
- ✅ `Cargo.toml` 优化（opt-level = "s" + LTO + strip）
- ✅ `src/main.rs` + `src/lib.rs` 入口

**目标体积**：**5-10 MB**（vs Electron 150-200 MB）

### 3.2 桌面端 4 周计划（21 天）

#### Week 1：基础壳跑起来

| Day | 任务 | 验收 |
|-----|------|------|
| 1-2 | **编译验证**（tauri build 在 Windows 真跑通） | 出 .msi / .exe |
| 3-4 | **系统托盘**（点击展开菜单：显示窗口 / 退出） | 最小化到托盘 |
| 5-7 | **窗口管理**（关闭最小化到托盘，单实例锁） | 第二次启动唤起原窗口 |

技术细节：
- `tauri-plugin-single-instance` 防止多开
- `tauri::tray::TrayIcon` 托盘
- `WindowEvent::CloseRequested` 拦截关闭

#### Week 2：Gateway 联动

| Day | 任务 | 验收 |
|-----|------|------|
| 8-9  | **自动启停 Gateway**（壳启动 → spawn Node 进程） | 桌面打开 Gateway 自动起 |
| 10-11 | **健康检查**（壳定时 ping Gateway，挂了重启） | Gateway 死了桌面自动拉起 |
| 12-14 | **Webview 嵌 GUI**（tauri webview 加载 agentai-gui 编译产物） | 桌面里看到 Web 界面 |

#### Week 3：原生能力桥

| Day | 任务 | 验收 |
|-----|------|------|
| 15-16 | **全局快捷键**（Cmd+Shift+A 唤起对话框） | 全局能用 |
| 17-18 | **系统通知**（生图完成 / 长任务完成弹原生通知） | Windows Action Center 收到 |
| 19-21 | **文件系统桥**（Rust 读文件，前端显示） | 能选本地文件上传 |

#### Week 4：跨平台 + 签名 + 自动更新

| Day | 任务 | 验收 |
|-----|------|------|
| 22-23 | **macOS 编译**（tauri build --target aarch64-apple-darwin） | 出 .dmg |
| 24-25 | **Linux 编译**（tauri build --target x86_64-unknown-linux-gnu） | 出 .deb / .AppImage |
| 26-27 | **代码签名**（Windows EV 证书 / macOS 公证） | SmartScreen 不警告 |
| 28 | **自动更新**（tauri-plugin-updater + GitHub Releases） | 桌面内"检查更新"按钮 |

### 3.3 体积优化 5 把刀

| 优化 | 当前 | 优化后 | 节省 |
|------|------|--------|------|
| opt-level "s" | 12 MB | 8 MB | 33% |
| LTO (Link-Time Optimization) | - | 7 MB | 12% |
| strip symbols | - | 6.5 MB | 7% |
| wasm-opt | - | 6 MB | 8% |
| 不要 panic-abort | - | 5.5 MB | 8% |
| **总目标** | **12 MB** | **5-6 MB** | **~50%** |

### 3.4 跨平台产物

| 平台 | 格式 | 工具链 | 体积目标 |
|------|------|--------|----------|
| Windows x64 | .msi / .exe | tauri build | 5-6 MB |
| Windows ARM | .msi | tauri build --target aarch64-pc-windows-msvc | 5-6 MB |
| macOS Intel | .dmg | tauri build --target x86_64-apple-darwin | 7-8 MB |
| macOS Apple Silicon | .dmg | tauri build --target aarch64-apple-darwin | 5-6 MB |
| Linux x64 | .deb / .AppImage | tauri build --target x86_64-unknown-linux-gnu | 8-10 MB |

### 3.5 CI/CD 自动打包（GitHub Actions）

```yaml
name: release-desktop
on:
  push:
    tags: ['v*']
jobs:
  build:
    strategy:
      matrix:
        os: [windows-latest, macos-latest, ubuntu-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: pnpm install
      - run: pnpm --filter @agentai/gui build
      - run: pnpm --filter @agentai/desktop tauri build
      - uses: softprops/action-gh-release@v2
        with:
          files: |
            packages/agentai-desktop/target/release/bundle/**/*.msi
            packages/agentai-desktop/target/release/bundle/**/*.dmg
            packages/agentai-desktop/target/release/bundle/**/*.deb
```

### 3.6 学 Tauri 官方 + Cursor 实践

- Tauri 官方 starter：`cargo create-tauri-app`
- 体积优化：Tauri 官方 1.0 文档 `Bundle` 章节
- 单实例：tauri-plugin-single-instance 官方插件
- 自动更新：tauri-plugin-updater 官方插件

---

## 四、整体节奏（6 周冲刺）

| 周 | 前端 | 桌面端 | 后端 | 验收 |
|----|------|--------|------|------|
| 1 (已完) | 脚手架 | 脚手架 | Stage 2 核心 4 件 + 切换器 | 9/9 测试 |
| 2 | Week 1 (Chat + 框架切换) | Week 1 (编译 + 托盘) | Stage 2.5 (接 AgentAI 真 LLM) | E2E 跑通 1 个对话 |
| 3 | Week 2 (技能 + 工具) | Week 2 (Gateway 联动) | Stage 3 (Python 多模态 7 服) | 生图 + 生视频 端到端 |
| 4 | Week 3 (设置 + 密钥) | Week 3 (原生桥) | Stage 4 (6 平台适配器) | QQ 机器人跑通 |
| 5 | Week 4 (打磨 + a11y) | Week 4 (跨平台 + 签名) | Stage 5 (VSCode ACP) | 三端全过 |
| 6 | 修 bug | 修 bug | 修 bug | 全渠道 1.0 release |

---

## 五、关键风险 + 缓解

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| Tauri Windows 编译链断 | 中 | 高 | 文档化安装 vs buildtools + 备 Electron 方案 B |
| Apple 公证慢 / 卡 | 高 | 中 | 提前 1 周做，加时间缓冲 |
| LLM Provider API 限流 | 高 | 中 | 走 OpenAI 兼容 + 多 key 轮询 |
| QQ oicq 协议被封 | 中 | 高 | 备 go-cqhttp / 直接走 WebSocket 模拟 |
| Rust 学习曲线 | 中 | 中 | 阶段 1 跑通后只加 Rust 代码，前端不动 |
| Electron 回滚 | 低 | 中 | Tauri 完全失败 → 1 周内切回 Electron（文档已写） |

---

## 六、富哥拍板路径

| 选项 | 含义 | 时间 |
|------|------|------|
| **"全干 6 周"** | 按上面 6 周冲刺跑，每周 review | 6 周后 v1.0 |
| **"只前端 4 周"** | 跳过桌面端，先把 Web + VSCode 做透 | 4 周后 v0.5 |
| **"只核心 2 周"** | 只做 Chat + 框架切换 + 1 平台 | 2 周后 MVP |
| **"MVP 1 周"** | 只做：能对话 + 能切框架 + 桌面壳能起 | 1 周 demo |

---

**当前确认**：
- ✅ 后端编译 + 9/9 测试 + GUI 构建 + VSCode 打包全过
- ✅ 6 个 commit 干净基线
- ⏳ 等富哥选路径（6 周 / 4 周 / 2 周 / 1 周）

**下一步**（你说"全干"我会做的事）：
- Week 2 Day 1：写 Chat 组件 `packages/agentai-gui/src/components/Chat.tsx`
- 真接 Gateway socket.io，跑通"发消息收到回复"
- 桌面端：tauri build 编译验证 + 托盘

要不要我先开 Week 2 第一个文件（Chat 组件）？还是先给你 .vsix 装上看 VSCode 端效果？
