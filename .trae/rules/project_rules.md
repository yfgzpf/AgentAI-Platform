

> 此文件由 AI 自动生成

# agentai-platform 项目开发规范

## 1. 项目概述
`agentai-platform` 是基于 React、Vite、TypeScript 和 Ant Design 构建的 AI 辅助开发平台，采用 pnpm 管理 Monorepo 结构。

## 2. 技术栈
- **前端框架**：React
- **构建工具**：Vite
- **语言**：TypeScript (Strict Mode)
- **UI 组件库**：Ant Design
- **包管理**：pnpm (Monorepo)

## 3. 目录结构说明
- `.agentai/`, `.codebuddy/`, `.workbuddy/`：AI Agent 配置、上下文与工具链
- `packages/`：Monorepo 子包，包含核心业务逻辑与共享模块
- `assets/`, `docs/`, `models/`, `references/`：静态资源、文档、数据模型与参考材料
- `output/`, `reports/`：构建产物、日志与测试报告
- `.husky/`, `.github/`：Git Hooks 与 CI/CD 流水线配置

## 4. 编码规范
- **命名**：组件与类使用 PascalCase，文件与函数使用 camelCase，常量使用 UPPER_SNAKE_CASE。
- **导入顺序**：React