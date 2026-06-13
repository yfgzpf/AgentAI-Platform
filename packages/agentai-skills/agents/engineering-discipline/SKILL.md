# 工程纪律操作系统 (Engineering Discipline)

**参考来源**: `agent-skills` by Addy Osmani (Google) — https://github.com/addyosmani/agent-skills

**核心灵感**: 微信公众号文章《被AI写的烂代码折磨了三个月，直到给它装了这个55k星的「免代码」工程技能包》

---

## 核心理念

AI 编程助手擅长生成代码但缺乏工程纪律——跳过测试、忽略安全、急于合并。本 Skill 作为 **工程纪律操作系统**，强制执行 `定义→规划→构建→验证→审查→发布` 完整工作流，确保 AI 输出的代码可直接上生产。

---

## 六大阶段 24 项技能

### Phase 1: 定义 (Define)

| 技能 | 斜杠命令 | 作用 |
|------|---------|------|
| 需求访谈 | `/spec` | 启动 `interview-me`，通过提问澄清需求，确认率达 95% |
| 创意打磨 | `idea-refine` | 分析创意可行性，识别技术约束和依赖 |
| 规格驱动开发 | `spec-driven-development` | 先生成 PRD 再写代码 |

**AI 反合理化**: 禁止在未明确需求时写代码。如果 AI 说"我直接开始写"，强制要求先完成需求访谈。

### Phase 2: 规划 (Plan)

| 技能 | 斜杠命令 | 作用 |
|------|---------|------|
| 任务拆解 | `/plan` | 大任务拆分为可验证的小任务，每步有明确的 acceptance criteria |

**原则**: 开发中途发现方向错误 ≠ 失败，而是 `planning-and-task-breakdown` 的一部分。

### Phase 3: 构建 (Build)

| 技能 | 作用 |
|------|------|
| 增量实现 | `incremental-implementation` — 逐步构建，非一次性生成 |
| 测试驱动开发 | `test-driven-development` — 红-绿-重构循环 |
| 上下文工程 | `context-engineering` — 构建正确的 context window |
| 源码驱动开发 | `source-driven-development` — 基于现有代码库结构生成 |
| 疑问驱动开发 | `doubt-driven-development` — 在不确定处暂停提问 |
| 前端 UI 工程 | `frontend-ui-engineering` — 组件化、响应式、可访问性 |
| API 与接口设计 | `api-and-interface-design` — 版本管理、向后兼容 |

**内嵌工程原则**:
- **Hyrum's Law**: API 设计需考虑所有可见行为
- **Beyonce Rule**: 测试优先 (Test First)
- **Chesterton's Fence**: 理解后再修改已有代码
- **Shift Left**: 早期质量检查
- **Trunk-based Development**: 主干开发，短生命周期分支

### Phase 4: 验证 (Verify)

| 技能 | 作用 |
|------|------|
| 浏览器测试 | `browser-testing-with-devtools` — 利用 DevTools 做 E2E 测试 |
| 调试与错误恢复 | `debugging-and-error-recovery` — 系统性调试流程 |

### Phase 5: 审查 (Review)

| 技能 | 斜杠命令 | 作用 |
|------|---------|------|
| 代码审查 | `/review` | 五轴代码审查：正确性、性能、安全、可读性、可维护性 |
| 代码简化 | `/code-simplify` | 简化代码但保持行为不变 |
| 安全加固 | `security-and-hardening` — SQL 注入、XSS、CSRF 等检查 |
| 性能优化 | `performance-optimization` — 复杂度分析、缓存策略 |

### Phase 6: 发布 (Ship)

| 技能 | 斜杠命令 | 作用 |
|------|---------|------|
| Git 工作流 | `git-workflow-and-versioning` | 语义化版本、commit convention |
| CI/CD 自动化 | `ci-cd-and-automation` | 流水线配置、自动化部署 |
| 弃用与迁移 | `deprecation-and-migration` | 平滑迁移策略 |
| 文档与 ADR | `documentation-and-adrs` | 架构决策记录 |
| 可观测性 | `observability-and-instrumentation` | 日志、指标、追踪 |
| 发布上线 | `/ship` | 灰度上线、回滚机制 |

---

## 元技能: using-agent-skills

**核心机制**: 在任务开始时动态判断"当前阶段应该使用哪个技能"，实现技能的动态路由和上下文感知。

```
用户输入: /spec 做一个用户登录功能
→ using-agent-skills 判断: Phase 1 (定义) → 调用 interview-me
→ AI 提问: 认证方式? OAuth? Session/JWT? 密码策略?
→ 确认率 ≥ 95% 后生成 PRD
→ 用户输入: /build auto
→ 自动串联: 规划 → 编码 → 测试 → 验证 → 安全审查 → 代码审查 → 提交
```

---

## 与 agentai-platform 的集成方案

### 1. 作为 Gateway 的顶层工作流约束

本 Skill 可作为 `workflow/engine.ts` 的默认执行策略：

```typescript
// 在 workflow/engine.ts 中集成
import { EngineeringDiscipline } from '../skills/engineering-discipline';

const WORKFLOW = {
  phases: ['define', 'plan', 'build', 'verify', 'review', 'ship'],
  // 每阶段对应具体的 Skill
  skills: EngineeringDiscipline.phaseSkills,
  // 元技能: 动态路由
  metaSkill: 'using-agent-skills',
};
```

### 2. 与 LLM-as-Judge 联动

每个阶段的输出都经过 `judge/self-eval.ts` 评分：
- 定义阶段: 需求完整度 ≥ 90%
- 规划阶段: 任务粒度 ≤ 5 步
- 构建阶段: 测试覆盖率 ≥ 80%
- 审查阶段: 安全得分 ≥ 90

### 3. 反合理化表嵌入

每个技能内置 AI 常见偷懒借口及反驳理由，例如：

| AI 借口 | 反驳 |
|---------|------|
| "这个功能很简单，直接写代码吧" | 违反 Phase 1 定义规则，必须先完成需求访谈 |
| "测试不重要，先上线再说" | 违反 Beyonce Rule，测试优先 |
| "这段代码是别人的，我直接改" | 违反 Chesterton's Fence，必须先理解为什么这么写 |

---

## 市场验证

- **Stars**: 54,748+ ⭐ (截至 2026-06-12)
- **Forks**: 5,950
- **支持平台**: Claude Code, Cursor, Codex, Gemini CLI, Windsurf, GitHub Copilot, Kiro
- **增长速度**: 日均新增 ~500 Stars

---

## 关键启示

1. **架构层面**: AI Agent 的能力不仅取决于模型本身，更取决于 **工作流约束** 和 **技能系统** 的设计
2. **交互层面**: 通过标准化的斜杠命令和 Markdown 格式的技能定义，实现了低门槛、跨平台的工具调用
3. **未来方向**: AI 编程的重点正从"代码生成"转向"工程化交付"，具备自我约束、自动测试和安全审查能力的 Agent 将成为主流

---

**Skill 版本**: 1.0.0
**创建日期**: 2026-06-13
**更新记录**: 初始版本，基于 agent-skills 开源项目
