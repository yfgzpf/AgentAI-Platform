/**
 * WeChatAutomationAdapter - 微信自动化适配器
 * 
 * 基于zyai的wechat_automation_service实现，提供真实的微信自动化能力：
 * 1. 自动添加好友（通过手机号/微信号）
 * 2. 自动发送消息
 * 3. 自动回复（基于AI）
 * 4. 朋友圈互动
 * 5. 群管理
 */

import { EventEmitter } from 'events';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

// ═══════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════

export interface WeChatMessage {
  id: string;
  type: 'text' | 'image' | 'voice' | 'file';
  from: string;
  to: string;
  content: string;
  isGroup: boolean;
  groupName?: string;
  timestamp: number;
}

export interface FriendRequest {
  id: string;
  fromUser: string;
  verifyMessage: string;
  timestamp: number;
}

export interface WeChatConfig {
  // 微信PC版路径
  wechatPath?: string;
  // 数据存储路径
  dataPath: string;
  // Python脚本路径（zyai的wechat_automation_service.py）
  pythonScriptPath?: string;
  // LLM配置
  llmProvider?: 'deepseek' | 'qwen' | 'glm';
  llmApiKey?: string;
  // 行业类型
  industry?: 'decoration' | 'ecommerce' | 'office' | 'education' | 'health';
}

// ═══════════════════════════════════════════════════════════
// 微信自动化适配器
// ═══════════════════════════════════════════════════════════

export class WeChatAutomationAdapter extends EventEmitter {
  private config: WeChatConfig;
  private pythonProcess?: ChildProcess;
  private isRunning = false;
  private messageQueue: WeChatMessage[] = [];
  private pendingFriendRequests: FriendRequest[] = [];

  constructor(config: WeChatConfig) {
    super();
    this.config = {
      wechatPath: 'C:\\Program Files (x86)\\Tencent\\WeChat\\WeChat.exe',
      dataPath: path.join(process.cwd(), '.agentai', 'wechat-data'),
      industry: 'decoration',
      ...config,
    };

    // 确保数据目录存在
    if (!fs.existsSync(this.config.dataPath)) {
      fs.mkdirSync(this.config.dataPath, { recursive: true });
    }
  }

  /**
   * 启动微信自动化服务
   */
  async start(): Promise<boolean> {
    if (this.isRunning) {
      console.log('[WeChatAdapter] 服务已在运行');
      return true;
    }

    try {
      // 方案1: 如果提供了zyai的Python脚本路径，使用Python服务
      if (this.config.pythonScriptPath && fs.existsSync(this.config.pythonScriptPath)) {
        return await this.startPythonService();
      }

      // 方案2: 使用内置的模拟实现（用于测试）
      return await this.startMockService();

    } catch (error: any) {
      console.error('[WeChatAdapter] 启动失败:', error.message);
      this.emit('error', error);
      return false;
    }
  }

  /**
   * 启动Python服务（基于zyai实现）
   */
  private async startPythonService(): Promise<boolean> {
    return new Promise((resolve) => {
      const scriptPath = this.config.pythonScriptPath!;
      
      console.log('[WeChatAdapter] 启动Python服务:', scriptPath);

      this.pythonProcess = spawn('python', [scriptPath], {
        cwd: path.dirname(scriptPath),
        env: {
          ...process.env,
          WECHAT_DATA_PATH: this.config.dataPath,
          LLM_PROVIDER: this.config.llmProvider,
          LLM_API_KEY: this.config.llmApiKey,
          INDUSTRY_TYPE: this.config.industry,
        },
      });

      // 监听Python输出
      this.pythonProcess.stdout?.on('data', (data) => {
        const output = data.toString();
        console.log('[WeChatPython]', output);
        
        // 解析Python输出的JSON消息
        try {
          const lines = output.split('\n');
          for (const line of lines) {
            if (line.trim().startsWith('{')) {
              const msg = JSON.parse(line);
              this.handlePythonMessage(msg);
            }
          }
        } catch (e) {
          // 非JSON输出，忽略
        }
      });

      this.pythonProcess.stderr?.on('data', (data) => {
        console.error('[WeChatPython Error]', data.toString());
      });

      this.pythonProcess.on('close', (code) => {
        console.log(`[WeChatAdapter] Python服务退出，代码: ${code}`);
        this.isRunning = false;
        this.emit('stopped');
      });

      // 等待服务启动
      setTimeout(() => {
        this.isRunning = true;
        this.emit('started');
        resolve(true);
      }, 3000);
    });
  }

  /**
   * 启动模拟服务（用于测试和演示）
   */
  private async startMockService(): Promise<boolean> {
    console.log('[WeChatAdapter] 启动模拟服务（测试模式）');
    
    this.isRunning = true;
    
    // 模拟接收消息
    this.simulateIncomingMessages();
    
    this.emit('started');
    return true;
  }

  /**
   * 模拟接收消息（测试用）
   */
  private simulateIncomingMessages(): void {
    const simulateMessage = () => {
      if (!this.isRunning) return;

      // 随机生成测试消息
      if (Math.random() > 0.7) {
        const testMessages = [
          { from: '客户A', content: '你好，我想咨询装修报价' },
          { from: '客户B', content: '你们公司在哪里？' },
          { from: '客户C', content: '有优惠活动吗？' },
          { from: '装修交流群', content: '有人推荐靠谱的装修公司吗？', isGroup: true },
        ];

        const randomMsg = testMessages[Math.floor(Math.random() * testMessages.length)];
        
        const message: WeChatMessage = {
          id: `msg-${Date.now()}`,
          type: 'text',
          from: randomMsg.from,
          to: '我',
          content: randomMsg.content,
          isGroup: randomMsg.isGroup || false,
          timestamp: Date.now(),
        };

        this.messageQueue.push(message);
        this.emit('message', message);
      }

      // 继续模拟
      setTimeout(simulateMessage, 5000 + Math.random() * 10000);
    };

    simulateMessage();
  }

