# AgentAI Platform — 项目规则

> 本文件由 Trae IDE 自动加载，跨会话、跨模型生效。
> 修改本文件前请读完整内容。

---

## 1. 项目概述

AgentAI Platform — 完全免费的智能体框架平台。
- **Gateway**: Node.js 22, Express, TypeScript
- **GUI**: React, Vite, Antd5, TypeScript
- **Desktop**: Tauri (Rust shell)
- **Skills**: Python 技能集
- **QQBot/VSCode**: 渠道接入

## 2. 架构约束（层间依赖严格单向）

```
gui ──HTTP/WS──→ gateway ──import──→ core
```

- gateway 必须 import agentai-core，不允许在 gateway 内重写 core 的逻辑
- gui/qqbot/vscode/desktop 只能通过 HTTP/WS 调 gateway
- 禁止 gui 直接 import gateway 或 core

## 3. 编码规范

### 3.1 命名
| 元素 | 规范 | 示例 |
|------|------|------|
| 模块/文件 | 小写+下划线 | `anomaly_feature_integrator.ts` |
| 类 | 驼峰 | `AnomalyFeatureIntegrator` |
| 函数/方法 | 小写+下划线 | `load_model()` |
| 变量 | 小写+下划线 | `pipeline` |
| 私有方法 | 单下划线前缀 | `_enhance_with_anomaly_features()` |
| 常量 | 大写+下划线 | `MAX_RETRY_COUNT` |

### 3.2 代码风格
- 缩进：4 空格（非制表符）
- 行长度：不超过 100 字符
- 空行：模块间导入/类定义/方法定义/逻辑块之间空行分隔
- 运算符前后各一个空格，逗号/冒号后加空格，括号内侧不加空格

### 3.3 导入顺序
1. 标准库（`os`, `path`, `fs`）
2. 第三方库（`express`, `react`, `antd`）
3. 自定义模块

### 3.4 前端颜色
- 必须用 CSS 变量：`var(--panel)`, `var(--fg)`, `var(--border)`
- 禁止硬编码颜色：`#141414`, `#ddd`

### 3.5 组件注册
- 所有功能页面在 App.tsx 的 `PAGES` 字典注册
- 禁止手动 JSX 条件渲染 `{view === 'xxx' && <Xxx />}`

## 4. 工作规范

### 4.1 先思考再动手
- 修改前先读相关代码，理解现有逻辑
- 搜索相关模块再修改，禁止不读代码直接写新文件

### 4.2 最小改动原则
- 能改 3 行不重写一个文件
- 精准定位目标代码段，不做无关优化
- 禁止打包多个不相关修改到同一 commit

### 4.3 不引入无关变更
- 只修改和任务直接相关的代码
- 禁止顺手格式化/重命名/重构不相关的代码
- diff 只包含必要变更

### 4.4 目标驱动
- 记住用户意图，不要迷失在细节中
- 完成目标即停，不做多余的事

### 4.5 预留上下文
- 每次对话开始时自动加载此文件
- 关键上下文写在文件中，不依赖对话历史

## 5. 禁止事项

- ❌ 盘符硬编码路径。必须用 `process.cwd()` + `path.resolve`
- ❌ `process.kill()`。必须用 `taskkill` 或 `AbortController`
- ❌ 覆盖已有 `style` 属性
- ❌ 在 gateway 内重写 core 的能力
- ❌ 在前端代码中硬编码后端 API URL
- ❌ 删除 `.workbuddy/` 目录

## 6. 测试与验证

| 类型 | 要求 |
|------|------|
| 修改后 | 必须跑 `pnpm typecheck` |
| 提交前 | `pnpm lint` 无新增错误 |
| 新功能 | 需遵循 CODING_GUIDELINES.md 全部规则 |

> 根目录无 tsconfig.json，typecheck 请在 `packages/agentai-gateway/` 下运行。

## 7. 沙箱规则

沙箱相关配置见 `f:\agentai-platform\.trae-cn\sandbox-config.json`，包含文件路径白名单、命令白名单、网络操作白名单等。当工具调用被阻止时，检查沙箱配置是否缺少相关路径。

已知需要放行的路径模式：`F:\_tmp_8204_*` (pnpm 临时文件)、`node_modules`、`dist`。

## 8. README

- 禁止 AI 主动创建或更新 README、文档文件
- 除非用户明确要求
