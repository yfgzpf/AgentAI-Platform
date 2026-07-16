/**
 * BrowserProfile — 读取本地浏览器 (Chrome/Edge) 的书签、历史记录、Cookie
 * =====================================================
 * 用于内嵌浏览器显示收藏栏、输入补全、登录态同步
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/** 浏览器配置文件路径 */
function getBrowserPaths(): { name: string; userDataDir: string }[] {
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const paths: { name: string; userDataDir: string }[] = [];

  // Chrome
  const chromePath = path.join(localAppData, 'Google', 'Chrome', 'User Data');
  if (fs.existsSync(chromePath)) paths.push({ name: 'Chrome', userDataDir: chromePath });

  // Edge
  const edgePath = path.join(localAppData, 'Microsoft', 'Edge', 'User Data');
  if (fs.existsSync(edgePath)) paths.push({ name: 'Edge', userDataDir: edgePath });

  return paths;
}

/** 获取所有 profile 目录 (Default, Profile 1, Profile 2...) */
function getProfiles(userDataDir: string): string[] {
  const profiles: string[] = [];
  // Default
  const defaultDir = path.join(userDataDir, 'Default');
  if (fs.existsSync(defaultDir)) profiles.push('Default');
  // Profile 1, 2, 3...
  try {
    const entries = fs.readdirSync(userDataDir);
    for (const e of entries) {
      if (/^Profile\s+\d+$/.test(e) && fs.statSync(path.join(userDataDir, e)).isDirectory()) {
        profiles.push(e);
      }
    }
  } catch { /* ignore */ }
  return profiles;
}

export interface BookmarkNode {
  title: string;
  url?: string;
  children?: BookmarkNode[];
  type: 'folder' | 'url';
}

export interface BookmarkItem {
  title: string;
  url: string;
  icon?: string; // favicon url
}

export interface HistoryItem {
  url: string;
  title: string;
  visitCount: number;
  lastVisitTime: number; // ms timestamp
}

/**
 * 读取浏览器书签 (JSON 文件)
 * Chrome/Edge 书签文件格式: JSON, 包含 roots.bookmark_bar.children
 */
export function readBookmarks(): BookmarkItem[] {
  const browsers = getBrowserPaths();
  const allBookmarks: BookmarkItem[] = [];

  for (const { name, userDataDir } of browsers) {
    for (const profile of getProfiles(userDataDir)) {
      const bookmarkFile = path.join(userDataDir, profile, 'Bookmarks');
      if (!fs.existsSync(bookmarkFile)) continue;
      try {
        const raw = fs.readFileSync(bookmarkFile, 'utf-8');
        const data = JSON.parse(raw);
        const roots = data.roots || {};
        // 收集所有书签栏的链接 (bookmark_bar, other, synced)
        for (const key of ['bookmark_bar', 'other', 'synced']) {
          if (roots[key]?.children) {
            collectBookmarks(roots[key].children, allBookmarks);
          }
        }
      } catch { /* 解析失败跳过 */ }
    }
  }

  // 去重
  const seen = new Set<string>();
  return allBookmarks.filter(b => {
    if (seen.has(b.url)) return false;
    seen.add(b.url);
    return true;
  });
}

function collectBookmarks(nodes: any[], out: BookmarkItem[]): void {
  for (const node of nodes) {
    if (node.type === 'url' && node.url) {
      out.push({ title: node.name || node.url, url: node.url });
    }
    if (node.type === 'folder' && node.children) {
      collectBookmarks(node.children, out);
    }
  }
}

/**
 * 读取浏览器历史记录 (SQLite 文件)
 * Chrome/Edge 历史记录在 History 文件中, 表 urls: (url, title, visit_count, last_visit_time)
 * Chrome 时间戳: 微秒自 1601-01-01, 需转换为 Unix 时间戳
 */
export async function readHistory(limit = 500): Promise<HistoryItem[]> {
  const browsers = getBrowserPaths();
  const allHistory: HistoryItem[] = [];

  for (const { userDataDir } of browsers) {
    for (const profile of getProfiles(userDataDir)) {
      const historyFile = path.join(userDataDir, profile, 'History');
      if (!fs.existsSync(historyFile)) continue;
      try {
        const tmpFile = path.join(os.tmpdir(), `agentai-history-${Date.now()}.db`);
        fs.copyFileSync(historyFile, tmpFile);
        const items = await readHistorySqlite(tmpFile, limit);
        allHistory.push(...items);
        try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
      } catch { /* ignore */ }
    }
  }

  // 按 lastVisitTime 排序, 去重
  const seen = new Map<string, HistoryItem>();
  for (const h of allHistory) {
    const existing = seen.get(h.url);
    if (!existing || h.lastVisitTime > existing.lastVisitTime) {
      seen.set(h.url, h);
    }
  }
  return Array.from(seen.values())
    .sort((a, b) => b.lastVisitTime - a.lastVisitTime)
    .slice(0, limit);
}

