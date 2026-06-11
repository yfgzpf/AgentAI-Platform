/**
 * Express App 配置
 * 把所有路由模块化, 替代 1000+ 行的 index.ts
 */
import express from 'express';
import cors from 'cors';
import * as path from 'path';
import { createServer } from 'http';
import { Server as IOServer } from 'socket.io';

import { createChatRouter, ChatRouterDeps } from './routes/chat.js';
import { createFilesRouter } from './routes/files.js';
import { createQQRouter, QQRouterDeps } from './routes/qq.js';
import { createHealthRouter, HealthRouterDeps } from './routes/health.js';
import { createSandboxRouter } from './sandbox/index.js';
import { createSkillsRouter } from './skills/router.js';
import { startSkillWatcher } from './skills/watcher.js';
import { startEvolutionCleanupLoop } from './evolution.js';
import { getSessionManager } from './session-manager.js';

export interface AppDeps extends ChatRouterDeps, QQRouterDeps, HealthRouterDeps {
  sandbox: any;
}

export function createApp(deps: AppDeps) {
  const app = express();

  // ===== 中间件 =====
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));

  // ===== 静态资源 =====
  app.use('/media', express.static(path.resolve(process.cwd(), '../../packages/agentai-skills/out')));

  // ===== 路由模块化 =====
  if (deps.sandbox) {
    app.use('/v1/sandbox', createSandboxRouter(deps.sandbox));
  }
  app.use(createSkillsRouter());
  app.use(createChatRouter(deps));
  app.use(createQQRouter(deps));
  app.use(createHealthRouter(deps));
  app.use(createFilesRouter());

  return app;
}

export interface ServerHandle {
  httpServer: any;
  io: IOServer;
}

export function createServerHandle(app: express.Express): ServerHandle {
  const httpServer = createServer(app);
  const io = new IOServer(httpServer, {
    cors: { origin: '*' },
  });
  return { httpServer, io };
}

/**
 * 启动后台任务
 * - 技能热加载 watcher
 * - evolution 文件清理循环
 * - session manager (内部已自动)
 */
export function startBackgroundJobs(skillsDir: string) {
  startSkillWatcher([skillsDir]);
  startEvolutionCleanupLoop();
  getSessionManager();
}
