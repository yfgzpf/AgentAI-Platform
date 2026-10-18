/**
 * session-checkpoint-e2e.mjs — 会话级 checkpoint/rewind 端到端自检 (2026-10-16)
 * ============================================================================
 * 验证 "用户发一轮 → AI 改文件前存副本 → 一键退回这一轮之前" 完整链路:
 *   ① 缺 sessionId → 400   ② 列空 checkpoint   ③ 建点 + 跟踪文件
 *   → ④ dryRun 只出计划不动盘  ⑤ apply 真恢复   ⑥ 本轮新建文件被删
 *   → ⑦ 未跟踪文件不动   ⑧ :id/files 预览   ⑨ DELETE 清空
 *   → ⑩ sessionId 穿越字符被消毒 (不写盘到 ROOT 之外)
 *
 * 跑法 (gateway 目录): npx tsx scripts/session-checkpoint-e2e.mjs
 * 退出码: 0 = 全通过, 1 = 有失败
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import express from 'express';
import { sessionCheckpointRouter } from '../src/routes/session-checkpoint.ts';
import { runWithWorkspace, workspaceFromRequest } from '../src/request-scope.ts';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-e2e-'));
const WS = path.join(TMP, 'ws');
fs.mkdirSync(WS, { recursive: true });
// checkpoint 存储也指到临时目录 (别污染真实 ~/.agentai/checkpoints)
process.env.AGENTAI_CHECKPOINT_ROOT = path.join(TMP, 'cp-store');
process.env.SESSION_CHECKPOINT_ENABLED = 'true';

const { beginTurn, trackFile, rewind, listCheckpoints } = await import('../src/session-checkpoint.ts');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use((req, _res, next) => {
  const ws = workspaceFromRequest(req);
  if (!ws) return next();
  runWithWorkspace(ws, () => next(), {});
});
app.use(sessionCheckpointRouter);

const server = await new Promise((resolve) => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s));
});
const BASE = `http://127.0.0.1:${server.address().port}`;
const SID = 'e2e-session';
const hdr = { 'Content-Type': 'application/json', 'x-workspace': WS };

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${detail}`); }
};
const file = (p) => path.join(WS, p);
const post = (p, body) => fetch(`${BASE}${p}`, { method: 'POST', headers: hdr, body: JSON.stringify(body) }).then(r => r.json());
const get = (p) => fetch(`${BASE}${p}`, { headers: hdr }).then(r => r.json());
const del = (p) => fetch(`${BASE}${p}`, { method: 'DELETE', headers: hdr }).then(r => r.json());

console.log('\n═══ session checkpoint / rewind 端到端自检 ═══\n');

// 准备两个文件: a 会被 AI 改 (被跟踪), b 是用户自己的文件 (不被跟踪)
fs.writeFileSync(file('a.txt'), 'v0', 'utf8');
fs.writeFileSync(file('b.txt'), '用户自己的改动', 'utf8');

// ① 缺 sessionId → 400
{
  const r = await fetch(`${BASE}/v1/session/checkpoints`, { headers: { 'x-workspace': WS } });
  const d = await r.json();
  ok('① 缺 sessionId → 400', r.status === 400 && d.ok === false, `status=${r.status}`);
}

// ② 列空 checkpoint
{
  const d = await get(`/v1/session/checkpoints?sessionId=${SID}`);
  ok('② 列空 checkpoint', d.ok === true && d.checkpoints.length === 0, JSON.stringify(d).slice(0, 100));
}

// ③ 建点 + 跟踪文件 (模拟一次真实回合: AI 改了 a.txt, 新建了 new.ts)
let cpId = '';
{
  cpId = beginTurn(SID, '把 a.txt 改成 v1 并新建 new.ts') || '';
  ok('③ beginTurn 建点', !!cpId);
  ok('③ 跟踪已存在文件', trackFile(SID, file('a.txt'), WS) === true);
  ok('③ 跟踪将要新建的文件', trackFile(SID, file('new.ts'), WS) === true);
  // AI 真的动手了
  fs.writeFileSync(file('a.txt'), 'v1 (AI 改的, 但改错了)', 'utf8');
  fs.writeFileSync(file('new.ts'), 'AI 新建的垃圾文件', 'utf8');
  const d = await get(`/v1/session/checkpoints?sessionId=${SID}`);
  ok('③ 列出的点 fileCount=2', d.checkpoints[0]?.fileCount === 2, `got ${d.checkpoints[0]?.fileCount}`);
  ok('③ 标签取用户输入', d.checkpoints[0]?.label === '把 a.txt 改成 v1 并新建 new.ts');
}

// ④ dryRun 只出计划, 不动盘
{
  const d = await post('/v1/session/checkpoints/rewind', { sessionId: SID, checkpointId: cpId });
  ok('④ dryRun 标记', d.ok === true && d.dryRun === true);
  ok('④ 计划: 恢复 1 + 删除 1', d.restored === 1 && d.deleted === 1, `restored=${d.restored} deleted=${d.deleted}`);
  ok('④ dryRun 不动盘', fs.readFileSync(file('a.txt'), 'utf8') === 'v1 (AI 改的, 但改错了)' && fs.existsSync(file('new.ts')));
}

// ⑤ apply 真恢复
{
  const d = await post('/v1/session/checkpoints/rewind', { sessionId: SID, checkpointId: cpId, apply: true });
  ok('⑤ apply 真回滚', d.ok === true && d.dryRun === false);
  ok('⑤ a.txt 恢复成 v0', fs.readFileSync(file('a.txt'), 'utf8') === 'v0', fs.readFileSync(file('a.txt'), 'utf8'));
}

// ⑥ 本轮新建的文件被删
ok('⑥ 本轮新建的 new.ts 已删除', !fs.existsSync(file('new.ts')));

// ⑦ 未跟踪的文件一个字节都不能动
ok('⑦ 未跟踪的 b.txt 未被动过', fs.readFileSync(file('b.txt'), 'utf8') === '用户自己的改动');

// ⑧ :id/files 预览
{
  const d = await get(`/v1/session/checkpoints/${cpId}/files?sessionId=${SID}`);
  ok('⑧ :id/files 返回清单', d.ok === true && d.count === 2, JSON.stringify(d).slice(0, 120));
  ok('⑧ 不泄漏 blob 内部路径', !JSON.stringify(d).includes('blobs'), JSON.stringify(d).slice(0, 160));
}

// ⑨ DELETE 清空
{
  const d = await del(`/v1/session/checkpoints?sessionId=${SID}`);
  ok('⑨ DELETE 清空', d.ok === true && d.cleared === true);
  const d2 = await get(`/v1/session/checkpoints?sessionId=${SID}`);
  ok('⑨ 清空后列表为空', d2.checkpoints.length === 0);
}

// ⑩ sessionId 穿越字符被消毒
{
  const evil = '../../../escape';
  beginTurn(evil, 'x');
  const d = await get(`/v1/session/checkpoints?sessionId=${encodeURIComponent(evil)}`);
  ok('⑩ 穿越 sessionId 不产生越界目录', d.ok === true);
  ok('⑩ ROOT 外无任何写入', !fs.existsSync(path.join(TMP, 'escape')) && !fs.existsSync(path.resolve(TMP, '..', 'escape')));
}

// ⑪ 回到更早的轮次
{
  fs.writeFileSync(file('m.txt'), '第0轮', 'utf8');
  beginTurn(SID, '第1轮: 改成 round1');
  const c1 = listCheckpoints(SID)[0].id;
  trackFile(SID, file('m.txt'), WS);
  fs.writeFileSync(file('m.txt'), 'round1', 'utf8');

  beginTurn(SID, '第2轮: 改成 round2 (改错了)');
  trackFile(SID, file('m.txt'), WS);
  fs.writeFileSync(file('m.txt'), 'round2 (改错了)', 'utf8');

  // 回到第1轮开始前 (即 round1 之前 = 第0轮状态)
  const r = rewind(SID, c1, { apply: true, workspaceRoot: WS });
  ok('⑪ 回到更早轮次', r.ok === true && fs.readFileSync(file('m.txt'), 'utf8') === '第0轮', fs.readFileSync(file('m.txt'), 'utf8'));
}

server.close();
fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n═══ 结果: ${pass} 通过 / ${fail} 失败 ═══\n`);
process.exit(fail > 0 ? 1 : 0);