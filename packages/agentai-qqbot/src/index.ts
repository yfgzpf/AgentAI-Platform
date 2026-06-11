/**
 * AgentAI Platform - QQ Bot 独立包
 * -----------------------------------------------------------
 * 架构 (照抄 Reasonix):
 *   模式 A (官方 SDK): QQOfficialBot → wss://api.sgroup.qq.com → Gateway /v1/qq/message
 *   模式 B (go-cqhttp): go-cqhttp → 反向 WS → QQClient → Gateway /v1/qq/message
 *
 * 推荐: 模式 A (官方 SDK, 稳定, 不依赖第三方)
 *
 * 与其他包的关系:
 *   - 独立进程, 不嵌入 gateway/gui
 *   - 通过 HTTP 调 gateway (解耦)
 *   - 可独立热重启, 不影响主程序
 *
 * 启动方式:
 *   方式 1: QQ 官方 SDK (推荐)
 *     AGENTAI_QQ_APPID=xxx AGENTAI_QQ_SECRET=xxx pnpm --filter agentai-qqbot dev
 *
 *   方式 2: go-cqhttp (兼容旧版)
 *     AGENTAI_QQ_MODE=go-cqhttp pnpm --filter agentai-qqbot dev
 *
 * 环境变量:
 *   AGENTAI_QQ_MODE=official|go-cqhttp (默认 official)
 *   AGENTAI_QQ_APPID=xxx (官方 SDK appId)
 *   AGENTAI_QQ_SECRET=xxx (官方 SDK appSecret)
 *   AGENTAI_QQ_SANDBOX=true (官方沙箱环境)
 *   AGENTAI_GATEWAY_URL=http://127.0.0.1:18789
 */

import chalk from 'chalk';
import { QQOfficialBot } from './qq-official-bot.js';
import { QQConfig } from './config.js';

// 旧版 go-cqhttp 兼容 (懒加载, 避免没装 ws 时报错)
async function startGoCqHttpMode() {
  const { QQBotService } = await import('./service-legacy.js');
  const config = QQConfig.load();
  const service = new QQBotService(config);
  await service.start();
}

async function startOfficialMode() {
  const appid = process.env.AGENTAI_QQ_APPID;
  const secret = process.env.AGENTAI_QQ_SECRET;

  if (!appid || !secret) {
    console.error(chalk.red('❌ 请设置环境变量:'));
    console.error(chalk.gray('   AGENTAI_QQ_APPID=你的appId'));
    console.error(chalk.gray('   AGENTAI_QQ_SECRET=你的appSecret'));
    console.error(chalk.gray('   获取: https://q.qq.com/ -> 创建机器人'));
    process.exit(1);
  }

  console.log(chalk.cyan('🚀 AgentAI QQ Bot (官方 SDK) 启动中...'));

  const bot = new QQOfficialBot({
    appid,
    secret,
    sandbox: process.env.AGENTAI_QQ_SANDBOX === 'true',
    allowedGroups: process.env.AGENTAI_QQ_GROUPS?.split(',').filter(Boolean),
    adminOpenIds: process.env.AGENTAI_QQ_ADMINS?.split(',').filter(Boolean),
    triggerPrefix: process.env.AGENTAI_QQ_TRIGGER || '',
    gatewayUrl: process.env.AGENTAI_GATEWAY_URL || 'http://127.0.0.1:18789',
  });

  bot.on('online', () => {
    console.log(chalk.green('✅ QQ Bot 已上线'));
  });

  bot.on('bot_error', (msg: string) => {
    console.error(chalk.red(`❌ QQ Bot 错误: ${msg}`));
  });

  await bot.start();

  // 优雅关闭
  const shutdown = async () => {
    console.log(chalk.yellow('\n🛑 关闭中...'));
    await bot.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// 默认入口
export async function startDefault(): Promise<void> {
  const mode = process.env.AGENTAI_QQ_MODE || 'official';

  if (mode === 'go-cqhttp') {
    console.log(chalk.yellow('⚠️  go-cqhttp 模式已过时, 推荐使用官方 SDK (AGENTAI_QQ_MODE=official)'));
    await startGoCqHttpMode();
  } else {
    await startOfficialMode();
  }
}

// 直接运行
startDefault().catch(err => {
  console.error(chalk.red('❌ 启动失败:'), err);
  process.exit(1);
});
