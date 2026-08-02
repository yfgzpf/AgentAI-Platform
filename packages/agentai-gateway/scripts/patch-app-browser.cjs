const fs = require('fs');
const filePath = 'f:/agentai-platform/packages/agentai-gateway/src/app.ts';
let c = fs.readFileSync(filePath, 'utf8');

// 1. 添加 import
const oldImport = "import { createBrowserRouter } from './routes/browser.js';";
const newImport = oldImport + "\nimport { createBrowserEngineRouter, registerBrowserStreamSocket } from './routes/browser-engine-api.js';";
if (c.includes(oldImport) && !c.includes('browser-engine-api')) {
  c = c.replace(oldImport, newImport);
  console.log('✅ import 已添加');
} else if (c.includes('browser-engine-api')) {
  console.log('⚠️ import 已存在, 跳过');
}

// 2. 添加路由挂载 (在 createBrowserRouter() 后面)
const oldRoute = 'app.use(createBrowserRouter());';
const newRoute = oldRoute + '\napp.use(createBrowserEngineRouter());';
if (c.includes(oldRoute) && !c.includes('createBrowserEngineRouter()')) {
  c = c.replace(oldRoute, newRoute);
  console.log('✅ 路由已挂载');
} else if (c.includes('createBrowserEngineRouter()')) {
  console.log('⚠️ 路由已存在, 跳过');
}

// 3. 在 createServerHandle 中注册 Socket.IO namespace
// 查找 httpServer 创建位置
const socketPattern = 'const httpServer = createServer(app);';
if (c.includes(socketPattern) && !c.includes('registerBrowserStreamSocket')) {
  const replacement = socketPattern + '\n\n// 注册 Playwright 浏览器截图流 Socket.IO\nregisterBrowserStreamSocket(io);';
  c = c.replace(socketPattern, replacement);
  console.log('✅ Socket.IO 截图流已注册');
} else if (c.includes('registerBrowserStreamSocket')) {
  console.log('⚠️ Socket.IO 已注册, 跳过');
}

fs.writeFileSync(filePath, c, 'utf8');
console.log('✅ app.ts 更新完成');
