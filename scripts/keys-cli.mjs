#!/usr/bin/env node
/**
 * AgentAI 密钥管理 CLI
 * 阶段 1 占位, 阶段 2 完整实现 AES-256-GCM 加密
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const AGENTAI_DIR = join(homedir(), '.agentai');
const ENV_FILE = join(AGENTAI_DIR, '.env');

const subcommand = process.argv[2];

function listKeys() {
  if (!existsSync(ENV_FILE)) {
    console.log('❌ .env 文件不存在, 请先运行: pnpm init');
    return;
  }
  const content = readFileSync(ENV_FILE, 'utf-8');
  const keys = content
    .split('\n')
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => {
      const [k, v] = l.split('=');
      const masked = v.length > 8 ? `${v.slice(0, 4)}***${v.slice(-4)}` : '***';
      return `  ${k} = ${masked} (${v.length} chars)`;
    });
  console.log('🔑 已配置的密钥:');
  console.log(keys.join('\n'));
}

function setKey(key, value) {
  if (!existsSync(ENV_FILE)) {
    writeFileSync(ENV_FILE, '', { mode: 0o600 });
  }
  let content = readFileSync(ENV_FILE, 'utf-8');
  const re = new RegExp(`^${key}=.*$`, 'm');
  if (re.test(content)) {
    content = content.replace(re, `${key}=${value}`);
  } else {
    content += `\n${key}=${value}\n`;
  }
  writeFileSync(ENV_FILE, content, { mode: 0o600 });
  console.log(`✅ ${key} 已设置 (${value.length} chars)`);
}

function testKeys() {
  console.log('🔍 测试连接 (阶段 2 完整实现)...');
  console.log('  → AGNES_API_KEY: 跳过 (阶段 1 占位)');
  console.log('  → DEEPSEEK_API_KEY: 跳过 (阶段 1 占位)');
  console.log('✅ 所有密钥加载成功 (未实际测试)');
}

switch (subcommand) {
  case 'list':
    listKeys();
    break;
  case 'set':
    {
      const kv = process.argv[3];
      if (!kv || !kv.includes('=')) {
        console.log('用法: agentai keys set KEY=VALUE');
        process.exit(1);
      }
      const [k, v] = kv.split('=');
      setKey(k, v);
    }
    break;
  case 'test':
    testKeys();
    break;
  default:
    console.log('用法: agentai keys {list|set|test}');
    console.log('  list  - 列出已配置的密钥 (脱敏)');
    console.log('  set   - 设置密钥 (例: agentai keys set AGNES_API_KEY=sk-xxx)');
    console.log('  test  - 测试所有连接');
    process.exit(1);
}
