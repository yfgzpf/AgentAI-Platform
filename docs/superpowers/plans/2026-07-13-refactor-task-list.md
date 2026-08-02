# AgentAI Platform 系统重构与漏洞修复计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复终极审查发现的 6 个 Critical + 15 个 High 漏洞，清理 31 个死代码，合并 17 个重复组件，把 AgentAI Platform 从"119 项问题"提升为"安全+可维护+创新"的平台。

**Architecture:** 分 4 个 Phase 渐进式重构：Phase 0 修 Critical（安全优先）→ Phase 1 修 High → Phase 2 清死代码 → Phase 3 合重复。每任务独立可测试，频繁 commit。

**Tech Stack:** Node.js 22 + TypeScript + Express + React + Vite + Tauri + Python 技能

---

## 文件结构

### 新建文件

| 路径 | 职责 |
|------|------|
| `gateway/src/middleware/auth.ts` | 全局 token 认证中间件 |
| `gateway/src/safety/command-whitelist.ts` | 命令注入白名单校验器 |
| `gateway/src/safety/path-guard.ts` | 路径白名单校验器 |
| `gui/src/services/secureKeyStorage.ts` | sessionStorage 安全 API Key 存储 |
| `gateway/src/safety/code-runner.ts` | AI 生成代码的沙箱执行器 |
| `gateway/src/diagnosis/decision-gate.ts` | 统一决策入口（废弃后复用） |
| `gateway/src/diagnosis/step-verifier.ts` | 治中求验（接入） |
| `docs/superpowers/plans/2026-07-13-refactor-safety-review.md` | 重构安全审查 |

### 修改文件

| 路径 | 改动 |
|------|------|
| `gateway/src/app.ts` | 加 auth middleware、删 inline 路由、修硬编码 URL |
| `gateway/src/routes/chat.ts` | Xuanji clarify 真阻塞 |
| `gateway/src/agentai-loop.ts` | metaLoop 每次 run() 重置、waitForClarification 监听 abort |
| `gateway/src/tools.ts` | discover_or_create_skill 用 CodeRunner |
| `gateway/src/llm-router.ts` | SmartModelSwitcher 免费池补全 |
| `gateway/src/files.ts` | 恢复 allowedRoots、删重复路由 |
| `gui/src/App.tsx` | 删硬编码 URL、删 dead PAGES |
| `gui/src/components/SchedulePanel.tsx` + `AutomationPanel.tsx` | 合并为单一 SchedulePage |

### 删除文件（31 个）

`decision-gate.ts`、`plan-assembler.ts`、`step-verifier.ts`（已有等价实现）、`gap-analyzer.ts`、`quick-diagnose.ts`、`tool-factory.ts`、`skill-training.ts`、`skills/doubt-driven-development.ts`、`skills/auto-error-repair.ts`、`router-rate-limiter.ts`、`rate-limit-integration.ts`、`sedoxtJWW`、`utils/profile.ts`、`stores/useAppStore.ts`、`pages/*.tsx`（5 个）、`services/CameraTemplates.ts`、`agentai-core/`、`agentai-desktop/src/ai-browser-agent.ts`、`agentai-qqbot/`（整个包）、`agentai-skills/decoration-quote/`、`moss-tts-server/` 重复副本

---

## Phase 0: Critical 安全修复（1-2 天）

### Task 1: C1 — 修命令注入 RCE

**Files:**
- Create: `packages/agentai-gateway/src/safety/command-whitelist.ts`
- Modify: `packages/agentai-gateway/src/app.ts:120-138`

- [ ] **Step 1: 创建命令白名单**

```typescript
// packages/agentai-gateway/src/safety/command-whitelist.ts
const ALLOWED_COMMANDS = new Set([
  'node', 'npm', 'pnpm', 'python', 'python3', 'pip', 'git', 'tsc'
]);

export function validateCommand(cmd: string): { ok: true } | { ok: false; reason: string } {
  const base = cmd.trim().split(/\s+/)[0];
  if (!ALLOWED_COMMANDS.has(base)) {
    return { ok: false, reason: `Command '${base}' not in whitelist` };
  }
  if (cmd.includes('&&') || cmd.includes('|') || cmd.includes(';') || cmd.includes('`')) {
    return { ok: false, reason: 'Chaining operators not allowed' };
  }
  if (cmd.includes('$(') || cmd.includes('${')) {
    return { ok: false, reason: 'Command substitution not allowed' };
  }
  return { ok: true };
}
```

- [ ] **Step 2: 替换 app.ts:120-138 的命令执行**

```typescript
// 旧:
const cmd = (req.query.cmd as string) || 'node';
execSync(`${cmd} --version 2>&1`, { encoding: 'utf-8' });

