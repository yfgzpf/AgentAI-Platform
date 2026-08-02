# Critical #1 修复方案：ask_human 死代码

> 问题：当 `meta-cognitive-loop` 返回 `ask_human` 时，主循环设置 `forceTool = 'ask_user'` 后 `break`，但用户回答后，新消息被当作新输入而非追问回答，导致原任务上下文丢失。

---

## 当前流程

```
meta-cognitive-loop → ask_human → 主循环设置 forceTool → break → 
AI 调用 ask_user → 前端显示 AskUserCard → 用户回答 → 
handleSend(pendingAnswer) → 后端当作新消息处理 → 原任务上下文丢失
```

---

## 修复方案

### 方案 A：追问答案标记（最小改动）

**前端改动**：
1. `AskUserCard` 增加 `askId` prop
2. `onAskUser` 回调传递 `askId`
3. 发送答案时附加 `meta: { askId, type: 'ask_response' }`

**后端改动**：
1. `chat.ts` 识别 `meta.ask_response` 类型
2. 注入提示：`[SYSTEM] 这是用户对你追问的回答，请继续原任务`
3. 复用会话中的 `loop` 对象继续执行

**优点**：改动小，利用现有会话机制
**缺点**：依赖 AI 理解提示，可能不稳定

### 方案 B：主循环状态机（彻底）

**改动**：
1. 主循环增加 `pause()` / `resume()` 方法
2. `ask_human` 时 `pause()` 并等待信号
3. 用户回答后调用 `resume(answer)` 继续

**优点**：状态完整，不依赖 AI 理解
**缺点**：改动大，需要重构主循环

---

## 推荐方案：方案 A

理由：
1. 会话机制已存在，`loop` 对象会保存
2. 只需注入提示，让 AI 知道这是追问回答
3. 改动量可控（前端 3 处 + 后端 2 处）

---

## 具体修改点

### 前端

1. **Thread.tsx / ChatView.tsx**：
   - `onAskUser` 回调增加 `askId` 参数
   - `AskUserCard` 接收 `askId` prop

2. **AskUserCard.tsx**：
   - `onAnswer` 回调增加 `askId` 参数

3. **ChatView.tsx**：
   - `pendingAnswer` 改为 `{ text: string; askId: string } | null`
   - `handleSend` 支持发送 `meta.ask_response`

### 后端

1. **routes/chat.ts**：
   - 检查 `req.body.meta?.type === 'ask_response'`
   - 注入提示到消息头部

2. **agentai-loop.ts**（可选）：
   - `ask_human` 时记录 `pendingAskId`
   - 方便后续追踪

---

## 估算改动量

| 文件 | 改动行数 | 难度 |
|------|---------|------|
| ChatView.tsx | 15 行 | 中 |
| AskUserCard.tsx | 5 行 | 低 |
| Thread.tsx | 3 行 | 低 |
| routes/chat.ts | 10 行 | 中 |
| agentai-loop.ts | 5 行（可选） | 低 |
| **总计** | **~38 行** | — |

---

## 是否继续？

请确认：
- ✅ 接受方案 A（追问答案标记）
- 🔄 改用方案 B（主循环状态机）
- ⏸ 暂停，先讨论其他方案