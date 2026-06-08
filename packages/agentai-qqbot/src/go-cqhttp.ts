/**
 * go-cqhttp 子进程管理
 * -----------------------------------------------------------
 * 真 go-cqhttp 二进制从 https://github.com/Mrs4s/go-cqhttp 下载
 * 用户需自己下载并放入 packages/agentai-qqbot/bin/
 *
 * 文档: docs/QQBOT_SETUP.md 详细说明
 */

import { spawn, ChildProcess } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import chalk from 'chalk';

interface GoCqHttpOpts {
  binaryPath: string;
  configPath: string;
  qq: number;
  password?: string;
}

export const goCqHttpManager = {
  async start(opts: GoCqHttpOpts): Promise<ChildProcess> {
    if (!existsSync(opts.binaryPath)) {
      console.error(chalk.red(`❌ go-cqhttp 不存在: ${opts.binaryPath}`));
      console.error(chalk.gray('   请按 docs/QQBOT_SETUP.md 步骤 1 下载二进制'));
      throw new Error('go-cqhttp binary not found');
    }
    if (!existsSync(opts.configPath)) {
      console.error(chalk.red(`❌ config.yml 不存在: ${opts.configPath}`));
      console.error(chalk.gray('   请按 docs/QQBOT_SETUP.md 步骤 2 创建配置'));
      throw new Error('go-cqhttp config.yml not found');
    }

    console.log(chalk.cyan(`🚀 启动 go-cqhttp: ${opts.binaryPath} -config ${opts.configPath}`));
    const child = spawn(opts.binaryPath, ['-config', opts.configPath], {
      stdio: 'inherit',
      shell: true,
      windowsHide: true,
    });

    child.on('close', (code) => {
      console.log(chalk.yellow(`go-cqhttp 退出, code=${code}`));
    });
    child.on('error', (err) => {
      console.error(chalk.red('go-cqhttp 启动失败:'), err);
    });

    // 等待 3s 让 go-cqhttp 初始化
    await new Promise((r) => setTimeout(r, 3000));
    return child;
  },
};
