# AgentAI Platform 修订计划 v1.0

> 基于 2026-06-13 系统审查报告
> 预计总工期: 7 天 (P0 2天 + P1 3天 + P2 2天)

---

## 一、修订总览

| 阶段 | 优先级 | 项目数 | 预计天数 | 核心目标 |
|------|--------|--------|----------|----------|
| 阶段 A | P0 🔴 | 4 | 2天 | 修复核心对话闭环 |
| 阶段 B | P1 🟡 | 4 | 3天 | 提升体验与架构质量 |
| 阶段 C | P2 🟢 | 4 | 2天 | 补全生态与质量保障 |

---

## 二、阶段 A：P0 严重修复 (Day 1-2)

### P0-1：修复 SSE 路径走 AgentAILoop ⭐⭐⭐ 最关键

**问题**: `/v1/chat` SSE 分支 (chat.ts L74-97) 直接调 `router.chat()` 发一条消息，不走 `loop.run()`，导致工具调用闭环断开。

**影响范围**:
- ❌ 前端 ChatView 的 `tool_start`/`tool_result` 事件永远不触发
- ❌ AI 不执行任何工具（文件读写、搜索等）
- ❌ 上下文不积累，每次请求是全新 session
- ❌ 反思门、记忆写入不触发

**修复方案**:

```
文件: packages/agentai-gateway/src/routes/chat.ts

1. SSE 分支复用非 SSE 分支的 session 获取逻辑:
   - 使用 sessionManager.getOrCreate() 获取/创建 loop
   - 不再直接操作 sessionManager['map']

2. SSE 分支调 loop.run(message) 而非 router.chat():
   - 监听 loop 的 'log:appended' 事件 → 发 delta SSE
   - 监听 loop 的 'tool:start' 事件 → 发 tool_start SSE
   - 监听 loop 的 'tool:result' 事件 → 发 tool_result SSE
   - 监听 loop 的 'loop:done' 事件 → 发 done SSE

3. Loop.run() 的流式输出改造:
   - AgentAILoop 新增 streamMode 选项
   - streamMode=true 时, 每次 router.chat(req) 带 onDelta 回调
   - onDelta 触发 'log:appended' 事件 (含 delta 而非完整 content)

4. 处理 LLM 的 onDelta 流式:
   - loop.run() 内部的 router.chat() 调用传入 onDelta
   - loop 发射 'stream:delta' 事件, SSE 监听后转发
```

**验证标准**:
- [ ] SSE 模式下，ChatView 收到 `delta` 事件并逐字显示
- [ ] SSE 模式下，AI 调用工具时前端收到 `tool_start` → `tool_result`
- [ ] SSE 模式下，session 上下文在多次请求间保持
- [ ] 非 SSE 模式行为不变

**预估工时**: 6h

---

### P0-2：修复 AgentAILoop model 硬编码

**问题**: `agentai-loop.ts` L187 构造 `ChatRequest` 时 `model: 'agentai'` 写死。

**修复方案**:

```
文件: packages/agentai-gateway/src/agentai-loop.ts

第 187 行:
  修改前: model: 'agentai',
  修改后: model: this.opts.model,
```

**验证标准**:
- [ ] 前端选 deepseek 模型后，loop 实际调用 deepseek provider
- [ ] 智能路由仍能正常工作 (model=agentai 时走评分)

**预估工时**: 0.5h

---

### P0-3：QQ Bot 真调 LLM

**问题**: `routes/qq.ts` 的 `processQQMessage()` 只返回格式化字符串，没有调 LLM。

**修复方案**:

```
文件: packages/agentai-gateway/src/routes/qq.ts

1. processQQMessage 改为异步调 Gateway 自身的 /v1/chat:
   const resp = await fetch('http://127.0.0.1:18789/v1/chat', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({
       message: cleanContent,
       userId: `qq:${userId}`,
       workspace: '',
       stream: false,
       model: 'agentai',
     }),
   });
   const data = await resp.json();
   return data.content || '(无回复)';

2. 增加 QQ 消息长度截断 (QQ 单条消息限 2000 字):
   const reply = (data.content || '').slice(0, 1800);

3. 增加 rate-limit (每用户 30s 冷却):
   const lastReply = qqUserCooldowns.get(userId);
   if (lastReply && Date.now() - lastReply < 30000) return '(冷却中)';

4. 增加 @ 提及过滤:
   cleanContent = cleanContent.replace(/<@\d+>/g, '').trim();
```

