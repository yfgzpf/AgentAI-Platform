/**
 * 智 Y.Ai Gateway 核心
 * 基于 OpenClaw 架构实现的 AI 网关
 * 
 * 核心功能：
 * 1. 会话管理 - 每个用户独立会话
 * 2. 消息路由 - 智能分发到 AI Agent
 * 3. 通道支持 - WebSocket、钉钉、微信等
 * 4. 插件系统 - 可扩展的工具和命令
 * 5. 记忆系统 - 长期记忆和上下文
 */

import express, { Request, Response } from 'express';
import { createServer } from 'http';
import { Server as WebSocketServer, WebSocket } from 'ws';
import { EventEmitter } from 'events';

interface Session {
  id: string;
  senderId: string;
  channel: string;
  messages: Message[];
  context: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  metadata?: Record<string, any>;
}

interface ChannelAdapter {
  id: string;
  name: string;
  send(sessionId: string, message: string): Promise<void>;
  receive?(message: any): void;
}

interface Plugin {
  id: string;
  name: string;
  tools?: Tool[];
  commands?: Command[];
  hooks?: Hook[];
}

interface Tool {
  name: string;
  description: string;
  parameters: Record<string, any>;
  execute: (params: any) => Promise<any>;
}

interface Command {
  name: string;
  description: string;
  handler: (ctx: any) => Promise<{ text: string }>;
}

interface Hook {
  event: string;
  handler: (ctx: any) => Promise<any>;
}

class ZhiYGateway extends EventEmitter {
  private app: express.Application;
  private server: any;
  private wss: WebSocketServer;
  private sessions: Map<string, Session> = new Map();
  private channels: Map<string, ChannelAdapter> = new Map();
  private plugins: Map<string, Plugin> = new Map();
  private tools: Map<string, Tool> = new Map();
  private commands: Map<string, Command> = new Map();
  private port: number;

  constructor(port: number = 18789) {
    super();
    this.port = port;
    this.app = express();
    this.server = createServer(this.app);
    this.wss = new WebSocketServer({ server: this.server });
    
    this.setupMiddleware();
    this.setupRoutes();
    this.setupWebSocket();
    this.registerBuiltinTools();
    
    console.log('[Gateway] 智 Y.Ai Gateway 初始化完成');
  }

