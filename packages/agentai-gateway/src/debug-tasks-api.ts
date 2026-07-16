/**
 * debug-tasks-api.ts — 调试用, 打印实际 API 响应
 */
import express from 'express';
import { createTasksRouter } from './routes/tasks.js';
import { getOrCreateSnapshot, TASKS_ROOT } from './task-snapshot.js';
import * as fs from 'fs';
import * as http from 'http';

const PORT = 19001;
let server: http.Server;

async function http_(method: string, p: string, body?: any): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: '127.0.0.1', port: PORT, path: p, method,
      headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {},
    }, (res) => {
      let chunks = '';
      res.on('data', (c) => chunks += c);
      res.on('end', () => {
        try {
          console.log(`[DEBUG] ${method} ${p} -> ${res.statusCode}: ${chunks.slice(0, 200)}`);
          resolve({ status: res.statusCode || 0, data: chunks ? JSON.parse(chunks) : null });
        } catch (e: any) {
          console.log(`[DEBUG] ${method} ${p} -> ${res.statusCode}: ${chunks.slice(0, 200)} (parse failed)`);
          resolve({ status: res.statusCode || 0, data: chunks });
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  const app = express();
  app.use(express.json());
  app.use('/v1/tasks', createTasksRouter());
  server = http.createServer(app);
  await new Promise<void>(r => server.listen(PORT, r));
  console.log(`Server: http://127.0.0.1:${PORT}\n`);

  // 创建任务
  const taskId = 'debug-task-' + Date.now();
  console.log(`Creating task: ${taskId}`);
  const mgr = getOrCreateSnapshot(taskId, {
    sessionId: 's1', userId: 'u1', workspace: '.', goal: 'debug',
  });
  mgr.flush();
  console.log(`TASKS_ROOT: ${TASKS_ROOT}`);
  console.log(`File exists: ${fs.existsSync(`${TASKS_ROOT}/${taskId}/meta.json`)}`);

  await http_('GET', `/v1/tasks/${taskId}`);

  server.close();
  process.exit(0);
}

main().catch(e => {
  console.error('Crashed:', e);
  if (server) server.close();
  process.exit(1);
});
