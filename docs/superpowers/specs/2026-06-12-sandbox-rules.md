# Spec: 用户可配 Sandbox 规则

**日期**: 2026-06-12
**作者**: AgentAI Builder
**关联 plan**: `docs/superpowers/plans/2026-06-12-sandbox-rules.md`
**前置依赖**:
- 用户多次要求"保护代码安全"(对话历史)
- Trae 2025-04 已实现 Custom Sandbox Configuration
- CleanerDaemon 已有 SAFE/RISKY/ALERT 三级(可推广)
- 当前 PowerShell TRAE sandbox 仅是 IDE 层, 应用层无细粒度规则

---

## 1. 目标

让用户在 `~/.agentai/sandbox-rules.json` 配**应用层**文件操作白/黑名单, AI/cleaner 工具调用前自动校验:

- 路径允许(ALLOW): 在白名单内的路径可任意操作
- 路径禁止(DENY): 在黑名单内的路径直接拒
- 路径高危(PROMPT): 弹窗/通知用户确认(类似 cleaner RISKY)

保护场景:
- 用户代码(workspace/**, 排除 node_modules/dist)
- 用户密钥(~/.ssh, ~/.aws, ~/.gnupg)
- 系统目录(C:\Windows, /etc, /usr)
- 大文件目录(避免误清)

## 2. 非目标

- ❌ 替换 PowerShell TRAE sandbox(只叠加应用层)
- ❌ 实现进程隔离/sandbox exec(那是 Docker 范畴)
- ❌ 实施 SELinux/AppArmor 级别强制(本期用户级软约束)
- ❌ 改 CleanerDaemon 已有规则(rules.json), 只在它之上加一层

## 3. 架构

```
┌────────────────────────────────────────────────┐
│  ~/.agentai/sandbox-rules.json (用户编辑)      │
│  {                                             │
│    "allow": ["/workspace/**", "~/Downloads/**"],│
│    "deny": ["/etc/**", "~/.ssh/**",            │
│             "C:/Windows/**"],                   │
│    "prompt": ["**/.env*", "**/secrets/**"],     │
│    "maxFileSize": "100MB",                      │
│    "maxTotalSize": "1GB"                        │
│  }                                             │
└──────────────────────┬─────────────────────────┘
                       │ 启动时加载
                       ↓
┌────────────────────────────────────────────────┐
│  packages/agentai-gateway/src/sandbox/         │
│  ├── rules.ts      (加载 + 解析 + glob 匹配)   │
│  ├── checker.ts    (check(path, op): Verdict)  │
│  ├── index.ts      (Sandbox 单例)              │
│  └── router.ts     (GET/PUT /v1/sandbox/rules)│
└──────────────────────┬─────────────────────────┘
                       │ check() 调用
        ┌──────────────┼──────────────┐
        ↓              ↓              ↓
   cleaner/      tools.ts        mcp/
   executor.ts   (file ops)      client.ts
```

## 4. 数据模型

```typescript
// packages/agentai-gateway/src/sandbox/types.ts
export type SandboxVerdict = 'allow' | 'deny' | 'prompt';

export interface SandboxRules {
    allow: string[];            // glob 数组
    deny: string[];             // glob 数组
    prompt: string[];           // glob 数组
    maxFileSize?: number;       // bytes
    maxTotalSize?: number;      // bytes(单次操作累计)
    exclude?: string[];         // 永远跳过(deny 优先)
}

export interface SandboxCheckResult {
    verdict: SandboxVerdict;
    reason: string;             // 解释(给 LLM/用户看)
    matchedRule?: string;       // 匹配的 glob
}
```

## 5. 文件改动

| 文件 | 类型 | 职责 |
|---|---|---|
| `sandbox/types.ts` | **新建** | SandboxRules / SandboxVerdict / SandboxCheckResult |
| `sandbox/rules.ts` | **新建** | load(path) / validate(rules) / match(path, patterns) |
| `sandbox/checker.ts` | **新建** | check(path, op): SandboxCheckResult(deny > prompt > allow 优先级) |
| `sandbox/index.ts` | **新建** | Sandbox 单例 + getRules()/setRules()/check() |
| `sandbox/router.ts` | **新建** | GET /v1/sandbox/rules / PUT /v1/sandbox/rules / POST /v1/sandbox/check |
| `cleaner/executor.ts` | **修改** | 每个写操作前 `sandbox.check(path, op)`, verdict=deny 抛错, prompt 触发 confirm 流程 |
| `tools.ts` | **修改** | 任何 file write/read tool 加 sandbox.check |
| `index.ts` | **修改** | 启动 sandbox 单例 + 挂路由 |
| `Settings.tsx` | **修改** | 加 "Sandbox Rules" Tab, 展示当前规则 + 编辑 |
| `SandboxRulesEditor.tsx` | **新建** | JSON 编辑器 + 实时校验 + 路径测试器(输入路径返回 verdict) |

## 6. 默认规则(首次启动生成)

```json
{
  "allow": [
    "<workspace>/**",
    "~/Documents/**",
    "~/Downloads/**"
  ],
  "deny": [
    "C:/Windows/**",
    "C:/Program Files/**",
    "/etc/**",
    "/usr/**",
    "~/.ssh/**",
    "~/.aws/**",
    "~/.gnupg/**",
    "**/node_modules/**",
    "**/.git/**"
  ],
  "prompt": [
    "**/.env*",
    "**/secrets/**",
    "**/*.key",
    "**/*.pem"
  ],
  "maxFileSize": 104857600,
  "maxTotalSize": 1073741824
}
```

## 7. 优先级

```
deny > prompt > allow
```

- 任何 path 匹配 deny → 直接拒
- 不匹配 deny, 匹配 prompt → 弹确认
- 都不匹配, 匹配 allow → 通过
- 都不匹配 → 默认 **deny**(白名单模式, 谨慎)

## 8. 测试

- 单元: 5 glob 模式匹配
- 单元: deny > prompt > allow 优先级
- 单元: 默认规则加载 + 校验
- 集成: cleaner executor 拒写 C:\Windows\test.txt
- E2E: GUI 编辑规则, 实时校验 + 测试路径

## 9. 错误处理

- 规则文件不存在 → 用默认规则 + 写日志
- 规则 JSON 错 → 加载失败, 用默认 + 提示用户修复
- glob 错(typo) → 跳过该条 + 告警(不整个失败)
- 检查器抛错 → fail-closed(deny), 保护优先
