/**
 * e2e-tasks-api.ts — 任务快照 API E2E 测试
 * ===========================================
 * 通过 Express 启动一个测试 server, 验证 /v1/tasks/* 全部端点
 */
import express from 'express';
import { createTasksRouter } from './routes/tasks.js';
import {
  getOrCreateSnapshot,
  listAllTasks,
  loadTaskSnapshot,
  deleteDirReliable,
  TASKS_ROOT,
} from './task-snapshot.js';
import * as fs from 'fs';
import * as http from 'http';

let passed = 0;
let failed = 0;
const results: Array<{ name: string; ok: boolean; detail?: string }> = [];

function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
  if (ok) {
    passed++;
    console.log(`  [PASS] ${name}${detail ? ' - ' + detail : ''}`);
  } else {
    failed++;
    console.log(`  [FAIL] ${name}${detail ? ' - ' + detail : ''}`);
  }
}

async function http_(method: string, path: string, body?: any): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: '127.0.0.1', port: PORT, path, method,
      headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {},
    }, (res) => {
      let chunks = '';
      res.on('data', (c) => chunks += c);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode || 0, data: chunks ? JSON.parse(chunks) : null });
        } catch (e: any) {
          resolve({ status: res.statusCode || 0, data: chunks });
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function debug_(label: string, r: { status: number; data: any }) {
  console.log(`  [DEBUG] ${label} -> status=${r.status} data=${JSON.stringify(r.data).slice(0, 300)}`);
}

const PORT = 18901 + Math.floor(Math.random() * 100);
let server: http.Server;

async function main() {
  console.log('═══ Tasks API E2E ═══\n');

  // 启动测试 server
  const app = express();
  app.use(express.json());
  app.use('/v1/tasks', createTasksRouter());
  server = http.createServer(app);
  await new Promise<void>(r => server.listen(PORT, r));
  console.log(`Test server: http://127.0.0.1:${PORT}\n`);

  // 准备: 清理旧测试任务 (强制清理, 避免前次测试残留)
  const testUserId = 'e2e-api-user';
  if (fs.existsSync(TASKS_ROOT)) {
    for (const id of fs.readdirSync(TASKS_ROOT)) {
      const taskDir = `${TASKS_ROOT}/${id}`;
      let shouldClean = false;
      try {
        const m = JSON.parse(fs.readFileSync(`${taskDir}/meta.json`, 'utf-8'));
        if (m.userId === testUserId) shouldClean = true;
      } catch {
        // 无 meta.json 或解析失败, 也清理 (避免脏数据)
        shouldClean = true;
      }
      if (shouldClean) {
        deleteDirReliable(taskDir);
      }
    }
  }

  // 1. 空列表
  console.log('[1] 初始: 列表应为空');
  let r = await http_('GET', `/v1/tasks?userId=${testUserId}`);
  check('GET /v1/tasks 返回 200', r.status === 200);
  check('初始列表为空', r.data.count === 0, `count=${r.data.count}`);

  // 2. 创建任务
  console.log('\n[2] 创建任务');
  const taskId = `task-api-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  getOrCreateSnapshot(taskId, {
    sessionId: 'session-api-1',
    userId: testUserId,
    workspace: process.cwd(),
    goal: 'API E2E 测试任务',
  });

  r = await http_('GET', `/v1/tasks?userId=${testUserId}`);
  check('任务已出现在列表', r.data.count === 1);
  check('taskId 匹配', r.data.tasks[0]?.taskId === taskId);

  // 3. 获取任务详情
  console.log('\n[3] GET /v1/tasks/:id');
  r = await http_('GET', `/v1/tasks/${taskId}`);
  debug_('GET /:id', r);
  check('详情返回 200', r.status === 200);
  check('goal 一致', r.data.task?.goal === 'API E2E 测试任务');
  check('status=running', r.data.task?.status === 'running');
  check('有 progress', r.data.task?.progress !== undefined);

  // 4. 获取恢复上下文
  console.log('\n[4] GET /v1/tasks/:id/context');
  r = await http_('GET', `/v1/tasks/${taskId}/context`);
  check('context 返回 200', r.status === 200);
  check('context 包含 TASK RESUME', r.data.context?.includes('[TASK RESUME]'));
  check('context 包含目标', r.data.context?.includes('API E2E 测试任务'));
  check('progress 数据正确', r.data.progress?.completed === 0);

  // 5. 更新进度
  console.log('\n[5] 更新进度');
  const mgr = (await import('./task-snapshot.js')).getOrCreateSnapshot(taskId);
  mgr.completeStep('步骤A', '完成', ['read_file']);
  mgr.completeStep('步骤B', '完成', ['write_file']);
  mgr.flush();
  r = await http_('GET', `/v1/tasks/${taskId}/context`);
  check('已完成步骤数 = 2', r.data.progress?.completed === 2);

  // 6. 列出可恢复任务
  console.log('\n[6] GET /v1/tasks/resumable');
  r = await http_('GET', `/v1/tasks/resumable?userId=${testUserId}`);
  check('可恢复任务 = 1', r.data.count === 1);
  check('包含 resumeContext', r.data.tasks[0]?.resumeContext?.includes('[TASK RESUME]'));

  // 7. 标记完成
  console.log('\n[7] POST /v1/tasks/:id/status');
  r = await http_('POST', `/v1/tasks/${taskId}/status`, {
    status: 'completed',
    note: 'API 测试完成',
  });
  check('markStatus 返回 200', r.status === 200);
  check('返回 success', r.data.success === true);

  r = await http_('GET', `/v1/tasks/${taskId}`);
  check('status 变为 completed', r.data.task?.status === 'completed');
  check('endedAt 已设置', r.data.task?.endedAt > 0);

  // 8. 标记失败 (无效 status)
  console.log('\n[8] 无效状态码');
  r = await http_('POST', `/v1/tasks/${taskId}/status`, { status: 'invalid' });
  check('无效 status 返回 400', r.status === 400);

  // 9. 任务不存在
  console.log('\n[9] 任务不存在');
  r = await http_('GET', '/v1/tasks/nonexistent-task-xyz');
  check('不存在任务返回 404', r.status === 404);
  r = await http_('GET', '/v1/tasks/nonexistent/context');
  check('context 不存在返回 404', r.status === 404);

  // 10. 准备 resume 任务
  console.log('\n[10] 创建第二个任务 (用于 resume)');
  const taskId2 = `task-api2-${Date.now()}`;
  const mgr2 = getOrCreateSnapshot(taskId2, {
    sessionId: 'session-api-2',
    userId: testUserId,
    workspace: process.cwd(),
    goal: '可恢复测试任务',
  });
  mgr2.completeStep('已做A', 'OK');
  mgr2.flush();
  mgr2.pause('模拟中断');
  mgr2.flush();

  // 11. POST /v1/tasks/:id/resume
  console.log('\n[11] POST /v1/tasks/:id/resume');
  r = await http_('POST', `/v1/tasks/${taskId2}/resume`);
  check('resume 返回 200', r.status === 200);
  check('返回 taskId', r.data.taskId === taskId2);
  check('返回 context', r.data.context?.includes('可恢复测试任务'));
  check('返回 suggestion', r.data.suggestion?.includes(taskId2));

  // 12. 列表查询
  console.log('\n[12] 列表查询');
  r = await http_('GET', `/v1/tasks?userId=${testUserId}&status=completed`);
  check('completed 过滤 = 1', r.data.count === 1);
  r = await http_('GET', `/v1/tasks?userId=${testUserId}&status=paused`);
  check('paused 过滤 = 1', r.data.count === 1);

  // 13. 限制数量
  r = await http_('GET', `/v1/tasks?userId=${testUserId}&limit=1`);
  check('limit=1 生效', r.data.count === 1);

  // 14. 清理接口
  console.log('\n[13] POST /v1/tasks/cleanup');
  r = await http_('POST', '/v1/tasks/cleanup', { maxAgeDays: 30 });
  check('cleanup 返回 200', r.status === 200);
  // 由于我们没改时间戳, completed 任务还不会被清
  // 但 paused 也不会被清 (status 是 paused)
  check('removed 是数字', typeof r.data.removed === 'number');

  // 15. DELETE /v1/tasks/:id
  console.log('\n[14] DELETE /v1/tasks/:id');
  r = await http_('DELETE', `/v1/tasks/${taskId2}`);
  debug_('DELETE /:id', r);
  check('delete 返回 200', r.status === 200);
  check('deleted=true', r.data.deleted === true);
  r = await http_('GET', `/v1/tasks/${taskId2}`);
  check('删除后 404', r.status === 404);

  // 16. 清理另一个
  r = await http_('DELETE', `/v1/tasks/${taskId}`);
  check('第二次 delete', r.status === 200);
  r = await http_('GET', `/v1/tasks?userId=${testUserId}`);
  check('列表为空', r.data.count === 0);

  // 总结
  server.close();
  console.log('\n=== Result ===');
  console.log(`Passed: ${passed} / ${passed + failed}`);
  console.log(`Failed: ${failed}`);
  if (failed > 0) {
    console.log('\nFailed items:');
    for (const x of results.filter(r => !r.ok)) {
      console.log(`  [FAIL] ${x.name}${x.detail ? ' - ' + x.detail : ''}`);
    }
    process.exit(1);
  } else {
    console.log('\nAll tests passed');
    process.exit(0);
  }
}

main().catch(e => {
  console.error('Test crashed:', e);
  if (server) server.close();
  process.exit(1);
});