**验证标准**:
- [ ] QQ 群 @机器人后收到 AI 回复
- [ ] 私聊机器人收到 AI 回复
- [ ] 回复内容 > 2000 字时自动截断

**预估工时**: 2h

---

### P0-4：SessionManager 私有属性直接操作改为用 getOrCreate

**问题**: `routes/chat.ts` L53, L148 直接操作 `sessionManager['map'].set()`

**修复方案**:

```
文件: packages/agentai-gateway/src/session-manager.ts

1. 扩展 getOrCreate 的 factory 参数:
   interface SessionFactory {
     loop: AgentAILoop;
     userId: string;
     workspace: string;
   }
   // factory 可以接收外部传入的 loop 实例
   // 也可以让 getOrCreate 自行创建

文件: packages/agentai-gateway/src/routes/chat.ts

2. 替换所有 sessionManager['map'].set() 为:
   const loop = sessionManager.getOrCreate(sessionKey, () => ({
     loop: new AgentAILoop(router, registry, [], opts),
     userId,
     workspace,
   }));
```

**验证标准**:
- [ ] 不再有 `sessionManager['map']` 的直接操作
- [ ] Session 的 LRU/TTL 行为正常

**预估工时**: 1h

---

## 三、阶段 B：P1 重要改进 (Day 3-5)

### P1-1：ChatView / Editor / StatusBar 硬编码颜色 → CSS 变量

**问题**: 多个组件内硬编码 `#0f0f0f`、`#1f1f1f`、`#ddd` 等，不跟随主题切换。

**涉及文件** (按优先级):
| 文件 | 硬编码处 | 修复量 |
|------|----------|--------|
| `ChatView.tsx` | L96-155 (全部容器+输入区) | ~15处 |
| `Editor.tsx` | L96-730 (文件树+编辑区+状态栏) | ~30处 |
| `ChatMessage.tsx` | 消息气泡颜色 | ~10处 |
| `StatusBar.tsx` | 底栏颜色 | ~8处 |
| `ImageGen.tsx` | 面板颜色 | ~6处 |
| `VideoGen.tsx` | 面板颜色 | ~6处 |

**CSS 变量映射表**:
```
#0f0f0f / #0a0a0a → var(--bg)
#141414 / #1a1a1a → var(--panel)
#1f1f1f / #222 / #262626 → var(--border)
#333 → var(--border-strong)
#ddd / #d4d4d4 → var(--fg)
#aaa / #888 → var(--fg-2)
#666 / #555 → var(--muted)
#4F46E5 → var(--accent)
#facc15 → var(--warning)
#93c5fd → var(--accent-soft)
```

**验证标准**:
- [ ] 切换到 sandstone (亮色) 主题时，所有组件正确变色
- [ ] 切换到 midnight 主题时，紫色强调色生效
- [ ] 切换到 ember 主题时，橙色强调色生效

**预估工时**: 4h

---

### P1-2：Editor AI 改写走 SSE 流式

**问题**: `Editor.tsx` 的 `aiEdit()` 用非流式 `fetch`，用户等待时间长。

**修复方案**:

```
文件: packages/agentai-gui/src/components/Editor.tsx

1. aiEdit() 改用 apiStream():
   import { apiStream } from '../services/api';

   await apiStream('/v1/chat', {
     message: `请改写这段代码...`,
     stream: true,
     userId: 'editor',
     workspace,
   }, {
     onDelta: (text) => {
       // 逐步更新编辑器内容
       setAiResponse(prev => prev + text);
     },
     onDone: () => {
       // 将 AI 回复写入编辑器
       editContent(cleanAiResponse(aiResponse));
       setAiBusy(false);
     },
   });

2. 增加 AI 回复预览区:
   - 编辑器下方显示 AI 回复进度条
   - 完成后一键"采纳"或"放弃"
```

**验证标准**:
- [ ] AI 改写时编辑器下方逐步显示回复
- [ ] 用户可以在 AI 回复过程中取消
- [ ] 回复完成后可选择采纳或放弃

**预估工时**: 3h