// 新:
import { validateCommand } from './safety/command-whitelist.js';
const cmd = (req.query.cmd as string) || 'node';
const validation = validateCommand(cmd);
if (!validation.ok) {
  return res.status(400).json({ error: validation.reason });
}
const output = execSync(`${cmd} --version 2>&1`, { encoding: 'utf-8' });
res.json({ version: output.trim() });
```

- [ ] **Step 3: 测试**

```typescript
// tests/safety/command-whitelist.test.ts
import { validateCommand } from '../../src/safety/command-whitelist.js';
test('rejects malicious command', () => {
  const r = validateCommand('node -e "require(\'child_process\').exec(\'rm -rf /\')"');
  expect(r.ok).toBe(false);
});
test('accepts node', () => {
  const r = validateCommand('node');
  expect(r.ok).toBe(true);
});
```

- [ ] **Step 4: 编译验证**

```bash
cd packages/agentai-gateway && node node_modules/typescript/bin/tsc --noEmit
```
Expected: EXIT 0

- [ ] **Step 5: 提交**

```bash
git add packages/agentai-gateway/src/safety/command-whitelist.ts \
        packages/agentai-gateway/src/app.ts \
        packages/agentai-gateway/tests/safety/command-whitelist.test.ts
git commit -m "fix(security): block command injection in /v1/system/check-dep"
```

### Task 2: C2 — 全局认证中间件

**Files:**
- Create: `packages/agentai-gateway/src/middleware/auth.ts`
- Modify: `packages/agentai-gateway/src/app.ts`

- [ ] **Step 1: 创建 auth middleware**

```typescript
// packages/agentai-gateway/src/middleware/auth.ts
import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

const TOKEN_FILE = process.env.AGENTAI_TOKEN_FILE || '.agentai/auth-token';
let cachedToken: string | null = null;

function loadToken(): string {
  if (cachedToken) return cachedToken;
  if (process.env.AGENTAI_AUTH_TOKEN) {
    cachedToken = process.env.AGENTAI_AUTH_TOKEN;
    return cachedToken;
  }
  try {
    const fs = require('fs');
    cachedToken = fs.readFileSync(TOKEN_FILE, 'utf-8').trim();
  } catch {
    cachedToken = crypto.randomBytes(32).toString('hex');
    try {
      require('fs').writeFileSync(TOKEN_FILE, cachedToken);
    } catch {}
  }
  return cachedToken;
}

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  if (req.path === '/health' || req.path === '/v1/system/check-dep') {
    return next();
  }
  const provided = req.headers['x-agentai-token'] || req.query.token;
  if (provided !== loadToken()) {
    return res.status(401).json({ error: 'Invalid or missing token' });
  }
  next();
}
```

- [ ] **Step 2: 在 app.ts 启用（路由前）**

```typescript
import { authMiddleware } from './middleware/auth.js';
// 在所有 app.use() 之前
app.use(authMiddleware);
```

- [ ] **Step 3: 编译验证 + 提交**

```bash
cd packages/agentai-gateway && node node_modules/typescript/bin/tsc --noEmit
git add packages/agentai-gateway/src/middleware/auth.ts packages/agentai-gateway/src/app.ts
git commit -m "feat(security): add global auth middleware with token file"
```

### Task 3: C3 — files.ts 恢复 allowedRoots

**Files:**
- Modify: `packages/agentai-gateway/src/routes/files.ts:163-203`

- [ ] **Step 1: 加白名单校验**

```typescript
// 在 GET /v1/fs/list 路由前
const ALLOWED_ROOTS = [
  process.cwd(),
  process.env.AGENTAI_WORKSPACE || process.cwd(),
  path.join(process.env.HOME || process.env.USERPROFILE || '', 'Documents'),
];

function isPathAllowed(target: string): boolean {
  const resolved = path.resolve(target);
  return ALLOWED_ROOTS.some(root => resolved.startsWith(path.resolve(root)));
}

