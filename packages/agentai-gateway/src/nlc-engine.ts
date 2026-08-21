/**
 * nlc-engine.ts — 自然语言编程引擎 (Natural Language to Code)
 * ============================================================
 * 用户说需求 → 系统自动生成完整可运行项目
 * 
 * 核心能力:
 *   1. 需求解构 — 从自然语言提取技术栈/页面/API/数据模型
 *   2. 项目骨架生成 — 自动创建目录结构+配置文件+依赖
 *   3. 代码模板匹配 — 根据需求匹配最佳代码模板
 *   4. 增量迭代 — "把这个按钮改成红色" → 精确定位+修改
 */

import * as fs from 'fs';
import * as path from 'path';

// ===== 需求解构 =====

export interface ProjectSpec {
  /** 项目类型 */
  type: 'web-app' | 'api-server' | 'cli-tool' | 'desktop-app' | 'mobile-app' | 'library' | 'static-site';
  /** 技术栈 */
  stack: {
    frontend?: string;    // react / vue / svelte / html
    backend?: string;     // express / fastify / koa / none
    database?: string;    // sqlite / postgres / mongodb / none
    language: string;     // typescript / javascript / python
  };
  /** 页面/路由 */
  pages: PageSpec[];
  /** API 端点 */
  apis: ApiSpec[];
  /** 数据模型 */
  models: ModelSpec[];
  /** 功能特性 */
  features: string[];
  /** 项目名称 */
  name: string;
  /** 原始需求 */
  rawRequest: string;
}

export interface PageSpec {
  name: string;
  path: string;
  components: string[];
  description: string;
}

export interface ApiSpec {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  description: string;
  input?: string;
  output?: string;
}

export interface ModelSpec {
  name: string;
  fields: { name: string; type: string; required: boolean }[];
}

/**
 * 从自然语言解构项目需求
 */
