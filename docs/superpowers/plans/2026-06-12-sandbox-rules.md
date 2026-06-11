# Sandbox Rules Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用户可配 sandbox-rules.json, AI/cleaner 写操作前自动校验, 保护系统代码安全

**Architecture:** 新增 sandbox/ 模块(5 文件) + cleaner/tools 集成 + GUI 编辑器

**Tech Stack:** TypeScript ESM + picomatch(轻量 glob) + JSON schema 校验

---

## File Structure

| 文件 | 类型 | 行数估 |
|---|---|---:|
| `sandbox/types.ts` | 新建 | 60 |
| `sandbox/rules.ts` | 新建 | 120 |
| `sandbox/checker.ts` | 新建 | 100 |
| `sandbox/index.ts` | 新建 | 80 |
| `sandbox/router.ts` | 新建 | 80 |
| `cleaner/executor.ts` | 修改 | +15 |
| `tools.ts` | 修改 | +10 |
| `index.ts` | 修改 | +10 |
| `components/Settings.tsx` | 修改 | +40 |
| `components/SandboxRulesEditor.tsx` | 新建 | 250 |
| `sandbox/*.test.ts` | 新建 | 300 |

**预计总改动**: ~1060 行, 11 个文件

---

## Task 1: 规则加载 + 校验

- [ ] 1.1 创建 `sandbox/types.ts`: SandboxRules / SandboxVerdict / SandboxCheckResult
- [ ] 1.2 创建 `sandbox/rules.ts`:
  - `load(filePath): Promise<SandboxRules>`(不存在则返默认 + 写盘)
  - `validate(rules): {ok, errors}`(JSON schema)
  - `match(path, patterns, cwd): boolean`(用 picomatch)
  - 路径标准化: `\` → `/`, 绝对化, `~` → `os.homedir()`
- [ ] 1.3 写 `rules.test.ts`:
  - 默认规则加载
  - 错误 JSON 兜底
  - `~/Downloads/**` 匹配 `~/Downloads/test.txt`
  - `**/node_modules/**` 匹配嵌套
  - Windows 路径 `\` → `/` 转换

## Task 2: 检查器

- [ ] 2.1 创建 `sandbox/checker.ts`:
  - `check(path, op: 'read'|'write'|'delete', rules): SandboxCheckResult`
  - 优先级: deny > prompt > allow > 默认 deny
  - 大小检查: write/delete 时对照 `maxFileSize` / `maxTotalSize`
  - 返回详细 reason(给 LLM 看)
- [ ] 2.2 写 `checker.test.ts`:
  - 5 场景: deny 路径 → deny, prompt 路径 → prompt, allow 路径 → allow
  - 默认 deny 验证
  - 大小超限 → deny

## Task 3: 单例 + 路由

- [ ] 3.1 创建 `sandbox/index.ts`, `Sandbox` 类:
  - 启动时 `load(rulesPath)`, 热重载(改文件 1s 内生效)
  - `getRules(): SandboxRules`
  - `setRules(rules): Promise<void>`(校验 + 写盘)
  - `check(path, op): SandboxCheckResult`
  - 加 audit log(每次规则改动 + 每次 deny/prompt)
- [ ] 3.2 创建 `sandbox/router.ts`:
  - `GET /v1/sandbox/rules` → `{rules, source, valid}`
  - `PUT /v1/sandbox/rules` body `{rules}` → 校验 + 写盘 + 返新规则
  - `POST /v1/sandbox/check` body `{path, op}` → `{verdict, reason}`
- [ ] 3.3 修改 `index.ts`:
  - `const sandbox = new Sandbox(); await sandbox.start();`
  - `app.use('/v1/sandbox', createSandboxRouter(sandbox));`
- [ ] 3.4 写 `index.test.ts` + `router.test.ts`

## Task 4: 集成到 cleaner + tools

- [ ] 4.1 修改 `cleaner/executor.ts`:
  - 每个 write/delete 操作前 `sandbox.check(path, 'delete')`
  - verdict=deny → 抛 `SandboxDeniedError`, 跳过该文件
  - verdict=prompt → 加入 pending risky 计划(等用户确认)
  - verdict=allow → 执行
- [ ] 4.2 修改 `tools.ts`:
  - `read_file` tool: 加 `sandbox.check(path, 'read')` 验证
  - `write_file` tool: 加 `sandbox.check(path, 'write')`
- [ ] 4.3 写增量测试:
  - mock sandbox, 验证 cleaner 跳 C:\Windows\test.txt
  - 验证 write_file 拒 ~/.ssh/id_rsa

## Task 5: GUI 集成

- [ ] 5.1 创建 `SandboxRulesEditor.tsx`:
  - 左侧: JSON 编辑器(monaco-react 或简 textarea)
  - 右侧: 实时校验 + 当前规则状态
  - 底部: "Test Path" 输入框 + verdict 实时显示
  - 顶部: "Save" 按钮(调 PUT)
- [ ] 5.2 修改 `Settings.tsx`, 加 "Sandbox Rules" Tab
- [ ] 5.3 写 E2E(`sandbox-rules.spec.ts`):
  - 打开设置 → 切到 Sandbox
  - 输入 `C:\Windows\test.txt` → 显 deny 红
  - 输入 `~/Downloads/test.txt` → 显 allow 绿
  - 改 JSON → 保存 → 重新测试

## Task 6: 验证

- [ ] 6.1 `pnpm typecheck` 0 错误
- [ ] 6.2 `pnpm test` 全过(老 + 新 ≥ 10 测试)
- [ ] 6.3 `pnpm -r build` 0 错误
- [ ] 6.4 真实测试: cleaner 跑扫描, 看它跳 C:\Windows\*

## 风险与备选

- **风险 1**: glob 性能 → 备选: 用 minimatch(更成熟) 或 路径前缀匹配(简单)
- **风险 2**: 白名单模式可能误伤合法路径 → 备选: 默认改 allow 模式(全允许 + deny 高危)
- **风险 3**: JSON 编辑易写错 → 备选: 用 form 表单而非 JSON
- **风险 4**: 热重载可能产生并发问题 → 备选: 改规则后 1s 重新加载, 加锁

## 不做(明确)

- ❌ 进程级 sandbox(只文件操作)
- ❌ 网络 egress 限制(只文件)
- ❌ SELinux/AppArmor
- ❌ PowerShell TRAE sandbox 替换
- ❌ 多用户规则(只单用户)
