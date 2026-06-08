/**
 * AgentAI Platform - QQ Bot 独立包
 * -----------------------------------------------------------
 * 架构:
 *   go-cqhttp (子进程) -> 反向 WebSocket -> 本包 (QQClient) ->
 *   AgentAI Gateway /v1/qq/message -> 回复
 *
 * 与其他包的关系:
 *   - 独立进程, 不嵌入 gateway/gui
 *   - 通过 HTTP 调 gateway (解耦)
 *   - 可独立热重启, 不影响主程序
 *
 * 启动方式:
 *   1) 先启动 agentai-gateway (pnpm dev:gateway)
 *   2) 启动 go-cqhttp (./bin/go-cqhttp -config config.yml)
 *   3) 启动本包 (pnpm --filter agentai-qqbot dev)
 *
 * 消息流程:
 *   QQ 群消息 -> go-cqhttp -> ws://127.0.0.1:5700 (反向 WS) ->
 *   QQClient.handleMessage() -> gateway /v1/qq/message ->
 *   gateway AgentAILoop -> LLM 调用 -> 回复字符串 ->
 *   QQClient.sendMessage() -> go-cqhttp HTTP API -> 群
 */

import { spawn, ChildProcess } from 'child_process';
import { WebSocket } from 'ws';
import axios from 'axios';
import path from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import { QQConfig } from './config.js';
import { QQClient } from './client.js';
import { GatewayProxy } from './gateway-proxy.js';
import { goCqHttpManager } from './go-cqhttp.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class QQBotService {
  private config: QQConfig;
  private client: QQClient;
  private gateway: GatewayProxy;
  private goCq: ChildProcess | null = null;

  constructor(config: QQConfig) {
    this.config = config;
    this.gateway = new GatewayProxy(config.gatewayUrl);
    this.client = new QQClient(this.gateway, {
      triggerPrefix: config.triggerPrefix,
      allowedGroups: config.allowedGroups,
      adminQQ: config.adminQQ,
    });
  }

  async start(): Promise<void> {
    console.log(chalk.cyan('🚀 AgentAI QQ Bot 启动中...'));

    // 1. 启动 go-cqhttp (子进程, 如果配置了)
    if (this.config.goCqHttp?.autoStart) {
      this.goCq = await goCqHttpManager.start(this.config.goCqHttp);
    } else {
      console.log(chalk.gray('⏭️  跳过 go-cqhttp 启动 (autoStart=false)'));
    }

    // 2. 检测 gateway 在线
    const gatewayOk = await this.gateway.health();
    if (!gatewayOk) {
      console.error(chalk.red('❌ Gateway 离线, 请先启动 pnpm dev:gateway'));
      console.error(chalk.gray(`   检测地址: ${this.config.gatewayUrl}/health`));
      if (!this.config.allowOffline) {
        process.exit(1);
      }
    } else {
      console.log(chalk.green('✅ Gateway 已连接'));
    }

    // 3. 连接 go-cqhttp 反向 WebSocket
    await this.client.connect(this.config.goCqHttp?.reverseWsUrl || 'ws://127.0.0.1:5700');
    console.log(chalk.green('✅ go-cqhttp 反向 WS 已连接'));

    // 4. 优雅关闭
    const shutdown = async () => {
      console.log(chalk.yellow('\n🛑 关闭中...'));
      this.client.disconnect();
      if (this.goCq) {
        this.goCq.kill('SIGTERM');
      }
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }
}

// 默认入口 (可被 CLI 调)
export async function startDefault(): Promise<void> {
  const config = QQConfig.load();
  const service = new QQBotService(config);
  await service.start();
}
