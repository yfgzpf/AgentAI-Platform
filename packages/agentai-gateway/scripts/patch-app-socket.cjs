const fs = require('fs');
const filePath = 'f:/agentai-platform/packages/agentai-gateway/src/app.ts';
let c = fs.readFileSync(filePath, 'utf8');

// 在 browser-bridge 初始化后添加 Playwright 浏览器引擎 Socket.IO 注册
const anchor = "console.log('[browser-bridge] 已初始化, 等待前端浏览器连接...');\n}).catch((e: any) => console.warn('[browser-bridge] init failed:', e?.message));";
const insert = anchor + `
// Playwright 浏览器引擎截图流 Socket.IO
registerBrowserStreamSocket(io);
console.log('[browser-engine] 截图流 Socket.IO 已注册');`;

if (c.includes(anchor) && !c.includes('registerBrowserStreamSocket(io)')) {
  c = c.replace(anchor, insert);
  fs.writeFileSync(filePath, c, 'utf8');
  console.log('✅ Socket.IO 截图流注册已添加');
} else if (c.includes('registerBrowserStreamSocket(io)')) {
  console.log('⚠️ 已存在');
} else {
  console.log('❌ 锚点未找到');
}
