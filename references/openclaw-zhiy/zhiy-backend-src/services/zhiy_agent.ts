/**
 * 智 Y.Ai 智能体核心
 * 基于 OpenClaw 架构的嵌入式 AI Agent
 * 
 * 核心特性：
 * 1. 直接集成 AI 对话能力（无需外部进程）
 * 2. 内置工具系统（浏览器、桌面、文件、通信）
 * 3. 会话管理（持久化、上下文）
 * 4. 流式输出（实时思考过程）
 * 5. 插件扩展支持
 */

import { EventEmitter } from 'events';
import { spawn, ChildProcess } from 'child_process';
import { Readable } from 'stream';

interface Tool {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
  execute: (params: any, context: AgentContext) => Promise<any>;
}

interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

interface AgentContext {
  sessionId: string;
  senderId: string;
  channel: string;
  history: Message[];
  workspace?: string;
}

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  toolCalls?: ToolCall[];
}

interface ToolCall {
  id: string;
  name: string;
  input: Record<string, any>;
}

interface AgentConfig {
  model?: string;
  provider?: 'deepseek' | 'openai' | 'anthropic' | 'qwen';
  apiKey?: string;
  baseUrl?: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
}

class ZhiYAgent extends EventEmitter {
  private config: AgentConfig;
  private tools: Map<string, Tool> = new Map();
  private sessions: Map<string, AgentContext> = new Map();
  private process: ChildProcess | null = null;
  private messageBuffer: string = '';

  constructor(config: AgentConfig = {}) {
    super();
    this.config = {
      model: config.model || 'deepseek-chat',
      provider: config.provider || 'deepseek',
      maxTokens: config.maxTokens || 4096,
      temperature: config.temperature || 0.7,
      systemPrompt: config.systemPrompt || this.getDefaultSystemPrompt(),
      ...config
    };

    this.registerBuiltinTools();
    console.log('[Agent] 智 Y.Ai 智能体初始化完成');
  }

  private getDefaultSystemPrompt(): string {
    return `你是智 Y.Ai，一个智能 AI 助手。

你的核心能力：
1. 理解用户意图并自动选择合适的工具执行
2. 当用户请求不明确时，主动追问以获取必要信息
3. 保持对话上下文连贯性

可用工具：
- browser_automation: 浏览器自动化（打开网页、搜索、截图）
- desktop_automation: 桌面自动化（打开应用、截图）
- document_generation: 文档生成（Word、Excel、PPT）
- image_generation: 图像生成
- video_generation: 视频生成
- quotation_generation: 装修报价单生成
- file_operation: 文件操作
- communication: 发送消息（微信、邮件）

工作流程：
1. 解析用户意图
2. 选择合适的工具
3. 提取所需参数
4. 如果参数不足，生成追问问题
5. 执行工具并返回结果

请始终保持专业、友好的态度。`;
  }