  /**
   * 处理Python服务消息
   */
  private handlePythonMessage(msg: any): void {
    switch (msg.type) {
      case 'message':
        this.emit('message', msg.data);
        break;
      case 'friend_request':
        this.pendingFriendRequests.push(msg.data);
        this.emit('friend_request', msg.data);
        break;
      case 'status':
        this.emit('status', msg.data);
        break;
      case 'error':
        this.emit('error', new Error(msg.data.message));
        break;
    }
  }

  /**
   * 发送好友申请
   */
  async sendFriendRequest(phone: string, message: string): Promise<{ success: boolean; message: string }> {
    if (!this.isRunning) {
      return { success: false, message: '服务未启动' };
    }

    try {
      // 如果是Python服务，通过stdin发送命令
      if (this.pythonProcess) {
        const command = JSON.stringify({
          action: 'send_friend_request',
          params: { phone, message },
        });
        this.pythonProcess.stdin?.write(command + '\n');
        
        return { success: true, message: '好友申请已发送' };
      }

      // 模拟模式
      console.log(`[WeChatAdapter] 模拟发送好友申请: ${phone}, 消息: ${message}`);
      return { success: true, message: '好友申请已发送（模拟）' };

    } catch (error: any) {
      return { success: false, message: error.message };
    }
  }

  /**
   * 发送消息
   */
  async sendMessage(to: string, content: string, type: 'text' | 'image' = 'text'): Promise<{ success: boolean; messageId: string }> {
    if (!this.isRunning) {
      return { success: false, messageId: '' };
    }

    try {
      const messageId = `msg-${Date.now()}`;

      if (this.pythonProcess) {
        const command = JSON.stringify({
          action: 'send_message',
          params: { to, content, type },
        });
        this.pythonProcess.stdin?.write(command + '\n');
      } else {
        console.log(`[WeChatAdapter] 模拟发送消息给 ${to}: ${content}`);
      }

      this.emit('message_sent', { to, content, messageId });

      return { success: true, messageId };

    } catch (error: any) {
      return { success: false, messageId: '' };
    }
  }

  /**
   * 获取新消息
   */
  async getNewMessages(): Promise<WeChatMessage[]> {
    const messages = [...this.messageQueue];
    this.messageQueue = [];
    return messages;
  }

  /**
   * 接受好友申请
   */
  async acceptFriendRequest(requestId: string): Promise<boolean> {
    if (!this.isRunning) return false;

    const request = this.pendingFriendRequests.find(r => r.id === requestId);
    if (!request) return false;

    if (this.pythonProcess) {
      const command = JSON.stringify({
        action: 'accept_friend_request',
        params: { requestId },
      });
      this.pythonProcess.stdin?.write(command + '\n');
    } else {
      console.log(`[WeChatAdapter] 模拟接受好友申请: ${request.fromUser}`);
    }

    // 从待处理列表移除
    this.pendingFriendRequests = this.pendingFriendRequests.filter(r => r.id !== requestId);
    
    this.emit('friend_request_accepted', request);
    
    return true;
  }

  /**
   * 配置自动回复
   */
  async configureAutoReply(config: {
    enabled: boolean;
    welcomeMessage?: string;
    replyDelay?: number;
  }): Promise<boolean> {
    if (!this.isRunning) return false;

    if (this.pythonProcess) {
      const command = JSON.stringify({
        action: 'configure_auto_reply',
        params: config,
      });
      this.pythonProcess.stdin?.write(command + '\n');
    }

    console.log(`[WeChatAdapter] 自动回复已${config.enabled ? '启用' : '禁用'}`);
    return true;
  }

  /**
   * 发布朋友圈
   */
  async postToMoments(content: string, images?: string[]): Promise<boolean> {
    if (!this.isRunning) return false;

    if (this.pythonProcess) {
      const command = JSON.stringify({
        action: 'post_moments',
        params: { content, images },
      });
      this.pythonProcess.stdin?.write(command + '\n');
    } else {
      console.log(`[WeChatAdapter] 模拟发布朋友圈: ${content}`);
    }

    this.emit('moments_posted', { content, images });
    return true;
  }

  /**
   * 获取状态
   */
  getStatus(): { running: boolean; messages: number; pendingRequests: number } {
    return {
      running: this.isRunning,
      messages: this.messageQueue.length,
      pendingRequests: this.pendingFriendRequests.length,
    };
  }

  /**
   * 停止服务
   */
  async stop(): Promise<void> {
    this.isRunning = false;

    if (this.pythonProcess) {
      this.pythonProcess.kill();
      this.pythonProcess = undefined;
    }

    this.emit('stopped');
    console.log('[WeChatAdapter] 服务已停止');
  }
}

// 单例导出
let wechatAdapter: WeChatAutomationAdapter | null = null;

export function getWeChatAutomationAdapter(config?: WeChatConfig): WeChatAutomationAdapter {
  if (!wechatAdapter && config) {
    wechatAdapter = new WeChatAutomationAdapter(config);
  }
  return wechatAdapter!;
}
