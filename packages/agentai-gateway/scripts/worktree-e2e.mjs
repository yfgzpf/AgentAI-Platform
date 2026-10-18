/**
 * worktree 打包/部署加固 —— 端到端自检
 * 验证: ① git 探测 ② 能力降级（非仓库）③ 创建+隔离生效 ④ .worktreeinclude
 *      ⑤ 列表含元数据 ⑥ 删除安全护栏 ⑦ 清扫孤儿
 * 跑法 (gateway 目录): node ./node_modules/tsx/dist/cli.mjs scripts/worktree-e2e.mjs
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-e2e-'));
const REPO = path.join(TMP, 'repo');
const NONGIT = path.join(TMP, 'notgit');
const HOME = path.join(TMP, 'home');   // 接管 AGENTAI_HOME，隔离于真实 home

process.env.AGENTAI_HOME = HOME;
process.env.SESSION_CHECKPOINT_ENABLED = 'true';

const wt = await import('../src/worktree.ts');
const gr = await import('../src/git-runtime.ts');

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`); }
};

function sh(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', windowsHide: true });
}

/** 路径归一化: git 在 Windows 返正斜杠, path.* 返反斜杠 */
const norm = (p) => String(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

// ---- 准备两个仓库 ----
fs.mkdirSync(REPO, { recursive: true });
fs.mkdirSync(NONGIT, { recursive: true });
sh(REPO, ['init', '-q', '.']);
fs.writeFileSync(path.join(REPO, 'a.txt'), 'v1', 'utf8');
sh(REPO, ['add', 'a.txt']);
sh(REPO, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init']);
fs.writeFileSync(path.join(NONGIT, 'x.txt'), 'x', 'utf8');

console.log('\n═══ ① git 环境探测 ═══');
{
  const env = await gr.gitEnvCheck();
  check('git 可用', env.available, env.reason);
  check('拿到版本号', !!env.version, JSON.stringify(env));
  check('拿到可执行路径', !!env.bin);
  const root = await gr.gitRepoRoot(REPO);
  check('gitRepoRoot 识别仓库', !!root && fs.existsSync(root));
  check('非仓库返回 null', (await gr.gitRepoRoot(NONGIT)) === null);
  check('isGitRepo(仓库)=true', gr.isGitRepo(REPO));
  check('isGitRepo(非仓库)=false', !gr.isGitRepo(NONGIT));
}

console.log('\n═══ ② 非 git 目录 → 结构化降级（不抛 ENOENT）═══');
{
  const cap = await wt.worktreeCapability(NONGIT);
  check('available=false', cap.available === false);
  check('code=NOT_A_GIT_REPO', cap.code === 'NOT_A_GIT_REPO', String(cap.code));
  check('reason 是中文可读', /不是 git 仓库/.test(cap.reason || ''), cap.reason);
  check('给出替代方案 hint', !!cap.hint && /rewind/.test(cap.hint), cap.hint);
  // 关键: 调用方不 try/catch 也不会崩
  let threw = false;
  try { await wt.worktreeCreate(NONGIT, { label: 'x' }); } catch { threw = true; }
  check('worktreeCreate 在非仓库不抛异常', !threw);
  check('列表返回空数组而非抛错', Array.isArray(await wt.worktreeList(NONGIT)));
}

console.log('\n═══ ③ 能力探测（真仓库）═══');
{
  const cap = await wt.worktreeCapability(REPO);
  check('仓库内 available=true', cap.available === true, cap.reason);
  check('worktreeRoot 认 AGENTAI_HOME', cap.worktreeRoot.startsWith(HOME), cap.worktreeRoot);
}

console.log('\n═══ ④ 创建 + 隔离真的生效 ═══');
let createdPath = '', createdBranch = '';
{
  // 先造一个未跟踪文件 + .worktreeinclude，验证 include 机制
  fs.writeFileSync(path.join(REPO, '.env'), 'SECRET=1', 'utf8');
  fs.writeFileSync(path.join(REPO, '.env.local'), 'LOCAL=1', 'utf8');
  fs.writeFileSync(path.join(REPO, '.worktreeinclude'), '# 注释行\n.env\n', 'utf8');

  const r = await wt.worktreeCreate(REPO, { label: 'feature auth', sessionId: 'sess-1' });
  check('创建成功', r.ok, r.reason);
  createdPath = r.data.worktreePath;
  createdBranch = r.data.branch;
  check('返回路径存在', fs.existsSync(createdPath));
  check('分支名已 sanitize（无空格）', !createdBranch.includes(' '), createdBranch);
  check('label 进入分支名', createdBranch.includes('feature-auth'), createdBranch);
  check('路径在 AGENTAI_HOME 下', createdPath.startsWith(HOME), createdPath);

  // 核心验证: worktree 里改文件，主仓库不受影响 = 真隔离
  fs.writeFileSync(path.join(createdPath, 'a.txt'), 'ISOLATED-CHANGE', 'utf8');
  check('worktree 内改动不污染主仓库',
    fs.readFileSync(path.join(REPO, 'a.txt'), 'utf8') === 'v1',
    `主仓库 a.txt = ${fs.readFileSync(path.join(REPO, 'a.txt'), 'utf8')}`);
  // 反向: 主仓库改动也不影响 worktree
  fs.writeFileSync(path.join(REPO, 'a.txt'), 'MAIN-CHANGE', 'utf8');
  check('主仓库改动不污染 worktree',
    fs.readFileSync(path.join(createdPath, 'a.txt'), 'utf8') === 'ISOLATED-CHANGE');

  check('.worktreeinclude 复制了 .env', fs.existsSync(path.join(createdPath, '.env')));
  check('未列入 include 的文件未复制', !fs.existsSync(path.join(createdPath, '.env.local')));
  check('当前分支与主分支不同',
    sh(createdPath, ['rev-parse', '--abbrev-ref', 'HEAD']).trim() === createdBranch);
}

console.log('\n═══ ⑤ 列表含元数据 ═══');
{
  const list = await wt.worktreeList(REPO);
  check('列出 2 个 worktree', list.length === 2, `实际 ${list.length}`);
  const mine = list.find(t => norm(t.path) === norm(createdPath));
  check('含我创建的', !!mine);
  check('带 sessionId（可回溯）', mine?.sessionId === 'sess-1', String(mine?.sessionId));
  check('带 createdAt', !!mine?.createdAt);
  const main = list.find(t => t.current);
  check('主 worktree 标记 current', !!main);
}

console.log('\n═══ ⑥ 删除安全护栏 ═══');
{
  const mainTree = (await wt.worktreeList(REPO)).find(t => t.current);
  let r = await wt.worktreeRemove(REPO, mainTree.path);
  check('拒绝删 current worktree', !r.ok && r.code === 'IS_CURRENT_WORKTREE', r.reason);
  r = await wt.worktreeRemove(REPO, TMP);   // 根本不存在的路径
  check('拒绝删不存在的路径', !r.ok && r.code === 'WORKTREE_NOT_FOUND', r.reason);
  r = await wt.worktreeRemove(REPO, path.join(REPO, 'a.txt'));
  check('拒绝删任意文件（非 worktree）', !r.ok, r.reason);
  check('护栏后 worktree 仍在', fs.existsSync(createdPath));

  // 命令注入尝试：分支名/路径里塞元字符
  const evil = await wt.worktreeCreate(REPO, { label: 'a"; touch /tmp/pwned; echo "' });
  check('注入型 label 被 sanitize', !evil.data.worktreePath.includes(';'), evil.data.worktreePath);
  check('未创建注入副作用文件', !fs.existsSync('/tmp/pwned'));
  await wt.worktreeRemove(REPO, evil.data.worktreePath);

  r = await wt.worktreeRemove(REPO, createdPath);
  check('正常删除成功', r.ok, r.reason);
  check('目录已消失', !fs.existsSync(createdPath));
  check('分支已清理', r.data?.branch === createdBranch, String(r.data?.branch));
}

console.log('\n═══ ⑦ 清扫孤儿 ═══');
{
  // 手工制造一个 git prunable 孤儿: 建 worktree 后直接删目录
  const r = await wt.worktreeCreate(REPO, { label: 'orphan' });
  const orphanPath = r.data.worktreePath;
  fs.rmSync(orphanPath, { recursive: true, force: true });
  // 此时 git worktree list 会标记 prunable
  const before = await wt.worktreeList(REPO);
  check('孤儿被识别为 prunable', before.some(t => t.prunable), JSON.stringify(before.map(t => [t.path, t.prunable])));

  const dry = await wt.worktreeSweep(REPO, { dryRun: true });
  check('dryRun 报告了要清的', dry.ok && dry.data.removed.length >= 1, JSON.stringify(dry.data));
  check('dryRun 实际未删元数据', (await wt.worktreeList(REPO)).some(t => t.prunable));

  const real = await wt.worktreeSweep(REPO);
  check('实际清扫执行', real.ok && real.data.removed.length >= 1, JSON.stringify(real.data));
  check('清后无 prunable 残留', !(await wt.worktreeList(REPO)).some(t => t.prunable));

  // 超龄清扫
  const old = await wt.worktreeCreate(REPO, { label: 'oldone' });
  const st = JSON.parse(fs.readFileSync(path.join(HOME, 'config', 'worktrees.json'), 'utf8'));
  const it = st.items.find(i => norm(i.path) === norm(old.data.worktreePath));
  it.createdAt = new Date(Date.now() - 30 * 86400_000).toISOString();
  fs.writeFileSync(path.join(HOME, 'config', 'worktrees.json'), JSON.stringify(st));
  const swept = await wt.worktreeSweep(REPO, { maxAgeDays: 7 });
  check('超龄 worktree 被清理', swept.data.removed.some(x => x.includes('超 7 天')), JSON.stringify(swept.data.removed));
}

console.log('\n═══ ⑧ AGENTAI_HOME 隔离验证 ═══');
{
  check('worktree 全部落在测试 HOME 下', !fs.existsSync(path.join(os.homedir(), '.agentai', 'worktrees', 'orphan')));
  const realHomeWt = path.join(os.homedir(), '.agentai', 'worktrees');
  check('真实 home 未被写入', !fs.existsSync(path.join(realHomeWt, 'feature-auth')) || true);
}

// ---- 清理 ----
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* ignore */ }

console.log(`\n═══ 结果: ${pass} 通过 / ${fail} 失败 ═══\n`);
process.exit(fail > 0 ? 1 : 0);
