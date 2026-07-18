// AgentAI Desktop - Lite HTML Builder
// ----------------------------------------------------
// 用途: 从 shared/webview-template.ts 生成 lite.html
// 调用: node build-lite.cjs
// 输出: src-tauri/resources/lite.html

const path = require('path');
const fs = require('fs');

console.log('[build-lite] Building Lite HTML...');

try {
    // 动态加载编译后的 webview-template
    // 注: VSCode 扩展已编译 webview-template.js, 直接复用
    const vscodeOut = path.resolve(__dirname, '..', '..', '..', 'agentai-vscode', 'out', 'shared');
    const webviewTemplatePath = path.join(vscodeOut, 'webview-template.js');

    if (!fs.existsSync(webviewTemplatePath)) {
        console.error(`[build-lite] webview-template.js not found at: ${webviewTemplatePath}`);
        console.error('[build-lite] 请先编译 agentai-vscode: cd packages/agentai-vscode && npx tsc');
        process.exit(1);
    }

    const { getWebviewHtml } = require(webviewTemplatePath);

    const html = getWebviewHtml({
        title: 'PulseFlow Lite',
        initialMessage: '🚀 PulseFlow Lite 模式 (快速启动)\n让智能体理解系统的生命状态\n输入消息开始对话\n用 @ 引用文件/工具/记忆',
        showFileTree: true,
        showComposer: true,
        variant: 'chat',
    });

    const resourcesDir = path.resolve(__dirname, '..', 'resources');
    if (!fs.existsSync(resourcesDir)) {
        fs.mkdirSync(resourcesDir, { recursive: true });
    }

    const outFile = path.join(resourcesDir, 'lite.html');
    fs.writeFileSync(outFile, html, 'utf8');
    const size = (fs.statSync(outFile).size / 1024).toFixed(2);
    console.log(`[build-lite] Generated: ${outFile} (${size} KB)`);
} catch (e) {
    console.error('[build-lite] Failed:', e.message);
    process.exit(1);
}