export function parseProjectSpec(message: string): ProjectSpec {
  const msg = message.toLowerCase();
  
  // 项目类型检测
  let type: ProjectSpec['type'] = 'web-app';
  if (msg.match(/api|后端|服务端|server/i)) type = 'api-server';
  else if (msg.match(/桌面|desktop|tauri|electron/i)) type = 'desktop-app';
  else if (msg.match(/移动|mobile|app|安卓|ios/i)) type = 'mobile-app';
  else if (msg.match(/命令行|cli|工具/i)) type = 'cli-tool';
  else if (msg.match(/库|library|组件|component|包/i)) type = 'library';
  else if (msg.match(/静态|展示|官网|落地页/i)) type = 'static-site';

  // 技术栈检测
  const stack: ProjectSpec['stack'] = { language: 'typescript' };
  if (msg.match(/react/i)) stack.frontend = 'react';
  else if (msg.match(/vue/i)) stack.frontend = 'vue';
  else if (msg.match(/svelte/i)) stack.frontend = 'svelte';
  else if (type === 'web-app' || type === 'static-site') stack.frontend = 'html';

  if (msg.match(/express/i)) stack.backend = 'express';
  else if (msg.match(/fastify/i)) stack.backend = 'fastify';
  else if (msg.match(/koa/i)) stack.backend = 'koa';
  else if (type === 'api-server' || type === 'web-app') stack.backend = 'express';

  if (msg.match(/sqlite/i)) stack.database = 'sqlite';
  else if (msg.match(/postgres|pg/i)) stack.database = 'postgres';
  else if (msg.match(/mongo/i)) stack.database = 'mongodb';
  else if (msg.match(/数据库|database|db|存储/i)) stack.database = 'sqlite';

  if (msg.match(/python/i)) stack.language = 'python';

  // 页面检测
  const pages: PageSpec[] = [];
  const pagePatterns = [
    { re: /首页|home|landing/i, name: 'Home', path: '/' },
    { re: /登录|login|signin/i, name: 'Login', path: '/login' },
    { re: /注册|register|signup/i, name: 'Register', path: '/register' },
    { re: /仪表盘|dashboard|控制台/i, name: 'Dashboard', path: '/dashboard' },
    { re: /设置|settings|配置/i, name: 'Settings', path: '/settings' },
    { re: /列表|list|商品列表/i, name: 'List', path: '/list' },
    { re: /详情|detail|商品详情/i, name: 'Detail', path: '/detail/:id' },
    { re: /个人|profile|用户中心/i, name: 'Profile', path: '/profile' },
    { re: /搜索|search/i, name: 'Search', path: '/search' },
    { re: /关于|about/i, name: 'About', path: '/about' },
    { re: /联系|contact/i, name: 'Contact', path: '/contact' },
    { re: /购物车|cart/i, name: 'Cart', path: '/cart' },
    { re: /订单|order/i, name: 'Orders', path: '/orders' },
  ];
  for (const p of pagePatterns) {
    if (p.re.test(msg)) {
      pages.push({ name: p.name, path: p.path, components: [], description: p.name });
    }
  }
  // 如果没有检测到页面但有前端需求, 默认首页
  if (pages.length === 0 && stack.frontend) {
    pages.push({ name: 'Home', path: '/', components: [], description: '首页' });
  }

  // API 检测
  const apis: ApiSpec[] = [];
  if (stack.backend) {
    if (msg.match(/用户|user|auth|登录|注册/i)) {
      apis.push({ method: 'POST', path: '/api/auth/login', description: '用户登录', input: '{email, password}', output: '{token, user}' });
      apis.push({ method: 'POST', path: '/api/auth/register', description: '用户注册', input: '{name, email, password}', output: '{user}' });
      apis.push({ method: 'GET', path: '/api/users/me', description: '获取当前用户', output: '{user}' });
    }
    if (msg.match(/商品|product|item/i)) {
      apis.push({ method: 'GET', path: '/api/products', description: '商品列表', output: '{products[]}' });
      apis.push({ method: 'GET', path: '/api/products/:id', description: '商品详情', output: '{product}' });
      apis.push({ method: 'POST', path: '/api/products', description: '创建商品', input: '{name, price, ...}' });
    }
    if (msg.match(/订单|order/i)) {
      apis.push({ method: 'POST', path: '/api/orders', description: '创建订单', input: '{items[]}' });
      apis.push({ method: 'GET', path: '/api/orders', description: '订单列表', output: '{orders[]}' });
    }
    if (apis.length === 0) {
      apis.push({ method: 'GET', path: '/api/health', description: '健康检查', output: '{status: "ok"}' });
    }
  }

  // 数据模型检测
  const models: ModelSpec[] = [];
  if (msg.match(/用户|user/i)) {
    models.push({
      name: 'User',
      fields: [
        { name: 'id', type: 'string', required: true },
        { name: 'email', type: 'string', required: true },
        { name: 'password', type: 'string', required: true },
        { name: 'name', type: 'string', required: false },
        { name: 'createdAt', type: 'Date', required: true },
      ],
    });
  }
  if (msg.match(/商品|product/i)) {
    models.push({
      name: 'Product',
      fields: [
        { name: 'id', type: 'string', required: true },
        { name: 'name', type: 'string', required: true },
        { name: 'price', type: 'number', required: true },
        { name: 'description', type: 'string', required: false },
        { name: 'image', type: 'string', required: false },
      ],
    });
  }
  if (msg.match(/订单|order/i)) {
    models.push({
      name: 'Order',
      fields: [
        { name: 'id', type: 'string', required: true },
        { name: 'userId', type: 'string', required: true },
        { name: 'items', type: 'Array', required: true },
        { name: 'total', type: 'number', required: true },
        { name: 'status', type: 'string', required: true },
        { name: 'createdAt', type: 'Date', required: true },
      ],
    });
  }

  // 功能特性检测
  const features: string[] = [];
  if (msg.match(/认证|auth|登录/i)) features.push('authentication');
  if (msg.match(/权限|role|admin/i)) features.push('authorization');
  if (msg.match(/上传|upload|文件/i)) features.push('file-upload');
  if (msg.match(/搜索|search/i)) features.push('search');
  if (msg.match(/通知|notification|消息/i)) features.push('notifications');
  if (msg.match(/支付|payment|alipay|wechat.*pay/i)) features.push('payment');
  if (msg.match(/导出|export|excel|csv/i)) features.push('export');
  if (msg.match(/图表|chart|可视化/i)) features.push('charts');
  if (msg.match(/响应式|mobile|适配/i)) features.push('responsive');
  if (msg.match(/暗色|dark.*mode|主题/i)) features.push('dark-mode');

  // 项目名称
  const nameMatch = message.match(/(?:叫|名称|name)\s*[：:]\s*([^\s,，。]+)/i) || message.match(/([^\s,，。]+)(?:系统|应用|平台|网站|app)/i);
  const name = nameMatch ? nameMatch[1] : 'my-app';

  return { type, stack, pages, apis, models, features, name, rawRequest: message };
}

/**
 * 生成项目骨架文件列表
 */