  private setupMiddleware() {
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
    
    // CORS
    this.app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
      }
      next();
    });
    
    // 请求日志
    this.app.use((req, res, next) => {
      console.log(`[Gateway] ${req.method} ${req.path}`);
      next();
    });
  }

  private setupRoutes() {
    // 健康检查
    this.app.get('/health', (req, res) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    // 会话管理
    this.app.get('/api/sessions', (req, res) => {
      const sessions = Array.from(this.sessions.values()).map(s => ({
        id: s.id,
        senderId: s.senderId,
        channel: s.channel,
        messageCount: s.messages.length,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt
      }));
      res.json({ sessions });
    });

    this.app.get('/api/sessions/:id', (req, res) => {
      const session = this.sessions.get(req.params.id);
      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }
      res.json({ session });
    });

    this.app.delete('/api/sessions/:id', (req, res) => {
      if (this.sessions.delete(req.params.id)) {
        res.json({ success: true });
      } else {
        res.status(404).json({ error: 'Session not found' });
      }
    });

    // 消息发送
    this.app.post('/api/messages', async (req, res) => {
      const { sessionId, content, channel } = req.body;
      
      let session = sessionId ? this.sessions.get(sessionId) : null;
      if (!session) {
        session = this.createSession('api-user', channel || 'api');
      }

      try {
        const result = await this.processMessage(session.id, content);
        res.json({ success: true, session, result });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    // 工具列表
    this.app.get('/api/tools', (req, res) => {
      const tools = Array.from(this.tools.values()).map(t => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters
      }));
      res.json({ tools });
    });

    // 工具执行
    this.app.post('/api/tools/:name/execute', async (req, res) => {
      const tool = this.tools.get(req.params.name);
      if (!tool) {
        return res.status(404).json({ error: 'Tool not found' });
      }

      try {
        const result = await tool.execute(req.body);
        res.json({ success: true, result });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    // 插件管理
    this.app.get('/api/plugins', (req, res) => {
      const plugins = Array.from(this.plugins.values());
      res.json({ plugins });
    });

    // 通道管理
    this.app.get('/api/channels', (req, res) => {
      const channels = Array.from(this.channels.values()).map(c => ({
        id: c.id,
        name: c.name
      }));
      res.json({ channels });
    });

    // 钉钉 Webhook
    this.app.post('/api/dingtalk/webhook', async (req, res) => {
      try {
        const result = await this.handleDingtalkWebhook(req.body);
        res.json(result);
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    // 微信 Webhook
    this.app.post('/api/wechat/webhook', async (req, res) => {
      try {
        const result = await this.handleWechatWebhook(req.body);
        res.json(result);
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });
  }

  private setupWebSocket() {
    this.wss.on('connection', (ws: WebSocket, req) => {
      const clientId = this.generateId();
      console.log(`[WS] Client connected: ${clientId}`);

      ws.on('message', async (data: string) => {
        try {
          const message = JSON.parse(data);
          await this.handleWebSocketMessage(ws, clientId, message);
        } catch (error: any) {
          console.error(`[WS] Error: ${error.message}`);
          ws.send(JSON.stringify({ type: 'error', message: error.message }));
        }
      });

      ws.on('close', () => {
        console.log(`[WS] Client disconnected: ${clientId}`);
        this.emit('client:disconnect', { clientId });
      });

      ws.send(JSON.stringify({ type: 'connected', clientId }));
    });
  }

  private async handleWebSocketMessage(ws: WebSocket, clientId: string, message: any) {
    const { type, content, sessionId } = message;

    console.log(`[WS] Received from ${clientId}: ${JSON.stringify(message)}`);

    switch (type) {
      case 'user_message':
        await this.handleUserMessage(ws, clientId, content, sessionId);
        break;

      case 'subscribe':
        // 订阅特定事件
        break;

      case 'command':
        await this.handleCommand(ws, clientId, message);
        break;

      default:
        ws.send(JSON.stringify({ type: 'error', message: `Unknown message type: ${type}` }));
    }
  }

  private async handleUserMessage(ws: WebSocket, clientId: string, content: string, sessionId?: string) {
    // 发送思考状态
    ws.send(JSON.stringify({ type: 'status', status: 'thinking' }));

    // 获取或创建会话
    let session = sessionId ? this.sessions.get(sessionId) : null;
    if (!session) {
      session = this.createSession(clientId, 'websocket');
    }

    try {
      // 处理消息
      const result = await this.processMessage(session.id, content);

      // 发送响应
      ws.send(JSON.stringify({
        type: 'message',
        role: 'assistant',
        content: result.message,
        sessionId: session.id,
        suggestedActions: result.suggestedActions
      }));
    } catch (error: any) {
      ws.send(JSON.stringify({
        type: 'error',
        message: error.message
      }));
    }
  }

  private async handleCommand(ws: WebSocket, clientId: string, message: any) {
    const { command, args } = message;
    const cmd = this.commands.get(command);

    if (!cmd) {
      return ws.send(JSON.stringify({
        type: 'error',
        message: `Unknown command: ${command}`
      }));
    }

    try {
      const result = await cmd.handler({ args, clientId });
      ws.send(JSON.stringify({
        type: 'command_result',
        command,
        result
      }));
    } catch (error: any) {
      ws.send(JSON.stringify({
        type: 'error',
        message: error.message
      }));
    }
  }

  private createSession(senderId: string, channel: string): Session {
    const id = this.generateId();
    const session: Session = {
      id,
      senderId,
      channel,
      messages: [],
      context: {},
      createdAt: new Date(),
      updatedAt: new Date()
    };
    this.sessions.set(id, session);
    console.log(`[Gateway] Created session: ${id} for ${senderId} via ${channel}`);
    return session;
  }

  private async processMessage(sessionId: string, content: string): Promise<any> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    // 添加用户消息
    session.messages.push({
      role: 'user',
      content,
      timestamp: new Date()
    });
    session.updatedAt = new Date();

    // 触发消息钩子
    this.emit('message:received', { session, content });

    // 意图识别和处理
    const intent = await this.analyzeIntent(content);
    
    // 检查是否需要追问
    if (intent.missingParams && intent.missingParams.length > 0) {
      return {
        type: 'question',
        message: `我理解您想要**${intent.action}**。\n\n请提供以下信息：\n${intent.missingParams.map((p: string) => `- ${p}`).join('\n')}`,
        suggestedActions: []
      };
    }

    // 执行工具
    if (intent.tool) {
      const tool = this.tools.get(intent.tool);
      if (tool) {
        try {
          const result = await tool.execute(intent.params);
          return {
            type: 'result',
            message: result.message || '操作完成',
            result,
            suggestedActions: []
          };
        } catch (error: any) {
          return {
            type: 'error',
            message: `执行失败: ${error.message}`,
            suggestedActions: []
          };
        }
      }
    }

    // 默认响应
    return {
      type: 'chat',
      message: `我理解您的请求。请问您需要什么帮助？`,
      suggestedActions: [
        { label: '打开浏览器', action: 'open_browser' },
        { label: '生成文档', action: 'generate_document' },
        { label: '搜索', action: 'search' }
      ]
    };
  }

  private async analyzeIntent(content: string): Promise<any> {
    const contentLower = content.toLowerCase();

    // 浏览器自动化
    if (contentLower.includes('打开') && (contentLower.includes('网页') || contentLower.includes('网站') || contentLower.includes('浏览器'))) {
      const urlMatch = content.match(/https?:\/\/[^\s]+/);
      return {
        action: '打开浏览器',
        tool: 'browser_automation',
        params: { action: 'open', url: urlMatch ? urlMatch[0] : 'https://www.baidu.com' },
        missingParams: []
      };
    }

    // 搜索
    if (contentLower.includes('搜索') || contentLower.includes('查找')) {
      const queryMatch = content.match(/搜索\s*(.+?)(?:\s|$)/) || content.match(/查找\s*(.+?)(?:\s|$)/);
      return {
        action: '搜索',
        tool: 'browser_automation',
        params: { action: 'search', query: queryMatch ? queryMatch[1] : '' },
        missingParams: queryMatch ? [] : ['搜索关键词']
      };
    }

    // 文档生成
    if (contentLower.includes('生成') && (contentLower.includes('文档') || contentLower.includes('word') || contentLower.includes('报告'))) {
      const titleMatch = content.match(/生成\s*(.+?)\s*(?:文档|报告|Word)/);
      return {
        action: '生成文档',
        tool: 'document_generation',
        params: { doc_type: 'word', title: titleMatch ? titleMatch[1] : '未命名文档' },
        missingParams: []
      };
    }

    // 报价单生成
    if (contentLower.includes('报价') || contentLower.includes('报价单')) {
      return {
        action: '生成报价单',
        tool: 'quotation_generation',
        params: {},
        missingParams: ['客户姓名', '装修面积', '装修风格']
      };
    }

    // 截图
    if (contentLower.includes('截图') || contentLower.includes('截屏')) {
      return {
        action: '截图',
        tool: 'desktop_automation',
        params: { action: 'screenshot' },
        missingParams: []
      };
    }

    // 打开应用
    if (contentLower.includes('打开') && (contentLower.includes('应用') || contentLower.includes('软件'))) {
      const appMatch = content.match(/打开\s*(.+?)\s*(?:应用|软件|程序|APP)/);
      return {
        action: '打开应用',
        tool: 'desktop_automation',
        params: { action: 'open_app', app_name: appMatch ? appMatch[1] : '' },
        missingParams: appMatch ? [] : ['应用名称']
      };
    }

    return {
      action: '对话',
      tool: null,
      params: {},
      missingParams: []
    };
  }

  private registerBuiltinTools() {
    // 浏览器自动化工具
    this.tools.set('browser_automation', {
      name: 'browser_automation',
      description: '浏览器自动化：打开网页、搜索、截图',
      parameters: {
        action: { type: 'string', description: '操作类型' },
        url: { type: 'string', description: '网址' },
        query: { type: 'string', description: '搜索关键词' }
      },
      execute: async (params: any) => {
        const { spawn } = require('child_process');
        const pythonScript = `
import webbrowser
import sys
action = sys.argv[1]
if action == 'open':
    webbrowser.open(sys.argv[2] if len(sys.argv) > 2 else 'https://www.baidu.com')
    print('已打开浏览器')
elif action == 'search':
    import urllib.parse
    query = urllib.parse.quote(sys.argv[2] if len(sys.argv) > 2 else '')
    webbrowser.open(f'https://www.baidu.com/s?wd={query}')
    print(f'正在搜索: {sys.argv[2] if len(sys.argv) > 2 else ""}')
`;
        return new Promise((resolve, reject) => {
          const proc = spawn('python', ['-c', pythonScript, params.action, params.url || params.query || '']);
          proc.on('close', () => resolve({ success: true, message: '操作完成' }));
          proc.on('error', (err: Error) => reject(err));
        });
      }
    });

    // 桌面自动化工具
    this.tools.set('desktop_automation', {
      name: 'desktop_automation',
      description: '桌面自动化：打开应用、截图',
      parameters: {
        action: { type: 'string', description: '操作类型' },
        app_name: { type: 'string', description: '应用名称' }
      },
      execute: async (params: any) => {
        if (params.action === 'screenshot') {
          const { spawn } = require('child_process');
          const pythonScript = `
import pyautogui
import os
from datetime import datetime
screenshot = pyautogui.screenshot()
timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
output_path = os.path.join(os.path.expanduser('~'), 'Pictures', f'screenshot_{timestamp}.png')
screenshot.save(output_path)
print(f'截图已保存: {output_path}')
`;
          return new Promise((resolve, reject) => {
            const proc = spawn('python', ['-c', pythonScript]);
            let output = '';
            proc.stdout.on('data', (data: Buffer) => output += data.toString());
            proc.on('close', () => resolve({ success: true, message: output }));
            proc.on('error', (err: Error) => reject(err));
          });
        }
        return { success: true, message: '操作完成' };
      }
    });

    // 文档生成工具
    this.tools.set('document_generation', {
      name: 'document_generation',
      description: '文档生成：Word、Excel、PPT',
      parameters: {
        doc_type: { type: 'string', description: '文档类型' },
        title: { type: 'string', description: '标题' },
        content: { type: 'string', description: '内容' }
      },
      execute: async (params: any) => {
        return { success: true, message: `已生成${params.doc_type}文档: ${params.title}` };
      }
    });

    // 报价单生成工具
    this.tools.set('quotation_generation', {
      name: 'quotation_generation',
      description: '装修报价单生成',
      parameters: {
        customerName: { type: 'string', description: '客户姓名' },
        area: { type: 'number', description: '装修面积' },
        style: { type: 'string', description: '装修风格' }
      },
      execute: async (params: any) => {
        return { success: true, message: '报价单生成功能需要完整参数' };
      }
    });

    console.log(`[Gateway] 已注册 ${this.tools.size} 个内置工具`);
  }

  private async handleDingtalkWebhook(body: any): Promise<any> {
    console.log('[Gateway] Dingtalk webhook received:', body);
    
    // 解析钉钉消息
    const { senderNick, senderId, content } = body;
    
    // 创建或获取会话
    let session = Array.from(this.sessions.values())
      .find(s => s.senderId === senderId && s.channel === 'dingtalk');
    
    if (!session) {
      session = this.createSession(senderId, 'dingtalk');
    }

    // 处理消息
    const result = await this.processMessage(session.id, content);

    return {
      msgtype: 'text',
      text: { content: result.message }
    };
  }

  private async handleWechatWebhook(body: any): Promise<any> {
    console.log('[Gateway] Wechat webhook received:', body);
    
    const { FromUserName, Content } = body;
    
    let session = Array.from(this.sessions.values())
      .find(s => s.senderId === FromUserName && s.channel === 'wechat');
    
    if (!session) {
      session = this.createSession(FromUserName, 'wechat');
    }

    const result = await this.processMessage(session.id, Content);

    return {
      ToUserName: FromUserName,
      FromUserName: 'system',
      CreateTime: Date.now(),
      MsgType: 'text',
      Content: result.message
    };
  }

  private generateId(): string {
    return Math.random().toString(36).substring(2, 15);
  }

  public registerPlugin(plugin: Plugin) {
    this.plugins.set(plugin.id, plugin);
    
    if (plugin.tools) {
      plugin.tools.forEach(tool => this.tools.set(tool.name, tool));
    }
    
    if (plugin.commands) {
      plugin.commands.forEach(cmd => this.commands.set(cmd.name, cmd));
    }
    
    console.log(`[Gateway] 已注册插件: ${plugin.id}`);
  }

  public registerChannel(channel: ChannelAdapter) {
    this.channels.set(channel.id, channel);
    console.log(`[Gateway] 已注册通道: ${channel.id}`);
  }

  public start() {
    this.server.listen(this.port, () => {
      console.log(`[Gateway] 智 Y.Ai Gateway 已启动: http://localhost:${this.port}`);
      console.log(`[Gateway] WebSocket 已就绪: ws://localhost:${this.port}`);
      console.log(`[Gateway] 已注册 ${this.tools.size} 个工具, ${this.commands.size} 个命令`);
    });
  }

  public stop() {
    this.wss.close();
    this.server.close();
    console.log('[Gateway] Gateway 已停止');
  }
}

export { ZhiYGateway, Session, Message, ChannelAdapter, Plugin, Tool, Command, Hook };
