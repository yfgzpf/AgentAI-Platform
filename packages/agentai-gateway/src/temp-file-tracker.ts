/**
 * 临时文件追踪器 — 任务完成后自动清理AI创建的临时文件
 * ----------------------------------------------------
 * 设计理念：
 * - AI创建的临时文件（测试脚本、临时文件）在任务完成后自动清理
 * - 不是周期性清理，而是任务完成时立即清理
 * - 只清理AI创建的临时文件，不清理用户文件
 * 
 * 安全守护：
 * - 只清理特定目录下的临时文件（tmp、temp、cache等）
 * - 只清理特定扩展名的临时文件（.tmp、.test.js、.spec.ts等）
 * - 不清理用户工作空间的核心文件
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface TempFileEntry {
    filePath: string;
    createdAt: number;
    toolName: string;
    sessionId: string;
    reason: string; // 创建原因（测试、临时、缓存等）
}

const TEMP_FILE_DIR = path.join(os.homedir(), '.agentai', 'temp-files');
const TEMP_FILE_TRACKER = path.join(TEMP_FILE_DIR, 'tracker.jsonl');

// 临时文件判定规则
const TEMP_FILE_PATTERNS = {
    // 目录模式：这些目录下的文件都是临时文件
    directoryPatterns: [
        /\/tmp\//i,
        /\/temp\//i,
        /\/\.tmp\//i,
        /\/\.temp\//i,
        /\/cache\//i,
        /\/\.cache\//i,
        /F:\\_tmp_/i, // Windows临时目录
        /C:\\Users\\.*\\AppData\\Local\\Temp/i,
        /\/\.agentai\/temp-files\//i
    ],
    
    // 文件名模式：这些文件名都是临时文件
    fileNamePatterns: [
        /\.tmp$/i,
        /\.temp$/i,
        /\.bak$/i,
        /\.log$/i,
        /\.test\.js$/i,
        /\.test\.ts$/i,
        /\.spec\.js$/i,
        /\.spec\.ts$/i,
        /_test_/i,
        /_tmp_/i,
        /_temp_/i,
        /^test-/i,
        /^tmp-/i,
        /^temp-/i
    ],
    
    // 工具模式：这些工具创建的文件可能是临时文件
    toolPatterns: [
        'run_code', // run_code执行的脚本
        'run_shell_command', // shell命令的输出文件
        'create_file', // create_file创建的临时文件
        'write_file' // write_file写入的临时文件（需要判断）
    ]
};

/**
 * 判断文件是否是临时文件
 */
export function isTempFile(filePath: string, toolName?: string): boolean {
    // 1. 检查目录模式
    for (const pattern of TEMP_FILE_PATTERNS.directoryPatterns) {
        if (pattern.test(filePath)) {
            return true;
        }
    }
    
    // 2. 检查文件名模式
    for (const pattern of TEMP_FILE_PATTERNS.fileNamePatterns) {
        if (pattern.test(filePath)) {
            return true;
        }
    }
    
    // 3. 检查工具模式（run_code执行的脚本）
    if (toolName && TEMP_FILE_PATTERNS.toolPatterns.includes(toolName)) {
        // run_code执行的脚本通常是临时文件
        if (toolName === 'run_code') {
            // 判断是否是脚本文件（.js、.py、.sh等）
            if (filePath.match(/\.(js|py|sh|bat|cmd)$/i)) {
                return true;
            }
        }
    }
    
    return false;
}

/**
 * 记录临时文件
 */
export function trackTempFile(entry: Omit<TempFileEntry, 'createdAt'>): void {
    try {
        fs.mkdirSync(TEMP_FILE_DIR, { recursive: true });
        const full = { ...entry, createdAt: Date.now() };
        fs.appendFileSync(TEMP_FILE_TRACKER, JSON.stringify(full) + '\n', 'utf-8');
    } catch {
        // 记录失败不影响主流程
    }
}

/**
 * 读取当前session的临时文件列表
 */
export function readTempFiles(sessionId: string): TempFileEntry[] {
    try {
        if (!fs.existsSync(TEMP_FILE_TRACKER)) return [];
        const lines = fs.readFileSync(TEMP_FILE_TRACKER, 'utf-8').trim().split('\n').filter(Boolean);
        return lines.map(l => {
            try { return JSON.parse(l); } catch { return null; }
        }).filter((e): e is TempFileEntry => e && e.sessionId === sessionId);
    } catch {
        return [];
    }
}