export function generateProjectSkeleton(spec: ProjectSpec): { path: string; content: string }[] {
  const files: { path: string; content: string }[] = [];
  const { stack, pages, apis, models, features, name } = spec;

  // package.json
  const deps: Record<string, string> = {};
  if (stack.frontend === 'react') { deps.react = '^18'; deps['react-dom'] = '^18'; deps['react-router-dom'] = '^6'; }
  if (stack.frontend === 'vue') { deps.vue = '^3'; deps['vue-router'] = '^4'; }
  if (stack.backend === 'express') { deps.express = '^4'; deps.cors = '^2'; }
  if (stack.database === 'sqlite') { deps['better-sqlite3'] = '^11'; }
  if (features.includes('authentication')) { deps.jsonwebtoken = '^9'; deps.bcryptjs = '^2'; }
  
  const devDeps: Record<string, string> = {};
  if (stack.language === 'typescript') { devDeps.typescript = '^5'; devDeps['ts-node'] = '^10'; }
  if (stack.frontend === 'react') { devDeps.vite = '^5'; devDeps['@vitejs/plugin-react'] = '^4'; }

  files.push({
    path: 'package.json',
    content: JSON.stringify({
      name, version: '0.1.0', scripts: {
        dev: stack.frontend ? 'vite' : 'ts-node src/index.ts',
        build: 'tsc && vite build',
        start: 'node dist/index.js',
      },
      dependencies: deps, devDependencies: devDeps,
    }, null, 2),
  });

  // 目录结构 README
  const structure: string[] = [`# ${name}`, '', '## 项目结构', ''];
  if (stack.frontend) structure.push('src/ — 前端源码');
  if (stack.backend) structure.push('server/ — 后端源码');
  if (stack.database) structure.push('db/ — 数据库文件');
  structure.push('public/ — 静态资源');
  files.push({ path: 'README.md', content: structure.join('\n') });

  // 入口文件
  if (stack.frontend === 'react') {
    files.push({
      path: 'src/main.tsx',
      content: `import React from 'react'\nimport ReactDOM from 'react-dom/client'\nimport App from './App'\nReactDOM.createRoot(document.getElementById('root')!).render(<App />)`,
    });
    files.push({
      path: 'src/App.tsx',
      content: generateReactApp(pages),
    });
  }
  if (stack.backend === 'express') {
    files.push({
      path: 'server/index.ts',
      content: generateExpressServer(apis, models),
    });
  }

  // 页面组件
  for (const page of pages) {
    if (stack.frontend === 'react') {
      files.push({
        path: `src/pages/${page.name}.tsx`,
        content: generateReactPage(page),
      });
    }
  }

  // 数据模型
  for (const model of models) {
    if (stack.database === 'sqlite') {
      files.push({
        path: `db/schema/${model.name.toLowerCase()}.sql`,
        content: generateSqlSchema(model),
      });
    }
  }

  return files;
}

function generateReactApp(pages: PageSpec[]): string {
  const routes = pages.map(p => 
    `      <Route path="${p.path}" element={<${p.name} />} />`
  ).join('\n');
  return `import React from 'react'\nimport { BrowserRouter, Routes, Route } from 'react-router-dom'\n${pages.map(p => `import ${p.name} from './pages/${p.name}'`).join('\n')}\n\nexport default function App() {\n  return (\n    <BrowserRouter>\n      <Routes>\n${routes}\n      </Routes>\n    </BrowserRouter>\n  )\n}`;
}

function generateReactPage(page: PageSpec): string {
  return `export default function ${page.name}() {\n  return (\n    <div>\n      <h1>${page.description}</h1>\n    </div>\n  )\n}`;
}

function generateExpressServer(apis: ApiSpec[], models: ModelSpec[]): string {
  const routes = apis.map(a => 
    `app.${a.method.toLowerCase()}('${a.path}', (req, res) => {\n  // ${a.description}\n  res.json({ message: '${a.description}' })\n})`
  ).join('\n\n');
  return `import express from 'express'\nimport cors from 'cors'\n\nconst app = express()\napp.use(cors())\napp.use(express.json())\n\n${routes}\n\napp.listen(3000, () => console.log('Server running on http://localhost:3000'))`;
}

function generateSqlSchema(model: ModelSpec): string {
  const cols = model.fields.map(f => 
    `  ${f.name} ${f.type === 'string' ? 'TEXT' : f.type === 'number' ? 'REAL' : f.type === 'Date' ? 'DATETIME' : 'TEXT'}${f.required ? ' NOT NULL' : ''}`
  ).join(',\n');
  return `CREATE TABLE IF NOT EXISTS ${model.name.toLowerCase()}s (\n${cols}\n);`;
}

/**
 * 构建自然语言编程上下文 — 注入到 AI
 */
export function buildNlcContext(message: string): string {
  const spec = parseProjectSpec(message);
  const parts: string[] = ['[自然语言编程] 需求分析:'];
  
  parts.push(`类型: ${spec.type}`);
  parts.push(`技术栈: ${spec.stack.frontend || '无'} + ${spec.stack.backend || '无'} + ${spec.stack.database || '无'} (${spec.stack.language})`);
  
  if (spec.pages.length > 0) {
    parts.push(`页面: ${spec.pages.map(p => `${p.name}(${p.path})`).join(', ')}`);
  }
  if (spec.apis.length > 0) {
    parts.push(`API: ${spec.apis.map(a => `${a.method} ${a.path}`).join(', ')}`);
  }
  if (spec.models.length > 0) {
    parts.push(`数据模型: ${spec.models.map(m => `${m.name}(${m.fields.length}字段)`).join(', ')}`);
  }
  if (spec.features.length > 0) {
    parts.push(`功能: ${spec.features.join(', ')}`);
  }
  
  return parts.join('\n');
}
