# 网关死代码清理执行方案（四波计划）

> 生成日期：2026-10-09
> 上游依据：`docs/PLATFORM_PARITY_DO_NOT_KEEP_2026-10-09.md`（平台能力 vs 自建对照）
> 原则：**删之前必须证明没人用；每波独立 commit；绿区全程冻结**

---

## 零、摸底结果（已完成，实测数据）

验证方法（两轮，防误判）：
1. 第一轮：`src/` 内 grep 文件名，统计引用数，排除自身
2. 第二轮：**全仓 `git grep`**，排除自身与配对 `.test.ts`（覆盖 package.json、构建脚本、CI、其他包）

| 指标 | 数值 |
|---|---|
| 网关 src 根目录 `.ts` 全零引用文件 | 88 个 / 18,863 行 |
| 二轮验证后仍零引用 | **70 个 / 12,960 行** |
| 其中 vitest 按 glob 收集的活测试 | 29 个 / 4,924 行（**禁删**） |
| 真正可删的非测试文件 | **41 个 / 约 8,200 行** |

**基线**：网关 `tsc --noEmit` = **0 错误**（删除后必须保持 0）。
**注意**：工作区当前有 **335 个未提交改动**（其中 gateway/src 内 98 个），提交时**必须按路径精确 `git add`**，禁止 `git add -A`。

---

## W1 · 原型脚本清除（立即可做，约 5,500 行）

### 判定标准
文件名含 `-demo` / `-example` / `-mock` / `-debug-` / `e2e-` / `test-` 前缀，且全仓零引用。

### 删除清单（31 个文件）

**营销/示例类**
- `ab-testing.ts` (595) — 唯一外部命中是 skills 目录下一个 SKILL.md 的文字描述，非代码引用
- `lead-conversion-example.ts` (306)
- `enterprise-automation-example.ts` (206)
- `real-content-publisher.example.ts` (194)
- `ai-autonomous-example.ts` (106)
- `marketing-suite-integration.ts` (63)
- `multi-platform-workflows.ts` (182)
- `ai-uses-marketing-tools.ts` (241)
- `media-generation-demo.ts` (170)
- `model-extension-plan.ts` (268)

**skill-market 三件套 + 相关测试脚本**
- `skill-market-mock.ts` (213)
- `skill-market-demo.ts` (157)
- `skill-market-integration-demo.ts` (149)
- `test-skill-market-api.ts` (232)
- `test-skill-market-debug.ts` (137)
- `test-skill-market-english.ts` (238)
- `test-skill-market-find.ts` (67)
- `test-skill-market-full.ts` (174)
- `test-skill-market-search.ts` (163)
- `test-industry-skill-discovery.ts` (193)
- `test-optimized-cad-discovery.ts` (175)
- `test-browser-auto-show.ts` (140)
- `skill-evolver.test.ts` (118)

**e2e / debug / 手工修补脚本**
- `e2e-desktop-automation.ts` (107)
- `e2e-desktop-extended.ts` (117)
- `e2e-desktop-image-match.ts` (156)
- `e2e-desktop-vision.ts` (122)
- `e2e-task-snapshot.ts` (281)
- `e2e-tasks-api.ts` (247)
- `e2e-vision-pipeline.ts` (162)
- `debug-tasks-api.ts` (66)
- `fix-thread.ts` (43)
- `revert-bridge.test.ts` (45)
- `agent-battle.ts` (222) + `agent-battle.test.ts` (89)
- `browser-auto-show.ts` (52)
- `office-self-check.ts` (136)

### 安全闸门（每步必须过）
1. 建检查点 commit（当前 335 个改动先单独提交为 `checkpoint:`）
2. **逐文件** `git grep` 确认 0 引用（不批量盲删）
3. 分 3 批删（营销类 / skill-market 类 / e2e 类），每批后跑 `tsc --noEmit`
4. 全部删完跑 `tsc --noEmit`（期望仍 0）+ `npx vite build` / `node scripts/build.mjs`
5. 跑 `npx vitest run`（注意：沙箱内可能被拦，需富哥授权或改用 `pnpm -C packages/agentai-gateway test`）
6. 单 commit：`refactor(gateway): 清除 W1 原型脚本 31 个文件`

---

## W2 · 零引用实现模块（需你点头，约 3,500 行）

这些不是脚本，是**写完从未接入的实现**。功能可能有价值，但当前是死重量。

