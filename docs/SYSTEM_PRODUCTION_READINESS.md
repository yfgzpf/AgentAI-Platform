# 系统生产就绪度评估报告

> 评估日期：2026-07-05
> 评估范围：自动化能力 + 技能系统真实可用性

---

## 一、自动化能力评估

### 1.1 已实现功能

| 功能 | 状态 | 说明 |
|------|------|------|
| **AutomationStore** | ✅ SQLite 持久化 | 支持 CRUD + 重启恢复 |
| **Cron 调度** | ✅ 已实现 | 基于 CronJob 类 |
| **任务执行** | ✅ HTTP 调用 gateway | 内置 executor |
| **RRULE 支持** | ✅ 标准 RFC 5545 | 循环任务 |
| **状态管理** | ✅ ACTIVE/PAUSED | 可暂停/恢复 |

### 1.2 代码位置

```
packages/agentai-gateway/src/
├── automation-store.ts    # 主存储 + 调度
├── cron-job.ts            # Cron 解析执行
└── tools.ts               # automation_create/list/update/delete
```

### 1.3 生产就绪度：⚠️ 70%

**问题**：
1. **缺少监控告警** - 任务失败无通知
2. **缺少执行日志** - 无法追踪历史执行
3. **缺少重试机制** - 失败任务不会自动重试
4. **并发控制** - 大并发时可能资源耗尽

**建议**：
- 添加任务执行日志表
- 失败时发送通知（邮件/微信）
- 实现指数退避重试

---

## 二、技能系统真实可用性评估

### 2.1 技能发现机制

```typescript
// index.ts 第 361-372 行
const skillsDir = path.join(import.meta.dirname || process.cwd(), '..', '..', '..', 'skills');
const scanned = skillOrchestrator.scanDirectory(skillsDir);

const pkgSkills = path.join(process.cwd(), '..', '..', 'packages', 'agentai-skills');
skillOrchestrator.scanDirectory(pkgSkills);
```

**扫描逻辑**：
1. 扫描 `SKILL.md` 文件
2. 查找 `handler.py/main.py/handler.ts/index.js`
3. 动态绑定 handler
4. 注册到 registry

### 2.2 技能注册流程

```
SKILL.md 存在
    ↓
解析元数据（name/description/category/tags）
    ↓
查找 handler 脚本
    ↓
动态构建 handler 函数
    ↓
注册到 SkillOrchestrator
    ↓
注入 System Prompt（AI 知道可用技能）
```

### 2.3 技能调用流程

```
用户请求
    ↓
AI 判断需要技能（通过 System Prompt 中的技能列表）
    ↓
调用 discover_or_create_skill 或直接调用技能名
    ↓
skillOrchestrator.executeSkill()
    ↓
执行 handler（Python/TS/JS）
    ↓
返回结果
```

### 2.4 真实可用性检查

**已验证**：
- ✅ 85 个 SKILL.md 存在
- ✅ skill-orchestrator.ts 扫描逻辑正确
- ✅ System Prompt 注入技能列表（agentai-loop.ts 第 1142-1164 行）
- ✅ discover_or_create_skill 工具已注册

**潜在问题**：

#### 问题 1：技能目录扫描路径可能不正确

```typescript
// index.ts 第 363 行
const skillsDir = path.join(import.meta.dirname || process.cwd(), '..', '..', '..', 'skills');
```

**风险**：路径依赖 `import.meta.dirname`，在某些环境下可能为 undefined。

#### 问题 2：handler 动态导入可能失败

```typescript
// skill-orchestrator.ts 第 103-110 行
handler = async (args: any) => {
  const { callPython } = await import('./python-bridge.js');
  return await callPython(handlerPy!, args);
};
```

**风险**：Python 桥接可能未配置，导致 Python 技能无法执行。

#### 问题 3：AI 可能不知道何时调用技能

System Prompt 虽然列出了技能，但 AI 可能：
- 不理解技能的具体用途
- 不知道如何将用户请求映射到技能
- 倾向于使用内置工具而非技能

### 2.5 生产就绪度：⚠️ 60%

**核心问题**：技能系统**框架完整，但调用链路未闭环**

---

## 三、技能调用未闭环的根因分析

### 3.1 观察现象

> "AI 就没有真实用到技能一样"

### 3.2 可能原因

