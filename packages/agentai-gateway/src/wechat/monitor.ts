/**
 * 长轮询消息监听器
 * 持续调用 WeChat API getUpdates 拉取新消息
 * 支持指数退避、会话过期处理、消息去重
 */
import { WeChatApi } from './api.js';
import { logger } from './logger.js';
import type { WeixinMessage } from './types.js';

const SESSION_EXPIRED_ERRCODE = -14;
const SESSION_EXPIRED_PAUSE_MS = 60 * 60 * 1000; // 1 hour
const BACKOFF_THRESHOLD = 3;
const BACKOFF_LONG_MS = 30_000;
const BACKOFF_SHORT_MS = 3_000;

export interface MonitorCallbacks {
  onMessage: (msg: WeixinMessage) => Promise<void>;
  onSessionExpired: () => void;
}

function sleep(
  ms: number,
  signal?: AbortSignal
): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true }
    );
  });
}

export function createMonitor(api: WeChatApi, callbacks: MonitorCallbacks) {
  const controller = new AbortController();
  let stopped = false;
  const recentMsgIds = new Set<number>();
  const MAX_MSG_IDS = 1000;

  async function run(): Promise<void> {
    let consecutiveFailures = 0;
    let syncBuf = '';

    while (!controller.signal.aborted) {
      try {
        logger.debug('Polling for messages', { hasBuf: syncBuf.length > 0 });
        const resp = await api.getUpdates(syncBuf || undefined);

        if (resp.ret === SESSION_EXPIRED_ERRCODE) {
          logger.warn('Session expired, pausing for 1 hour');
          callbacks.onSessionExpired();
          await sleep(SESSION_EXPIRED_PAUSE_MS, controller.signal);
          consecutiveFailures = 0;
          continue;
        }

        if (resp.ret !== undefined && resp.ret !== 0) {
          logger.warn('getUpdates error', {
            ret: resp.ret,
            retmsg: resp.errmsg,
          });
        }

        if (resp.get_updates_buf) {
          syncBuf = resp.get_updates_buf;
        }

        const messages = resp.msgs ?? [];
        if (messages.length > 0) {
          logger.info('Received messages', { count: messages.length });
          for (const msg of messages) {
            // Deduplicate by message_id
            if (msg.message_id && recentMsgIds.has(msg.message_id)) {
              continue;
            }
            if (msg.message_id) {
              recentMsgIds.add(msg.message_id);
              if (recentMsgIds.size > MAX_MSG_IDS) {
                // Trim half when reaching limit
                const iter = recentMsgIds.values();
                const toDelete: number[] = [];
                for (let i = 0; i < MAX_MSG_IDS / 2; i++) {
                  const { value } = iter.next();
                  if (value !== undefined) toDelete.push(value);
                }
                for (const id of toDelete) recentMsgIds.delete(id);
              }
            }

            callbacks.onMessage(msg).catch((err) => {
              const msg2 = err instanceof Error ? err.message : String(err);
              logger.error('Message processing error', {
                error: msg2,
                messageId: msg.message_id,
              });
            });
          }
        }

        consecutiveFailures = 0;
      } catch (err) {
        if (controller.signal.aborted) {
          break;
        }
        consecutiveFailures++;
        const errorMsg =
          err instanceof Error ? err.message : String(err);
        logger.error('Polling error', {
          error: errorMsg,
          consecutiveFailures,
        });
        const backoff =
          consecutiveFailures >= BACKOFF_THRESHOLD
            ? BACKOFF_LONG_MS
            : BACKOFF_SHORT_MS;
        await sleep(backoff, controller.signal);
      }
    }

    stopped = true;
    logger.info('Monitor stopped');
  }

  function stop(): void {
    if (!controller.signal.aborted) {
      logger.info('Stopping monitor...');
      controller.abort();
    }
  }

  return { run, stop };
}
