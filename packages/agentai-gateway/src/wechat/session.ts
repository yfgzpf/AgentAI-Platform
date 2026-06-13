/**
 * 微信会话持久化管理
 * 存储到 ~/.agentai-wechat/sessions/
 * 每个会话对应一个 JSON 文件
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getDataDir } from './account.js';
import { logger } from './logger.js';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface LocalSession {
  gatewaySessionId?: string;  // 对应 Gateway session key (userId:workspace)
  state: 'idle' | 'processing';
  chatHistory: ChatMessage[];
  maxHistoryLength?: number;
  createdAt: number;
}

export interface SessionHandle {
  sessionId: string;
  session: LocalSession;
}

const SESSIONS_DIR = path.join(getDataDir(), 'sessions');

function ensureSessionsDir(): void {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

function sessionFilePath(sessionId: string): string {
  return path.join(SESSIONS_DIR, `${sessionId}.json`);
}

function createNewSession(): LocalSession {
  return {
    state: 'idle',
    chatHistory: [],
    maxHistoryLength: 100,
    createdAt: Date.now(),
  };
}

export function createSession(accountId: string): SessionHandle {
  ensureSessionsDir();
  const sessionId = `${accountId}_${Date.now()}`;
  const session = createNewSession();
  saveSession(sessionId, session);
  logger.info('New session created', { sessionId });
  return { sessionId, session };
}

export function loadSession(sessionId: string): SessionHandle | null {
  const filePath = sessionFilePath(sessionId);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const data = fs.readFileSync(filePath, 'utf-8');
    const session = JSON.parse(data) as LocalSession;

    if (!session.chatHistory) session.chatHistory = [];
    if (!session.state) session.state = 'idle';
    if (!session.createdAt) session.createdAt = Date.now();

    return { sessionId, session };
  } catch (err) {
    logger.error('Session load failed', { sessionId, error: String(err) });
    return null;
  }
}

export function saveSession(sessionId: string, session: LocalSession): void {
  ensureSessionsDir();
  const filePath = sessionFilePath(sessionId);
  try {
    fs.writeFileSync(filePath, JSON.stringify(session, null, 2));
  } catch (err) {
    logger.error('Session save failed', { sessionId, error: String(err) });
  }
}

export function addChatMessage(
  session: LocalSession,
  role: 'user' | 'assistant',
  content: string
): void {
  session.chatHistory.push({
    role,
    content,
    timestamp: Date.now(),
  });

  const maxLength = session.maxHistoryLength || 100;
  if (session.chatHistory.length > maxLength) {
    session.chatHistory = session.chatHistory.slice(-maxLength);
  }
}

export function getChatHistoryText(
  session: LocalSession,
  limit?: number
): string {
  const history = limit
    ? session.chatHistory.slice(-limit)
    : session.chatHistory;
  return history
    .map((m) => `${m.role}: ${m.content}`)
    .join('\n');
}

export function clearSession(
  sessionId: string,
  session: LocalSession
): void {
  session.chatHistory = [];
  session.state = 'idle';
  saveSession(sessionId, session);
  logger.info('Session cleared', { sessionId });
}

export function deleteSessionFile(sessionId: string): boolean {
  const filePath = sessionFilePath(sessionId);
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      logger.info('Session file deleted', { sessionId });
      return true;
    }
    return false;
  } catch (err) {
    logger.error('Delete session file failed', {
      sessionId,
      error: String(err),
    });
    return false;
  }
}

export function listLocalSessions(accountId: string): SessionHandle[] {
  ensureSessionsDir();
  try {
    const files = fs.readdirSync(SESSIONS_DIR);
    const handles: SessionHandle[] = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const sid = file.slice(0, -5);
      if (!sid.startsWith(accountId)) continue;
      const handle = loadSession(sid);
      if (handle) handles.push(handle);
    }
    return handles.sort((a, b) => b.session.createdAt - a.session.createdAt);
  } catch (err) {
    logger.error('List sessions failed', { error: String(err) });
    return [];
  }
}

export function findSessionByGatewayId(
  accountId: string,
  gatewaySessionId: string
): string | null {
  ensureSessionsDir();
  try {
    const files = fs.readdirSync(SESSIONS_DIR);
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const sid = file.slice(0, -5);
      if (!sid.startsWith(accountId)) continue;
      const handle = loadSession(sid);
      if (handle && handle.session.gatewaySessionId === gatewaySessionId) {
        return sid;
      }
    }
    return null;
  } catch (err) {
    logger.error('Find session failed', { error: String(err) });
    return null;
  }
}
