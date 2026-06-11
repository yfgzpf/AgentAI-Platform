/**
 * 旧版 go-cqhttp 兼容服务 (保留向后兼容)
 * 推荐迁移到 QQOfficialBot (官方 SDK)
 */

import { ChildProcess, spawn } from 'child_process';
import chalk from 'chalk';
import { QQConfig } from './config.js';
import { QQClient } from './client.js';
import { GatewayProxy } from './gateway-proxy.js';
import { goCqHttpManager } from './go-cqhttp.js';

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
    console.log(chalk.cyan('🚀 AgentAI QQ Bot (go-cqhttp 兼容模式) 启动中...'));

    if (this.config.goCqHttp?.autoStart) {
      this.goCq = await goCqHttpManager.start(this.config.goCqHttp);
    } else {
      console.log(chalk.gray('⏭️  跳过 go-cqhttp 启动 (autoStart=false)'));
    }

    const gatewayOk = await this.gateway.health();
    if (!gatewayOk) {
      console.error(chalk.red('❌ Gateway 离线, 请先启动 pnpm dev:gateway'));
      if (!this.config.allowOffline) process.exit(1);
    } else {
      console.log(chalk.green('✅ Gateway 已连接'));
    }

    await this.client.connect(this.config.goCqHttp?.reverseWsUrl || 'ws://127.0.0.1:5700');
    console.log(chalk.green('✅ go-cqhttp 反向 WS 已连接'));

    const shutdown = async () => {
      console.log(chalk.yellow('\n🛑 关闭中...'));
      this.client.disconnect();
      if (this.goCq) this.goCq.kill('SIGTERM');
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }
}
