/**
 * 微信会话持久化管理
 * 存储到 ~/.agentai-wechat/sessions/
 * 每个会话对应一个 JSON 文件
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getDataDir } from './account.js';
import { logger } from './logger.js';
const SESSIONS_DIR = path.join(getDataDir(), 'sessions');
function ensureSessionsDir() {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}
function sessionFilePath(sessionId) {
    return path.join(SESSIONS_DIR, `${sessionId}.json`);
}
function createNewSession() {
    return {
        state: 'idle',
        chatHistory: [],
        maxHistoryLength: 100,
        createdAt: Date.now(),
    };
}
export function createSession(accountId) {
    ensureSessionsDir();
    const sessionId = `${accountId}_${Date.now()}`;
    const session = createNewSession();
    saveSession(sessionId, session);
    logger.info('New session created', { sessionId });
    return { sessionId, session };
}
export function loadSession(sessionId) {
    const filePath = sessionFilePath(sessionId);
    if (!fs.existsSync(filePath)) {
        return null;
    }
    try {
        const data = fs.readFileSync(filePath, 'utf-8');
        const session = JSON.parse(data);
        if (!session.chatHistory)
            session.chatHistory = [];
        if (!session.state)
            session.state = 'idle';
        if (!session.createdAt)
            session.createdAt = Date.now();
        return { sessionId, session };
    }
    catch (err) {
        logger.error('Session load failed', { sessionId, error: String(err) });
        return null;
    }
}
export function saveSession(sessionId, session) {
    ensureSessionsDir();
    const filePath = sessionFilePath(sessionId);
    try {
        fs.writeFileSync(filePath, JSON.stringify(session, null, 2));
    }
    catch (err) {
        logger.error('Session save failed', { sessionId, error: String(err) });
    }
}
export function addChatMessage(session, role, content) {
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
export function getChatHistoryText(session, limit) {
    const history = limit
        ? session.chatHistory.slice(-limit)
        : session.chatHistory;
    return history
        .map((m) => `${m.role}: ${m.content}`)
        .join('\n');
}
export function clearSession(sessionId, session) {
    session.chatHistory = [];
    session.state = 'idle';
    saveSession(sessionId, session);
    logger.info('Session cleared', { sessionId });
}
export function deleteSessionFile(sessionId) {
    const filePath = sessionFilePath(sessionId);
    try {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            logger.info('Session file deleted', { sessionId });
            return true;
        }
        return false;
    }
    catch (err) {
        logger.error('Delete session file failed', {
            sessionId,
            error: String(err),
        });
        return false;
    }
}
export function listLocalSessions(accountId) {
    ensureSessionsDir();
    try {
        const files = fs.readdirSync(SESSIONS_DIR);
        const handles = [];
        for (const file of files) {
            if (!file.endsWith('.json'))
                continue;
            const sid = file.slice(0, -5);
            if (!sid.startsWith(accountId))
                continue;
            const handle = loadSession(sid);
            if (handle)
                handles.push(handle);
        }
        return handles.sort((a, b) => b.session.createdAt - a.session.createdAt);
    }
    catch (err) {
        logger.error('List sessions failed', { error: String(err) });
        return [];
    }
}
export function findSessionByGatewayId(accountId, gatewaySessionId) {
    ensureSessionsDir();
    try {
        const files = fs.readdirSync(SESSIONS_DIR);
        for (const file of files) {
            if (!file.endsWith('.json'))
                continue;
            const sid = file.slice(0, -5);
            if (!sid.startsWith(accountId))
                continue;
            const handle = loadSession(sid);
            if (handle && handle.session.gatewaySessionId === gatewaySessionId) {
                return sid;
            }
        }
        return null;
    }
    catch (err) {
        logger.error('Find session failed', { error: String(err) });
        return null;
    }
}