// 替换 GET /v1/fs/list 中的 list 逻辑
app.get('/v1/fs/list', (req, res) => {
  const target = req.query.path as string;
  if (!target || !isPathAllowed(target)) {
    return res.status(403).json({ error: 'Path not in allowed roots' });
  }
  // ... 原有 list 逻辑
});
```

- [ ] **Step 2: 测试拒绝 C:\Windows**

```typescript
test('rejects system paths', () => {
  expect(isPathAllowed('C:\\Windows\\System32')).toBe(false);
});
test('allows workspace', () => {
  expect(isPathAllowed(process.cwd())).toBe(true);
});
```

- [ ] **Step 3: 编译 + 提交**

```bash
cd packages/agentai-gateway && node node_modules/typescript/bin/tsc --noEmit
git add packages/agentai-gateway/src/routes/files.ts
git commit -m "fix(security): restore allowedRoots check in /v1/fs/list"
```

### Task 4: C4 — 前端 API Key 改 sessionStorage

**Files:**
- Create: `packages/agentai-gui/src/services/secureKeyStorage.ts`
- Modify: `packages/agentai-gui/src/components/Settings.tsx:189,311`、`packages/agentai-gui/src/components/Model3DGen.tsx:52-54`、`packages/agentai-gui/src/services/VoiceService.ts:25`

- [ ] **Step 1: 创建安全存储工具**

```typescript
// packages/agentai-gui/src/services/secureKeyStorage.ts
const SESSION_KEYS = new Set([
  'DEEPSEEK_API_KEY', 'OPENAI_API_KEY', 'ZHIPU_API_KEY',
  'TENCENT_TC_ID', 'TENCENT_TC_SECRET', 'TTS_API_KEY'
]);

export function saveApiKey(envVar: string, value: string): void {
  if (!SESSION_KEYS.has(envVar)) {
    throw new Error(`Unknown env var: ${envVar}`);
  }
  sessionStorage.setItem(`agentai.${envVar}`, value);
}

export function getApiKey(envVar: string): string | null {
  if (!SESSION_KEYS.has(envVar)) return null;
  return sessionStorage.getItem(`agentai.${envVar}`);
}

export function removeApiKey(envVar: string): void {
  sessionStorage.removeItem(`agentai.${envVar}`);
}
```

- [ ] **Step 2: 替换 Settings.tsx 内的 localStorage.setItem**

```typescript
// 旧:
localStorage.setItem(envVar, apiKey);
// 新:
import { saveApiKey } from '../services/secureKeyStorage';
saveApiKey(envVar, apiKey);
```

- [ ] **Step 3: 替换 Model3DGen.tsx、VoiceService.ts 同样模式**

- [ ] **Step 4: 编译 + 提交**

```bash
cd packages/agentai-gui && pnpm typecheck
git add packages/agentai-gui/src/services/secureKeyStorage.ts \
        packages/agentai-gui/src/components/Settings.tsx \
        packages/agentai-gui/src/components/Model3DGen.tsx \
        packages/agentai-gui/src/services/VoiceService.ts
git commit -m "fix(security): move API keys to sessionStorage with whitelist"
```

### Task 5: C5 — discover_or_create_skill 用 CodeRunner 沙箱

**Files:**
- Create: `packages/agentai-gateway/src/safety/code-runner.ts`
- Modify: `packages/agentai-gateway/src/tools.ts:3298`

- [ ] **Step 1: 创建 CodeRunner**

```typescript
// packages/agentai-gateway/src/safety/code-runner.ts
import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const FORBIDDEN_PATTERNS = [
  /\brequire\s*\(\s*['"]child_process['"]\s*\)/,
  /\brequire\s*\(\s*['"]fs['"]\s*\)/,
  /\bprocess\.kill\b/,
  /\beval\s*\(/,
];

export interface CodeRunnerOptions {
  timeoutMs?: number;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export function runInSandbox(scriptPath: string, opts: CodeRunnerOptions = {}): { ok: true; output: string } | { ok: false; error: string } {
  if (!fs.existsSync(scriptPath)) {
    return { ok: false, error: 'Script not found' };
  }
  const content = fs.readFileSync(scriptPath, 'utf-8');
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(content)) {
      return { ok: false, error: `Forbidden pattern: ${pattern.source}` };
    }
  }
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-'));
  try {
    const output = execSync(`node --check "${scriptPath}"`, { encoding: 'utf-8' });
    const result = execSync(`node "${scriptPath}"`, {
      encoding: 'utf-8',
      timeout: opts.timeoutMs || 30000,
      cwd: opts.cwd || tempDir,
      env: { ...process.env, NODE_ENV: 'sandbox', ...opts.env },
    });
    return { ok: true, output: result };
  } catch (e: any) {
    return { ok: false, error: e.message };
  } finally {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  }
}
```

- [ ] **Step 2: 替换 tools.ts:3298 的 import**

```typescript
// 旧:
await import(path.join(skillDir, 'index.js'));

// 新:
import { runInSandbox } from './safety/code-runner.js';
const result = runInSandbox(path.join(skillDir, 'index.js'));
if (!result.ok) {
  return { error: result.error };
}
```

- [ ] **Step 3: 编译 + 提交**

```bash
cd packages/agentai-gateway && node node_modules/typescript/bin/tsc --noEmit
git add packages/agentai-gateway/src/safety/code-runner.ts \
        packages/agentai-gateway/src/tools.ts
git commit -m "fix(security): sandbox AI-generated code in discover_or_create_skill"
```

### Task 6: C6 — waitForClarification 监听 abort

**Files:**
- Modify: `packages/agentai-gateway/src/agentai-loop.ts:474-483`

- [ ] **Step 1: 加 abort 监听**

```typescript
// 旧:
private async waitForClarification(askId: string, timeoutMs = 60000): Promise<string | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      this.pendingClarifications.delete(askId);
      resolve(null);
    }, timeoutMs);
    this.pendingClarifications.set(askId, { resolve: (answer) => {
      clearTimeout(timer);
      resolve(answer);
    }});
  });
}