| 文件 | 行数 | 说明 |
|---|---|---|
| `enhanced-image-tools.ts` | 495 | 图像增强工具，未挂载 |
| `knowledge-gap-detector.test.ts` + 实现 | — | 见下 |
| `plugin-system.ts` | 363 | 插件系统，未接入 |
| `iterative-tool-generator.ts` | 365 | 迭代工具生成，未接入 |
| `nlc-engine.ts` | 334 | NLC 引擎，未接入 |
| `performance-monitor.ts` | 347 | 性能监控，未接入 |
| `git-auth.ts` | 257 | Git 认证，未接入 |
| `tool-description-compressor.ts` | 202 | 工具描述压缩，未接入 |
| `model-api-handlers.ts` | 107 | 模型 API handler，未挂载 |
| `tool-utils.ts` | 112 | 工具工具函数（被 test 引用但生产零引用） |
| `context-fidelity.test.ts` | 334 | **被测文件不存在**（context-fidelity.ts 已删），死测试 |
| 其余零引用 test | — | 随对应实现一并处置 |

### 处置方式（与 W1 不同）
**不直接删，先移到 `archive/` 目录保留一个 commit**，理由：
- 这批是能力不是垃圾，未来可能接入
- 直接删掉就找不回来了
- 移到 archive 既从主构建中移除，又可随时恢复

### 安全闸门
1. W1 完成后单独 commit
2. `git mv` 到 `src/_archive/`，加 `.gitignore` 说明
3. `tsc --noEmit` 期望 0（若 archive 被 tsconfig 包含导致报错，需加 exclude）
4. `build` 验证
5. 单 commit：`refactor(gateway): W2 零引用实现移入 _archive（保留可恢复）`

---

## W3 · 平台收敛（需先出设计，约 1.1 万行）

这批**不能直接删**——它们有真实调用方，需要先设计适配层。

| 组 | 文件 | 被谁依赖 | 平台替代 |
|---|---|---|---|
| 浏览器 | `browser-engine` / `bridge` / `profile` / `automation-simple` / `auto-show` / `captcha-handler` | `agentai-loop` / `app.ts` / `routes/browser*.ts` / `rpa-recorder` / `screen-capture` / `tools.ts` / `web-search` | 6 个浏览器技能 |
| 调度 | `automation-engine` / `automation-store` / `cron-*` 3 个 | `app.ts` / `model-distiller` / `routes/automation.ts` / `tools/automation-tools.ts` | automation_update |
| MCP | `mcp-client` / `host` / `config` / `mcp-tools` | `index.ts` | 400+ 连接器 |
| 技能 | `skill-*` 15 个 | `agentai-loop` / `app.ts` | 平台 Skill 运行时 |

### 执行方式
1. **先出设计文档**（每组一份：现有对外接口 → 平台替代的映射方案 → 迁移步骤 → 回滚点）→ 富哥审
2. 逐组改：一组一 commit，每组改完 tsc + build + 关键路径手测
3. **绝不一上来就删**——这批有真实调用方，误删会打断运行时

---

## W4 · 绿区冻结（全程不动）

`soul/` `qihuang/` `xuanji/` `diagnosis/` `judge/` `governor/` `sandbox/`

平台零对应物，是 PulseFlow 的存在理由。任何一波清理都不得触碰这些目录。

---

## 执行顺序与预期收益

| 波次 | 行数 | 风险 | 前置条件 |
|---|---|---|---|
| W1 | ~5,500 | 极低 | 无，立即可做 |
| W2 | ~3,500 | 低（可恢复） | W1 完成 |
| W3 | ~11,000 | 中（需适配层） | 设计文档 + 富哥审 |
| 合计 | **~20,000** | — | — |

对照：网关 src 根目录约 4.5 万行 + 子目录约 3 万行。**清理完轻 25%+，且 W3 换来的能力实际是升级**（400+ 连接器 / 6 个浏览器技能 / 带执行历史的调度器）。

---

## 每次提交前必查（安全铁律）

1. `git status` 确认只 stage 了本次要删的路径（工作区有 335 个改动，**禁用 `git add -A`**）
2. `tsc --noEmit` = 0
3. `node scripts/build.mjs` 通过
4. `vitest run` 全绿（29 个零引用 test 仍在跑，删错会被立刻发现）
5. commit message 写清删了什么、为什么、验证结果