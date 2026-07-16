/**
 * e2e-task-snapshot.ts — 长任务快照与恢复 E2E 测试
 * ========================================================
 * 测试场景:
 *   1. 创建任务快照
 *   2. 多次更新 (完成步骤、记录决策、文件接触)
 *   3. 持久化到磁盘
 *   4. 重新加载 (模拟跨进程/跨会话)
 *   5. 模拟超时中断: pause() + flush()
 *   6. 重新创建管理器 (新会话) → 加载同一 taskId → 状态恢复
 *   7. 标记完成/失败
 *   8. 列出所有任务 (含 abandoned 检测)
 *   9. 清理过期任务
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  TaskSnapshotManager,
  getOrCreateSnapshot,
  loadTaskSnapshot,
  findResumableTasks,
  listAllTasks,
  markTaskStatus,
  formatResumeContext,
  cleanupOldTasks,
  generateTaskId,
  TASKS_ROOT,
} from './task-snapshot.js';

let passed = 0;
let failed = 0;
const results: Array<{ name: string; ok: boolean; detail?: string }> = [];

function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

async function main() {
  console.log('═══ Task Snapshot E2E ═══\n');
  console.log(`Tasks root: ${TASKS_ROOT}\n`);

  // 1. 准备: 清理旧测试
  const testUserId = 'e2e-test-user';
  if (fs.existsSync(TASKS_ROOT)) {
    for (const id of fs.readdirSync(TASKS_ROOT)) {
      const dir = path.join(TASKS_ROOT, id);
      try {
        const metaPath = path.join(dir, 'meta.json');
        if (fs.existsSync(metaPath)) {
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
          if (meta.userId === testUserId) {
            fs.rmSync(dir, { recursive: true, force: true });
          }
        }
      } catch {}
    }
  }

  const taskId = generateTaskId();
  const sessionId = 'session-1';
  console.log(`Test taskId: ${taskId}\n`);

  // 2. 创建任务
  console.log('[1] 创建任务快照');
  const mgr = getOrCreateSnapshot(taskId, {
    sessionId,
    userId: testUserId,
    workspace: 'F:\\agentai-platform',
    goal: '实现长任务快照与恢复系统',
  });
  check('任务已创建', mgr !== null);
  const snap1 = mgr.getSnapshot();
  check('status=running', snap1.status === 'running');
  check('iteration=0', snap1.iteration === 0);
  check('currentStage=plan', snap1.currentStage === 'plan');

  // 3. 模拟任务进度
  console.log('\n[2] 模拟任务进度');
  mgr.setStage('solve');
  mgr.bumpIteration();
  mgr.completeStep('设计数据结构', '完成 task-snapshot.ts 核心模块', ['write_file'], 1200);
  mgr.completeStep('实现存储层', '完成磁盘持久化', ['write_file'], 2500);
  mgr.addPendingStep('集成到主循环');
  mgr.addPendingStep('编写 E2E 测试');
  mgr.recordDecision(
    '使用 ~/.agentai/tasks/ 作为存储路径',
    '对齐现有模块 (persistent-memory, evolution), 避免引入新根目录'
  );
  mgr.recordFileTouch('task-snapshot.ts', 'created');
  mgr.recordFileTouch('agentai-loop.ts', 'modified');
  mgr.addCheckpoint('initial-design', 'abc123', '数据结构设计完成');
  mgr.flush(); // 强制持久化

  const snap2 = mgr.getSnapshot();
  check('2 步完成', snap2.progress.completedSteps.length === 2);
  check('2 步待办', snap2.progress.pendingSteps.length === 2);
  check('1 个决策', snap2.progress.keyDecisions.length === 1);
  check('2 文件接触', snap2.filesTouched.length === 2);
  check('1 个检查点', snap2.checkpoints.length === 1);
  check('stage=solve', snap2.currentStage === 'solve');

  // 4. 验证磁盘文件存在
  console.log('\n[3] 验证磁盘持久化');
  const taskDir = path.join(TASKS_ROOT, taskId);
  check('任务目录存在', fs.existsSync(taskDir));
  const snapFile = path.join(taskDir, 'snapshot.json');
  check('snapshot.json 存在', fs.existsSync(snapFile));
  const metaFile = path.join(taskDir, 'meta.json');
  check('meta.json 存在', fs.existsSync(metaFile));
  const logFile = path.join(taskDir, 'log.jsonl');
  check('log.jsonl 存在', fs.existsSync(logFile));

  // 5. 模拟跨进程: 重新加载
  console.log('\n[4] 模拟跨进程 (重新加载)');
  const reloaded = loadTaskSnapshot(taskId);
  check('快照可加载', reloaded !== null);
  if (reloaded) {
    check('目标一致', reloaded.goal === '实现长任务快照与恢复系统');
    check('已完成步骤保持', reloaded.progress.completedSteps.length === 2);
    check('决策保持', reloaded.progress.keyDecisions.length === 1);
    check('文件接触保持', reloaded.filesTouched.length === 2);
  }

  // 6. 模拟超时中断
  console.log('\n[5] 模拟超时中断 (pause + flush)');
  mgr.setResumeHints({
    nextAction: '继续集成到主循环',
    blockers: ['需修改 agentai-loop.ts 添加集成点'],
    filesToCheck: ['agentai-loop.ts'],
  });
  mgr.flush();
  mgr.pause('模拟超时, 等待恢复');
  const snapPaused = mgr.getSnapshot();
  check('status=paused', snapPaused.status === 'paused');
  check('有 nextAction', !!snapPaused.resumeHints.nextAction);

  // 7. 新会话接管: 创建新 mgr, 加载相同 taskId
  console.log('\n[6] 模拟新会话恢复');
  const mgr2 = new TaskSnapshotManager(taskId);
  const init2 = mgr2.init({
    sessionId: 'session-2', // 新 session
    userId: testUserId,
    workspace: 'F:\\agentai-platform',
    goal: '实现长任务快照与恢复系统', // 同一目标
  });
  check('新会话接管成功', init2.sessionId === 'session-2');
  check('status 恢复为 running', init2.status === 'running');
  check('进度保持 (2 步完成)', init2.progress.completedSteps.length === 2);
  check('nextAction 保持', init2.resumeHints.nextAction === '继续集成到主循环');

  // 8. 测试 formatResumeContext
  console.log('\n[7] 测试 formatResumeContext');
  const ctxStr = formatResumeContext(init2);
  check('包含 TASK RESUME 标记', ctxStr.includes('[TASK RESUME]'));
  check('包含目标', ctxStr.includes('实现长任务快照与恢复系统'));
  check('包含 nextAction', ctxStr.includes('继续集成到主循环'));
  check('包含已完成步骤', ctxStr.includes('设计数据结构') || ctxStr.includes('实现存储层'));

  // 9. 列出所有任务
  console.log('\n[8] 列出所有任务');
  const allTasks = listAllTasks({ userId: testUserId });
  check('至少 1 个任务', allTasks.length >= 1);
  const myTask = allTasks.find(t => t.taskId === taskId);
  check('能找到自己的任务', !!myTask);

  // 10. 测试 findResumableTasks
  console.log('\n[9] 测试 findResumableTasks');
  const resumable = findResumableTasks(testUserId);
  check('可恢复任务至少 1 个', resumable.length >= 1);

  // 11. 测试 markTaskStatus 完成
  console.log('\n[10] 测试 markTaskStatus');
  const ok = markTaskStatus(taskId, 'completed', '集成完成, E2E 测试通过');
  check('markTaskStatus 成功', !!ok);  // v3.2 修复: 显式 boolean
  const finalSnap = loadTaskSnapshot(taskId);
  check('status=completed', finalSnap?.status === 'completed');
  check('endedAt 已设置', !!finalSnap?.endedAt);
  check('summary 已设置', !!finalSnap?.contextSummary?.includes('集成完成'));  // v3.2 修复: 显式 boolean

  // 12. 模拟 abandoned (stale task)
  console.log('\n[11] 模拟 abandoned 任务');
  const abandonedTaskId = generateTaskId();
  const mgr3 = getOrCreateSnapshot(abandonedTaskId, {
    sessionId: 'session-old',
    userId: testUserId,
    workspace: 'F:\\agentai-platform',
    goal: '过时的任务',
  });
  // 修改最后更新时间为 2 小时前
  const dir3 = path.join(TASKS_ROOT, abandonedTaskId);
  const snap3 = mgr3.getSnapshot();
  snap3.lastUpdatedAt = Date.now() - 2 * 60 * 60 * 1000;
  fs.writeFileSync(path.join(dir3, 'snapshot.json'), JSON.stringify(snap3, null, 2));
  fs.writeFileSync(
    path.join(dir3, 'meta.json'),
    JSON.stringify({
      ...snap3,
      summary: '过时任务',
      lastUpdatedAt: snap3.lastUpdatedAt,
    }, null, 2)
  );
  const allAfter = listAllTasks({ userId: testUserId });
  const abandoned = allAfter.find(t => t.taskId === abandonedTaskId);
  check('stale 任务被标记 abandoned', abandoned?.status === 'abandoned');

  // 13. 测试 cleanupOldTasks
  console.log('\n[12] 测试 cleanupOldTasks');
  // 注意: 不要 flush mgr2/mgr3, 它们的内存状态(stage=running, lastUpdatedAt=now)
  // 会覆盖我们手动设置的 100 天前时间戳。
  // 早前步骤的 setTimeout(500ms) 早已 fire, 无残留风险。
  // 修改为 100 天前
  const dir4 = path.join(TASKS_ROOT, taskId);
  const finalSnap2 = JSON.parse(fs.readFileSync(path.join(dir4, 'snapshot.json'), 'utf-8'));
  finalSnap2.lastUpdatedAt = Date.now() - 100 * 24 * 60 * 60 * 1000;
  finalSnap2.endedAt = finalSnap2.lastUpdatedAt;
  fs.writeFileSync(path.join(dir4, 'snapshot.json'), JSON.stringify(finalSnap2, null, 2));
  // 重新读取并构造正确的 meta (只包含 TaskMeta 字段)
  const finalMeta = {
    taskId: finalSnap2.taskId,
    userId: finalSnap2.userId,
    workspace: finalSnap2.workspace,
    goal: finalSnap2.goal,
    createdAt: finalSnap2.startedAt,
    lastUpdatedAt: finalSnap2.lastUpdatedAt,
    status: finalSnap2.status,
    summary: finalSnap2.contextSummary,
  };
  fs.writeFileSync(path.join(dir4, 'meta.json'), JSON.stringify(finalMeta, null, 2));
  const removed = cleanupOldTasks(30);
  check('清理至少 1 个', removed >= 1, `removed=${removed}`);
  check('完成的任务已清理', !fs.existsSync(path.join(TASKS_ROOT, taskId)));

  // 14. 错误处理
  console.log('\n[13] 错误处理');
  // 重复 init 不应崩溃
  try {
    const m4 = new TaskSnapshotManager(abandonedTaskId);
    m4.init({
      sessionId: 's3',
      userId: testUserId,
      workspace: '.',
      goal: 'test',
    });
    check('重复 init 不崩溃', true);
  } catch (e: any) {
    check('重复 init 不崩溃', false, e.message);
  }

  // 清理: 删除剩余的 abandoned 任务
  if (fs.existsSync(path.join(TASKS_ROOT, abandonedTaskId))) {
    fs.rmSync(path.join(TASKS_ROOT, abandonedTaskId), { recursive: true, force: true });
  }

  // 总结
  console.log('\n═══ 结果 ═══');
  console.log(`通过: ${passed} / ${passed + failed}`);
  console.log(`失败: ${failed}`);
  if (failed > 0) {
    console.log('\n失败项:');
    for (const r of results.filter(x => !x.ok)) {
      console.log(`  ✗ ${r.name}${r.detail ? ' — ' + r.detail : ''}`);
    }
    process.exit(1);
  } else {
    console.log('\n✓ 所有测试通过');
    process.exit(0);
  }
}

main().catch(e => {
  console.error('Test crashed:', e);
  process.exit(1);
});
