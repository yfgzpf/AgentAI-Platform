#!/usr/bin/env node
/**
 * AgentAI 首启动引导向导 (CLI 占位)
 * 阶段 1 占位, GUI 版本在阶段 2 落地
 */
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { createInterface } from 'readline';

const AGENTAI_DIR = join(homedir(), '.agentai');
const CONFIG_FILE = join(AGENTAI_DIR, 'config.yaml');
const ENV_EXAMPLE = join(process.cwd(), '.env.example');

function log(emoji, msg) {
  console.log(`${emoji} ${msg}`);
}

function prompt(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main() {
  console.log('\n🚀 AgentAI Platform — 首启动引导\n');

  // 1. 创建工作目录
  if (!existsSync(AGENTAI_DIR)) {
    mkdirSync(AGENTAI_DIR, { recursive: true });
    log('✅', `已创建工作目录: ${AGENTAI_DIR}`);
  }

  // 2. 复制 .env.example → .env
  if (existsSync(ENV_EXAMPLE)) {
    const envPath = join(AGENTAI_DIR, '.env');
    if (!existsSync(envPath)) {
      const content = readFileSync(ENV_EXAMPLE, 'utf-8');
      writeFileSync(envPath, content, { mode: 0o600 });
      log('✅', `已生成 ${envPath} (权限 600, 请编辑填入密钥)`);
    }
  }

  // 3. 引导选择 LLM
  log('ℹ️ ', '请选择你的 LLM 提供商:');
  log('  1) AgentAI (主推, https://apihub.agnes-ai.com)');
  log('  2) DeepSeek (备选, https://platform.deepseek.com)');
  log('  3) 暂时跳过 (仅命令行)');

  const choice = await prompt('\n选择 [1-3]: ');

  if (choice === '1' || choice === '2') {
    const provider = choice === '1' ? 'AGNES_API_KEY' : 'DEEPSEEK_API_KEY';
    const key = await prompt(`请粘贴 ${provider}: `);

    if (key) {
      const envPath = join(AGENTAI_DIR, '.env');
      let content = existsSync(envPath) ? readFileSync(envPath, 'utf-8') : '';
      content = content.replace(new RegExp(`^${provider}=.*$`, 'm'), `${provider}=${key}`);
      if (!content.includes(`${provider}=${key}`)) {
        content += `\n${provider}=${key}\n`;
      }
      writeFileSync(envPath, content, { mode: 0o600 });
      log('✅', `已写入 ${provider} 到 ${envPath}`);
    }
  }

  // 4. 写主配置
  if (!existsSync(CONFIG_FILE)) {
    const config = `# AgentAI Platform 配置
llm:
  default: agentai
  providers:
    agentai:
      enabled: true
      base_url: https://apihub.agnes-ai.com/v1
    deepseek:
      enabled: true
      base_url: https://api.deepseek.com/v1

gateway:
  host: 127.0.0.1
  port: 18789

routing:
  strategy: cost-first
  max_cost_per_run: 0.05
  circuit_breaker_threshold: 3

memory:
  dir: ${AGENTAI_DIR}/workspace-magic

skills:
  dir: ${AGENTAI_DIR}/skills

encryption:
  algo: aes-256-gcm
  pbkdf2_iterations: 100000

logging:
  level: info
  dir: ${AGENTAI_DIR}/logs
`;
    writeFileSync(CONFIG_FILE, config, { mode: 0o600 });
    log('✅', `已生成主配置: ${CONFIG_FILE}`);
  }

  log('🎉', '初始化完成!');
  log('📁', `工作目录: ${AGENTAI_DIR}`);
  log('🚀', '启动 Gateway: pnpm dev');
  log('🚀', '启动 Tauri 桌面: pnpm dev:desktop');
}

main().catch((err) => {
  console.error('❌ 初始化失败:', err.message);
  process.exit(1);
});
