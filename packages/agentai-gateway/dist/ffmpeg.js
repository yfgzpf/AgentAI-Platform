/**
 * ffmpeg 封装 —— 2026-10-06
 * ========================================================================
 * 立项原因（用户实机反馈）:
 *   「续集生成失败, 请手动截图视频最后一帧上传」
 *
 * 根因: `video.ts` 的extract-tail / extract-frames / next-episode 全部用
 *   `execSync('ffmpeg ...')`，而**实测本机未安装 ffmpeg**
 *   → `command not found` → catch 里统一返回
 *     "ffmpeg 提取尾帧失败, 请确保 ffmpeg 已安装"
 *   → 前端把它翻译成"请手动截图视频最后一帧上传"
 *   → 用户被要求手动操作，但根本不知道真正原因是环境缺依赖。
 *
 * 另一个独立问题: 原实现把 `videoPath` 直接插进 execSync 命令字符串
 *   （只靠双引号包裹）。Windows cmd.exe 下 `&` `|` `%VAR%` 都是分隔符，
 *   双引号**挡不住** —— 这与 B1 批次修掉的 git 命令注入同源。
 *
 * 本模块提供:
 *   1. hasFfmpeg() —— 探测（带缓存），让调用方能在报错前就给出准确原因
 *   2. runFfmpeg() —— execFile 参数数组，不经 shell，无注入面
 *   3. ffmpegHint —— 统一的缺失提示（区分"没装"与"装了但失败"）
 */
import { execFile, execFileSync } from 'child_process';
import * as path from 'path';
/** 探测结果缓存（ffmpeg 装没装不会中途变） */
let cached = null;
/** 常见的 ffmpeg 安装位置（PATH 里没有时兜底扫描） */
const COMMON_PATHS = [
    'ffmpeg',
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'ffmpeg', 'bin', 'ffmpeg.exe'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'ffmpeg', 'bin', 'ffmpeg.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Links', 'ffmpeg.exe'),
    '/usr/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
    '/opt/homebrew/bin/ffmpeg',
];
/**
 * 探测 ffmpeg 是否可用
 * @param force 忽略缓存，强制重新探测
 */
export function hasFfmpeg(force = false) {
    if (cached && !force)
        return cached;
    for (const bin of COMMON_PATHS) {
        if (!bin)
            continue;
        try {
            // 纯本地路径的先验证存在；命令名直接试 exec
            if (bin.includes('/') || bin.includes('\\')) {
                if (!require('fs').existsSync(bin))
                    continue;
            }
            const v = execFileSync(bin, ['-version'], {
                timeout: 5000,
                windowsHide: true,
                stdio: ['ignore', 'pipe', 'ignore'],
            }).toString();
            const firstLine = v.split('\n')[0] || '';
            cached = { ok: true, version: firstLine, bin };
            return cached;
        }
        catch { /* try next */ }
    }
    cached = { ok: false, version: '', bin: '' };
    return cached;
}
/**
 * 执行 ffmpeg（参数数组，不经 shell）
 *
 * @param args ffmpeg 参数数组，**不要**手工拼 shell 字符串
 * @param timeout 超时（ms），默认 60s
 */
export function runFfmpeg(args, timeout = 60000) {
    return new Promise((resolve, reject) => {
        const probe = hasFfmpeg();
        if (!probe.ok) {
            reject(new Error(FFMPEG_MISSING));
            return;
        }
        execFile(probe.bin, args, { timeout, windowsHide: true, maxBuffer: 10 * 1024 * 1024 }, (err, _stdout, stderr) => {
            if (err) {
                const detail = String(stderr || '').slice(-400) || err.message;
                reject(new Error(`ffmpeg 执行失败: ${detail}`));
                return;
            }
            resolve();
        });
    });
}
/** 统一缺失提示 —— 调用方直接返回给用户 */
export const FFMPEG_MISSING = '服务器未安装 ffmpeg，无法自动提取视频帧。'
    + '这是「智能续集」功能的硬依赖（需要它从视频末尾抽一帧作为下一集的首帧）。\n'
    + '解决办法（任选其一）：\n'
    + '  1. 安装 ffmpeg 并加入 PATH（推荐）：\n'
    + '     - Windows: winget install Gyan.FFmpeg  或  choco install ffmpeg\n'
    + '       然后重启 gateway（让它重新探测 PATH）\n'
    + '  2. 临时方案：在视频下方点击「上传尾帧」，手动截取最后一帧上传\n'
    + '  3. 若已安装但仍报错，确认它在本终端可见：ffmpeg -version';
/** 把 ffmpeg 错误转成用户能看懂的话 */
export function explainFfmpegError(e) {
    const msg = String(e?.message || e || '');
    if (msg.includes(FFMPEG_MISSING.slice(0, 20)))
        return FFMPEG_MISSING;
    if (/ENOENT|command not found|not recognized/i.test(msg))
        return FFMPEG_MISSING;
    if (/Invalid data|could not find codec|moov atom not found/i.test(msg)) {
        return 'ffmpeg 无法解析该视频文件（可能格式不受支持，或文件未下载完整）。'
            + '可以改用「上传尾帧」手动指定。';
    }
    return `ffmpeg 处理失败: ${msg.slice(0, 200)}`;
}