---

### P1-3：统一 ChatMessage 类型到 agentai-core

**问题**: 三个包各自定义 `ChatMessage`，互不兼容。

**修复方案**:

```
文件: packages/agentai-core/src/index.ts

1. 定义统一的 ChatMessage 接口:
   export interface ChatMessage {
     role: 'system' | 'user' | 'assistant' | 'tool';
     content: string | ContentBlock[];
     name?: string;
     toolCallId?: string;
     // 用于前端 segments 模型
     segments?: ChatSegment[];
     // 元数据
     id?: string;
     ts?: number;
     provider?: string;
     streaming?: boolean;
   }

   export interface ChatSegment {
     kind: 'text' | 'tool';
     text?: string;
     callId?: string;
     name?: string;
     state?: 'running' | 'success' | 'error';
     result?: string;
     ok?: boolean;
   }

   export interface ContentBlock {
     type: 'text' | 'image_url';
     text?: string;
     image_url?: { url: string; detail?: string };
   }

2. 修改引用:
   - llm-router.ts: import { ChatMessage } from '@agentai/core'
   - chatStore.ts: import { ChatMessage, ChatSegment } from '@agentai/core'
   - persistent-memory.ts: import { ChatMessage } from '@agentai/core'

3. 删除各文件的本地 ChatMessage 定义
```

**验证标准**:
- [ ] 所有包使用同一个 ChatMessage 定义
- [ ] 前后端数据结构可无缝序列化/反序列化
- [ ] TypeScript 编译无类型错误

**预估工时**: 3h

---

### P1-4：Editor 接入 Monaco 语法高亮

**问题**: 编辑器使用 `<textarea>`，无语法高亮。

**修复方案**:

```
1. 安装依赖:
   pnpm --filter @agentai/gui add @monaco-editor/react

2. 替换 textarea 为 MonacoEditor:
   import Editor from '@monaco-editor/react';

   <Editor
     height="100%"
     language={active.language}
     value={active.content}
     onChange={(val) => editContent(val || '')}
     theme={isDark ? 'vs-dark' : 'vs'}
     options={{
       minimap: { enabled: false },
       fontSize: 13,
       wordWrap: 'on',
       readOnly: active.readonly,
       automaticLayout: true,
     }}
   />

3. Ctrl+S 保存:
   editor.addCommand(KeyMod.CtrlCmd | KeyCode.KeyS, () => saveActive());
```

**验证标准**:
- [ ] .ts/.tsx 文件有 TypeScript 语法高亮
- [ ] .py 文件有 Python 语法高亮
- [ ] Ctrl+S 保存正常工作
- [ ] 深色/亮色主题切换时编辑器跟随

**预估工时**: 3h

---

## 四、阶段 C：P2 生态补全 (Day 6-7)

### P2-1：逐步移除 @ts-nocheck

**策略**: 按依赖顺序，从底层往上移除

```
移除顺序:
1. llm-router.ts (核心，最多类型错误)
2. tools.ts (依赖 llm-router 类型)
3. routes/chat.ts (依赖 loop + router + registry 类型)
4. routes/qq.ts
5. routes/admin.ts
6. sandbox/index.ts

每个文件:
1. 删除 // @ts-nocheck
2. 运行 tsc --noEmit 看错误列表
3. 逐个修复类型错误
4. 优先用 any 作临时逃生，避免改接口
```

**预估工时**: 6h (每个文件 ~1h)

---

### P2-2：ChatView 上下文记忆加载 + 会话切换

**当前状态**: ChatView 没有从 `/v1/memory` 加载历史，也没有会话列表切换。

**修复方案**:

```
1. 启动时加载历史记忆:
   useEffect(() => {
     fetch(GATEWAY_HTTP + '/v1/memory?workspace=...')
       .then(r => r.json())
       .then(data => {
         // 把历史记忆显示为"上下文"气泡
       });
   }, []);

2. SessionSidebar 接入 /api/sessions:
   - 列出所有持久化 checkpoint
   - 点击切换到对应 session
   - 新建对话 = 清空 chatStore + 创建新 session

3. 对话结束时写入记忆:
   - 已有 writeMemory 调用，确认 SSE 路径也写入
```

**预估工时**: 4h

---

