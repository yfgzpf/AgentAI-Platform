/**
 * WeChat Bridge 入口
 * 命令行:
 *   npx agentai-wechat setup    - 扫码绑定微信
 *   npx agentai-wechat start     - 启动服务 (守护进程)
 *   npx agentai-wechat status    - 查看绑定状态
 */
import { WeChatApi } from './api.js';
import { startQrLogin, waitForQrScan } from './login.js';
import { createMonitor } from './monitor.js';
import { handleMessage } from './handler.js';
import {
  saveAccount,
  loadLatestAccount,
  loadConfig,
  getDataDir,
  ensureDataDir,
  listAccounts,
} from './account.js';
import {
  createSession,
  saveSession,
  loadSession,
} from './session.js';
import { logger } from './logger.js';

const DEFAULT_GATEWAY_URL = process.env.AGENTAI_GATEWAY_URL || 'http://127.0.0.1:18789';

// ===== 发送消息到微信 =====
async function sendReply(
  botToken: string,
  baseUrl: string,
  toUserId: string,
  contextToken: string,
  text: string
): Promise<void> {
  try {
    const api = new WeChatApi(botToken, baseUrl);
    const clientId = generateClientId();

    await api.sendMessage({
      msg: {
        from_user_id: '', // Will be set by API
        to_user_id: toUserId,
        client_id: clientId,
        message_type: 2, // BOT
        message_state: 2, // FINISH
        context_token: contextToken,
        item_list: [
          {
            type: 1, // TEXT
            text_item: { text },
          },
        ],
      },
    });
    logger.info('Reply sent', { to: toUserId, len: text.length });
  } catch (err) {
    logger.error('Send reply failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function generateClientId(): string {
  return `wac-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ===== Setup 命令: 扫码绑定 =====
async function runSetup(): Promise<void> {
  logger.enableFileLogging();
  ensureDataDir();
  console.log('\n\ud83d\udee0\ufe0f 正在设置微信绑定...\n');

  while (true) {
    const { qrcodeUrl, qrcodeId } = await startQrLogin();
    console.log('请用微信扫描下方二维码：');
    await displayQrInTerminal(qrcodeUrl);
    console.log('\n等待扫码绑定...');

    try {
      const account = await waitForQrScan(qrcodeId);
      saveAccount(account);
      console.log('\n\ud83d\udc4d 绑定成功!');
      break;
    } catch (err: any) {
      if (err.message?.includes('expired')) {
        console.log('\ud83d\udd04 二维码已过期，正在刷新...');
        continue;
      }
      throw err;
    }
  }
}

async function displayQrInTerminal(
  qrcodeUrl: string
): Promise<void> {
  // Fallback: just print URL
  console.log(qrcodeUrl);
  console.log();
}

// ===== Daemon 命令: 启动服务 =====
async function runDaemon(): Promise<void> {
  logger.enableFileLogging();
  const account = loadLatestAccount();
  if (!account) {
    console.error(
      '\u274c 未找到微信账号，请先运行: npm run setup'
    );
    process.exit(1);
  }

  const config = loadConfig();
  const gatewayUrl = config.gatewayUrl || DEFAULT_GATEWAY_URL;

  console.log('\ud83d\udd17 正在连接 AgentAI Gateway...');
  try {
    const res = await fetch(`${gatewayUrl}/api/health`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      throw new Error('Gateway not healthy');
    }
    console.log('\u2705 Gateway 服务已连接');
  } catch (err) {
    console.error(
      '\u274c 无法连接 Gateway: ' +
        (err instanceof Error ? err.message : String(err))
    );
    console.log(
      '   请确保 Gateway 正在运行 (默认端口 18789)'
    );
    console.log(
      `   或通过环境变量 AGENTAI_GATEWAY_URL 指定地址`
    );
    process.exit(1);
  }

  // Create a default session
  const sessionHandle = createSession(account.accountId);
  saveSession(sessionHandle.sessionId, sessionHandle.session);

  const api = new WeChatApi(account.botToken, account.baseUrl);

  const monitorCallbacks = {
    onMessage: async (msg: any) => {
      // Auto-create session binding if not set
      if (!sessionHandle.session.gatewaySessionId) {
        // First message: create a Gateway session
        const sessionKey = `${account.accountId}:${account.userId}`;
        sessionHandle.session.gatewaySessionId = sessionKey;
        saveSession(sessionHandle.sessionId, sessionHandle.session);
      }

      await handleMessage(msg, {
        account,
        gatewayUrl,
        sessionId: sessionHandle.sessionId,
        session: sessionHandle.session,
      }, (toUserId, contextToken, text) =>
        sendReply(
          account.botToken,
          account.baseUrl,
          toUserId,
          contextToken,
          text
        )
      );
    },
    onSessionExpired: () => {
      console.error(
        '\u26a0\ufe0f 微信会话已过期，请重新扫码绑定'
      );
    },
  };

  const monitor = createMonitor(api, monitorCallbacks);

  function shutdown(): void {
    logger.info('Shutting down...');
    monitor.stop();
    process.exit(0);
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  console.log('');
  console.log(`\ud83d\udc64 账号: ${account.accountId}`);
  console.log(`\ud83d\udcac 会话: ${sessionHandle.sessionId}`);
  console.log('');
  console.log('\ud83d\udee1\ufe0f 守护进程已启动，等待消息中... [按 Ctrl+C 停止]');
  console.log('');

  await monitor.run();
}

// ===== Status 命令 =====
function showStatus(): void {
  const account = loadLatestAccount();
  if (account) {
    console.log(`\u2705 已绑定微信账号`);
    console.log(`  账号 ID: ${account.accountId}`);
    console.log(`  用户 ID: ${account.userId}`);
    console.log(`  绑定时间: ${account.createdAt}`);
  } else {
    console.log('\u274c 未绑定微信账号');
    console.log('   请运行: npm run setup');
  }
}

// ===== CLI 入口 =====
const command = process.argv[2];

if (command === 'setup') {
  runSetup().catch((err) => {
    console.error('Setup failed:', err);
    process.exit(1);
  });
} else if (command === 'start' || !command) {
  runDaemon().catch((err) => {
    console.error('Run failed:', err);
    process.exit(1);
  });
} else if (command === 'status') {
  showStatus();
} else if (command === 'help' || command === '--help' || command === '-h') {
  console.log(`
AgentAI WeChat Bridge - 微信接入 AgentAI Gateway

用法:
  npm run setup    扫码绑定微信
  npm run start     启动服务 (默认)
  npm run status    查看绑定状态

环境变量:
  AGENTAI_GATEWAY_URL  Gateway 地址 (默认 http://127.0.0.1:18789)
  DEBUG                 开启调试日志
  `);
} else {
  console.error(`\u274c 未知命令: ${command}`);
  process.exit(1);
}