// 新:
private async waitForClarification(askId: string, timeoutMs = 60000): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (val: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      this.pendingClarifications.delete(askId);
      resolve(val);
    };
    const timer = setTimeout(() => settle(null), timeoutMs);
    this.pendingClarifications.set(askId, { resolve: (answer) => settle(answer) });
    // 监听 abort
    if (this.opts?.abortSignal) {
      this.opts.abortSignal.addEventListener('abort', () => settle(null), { once: true });
    }
  });
}
```

- [ ] **Step 2: 编译 + 提交**

```bash
cd packages/agentai-gateway && node node_modules/typescript/bin/tsc --noEmit
git add packages/agentai-gateway/src/agentai-loop.ts
git commit -m "fix(memory): abort waitForClarification on session abort"
```

---

## Phase 1: High 漏洞修复（3-4 天）

### Task 7: H1 — Xuanji clarify 真阻塞

**Files:**
- Modify: `packages/agentai-gateway/src/routes/chat.ts:391-412`

- [ ] **Step 1: 加 return**

```typescript
// 在 strategy === 'clarify' 分支末尾
if (result.strategy === 'clarify') {
  sendSSE({ type: 'clarification_needed', questions: result.questions });
  return; // 关键：不再继续
}
```

- [ ] **Step 2: 编译 + 提交**

```bash
cd packages/agentai-gateway && node node_modules/typescript/bin/tsc --noEmit
git add packages/agentai-gateway/src/routes/chat.ts
git commit -m "fix(ux): Xuanji clarify strategy now actually blocks"
```

### Task 8: H4+H5 — decision-gate 统一决策 + metaLoop 重置

**Files:**
- Modify: `packages/agentai-gateway/src/agentai-loop.ts:2785-2796, 2783, 2870`

- [ ] **Step 1: 在 run() 开头重置 metaLoop**

```typescript
// AgentAILoop.run() 第一行
async run(input: UserInput): Promise<RunResult> {
  this.metaLoop = null; // 关键：每次 run() 重置
  // ... 原有代码
}
```

- [ ] **Step 2: 在 meta + confidence 之间用 decision-gate 协调**

```typescript
// agentai-loop.ts 2870 行附近
if (this.metaLoop && this.metaLoop.lastDecision !== 'continue') {
  // MetaCognitive 已决定（stop/ask_human/retry_with_pua），不再调 confidence
} else {
  // 调 confidence
  await this.confidenceEstimator.evaluate(...);
}
```

- [ ] **Step 3: 编译 + 提交**

```bash
cd packages/agentai-gateway && node node_modules/typescript/bin/tsc --noEmit
git add packages/agentai-gateway/src/agentai-loop.ts
git commit -m "fix(decision): unify meta+confidence via decision-gate pattern"
```

### Task 9: H6 — SmartModelSwitcher 免费池补全

**Files:**
- Modify: `packages/agentai-gateway/src/smart-model-switcher.ts:296`

- [ ] **Step 1: 补全免费池**

```typescript
const FREE_POOL = ['agentai', 'zhipu', 'sensenova', 'longcat', 'nvidia', 'dxnt'];
```

- [ ] **Step 2: 编译 + 提交**

```bash
cd packages/agentai-gateway && node node_modules/typescript/bin/tsc --noEmit
git add packages/agentai-gateway/src/smart-model-switcher.ts
git commit -m "fix(router): expand free model pool for switching"
```

### Task 10: H7-9 — 删除 inline 路由遮蔽

**Files:**
- Modify: `packages/agentai-gateway/src/app.ts:238-304, 455-469`
- Modify: `packages/agentai-gateway/src/routes/files.ts:295-307`

- [ ] **Step 1: 删除 app.ts:238-304 inline /v1/schedules**

```bash
# 找到 lines 238-304, 删除整段
```

- [ ] **Step 2: 删除 app.ts:455-469 inline /v1/suggestions**

- [ ] **Step 3: 删除 files.ts:295-307 重复 /v1/files/read**

- [ ] **Step 4: 编译 + 提交**

```bash
cd packages/agentai-gateway && node node_modules/typescript/bin/tsc --noEmit
git add packages/agentai-gateway/src/app.ts packages/agentai-gateway/src/routes/files.ts
git commit -m "fix(routes): remove inline routes shadowed by routers"
```

### Task 11: H11 — 删硬编码 URL

**Files:**
- Modify: `packages/agentai-gui/src/App.tsx:372`
- Modify: `packages/agentai-vscode/src/extension.ts:215`

- [ ] **Step 1: 修复 App.tsx fallback**

```typescript
// 旧: const FALLBACK_URL = 'http://localhost:3001';
// 新:
const FALLBACK_URL = (window as any).AGENTAI_GATEWAY_URL
  || `http://${window.location.hostname}:18789`;
