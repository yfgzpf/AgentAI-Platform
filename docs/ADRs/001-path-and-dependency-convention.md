# ADR-001: 路径规范与层间依赖规则

**日期**: 2026-06-08
**状态**: 已采纳
**来源**: 全库审查发现的 [P0-HARDPATH] 和 [P1-CORE-DUP]

## 背景

全库 6 个文件硬编码了 `F:/agentai-platform/.env` 和 `C:/Users/Administrator/.../python.exe`，导致项目在其他机器无法运行。同时，`agentai-core` 包的 30+ 文件无任何消费者，而 gateway 重新实现了全套。

## 决策

### 1. 路径: 只允许相对路径 + 环境变量

禁止绝对盘符路径（`C:/`, `D:/`, `F:/` 等）。路径解析统一用:
```typescript
path.resolve(process.cwd(), '.env')       // 工作目录相对
process.env.AGENTAI_ENV_PATH             // 环境变量覆盖
```

### 2. 依赖: 单向三层

```
GUI / QQ / VSCode / Desktop ──HTTP/WS──→ Gateway ──import──→ Core
```

Gateway 必须消费 Core 的 `LLMService` / `MemoryStore`，禁止自己重写。

## 影响

- 正面: 可移植性提升，新开发者 clone 即用
- 负面: Gateway 需改造 memory.ts → import from core（工作量约 0.5h）

## 对照

- 替代方案 A（保持现状）: rejected，硬编码使项目无法在其他机器运行
- 替代方案 B（全部 env var）: adopted，最灵活