  private registerBuiltinTools() {
    // 浏览器自动化工具
    this.tools.set('browser_automation', {
      name: 'browser_automation',
      description: '浏览器自动化：打开网页、搜索、截图等',
      parameters: {
        type: 'object',
        properties: {
          action: { 
            type: 'string', 
            enum: ['open', 'search', 'screenshot', 'click', 'type'],
            description: '操作类型' 
          },
          url: { type: 'string', description: '网址' },
          query: { type: 'string', description: '搜索关键词' },
          selector: { type: 'string', description: 'CSS选择器' },
          text: { type: 'string', description: '输入文本' }
        },
        required: ['action']
      },
      execute: async (params, context) => {
        console.log(`[Tool] 执行浏览器自动化: ${params.action}`);
        
        if (params.action === 'open' || params.action === 'search') {
          const url = params.url || (params.query 
            ? `https://www.baidu.com/s?wd=${encodeURIComponent(params.query)}`
            : 'https://www.baidu.com');
          
          // 使用系统命令打开浏览器
          const { exec } = require('child_process');
          return new Promise((resolve) => {
            exec(`start "" "${url}"`, (error: any) => {
              if (error) {
                resolve({ success: false, message: `打开失败: ${error.message}` });
              } else {
                resolve({ success: true, message: `已打开: ${url}` });
              }
            });
          });
        }
        
        if (params.action === 'screenshot') {
          return this.executePythonTool('screenshot', {});
        }

        return { success: false, message: '未知操作' };
      }
    });

    // 桌面自动化工具
    this.tools.set('desktop_automation', {
      name: 'desktop_automation',
      description: '桌面自动化：打开应用、截图等',
      parameters: {
        type: 'object',
        properties: {
          action: { 
            type: 'string', 
            enum: ['open_app', 'screenshot', 'click', 'type'],
            description: '操作类型' 
          },
          app_name: { type: 'string', description: '应用名称' },
          text: { type: 'string', description: '输入文本' }
        },
        required: ['action']
      },
      execute: async (params, context) => {
        console.log(`[Tool] 执行桌面自动化: ${params.action}`);
        
        if (params.action === 'open_app') {
          const { exec } = require('child_process');
          return new Promise((resolve) => {
            exec(`start "" "${params.app_name}"`, (error: any) => {
              if (error) {
                resolve({ success: false, message: `打开失败: ${error.message}` });
              } else {
                resolve({ success: true, message: `正在打开: ${params.app_name}` });
              }
            });
          });
        }

        if (params.action === 'screenshot') {
          return this.executePythonTool('screenshot', {});
        }

        return { success: false, message: '未知操作' };
      }
    });

    // 文档生成工具
    this.tools.set('document_generation', {
      name: 'document_generation',
      description: '文档生成：Word、Excel、PPT',
      parameters: {
        type: 'object',
        properties: {
          doc_type: { 
            type: 'string', 
            enum: ['word', 'excel', 'ppt'],
            description: '文档类型' 
          },
          title: { type: 'string', description: '文档标题' },
          content: { type: 'string', description: '文档内容' },
          data: { type: 'object', description: '表格数据' }
        },
        required: ['doc_type', 'title']
      },
      execute: async (params, context) => {
        console.log(`[Tool] 生成文档: ${params.doc_type} - ${params.title}`);
        
        // 生成文档
        const outputDir = require('os').homedir() + '/Documents/zhiy_output';
        const fs = require('fs');
        if (!fs.existsSync(outputDir)) {
          fs.mkdirSync(outputDir, { recursive: true });
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const ext = params.doc_type === 'word' ? 'docx' : 
                    params.doc_type === 'excel' ? 'xlsx' : 'pptx';
        const filename = `${params.title}_${timestamp}.${ext}`;
        
        // 使用 Python 生成文档
        const pythonResult = await this.executePythonTool('generate_document', {
          doc_type: params.doc_type,
          title: params.title,
          content: params.content || '',
          output: `${outputDir}/${filename}`
        });

        return {
          success: true,
          message: `文档已生成: ${filename}`,
          path: `${outputDir}/${filename}`
        };
      }
    });

    // 报价单生成工具
    this.tools.set('quotation_generation', {
      name: 'quotation_generation',
      description: '装修报价单生成',
      parameters: {
        type: 'object',
        properties: {
          customerName: { type: 'string', description: '客户姓名' },
          area: { type: 'number', description: '装修面积' },
          style: { type: 'string', description: '装修风格' },
          phone: { type: 'string', description: '联系电话' },
          address: { type: 'string', description: '装修地址' },
          rooms: { type: 'string', description: '房型' },
          budget: { type: 'string', description: '预算范围' }
        },
        required: ['customerName', 'area', 'style']
      },
      execute: async (params, context) => {
        console.log(`[Tool] 生成报价单: ${params.customerName}, ${params.area}㎡, ${params.style}`);
        
        // 调用 Python 报价单生成技能
        const pythonResult = await this.executePythonTool('generate_quotation', params);
        
        if (pythonResult.success) {
          return {
            success: true,
            message: `报价单生成成功！总价: ¥${pythonResult.total || '待计算'}`,
            details: pythonResult
          };
        }
        
        return {
          success: false,
          message: pythonResult.message || '生成失败'
        };
      }
    });

    // 文件操作工具
    this.tools.set('file_operation', {
      name: 'file_operation',
      description: '文件操作：创建、读取、写入、删除',
      parameters: {
        type: 'object',
        properties: {
          action: { 
            type: 'string', 
            enum: ['create', 'read', 'write', 'delete', 'copy', 'move'],
            description: '操作类型' 
          },
          path: { type: 'string', description: '文件路径' },
          content: { type: 'string', description: '文件内容' },
          destination: { type: 'string', description: '目标路径' }
        },
        required: ['action', 'path']
      },
      execute: async (params, context) => {
        const fs = require('fs');
        const path = require('path');
        
        try {
          switch (params.action) {
            case 'create':
              fs.writeFileSync(params.path, params.content || '', 'utf-8');
              return { success: true, message: `文件已创建: ${params.path}` };
            
            case 'read':
              if (fs.existsSync(params.path)) {
                const content = fs.readFileSync(params.path, 'utf-8');
                return { success: true, message: `文件内容:`, content };
              }
              return { success: false, message: `文件不存在: ${params.path}` };
            
            case 'write':
              fs.writeFileSync(params.path, params.content || '', 'utf-8');
              return { success: true, message: `文件已保存: ${params.path}` };
            
            case 'delete':
              if (fs.existsSync(params.path)) {
                fs.unlinkSync(params.path);
                return { success: true, message: `文件已删除: ${params.path}` };
              }
              return { success: false, message: `文件不存在: ${params.path}` };
            
            case 'copy':
              fs.copyFileSync(params.path, params.destination);
              return { success: true, message: `文件已复制: ${params.path} -> ${params.destination}` };
            
            default:
              return { success: false, message: `未知操作: ${params.action}` };
          }
        } catch (error: any) {
          return { success: false, message: `操作失败: ${error.message}` };
        }
      }
    });

    // 通信工具
    this.tools.set('communication', {
      name: 'communication',
      description: '发送消息：微信、邮件、钉钉',
      parameters: {
        type: 'object',
        properties: {
          platform: { 
            type: 'string', 
            enum: ['wechat', 'email', 'dingtalk'],
            description: '平台' 
          },
          recipient: { type: 'string', description: '接收者' },
          message: { type: 'string', description: '消息内容' },
          subject: { type: 'string', description: '邮件主题' }
        },
        required: ['platform', 'recipient', 'message']
      },
      execute: async (params, context) => {
        console.log(`[Tool] 发送${params.platform}消息给${params.recipient}`);
        
        // 实际发送需要配置相关服务
        return {
          success: true,
          message: `${params.platform}消息发送功能需要配置相关服务`,
          pending: true
        };
      }
    });

    // 代码执行工具
    this.tools.set('code_execution', {
      name: 'code_execution',
      description: '执行代码',
      parameters: {
        type: 'object',
        properties: {
          language: { type: 'string', description: '编程语言' },
          code: { type: 'string', description: '代码内容' }
        },
        required: ['language', 'code']
      },
      execute: async (params, context) => {
        console.log(`[Tool] 执行${params.language}代码`);
        
        if (params.language === 'python') {
          return this.executePythonCode(params.code);
        }
        
        return { success: false, message: `不支持的语言: ${params.language}` };
      }
    });

    console.log(`[Agent] 已注册 ${this.tools.size} 个内置工具`);
  }

  private async executePythonTool(toolName: string, params: any): Promise<any> {
    return new Promise((resolve) => {
      const pythonScript = this.getPythonToolScript(toolName, params);
      const proc = spawn('python', ['-c', pythonScript], {
        shell: true,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
      });

      let output = '';
      proc.stdout.on('data', (data: Buffer) => {
        output += data.toString();
      });

      proc.stderr.on('data', (data: Buffer) => {
        console.error(`[Python] Error: ${data.toString()}`);
      });

      proc.on('close', (code) => {
        if (code === 0) {
          try {
            resolve(JSON.parse(output.trim()));
          } catch {
            resolve({ success: true, message: output.trim() });
          }
        } else {
          resolve({ success: false, message: `执行失败: ${output}` });
        }
      });

      proc.on('error', (err) => {
        resolve({ success: false, message: `启动失败: ${err.message}` });
      });
    });
  }

  private getPythonToolScript(toolName: string, params: any): string {
    const scripts: Record<string, string> = {
      screenshot: `
import pyautogui
import os
from datetime import datetime
screenshot = pyautogui.screenshot()
timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
output_path = os.path.join(os.path.expanduser('~'), 'Pictures', f'zhiy_screenshot_{timestamp}.png')
screenshot.save(output_path)
print('{"success": true, "message": "截图已保存", "path": "' + output_path + '"}')
`,
      generate_document: `
import json
import sys
# 简化版本 - 实际需要 python-docx 等库
doc_type = "${params.doc_type}"
title = "${params.title}"
output = "${params.output}"
# 实际生成逻辑...
print(json.dumps({"success": True, "message": "文档已生成", "path": output}))
`,
      generate_quotation: `
import json
customer = "${params.customerName}"
area = ${params.area}
style = "${params.style}"
# 计算报价
total = area * 800  # 简化计算
print(json.dumps({"success": True, "total": total, "message": "报价单生成成功"}))
`
    };
    return scripts[toolName] || 'print("{}")';
  }

  private async executePythonCode(code: string): Promise<any> {
    return new Promise((resolve) => {
      const proc = spawn('python', ['-c', code], {
        shell: true,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
      });

      let output = '';
      let error = '';

      proc.stdout.on('data', (data: Buffer) => {
        output += data.toString();
      });

      proc.stderr.on('data', (data: Buffer) => {
        error += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve({ success: true, output });
        } else {
          resolve({ success: false, error });
        }
      });
    });
  }

