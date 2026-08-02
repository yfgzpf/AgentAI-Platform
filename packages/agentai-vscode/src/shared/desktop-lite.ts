/**
 * PulseFlow - Desktop Lite Mode (Webview Shared HTML 生成器)
 * ----------------------------------------------------
 * 品牌: PulseFlow (产品) + AgentAI Platform (底层框架)
 *
 * 创新点: 桌面端提供两种模式
 *   - Full Mode: 加载完整 React GUI (~5-10MB, 功能全)
 *   - Lite Mode: 加载 vanilla Webview (~50KB, 启动快 10x)
 *
 * Lite 模式优势:
 *   - 启动时间 0.5s vs 3s (Full)
 *   - 内存占用 50MB vs 200MB (Full)
 *   - 适合: 快速查询 / 嵌入式场景 / 低配电脑
 *
 * 集成方式:
 *   - Tauri 启动时根据配置加载不同的 webview
 *   - 用户可运行时切换 (无需重启)
 *   - Lite 模式复用 VSCode 的 shared/ 模板
 */

import { getWebviewHtml } from '../shared/webview-template';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 生成 Lite 模式的 HTML 文件
 * 编译期调用, 输出到 src-tauri/lite.html
 */
export function buildLiteHtml(outputDir: string): string {
    const html = getWebviewHtml({
        title: 'PulseFlow Lite',
        initialMessage: '🚀 PulseFlow Lite 模式 (快速启动)\n让智能体理解系统的生命状态\n输入消息开始对话\n用 @ 引用文件/工具/记忆',
        showFileTree: true,
        showComposer: true,
        variant: 'chat',
    });

    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }
    const outFile = path.join(outputDir, 'lite.html');
    fs.writeFileSync(outFile, html, 'utf8');
    return outFile;
}