/**
 * 清理临时文件
 */
export async function cleanupTempFiles(sessionId: string): Promise<{ deleted: number; kept: number; errors: string[] }> {
    const entries = readTempFiles(sessionId);
    let deleted = 0;
    let kept = 0;
    const errors: string[] = [];
    
    for (const entry of entries) {
        try {
            // 检查文件是否存在
            if (!fs.existsSync(entry.filePath)) {
                continue;
            }
            
            // 检查文件是否是临时文件（双重验证）
            if (!isTempFile(entry.filePath, entry.toolName)) {
                kept++;
                continue;
            }
            
            // 删除文件
            fs.unlinkSync(entry.filePath);
            deleted++;
        } catch (err: any) {
            errors.push(`${entry.filePath}: ${err?.message || 'unknown error'}`);
        }
    }
    
    // 清理tracker文件中的记录
    try {
        if (fs.existsSync(TEMP_FILE_TRACKER)) {
            const allLines = fs.readFileSync(TEMP_FILE_TRACKER, 'utf-8').trim().split('\n').filter(Boolean);
            const remaining = allLines.filter(l => {
                try {
                    const e = JSON.parse(l);
                    return e.sessionId !== sessionId;
                } catch {
                    return true;
                }
            });
            fs.writeFileSync(TEMP_FILE_TRACKER, remaining.join('\n') + '\n', 'utf-8');
        }
    } catch {
        // 清理tracker失败不影响主流程
    }
    
    return { deleted, kept, errors };
}

/**
 * 获取临时文件统计
 */
export function getTempFileStats(): { totalFiles: number; totalSize: number; oldestFile: number } {
    try {
        if (!fs.existsSync(TEMP_FILE_TRACKER)) {
            return { totalFiles: 0, totalSize: 0, oldestFile: Date.now() };
        }
        
        const lines = fs.readFileSync(TEMP_FILE_TRACKER, 'utf-8').trim().split('\n').filter(Boolean);
        const entries = lines.map(l => {
            try { return JSON.parse(l); } catch { return null; }
        }).filter(Boolean) as TempFileEntry[];
        
        let totalSize = 0;
        let oldestFile = Date.now();
        
        for (const entry of entries) {
            try {
                if (fs.existsSync(entry.filePath)) {
                    const stat = fs.statSync(entry.filePath);
                    totalSize += stat.size;
                    if (entry.createdAt < oldestFile) {
                        oldestFile = entry.createdAt;
                    }
                }
            } catch {
                // 文件不存在或无法访问
            }
        }
        
        return {
            totalFiles: entries.length,
            totalSize,
            oldestFile
        };
    } catch {
        return { totalFiles: 0, totalSize: 0, oldestFile: Date.now() };
    }
}

/**
 * 清理所有临时文件（用于系统启动时清理遗留文件）
 */
export async function cleanupAllTempFiles(): Promise<{ deleted: number; kept: number; errors: string[] }> {
    try {
        if (!fs.existsSync(TEMP_FILE_TRACKER)) {
            return { deleted: 0, kept: 0, errors: [] };
        }
        
        const lines = fs.readFileSync(TEMP_FILE_TRACKER, 'utf-8').trim().split('\n').filter(Boolean);
        const entries = lines.map(l => {
            try { return JSON.parse(l); } catch { return null; }
        }).filter(Boolean) as TempFileEntry[];
        
        let deleted = 0;
        let kept = 0;
        const errors: string[] = [];
        
        for (const entry of entries) {
            try {
                if (!fs.existsSync(entry.filePath)) {
                    continue;
                }
                
                if (!isTempFile(entry.filePath, entry.toolName)) {
                    kept++;
                    continue;
                }
                
                fs.unlinkSync(entry.filePath);
                deleted++;
            } catch (err: any) {
                errors.push(`${entry.filePath}: ${err?.message || 'unknown error'}`);
            }
        }
        
        // 清空tracker文件
        try {
            fs.writeFileSync(TEMP_FILE_TRACKER, '', 'utf-8');
        } catch {
            // 清空tracker失败不影响主流程
        }
        
        return { deleted, kept, errors };
    } catch {
        return { deleted: 0, kept: 0, errors: [] };
    }
}