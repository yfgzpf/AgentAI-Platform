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
import { createAdminRouter } from './routes/admin.js';
import { sessionsRouter } from './routes/sessions.js';

// ===== CORS 配置 =====
const CORS_ORIGINS = (process.env.AGENTAI_CORS_ORIGINS || 'http://localhost:5173,http://localhost:1420,tauri://localhost').split(',').map(o => o.trim());
import { filesRouter } from './routes/files.js';
import { createQQRouter } from './routes/qq.js';
import { createHealthRouter, HealthRouterDeps } from './routes/health.js';
import { wechatRouter } from './routes/wechat.js';
import { getGlobalSandbox, type Sandbox } from './sandbox/index.js';
import { createSkillsRouter } from './skills/router.js';
import { startSkillWatcher } from './skills/watcher.js';
import { startEvolutionCleanupLoop } from './evolution.js';
import { getSessionManager } from './session-manager.js';

export interface AppDeps {
  /** 共享依赖 (router / sessions / 等) */
  [key: string]: any;
}

export function createApp(deps: AppDeps) {
  const app = express();

  // ===== 中间件 =====
  app.use(cors({
    origin: (origin, callback) => {
      if (!origin || CORS_ORIGINS.includes(origin)) {
        callback(null, origin || CORS_ORIGINS[0]);
      } else {
        console.warn(`[cors] rejected origin: ${origin}`);
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
  }));
  app.use(express.json({ limit: '10mb' }));

  // ===== 静态资源 =====
  app.use('/media', express.static(path.resolve(process.cwd(), '../../packages/agentai-skills/out')));

  // ===== 路由模块化 =====
  const sandbox: Sandbox | null = getGlobalSandbox();
  if (sandbox) {
    try {
      const { createSandboxRouter } = require('./sandbox/router.js');
      app.use('/v1/sandbox', createSandboxRouter(sandbox));
    } catch {
      // sandbox router 不可用, 静默跳过
    }
  }
  app.use(createSkillsRouter());
  app.use(createChatRouter(deps as ChatRouterDeps));
  app.use(createQQRouter());
  app.use(createHealthRouter(deps as HealthRouterDeps));
  app.use('/api/wechat', wechatRouter);
  app.use('/api/sessions', sessionsRouter);
  if (deps.router) {
    app.use(createAdminRouter({ ...deps }));
  } else {
    app.use(createAdminRouter({}));
  }
  app.use(filesRouter);

  return app;
}

export interface ServerHandle {
  httpServer: any;
  io: IOServer;
}

export function createServerHandle(app: express.Express): ServerHandle {
  const httpServer = createServer(app);
  const io = new IOServer(httpServer, {
    cors: {
      origin: CORS_ORIGINS.length === 1 && CORS_ORIGINS[0] === '*' ? '*' : CORS_ORIGINS,
    },
  });
  return { httpServer, io };
}

/**
 * 启动后台任务
 * - 技能热加载 watcher
 * - evolution 文件清理循环
 * - session manager (内部已自动)
 * - 真定时反思 (cron dispatcher)
 */
export function startBackgroundJobs(skillsDir: string) {
  startSkillWatcher([skillsDir]);
  startEvolutionCleanupLoop();
  getSessionManager();

  // P0-2: 真定时反思 + 自进化触发器
  import('./cron-dispatcher.js').then(({ CronDispatcher }) => {
    const cron = new CronDispatcher();
    cron.start();
  }).catch((e: any) => console.warn('[cron] start failed:', e?.message));
}