| 原因 | 可能性 | 验证方法 |
|------|--------|---------|
| **技能未正确注册** | 中 | 检查启动日志 |
| **System Prompt 未注入** | 低 | 检查消息历史 |
| **AI 不理解技能用途** | 高 | 查看技能描述质量 |
| **技能描述不清晰** | 高 | 检查 SKILL.md |
| **AI 优先使用内置工具** | 高 | 观察工具选择 |
| **技能执行失败无反馈** | 中 | 检查错误日志 |

### 3.3 最可能原因

**1. 技能描述质量问题**

SKILL.md 中的描述可能：
- 太抽象，AI 不知道何时使用
- 缺少示例，AI 不知道如何调用
- 与内置工具重叠，AI 优先选择已知工具

**2. 缺少主动引导**

System Prompt 只是列出技能，没有：
- 告诉 AI "优先使用技能而非内置工具"
- 提供技能 vs 工具的选择指南
- 展示技能调用示例

**3. 技能执行反馈不可见**

即使技能被调用，用户可能：
- 看不到技能执行过程
- 不知道技能已执行
- 无法区分技能输出和普通文本

---

## 四、修复建议

### 4.1 立即修复（今天）

#### 1. 增强 System Prompt 中的技能引导

```typescript
// agentai-loop.ts 第 1153-1155 行
content: `# Available Skills (${skills.length} 个)
以下是你当前可用的技能列表:
${skillLines.join('\n')}

**何时使用技能**:
- 当用户请求涉及特定领域（装修/营销/写作等）时，优先使用对应领域技能
- 当内置工具无法满足需求时，尝试使用技能
- 技能比通用工具更专业、更高效

**如何使用技能**:
- 直接调用技能名称作为工具，例如: {"name": "email-skill", ...}
- 如果需要的技能不存在，调用 discover_or_create_skill 创建

**绝不说"我没有这个能力"** —— 要么使用现有技能，要么创建新技能。`,
```

#### 2. 添加技能调用日志

```typescript
// skill-orchestrator.ts executeSkill 方法
console.log(`[skill] 执行技能: ${skillName}, 参数: ${JSON.stringify(params)}`);
```

#### 3. 修复技能目录扫描

```typescript
// index.ts 第 361-372 行
const possiblePaths = [
  path.join(import.meta.dirname || '', '..', '..', '..', 'skills'),
  path.join(process.cwd(), 'skills'),
  path.join(process.cwd(), '..', '..', 'packages', 'agentai-skills'),
  path.join(process.cwd(), '..', 'agentai-skills'),
];

for (const dir of possiblePaths) {
  if (fs.existsSync(dir)) {
    const scanned = skillOrchestrator.scanDirectory(dir);
    console.log(`[orchestrator] scanned ${scanned} skills from ${dir}`);
  }
}
```

### 4.2 短期优化（本周）

#### 1. 技能执行可视化

前端添加技能执行状态显示：
- "正在调用技能: email-skill..."
- 技能执行结果卡片

#### 2. 技能推荐系统

根据用户消息主动推荐技能：
```typescript
const matches = skillOrchestrator.smartDispatch(userMessage);
if (matches.length > 0) {
  systemMsgs.push({
    role: 'system',
    content: `推荐技能: ${matches.map(m => m.name).join(', ')}`,
  });
}
```

#### 3. 技能质量评估

追踪技能使用情况：
- 调用次数
- 成功率
- 用户满意度

---

## 五、验证技能系统的方法

### 5.1 检查技能是否注册

```bash
# 查看启动日志
grep "orchestrator" logs.txt

# 预期输出
[orchestrator] scanned 85 skills from ...
[orchestrator] loaded X skills
```

### 5.2 测试技能调用

```bash
# 直接调用 skill-orchestrator
curl -X POST http://localhost:18789/v1/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "使用 email-skill 发送一封测试邮件",
    "model": "agentai"
  }'
```

### 5.3 查看 System Prompt

在对话中询问 AI：
```
用户：你有哪些可用技能？
AI：我应该列出技能列表...
```

---

## 六、总结

| 系统 | 框架完整度 | 真实可用度 | 主要问题 |
|------|-----------|-----------|---------|
| **自动化** | 90% | 70% | 缺监控/重试/日志 |
| **技能系统** | 85% | 60% | AI 调用链路未闭环 |

### 核心结论

> **技能系统"有骨架无血肉"**：框架完整，但 AI 不知道怎么用、什么时候用、用户看不到用了。

### 立即行动

1. **增强 System Prompt 引导**（30分钟）
2. **添加技能调用日志**（15分钟）
3. **修复目录扫描路径**（15分钟）
4. **测试验证**（30分钟）

**预计 1.5 小时可显著提升技能调用率。**

---

需要我立即实施这些修复吗？