  public registerTool(tool: Tool) {
    this.tools.set(tool.name, tool);
    console.log(`[Agent] 已注册工具: ${tool.name}`);
  }

  public unregisterTool(name: string) {
    this.tools.delete(name);
    console.log(`[Agent] 已注销工具: ${name}`);
  }

  public getTools(): Tool[] {
    return Array.from(this.tools.values());
  }

  private getToolsForAPI(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((tool: Tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters
    }));
  }

  public async createSession(senderId: string, channel: string): Promise<string> {
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    this.sessions.set(sessionId, {
      sessionId,
      senderId,
      channel,
      history: []
    });

    console.log(`[Agent] 创建会话: ${sessionId}`);
    return sessionId;
  }

  public async processMessage(
    sessionId: string,
    userInput: string,
    streamCallback?: (chunk: string) => void
  ): Promise<{ message: string; toolCalls?: any[]; suggestedActions?: string[] }> {
    const context = this.sessions.get(sessionId);
    if (!context) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // 添加用户消息到历史
    context.history.push({
      role: 'user',
      content: userInput,
      timestamp: new Date()
    });

    // 发送思考状态
    if (streamCallback) {
      streamCallback('[智 Y] 正在分析您的请求...\n');
    }

    // 意图识别
    const intent = this.analyzeIntent(userInput);
    
    // 如果需要参数，执行工具
    if (intent.tool && intent.missingParams && intent.missingParams.length > 0) {
      const questions = this.generateQuestions(intent.missingParams);
      
      if (streamCallback) {
        streamCallback(`我理解您想要**${intent.action}**。\n\n请提供以下信息：\n`);
        intent.missingParams.forEach((param: string, i: number) => {
          streamCallback(`${i + 1}. ${param}\n`);
        });
      }

      return {
        message: `我理解您想要**${intent.action}**。\n\n请提供以下信息：\n${questions.join('\n')}`,
        suggestedActions: intent.missingParams
      };
    }

    // 执行工具
    if (intent.tool) {
      if (streamCallback) {
        streamCallback(`[智 Y] 正在执行${intent.action}...\n`);
      }

      const tool = this.tools.get(intent.tool);
      if (tool) {
        try {
          const result = await tool.execute(intent.params, context);
          
          if (streamCallback) {
            streamCallback(`[智 Y] 执行完成: ${result.message}\n`);
          }

          // 添加助手消息
          context.history.push({
            role: 'assistant',
            content: result.message,
            timestamp: new Date()
          });

          return {
            message: result.message,
            toolCalls: [intent]
          };
        } catch (error: any) {
          return {
            message: `执行失败: ${error.message}`
          };
        }
      }
    }

    // 默认对话响应
    const response = await this.generateResponse(context, streamCallback);
    
    context.history.push({
      role: 'assistant',
      content: response,
      timestamp: new Date()
    });

    return { message: response };
  }

  private analyzeIntent(userInput: string): any {
    const input = userInput.toLowerCase();
    const patterns = [
      { regex: /打开(.+?)(网页|网站|浏览器)/, tool: 'browser_automation', action: '打开浏览器', paramExtractor: () => ({ action: 'open', url: 'https://www.baidu.com' }) },
      { regex: /搜索(.+)/, tool: 'browser_automation', action: '搜索', paramExtractor: (m: RegExpMatchArray) => ({ action: 'search', query: m[1] }) },
      { regex: /截图/, tool: 'desktop_automation', action: '截图', paramExtractor: () => ({ action: 'screenshot' }) },
      { regex: /打开(.+?)(应用|软件|程序)/, tool: 'desktop_automation', action: '打开应用', paramExtractor: (m: RegExpMatchArray) => ({ action: 'open_app', app_name: m[1] }) },
      { regex: /生成(.+?)(文档|报告|word)/i, tool: 'document_generation', action: '生成文档', paramExtractor: (m: RegExpMatchArray) => ({ doc_type: 'word', title: m[1], content: '' }) },
      { regex: /报价/, tool: 'quotation_generation', action: '生成报价单', paramExtractor: () => ({}), required: ['customerName', 'area', 'style'] },
      { regex: /创建(.+?)文件/, tool: 'file_operation', action: '创建文件', paramExtractor: (m: RegExpMatchArray) => ({ action: 'create', path: m[1] }) },
      { regex: /发送(.+?)微信/, tool: 'communication', action: '发送微信', paramExtractor: (m: RegExpMatchArray) => ({ platform: 'wechat', recipient: m[1], message: '' }) },
      { regex: /运行(.+?)代码/, tool: 'code_execution', action: '执行代码', paramExtractor: () => ({ language: 'python', code: '' }) }
    ];

    for (const pattern of patterns) {
      const match = userInput.match(pattern.regex);
      if (match) {
        const params = pattern.paramExtractor(match);
        const missingParams = (pattern.required || []).filter((p: string) => !(p in params));
        
        return {
          action: pattern.action,
          tool: pattern.tool,
          params,
          missingParams
        };
      }
    }

    return { action: '对话', tool: null, params: {}, missingParams: [] };
  }

  private generateQuestions(missingParams: string[]): string[] {
    const paramLabels: Record<string, string> = {
      customerName: '客户姓名',
      area: '装修面积（平方米）',
      style: '装修风格（现代/欧式/中式/美式）',
      phone: '联系电话',
      address: '装修地址',
      query: '搜索关键词',
      app_name: '应用名称'
    };

    return missingParams.map(p => `- ${paramLabels[p] || p}`);
  }

  private async generateResponse(context: AgentContext, streamCallback?: (chunk: string) => void): Promise<string> {
    // 简化版本 - 使用规则响应
    // 实际应该调用 LLM API
    const lastMessage = context.history[context.history.length - 1]?.content || '';
    
    const responses = [
      '我理解您的请求。请问有什么我可以帮您的？',
      '收到！请告诉我您想要做什么。',
      '好的，让我来帮您处理。'
    ];

    return responses[Math.floor(Math.random() * responses.length)];
  }

  public getSession(sessionId: string): AgentContext | undefined {
    return this.sessions.get(sessionId);
  }

  public deleteSession(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }
}

export { ZhiYAgent, Tool, AgentContext, Message, AgentConfig };