async function readHistorySqlite(dbPath: string, limit: number): Promise<HistoryItem[]> {
  // 尝试 better-sqlite3 (动态 import, ESM 兼容)
  try {
    // @ts-ignore - optional dependency, type declaration in sql-js.d.ts
    const mod: any = await import('better-sqlite3');
    const Database = mod.default || mod;
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const rows = db.prepare(
      'SELECT url, title, visit_count, last_visit_time FROM urls ORDER BY last_visit_time DESC LIMIT ?'
    ).all(limit);
    db.close();
    return rows.map((r: any) => ({
      url: r.url,
      title: r.title || r.url,
      visitCount: r.visit_count || 0,
      lastVisitTime: chromeTimeToMs(r.last_visit_time),
    }));
  } catch {
    // 降级: 用 sql.js (纯 JS SQLite)
    return readHistorySqlJs(dbPath, limit);
  }
}

async function readHistorySqlJs(dbPath: string, limit: number): Promise<HistoryItem[]> {
  try {
    const initSqlJsMod: any = await import('sql.js');
    const initSqlJs: any = initSqlJsMod.default || initSqlJsMod;
    const SQL: any = await initSqlJs({ locateFile: (f: string) => f });
    const fileBuffer = fs.readFileSync(dbPath);
    const db = new SQL.Database(fileBuffer);
    const result = db.exec(
      `SELECT url, title, visit_count, last_visit_time FROM urls ORDER BY last_visit_time DESC LIMIT ${limit}`
    );
    db.close();
    if (!result || result.length === 0) return [];
    const rows = result[0].values;
    return rows.map((r: any[]) => ({
      url: r[0],
      title: r[1] || r[0],
      visitCount: r[2] || 0,
      lastVisitTime: chromeTimeToMs(r[3]),
    }));
  } catch {
    return [];
  }
}

/** Chrome 时间戳 (微秒, 1601-01-01 起) → Unix ms */
function chromeTimeToMs(chromeTime: number): number {
  if (!chromeTime || chromeTime <= 0) return 0;
  // 1601-01-01 到 1970-01-01 = 11644473600 秒
  return Math.floor(chromeTime / 1000) - 11644473600000;
}

export interface CookieItem {
  domain: string;
  name: string;
  value: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  expires: number;
}

/**
 * 读取浏览器 Cookie (SQLite 文件)
 * Chrome/Edge Cookie 在 Cookies 文件中, 表 cookies: (host_key, name, value, path, is_secure, is_httponly, expires_utc)
 */
export async function readCookies(domainFilter?: string): Promise<CookieItem[]> {
  const browsers = getBrowserPaths();
  const allCookies: CookieItem[] = [];

  for (const { userDataDir } of browsers) {
    for (const profile of getProfiles(userDataDir)) {
      const cookieFile = path.join(userDataDir, profile, 'Cookies');
      if (!fs.existsSync(cookieFile)) continue;
      try {
        const tmpFile = path.join(os.tmpdir(), `agentai-cookies-${Date.now()}.db`);
        fs.copyFileSync(cookieFile, tmpFile);
        const items = await readCookiesSqlite(tmpFile, domainFilter);
        allCookies.push(...items);
        try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
      } catch { /* ignore */ }
    }
  }
  return allCookies;
}

async function readCookiesSqlite(dbPath: string, domainFilter?: string): Promise<CookieItem[]> {
  try {
    // @ts-ignore - optional dependency, type declaration in sql-js.d.ts
    const mod: any = await import('better-sqlite3');
    const Database = mod.default || mod;
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    let rows: any[];
    if (domainFilter) {
      rows = db.prepare(
        'SELECT host_key, name, value, path, is_secure, is_httponly, expires_utc FROM cookies WHERE host_key LIKE ?'
      ).all(`%${domainFilter}%`);
    } else {
      rows = db.prepare(
        'SELECT host_key, name, value, path, is_secure, is_httponly, expires_utc FROM cookies LIMIT 500'
      ).all();
    }
    db.close();
    return rows.map((r: any) => ({
      domain: r.host_key,
      name: r.name,
      value: r.value,
      path: r.path,
      secure: !!r.is_secure,
      httpOnly: !!r.is_httponly,
      expires: chromeTimeToMs(r.expires_utc),
    }));
  } catch {
    return [];
  }
}

/** 获取所有可用浏览器信息 */
export function getBrowserInfo(): { name: string; profiles: string[]; hasBookmarks: boolean; hasHistory: boolean; hasCookies: boolean }[] {
  const browsers = getBrowserPaths();
  return browsers.map(({ name, userDataDir }) => {
    const profiles = getProfiles(userDataDir);
    return {
      name,
      profiles,
      hasBookmarks: fs.existsSync(path.join(userDataDir, profiles[0] || 'Default', 'Bookmarks')),
      hasHistory: fs.existsSync(path.join(userDataDir, profiles[0] || 'Default', 'History')),
      hasCookies: fs.existsSync(path.join(userDataDir, profiles[0] || 'Default', 'Cookies')),
    };
  });
}