```

- [ ] **Step 2: 修复 vscode extension.ts**

```typescript
// 旧: const url = 'http://127.0.0.1:18789';
// 新:
import * as vscode from 'vscode';
const url = vscode.workspace.getConfiguration('agentai').get('gatewayUrl', 'http://127.0.0.1:18789');
```

- [ ] **Step 3: 编译 + 提交**

```bash
cd packages/agentai-gui && pnpm typecheck
cd ../agentai-vscode && pnpm typecheck
git add packages/agentai-gui/src/App.tsx packages/agentai-vscode/src/extension.ts
git commit -m "fix(config): remove hardcoded URLs, use env/config"
```

---

## Phase 2: 死代码清理（2-3 天）

### Task 12: 删除网关死代码（11 个）

**Files:**
- Delete: `decision-gate.ts`、`plan-assembler.ts`、`gap-analyzer.ts`、`quick-diagnose.ts`、`tool-factory.ts`、`skill-training.ts`、`skills/doubt-driven-development.ts`、`skills/auto-error-repair.ts`、`router-rate-limiter.ts`、`rate-limit-integration.ts`

- [ ] **Step 1: 确认无引用**

```bash
# 对每个文件，搜索所有 import
grep -r "from.*decision-gate" packages/agentai-gateway/src/
# 期望：无结果
```

- [ ] **Step 2: 备份到 .agentai/backups/**

```bash
mkdir -p .agentai/backups/dead-code-20260713
cp packages/agentai-gateway/src/decision-gate.ts .agentai/backups/dead-code-20260713/
# ... 对每个文件
```

- [ ] **Step 3: 删除**

```bash
rm packages/agentai-gateway/src/decision-gate.ts
# ... 对每个文件
```

- [ ] **Step 4: 编译 + 提交**

```bash
cd packages/agentai-gateway && node node_modules/typescript/bin/tsc --noEmit
git add -u packages/agentai-gateway/src/
git commit -m "chore(cleanup): remove 10 unused gateway modules"
```

### Task 13: 删除前端死代码（12 个）

**Files:**
- Delete: `sedoxtJWW`、`utils/profile.ts`、`services/sseParser.ts`（仅 parseSSE）、`services/IdeStateCollector.ts`（仅 ide_state_collector）、`services/CameraTemplates.ts`、`stores/useAppStore.ts`、`pages/*.tsx`（5 个）、`components/CleanerPanel.format.test.ts`

- [ ] **Step 1-4: 同 Task 12 模式（搜索引用 → 备份 → 删 → 编译 → 提交）**

```bash
cd packages/agentai-gui && pnpm typecheck
git add -u packages/agentai-gui/src/
git commit -m "chore(cleanup): remove 12 unused frontend modules"
```

### Task 14: 删除外围包死代码（5 个）

**Files:**
- Delete: `agentai-core/`（整个包）、`agentai-desktop/src/ai-browser-agent.ts`、`agentai-qqbot/src/service-legacy.ts` + `client.ts` + `gateway-proxy.ts` + `go-cqhttp.ts` + `config.ts`、`agentai-skills/decoration-quote/`

- [ ] **Step 1-4: 同 Task 12 模式**

```bash
# agentai-core 整个包
rm -rf packages/agentai-core/
# 更新根 package.json 移除 workspace
# ... 其他文件
git commit -m "chore(cleanup): remove 5 unused peripheral modules"
```

### Task 15: 删除 moss-tts 重复副本

**Files:**
- Delete: `agentai-desktop/resources/moss-tts-server/`
- Create: `agentai-desktop/resources/moss-tts-server` symlink → `../../../agentai-skills/moss-tts-nano/`

- [ ] **Step 1: 创建 symlink**

```bash
# Windows (PowerShell):
New-Item -ItemType SymbolicLink -Path "packages/agentai-desktop/resources/moss-tts-server" -Target "..\..\..\agentai-skills\moss-tts-nano"
```

- [ ] **Step 2: 验证 moss-tts-service.ts 路径逻辑**

```bash
grep "moss-tts" packages/agentai-gateway/src/moss-tts-service.ts
# 确认 fallback 链正确
```

- [ ] **Step 3: 提交**

```bash
git add packages/agentai-desktop/resources/moss-tts-server
git commit -m "chore(dedup): symlink moss-tts-server to moss-tts-nano source"
```

---

## Phase 3: 重复合并（4-5 天）

### Task 16: 合并 SchedulePanel + AutomationPanel

**Files:**
- Modify: `packages/agentai-gui/src/components/SchedulePanel.tsx`（保留为单一组件）
- Delete: `packages/agentai-gui/src/components/AutomationPanel.tsx`
- Modify: `packages/agentai-gui/src/App.tsx` PAGES

- [ ] **Step 1: 把 AutomationPanel 逻辑合并到 SchedulePanel**

```typescript
// 在 SchedulePanel.tsx 顶部
export type ScheduleViewMode = 'list' | 'automation';
// 增加 mode 切换 + AutomationPanel 内容
```

- [ ] **Step 2: 修改 App.tsx PAGES**

```typescript
// 移除 automation key，schedule 增加 mode prop
const PAGES: Record<View, () => Promise<{ default: ComponentType }>> = {
  // ...
  schedule: () => import('./components/SchedulePanel'),
  // 删除 automation
};
```

- [ ] **Step 3: 编译 + 提交**

```bash
cd packages/agentai-gui && pnpm typecheck
git add packages/agentai-gui/src/components/SchedulePanel.tsx \
        packages/agentai-gui/src/components/AutomationPanel.tsx \
        packages/agentai-gui/src/App.tsx
git commit -m "refactor(gui): merge AutomationPanel into SchedulePanel"
```

### Task 17: 合并 voice.ts + VoiceService.ts

**Files:**
- Modify: `packages/agentai-gui/src/services/voice.ts`（保留为统一入口）
- Delete: `packages/agentai-gui/src/services/VoiceService.ts`
- Modify: 所有引用 `VoiceService` 的文件

- [ ] **Step 1-3: 同 Task 16 模式**

```bash
cd packages/agentai-gui && pnpm typecheck
git commit -m "refactor(gui): unify voice service into single module"
```

### Task 18: 统一三套技能注册表

**Files:**
- Modify: `packages/agentai-gateway/src/skills/loader.ts`
- Modify: `packages/agentai-gateway/src/skill-orchestrator.ts`
- Modify: `packages/agentai-gateway/src/tool-registry.ts`

- [ ] **Step 1: 让 ToolRegistry 作为唯一权威**

```typescript
// tool-registry.ts 加 syncFromSkillOrchestrator() 方法
syncFromSkillOrchestrator(orchestrator: SkillOrchestrator): void {
  for (const skill of orchestrator.listAll()) {
    this.register({
      name: skill.id,
      description: skill.description,
      handler: skill.execute,
      risk: 'medium',
    });
  }
}
```

- [ ] **Step 2: index.ts 启动时同步**

```typescript
// index.ts
toolRegistry.syncFromSkillOrchestrator(skillOrchestrator);
toolRegistry.syncFromLoader(skillsLoader);
```

- [ ] **Step 3: 编译 + 提交**

```bash
cd packages/agentai-gateway && node node_modules/typescript/bin/tsc --noEmit
git commit -m "refactor(skills): unify 3 skill registries into ToolRegistry"
```

### Task 19: 删除 agentai-qqbot 整包（gateway 已有）

**Files:**
- Delete: `packages/agentai-qqbot/`（整个）
- Modify: 根 `package.json` workspace

- [ ] **Step 1: 确认 gateway 完整**

```bash
# gateway routes/qq.ts 已实现 QQBot 超集（含 socket.io 桥接）
grep "QQBot" packages/agentai-gateway/src/routes/qq.ts | head -5
```

- [ ] **Step 2: 删除整包 + 移除 workspace**

```bash
rm -rf packages/agentai-qqbot/
# 编辑 package.json 移除 "agentai-qqbot" from workspaces
```

- [ ] **Step 3: 编译 + 提交**

```bash
git commit -m "chore(dedup): remove agentai-qqbot (gateway routes/qq.ts is canonical)"
```

### Task 20: 统一 model 注册表

**Files:**
- Modify: `packages/agentai-gateway/src/model-classifier.ts`
- Modify: `packages/agentai-gateway/src/model-selector.ts`
- Modify: `packages/agentai-gateway/src/commercial-model-templates.ts`

- [ ] **Step 1: 抽出统一 model catalog**

```typescript
// 新文件: packages/agentai-gateway/src/model-catalog.ts
export const MODEL_CATALOG: ModelInfo[] = [
  // 合并三处数据源
];
```

- [ ] **Step 2: 让 3 个文件 import 此 catalog**

- [ ] **Step 3: 编译 + 提交**

```bash
cd packages/agentai-gateway && node node_modules/typescript/bin/tsc --noEmit
git commit -m "refactor(models): unify 3 model registries into single catalog"
```

---

## 验收标准

### Phase 0 完成后

- [ ] 所有 6 个 Critical 漏洞已修复
- [ ] `pnpm typecheck` 通过
- [ ] `pnpm test`（如存在）通过
- [ ] 启动前后端，主流程不破

### Phase 1 完成后

- [ ] 所有 15 个 High 漏洞已修复
- [ ] 主流程 e2e 测试通过
- [ ] 安全扫描无新增漏洞

### Phase 2 完成后

- [ ] 31 个死代码已删除
- [ ] 项目结构更清晰
- [ ] 无新增编译错误

### Phase 3 完成后

- [ ] 17 个重复组件已合并
- [ ] 用户可感知的功能无回归
- [ ] 代码量净减少 20%+

### 整体验收

- [ ] 全平台 `tsc --noEmit` 通过
- [ ] 启动测试、桌面端测试通过
- [ ] 24 个创新点全部保留并可用
- [ ] 与 ALTES · 岐黄 理念对齐度 100%

---

## 预计工作量

| Phase | 任务数 | 工作量 |
|-------|--------|--------|
| Phase 0 | 6 | 1-2 天 |
| Phase 1 | 5 | 3-4 天 |
| Phase 2 | 4 | 2-3 天 |
| Phase 3 | 5 | 4-5 天 |
| **合计** | **20** | **10-15 天** |

---

## 风险评估

| 风险 | 缓解措施 |
|------|---------|
| Phase 0 改核心路径可能影响主流程 | 灰度开关 + 备份 + tsc 验证 |
| Phase 2 删死代码可能误删 | grep 引用检查 + 备份 + tsc 验证 |
| Phase 3 合并可能破坏 UI | 保留原文件 + 渐进迁移 + e2e 测试 |
| 工时超期 | 优先级：P0 必做 → P1 应做 → P2-3 可选 |

---

## 后续跟进

Phase 4（@ts-nocheck 移除，26 个文件）和 Phase 5（治中求验接入）作为后续独立项目。

---

**Plan complete and saved to `docs/superpowers/plans/2026-07-13-refactor-task-list.md`. Two execution options:**

1. **Subagent-Driven (recommended)** - 每个 Task 派一个新 subagent，任务间 review
2. **Inline Execution** - 在当前会话批量执行，每 Phase 检查点

**Which approach?**
