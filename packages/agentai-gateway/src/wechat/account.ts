/**
 * 微信账号凭证持久化管理
 * 存储到 ~/.agentai-wechat/accounts/
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AccountData, ConfigData } from './types.js';
import { logger } from './logger.js';

const DATA_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE || '.',
  '.agentai-wechat'
);
const ACCOUNTS_DIR = path.join(DATA_DIR, 'accounts');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

export function getDataDir(): string {
  return DATA_DIR;
}

export function ensureDataDir(): void {
  fs.mkdirSync(ACCOUNTS_DIR, { recursive: true });
}

export function saveAccount(account: AccountData): void {
  ensureDataDir();
  const filePath = path.join(ACCOUNTS_DIR, `${account.accountId}.json`);
  fs.writeFileSync(filePath, JSON.stringify(account, null, 2));
  logger.info('Account saved', { accountId: account.accountId });
}

export function loadAccount(accountId: string): AccountData | null {
  const filePath = path.join(ACCOUNTS_DIR, `${accountId}.json`);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const data = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(data) as AccountData;
  } catch (err) {
    logger.error('Failed to load account', { accountId, error: String(err) });
    return null;
  }
}

export function loadLatestAccount(): AccountData | null {
  if (!fs.existsSync(ACCOUNTS_DIR)) {
    return null;
  }
  const files = fs
    .readdirSync(ACCOUNTS_DIR)
    .filter((f) => f.endsWith('.json'));
  if (files.length === 0) {
    return null;
  }
  let latest: AccountData | null = null;
  let latestTime = 0;
  for (const file of files) {
    try {
      const data = fs.readFileSync(path.join(ACCOUNTS_DIR, file), 'utf-8');
      const account = JSON.parse(data) as AccountData;
      const time = new Date(account.createdAt).getTime();
      if (time > latestTime) {
        latestTime = time;
        latest = account;
      }
    } catch {
      logger.warn('Failed to parse account file', { file });
    }
  }
  return latest;
}

export function deleteAccount(accountId: string): boolean {
  const filePath = path.join(ACCOUNTS_DIR, `${accountId}.json`);
  if (!fs.existsSync(filePath)) return false;
  fs.unlinkSync(filePath);
  logger.info('Account deleted', { accountId });
  return true;
}

export function listAccounts(): AccountData[] {
  if (!fs.existsSync(ACCOUNTS_DIR)) {
    return [];
  }
  const files = fs
    .readdirSync(ACCOUNTS_DIR)
    .filter((f) => f.endsWith('.json'));
  return files
    .map((file) => {
      try {
        const data = fs.readFileSync(path.join(ACCOUNTS_DIR, file), 'utf-8');
        return JSON.parse(data) as AccountData;
      } catch {
        logger.warn('Failed to parse account file', { file });
        return null;
      }
    })
    .filter((a): a is AccountData => a !== null);
}

// --- Config ---

export function loadConfig(): ConfigData {
  if (!fs.existsSync(CONFIG_FILE)) {
    return {};
  }
  try {
    const data = fs.readFileSync(CONFIG_FILE, 'utf-8');
    return JSON.parse(data) as ConfigData;
  } catch (err) {
    logger.error('Failed to load config', { error: String(err) });
    return {};
  }
}

export function saveConfig(config: ConfigData): void {
  try {
    fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    logger.info('Config saved', { configFile: CONFIG_FILE });
  } catch (err) {
    logger.error('Failed to save config', { error: String(err) });
  }
}
