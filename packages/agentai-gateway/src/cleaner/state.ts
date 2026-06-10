/**
 * 清理器状态持久化
 * - 主文件: state.json
 * - 备份: state.json.bak (轮转)
 * - 损坏时回退到备份
 * - 主备都损坏时返回 EMPTY_STATE
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { CleanerState, EMPTY_STATE } from './types.js';

const STATE_FILE = 'state.json';
const BACKUP_FILE = 'state.json.bak';

/**
 * 加载状态,优先主文件 → 备份 → 默认空状态
 */
export async function loadState(dir: string): Promise<CleanerState> {
    await fs.mkdir(dir, { recursive: true });
    const primary = path.join(dir, STATE_FILE);
    const backup = path.join(dir, BACKUP_FILE);

    for (const file of [primary, backup]) {
        try {
            const text = await fs.readFile(file, 'utf-8');
            const parsed = JSON.parse(text);
            if (parsed && parsed.version === 1) {
                return parsed as CleanerState;
            }
        } catch {
            // 文件不存在或损坏,继续尝试下一个
        }
    }
    return { ...EMPTY_STATE };
}

/**
 * 保存状态: 先把当前主文件轮转为备份,再写新主文件
 */
export async function saveState(dir: string, state: CleanerState): Promise<void> {
    await fs.mkdir(dir, { recursive: true });
    const primary = path.join(dir, STATE_FILE);
    const backup = path.join(dir, BACKUP_FILE);

    // 把当前主文件保留为备份
    try {
        const text = await fs.readFile(primary, 'utf-8');
        await fs.writeFile(backup, text, 'utf-8');
    } catch {
        // 首次保存,主文件不存在是正常的
    }

    // 写新主文件
    await fs.writeFile(primary, JSON.stringify(state, null, 2), 'utf-8');
}

/**
 * 默认状态目录: ~/.agentai/cleaner/
 * 可通过 AGENTAI_CLEANER_STATE_DIR 环境变量覆盖
 */
export function stateDir(): string {
    const env = process.env.AGENTAI_CLEANER_STATE_DIR;
    if (env) return env;
    const home = process.env.HOME || process.env.USERPROFILE || os.tmpdir();
    return path.join(home, '.agentai', 'cleaner');
}