### P2-3：VSCode 扩展骨架

**修复方案**:

```
1. 创建 packages/agentai-vscode/src/extension.ts:
   - activate(): 注册命令和侧边栏
   - AgentAI: Ask — 弹输入框, 发到 Gateway /v1/chat
   - AgentAI: Generate Code — 选中代码 + 指令 → /v1/chat
   - 侧边栏: WebView 对话面板

2. 创建 packages/agentai-vscode/package.json:
   - contributes.commands, contributes.viewsContainers

3. pnpm --filter agentai-vscode build && vsce package
```

**预估工时**: 6h

---

### P2-4：Skills Python 沙箱 dockerode 对接

**当前**: `python-bridge.ts` 直接 spawn python3，无资源隔离。

**修复方案**:

```
1. 安装 dockerode:
   pnpm --filter @agentai/gateway add dockerode @types/dockerode

2. 沙箱执行器:
   const docker = new Docker();
   const container = await docker.createContainer({
     Image: 'agentai-skills:latest',
     Cmd: ['python', '/skill/main.py', JSON.stringify(args)],
     HostConfig: {
       Memory: 512 * 1024 * 1024,  // 512MB
       NanoCpus: 1e9,              // 1 CPU
       NetworkMode: 'none',        // 无网络
       AutoRemove: true,
     },
   });

3. 构建 Dockerfile:
   FROM python:3.13-slim
   COPY requirements.txt /app/
   RUN pip install -r requirements.txt
   WORKDIR /skill

4. 回退: Docker 不可用时仍用 spawn python3 + sandboxGuard
```

**预估工时**: 4h

---

## 五、每日排程

| 日期 | 阶段 | 上午 | 下午 |
|------|------|------|------|
| Day 1 | A | P0-1 SSE走Loop (6h) | P0-2 model修复 + P0-4 SessionManager |
| Day 2 | A | P0-3 QQ Bot真调LLM + 验证 | P0-1 补充验证 + P1-1 主题适配 |
| Day 3 | B | P1-1 主题适配 (续) | P1-2 Editor SSE流式 |
| Day 4 | B | P1-3 统一ChatMessage类型 | P1-4 Monaco语法高亮 |
| Day 5 | B | P1-4 Monaco (续) + 全体验证 | P2-1 移除@ts-nocheck |
| Day 6 | C | P2-1 移除@ts-nocheck (续) | P2-2 记忆加载+会话切换 |
| Day 7 | C | P2-3 VSCode扩展骨架 | P2-4 Docker沙箱 + 全量回归 |

---

## 六、验收标准

### P0 验收 (Day 2 结束)
- [ ] 前端 ChatView SSE 模式: AI 逐字输出 + 工具调用可视化
- [ ] 前端 ChatView 非 SSE 模式: 行为不变
- [ ] QQ 群/私聊: @机器人收到真实 AI 回复
- [ ] 模型切换: 选 deepseek 实际调 deepseek API
- [ ] 无 `sessionManager['map']` 直接操作

### P1 验收 (Day 5 结束)
- [ ] 5 套主题全部正确渲染 (包括 ChatView、Editor)
- [ ] Editor AI 改写有流式输出
- [ ] 所有包使用统一 ChatMessage 类型
- [ ] Editor 有 Monaco 语法高亮
- [ ] TypeScript 编译 0 错误 (核心文件)

### P2 验收 (Day 7 结束)
- [ ] 核心文件无 @ts-nocheck
- [ ] ChatView 有记忆上下文 + 会话切换
- [ ] VSCode 扩展能发送消息到 Gateway
- [ ] Docker 沙箱能执行 Python 技能 (可选，Docker 可用时)

---

## 七、风险与缓解

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| SSE + Loop 集成复杂 | 中 | P0-1 延期 | 先实现最简版本 (delta only)，tool event 后补 |
| Monaco 体积大 | 低 | 包体积增大 | Vite tree-shaking + 按需加载 |
| ChatMessage 统一引发连锁修改 | 中 | 多文件改动 | 用 adapter 模式过渡 |
| Docker 不可用 | 中 | P2-4 无法验证 | 回退到 spawn + sandboxGuard |
| QQ Bot 测试环境受限 | 高 | 无法真实验证 | Mock 测试 + 日志验证 |
