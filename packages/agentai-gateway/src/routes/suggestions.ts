/**
 * Suggestions API Routes
 * ✨ 主动建议系统 API 接口
 */

import { Router } from 'express';
import { readMemory, writeMemory, MemoryEntry } from '../memory.js';
import { hooksManager } from '../lifecycle-hooks.js';
import { ProactiveSuggestionEngine } from '../proactive-suggestion-engine.js';
import { Suggestion } from '../proactive-suggestion-engine.js';

// 存储SSE连接的客户端
const sseClients = new Map<string, any>();

const router = Router();

// ✨ 获取当前用户的所有建议
router.get('/', async (req, res) => {
  try {
    const { userId, workspace } = req.query;
    
    if (!userId || !workspace) {
      return res.status(400).json({ 
        error: 'Missing required parameters: userId, workspace' 
      });
    }

    // 从memory中检索建议
    const memories: MemoryEntry[] = await readMemory({
      userId: userId as string,
      workspace: workspace as string,
      limit: 50
    });

    // 过滤出建议类型的memory并转换为建议对象
    const suggestions: Suggestion[] = memories
      .filter((memory: MemoryEntry) => memory.metadata?.type === 'proactive_suggestion')
      .map((memory: MemoryEntry) => ({
        id: (memory.metadata?.suggestion_id as string) || `suggest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        title: memory.content.replace(/\[主动建议\]\s*/, '').split('\n')[0] || 'Unknown Suggestion',
        description: memory.content.replace(/\[主动建议\]\s*/, '').substring(
          memory.content.replace(/\[主动建议\]\s*/, '').indexOf('\n') + 1
        ) || '',
        icon: (memory.metadata?.icon as string) || '💡',
        priority: (memory.metadata?.priority || 'medium') as any,
        action: (memory.metadata?.action as string) || '处理建议',
        context: {
          category: (memory.metadata?.category || 'workspace') as any,
          urgency: (memory.metadata?.urgency as number) || 0.5,
          confidence: (memory.metadata?.confidence as number) || 0.5,
          impact: memory.metadata?.impact || {
            user_experience: 0.5,
            efficiency: 0.5,
            cost_saving: 0.5,
            business_value: 0.5
          },
          metadata: memory.metadata?.suggestion_metadata || {}
        },
        timestamp: (memory.metadata?.timestamp as number) || Date.now(),
        status: (memory.metadata?.status || 'pending') as any,
        userId: userId as string,
        workspace: workspace as string
      }))
      .filter((suggestion: Suggestion) => suggestion.status === 'pending')
      .sort((a: Suggestion, b: Suggestion) => {
        // 按紧急性和优先级排序
        const priorityWeight: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
        const aScore = (priorityWeight[a.priority] || 2) * a.context.urgency;
        const bScore = (priorityWeight[b.priority] || 2) * b.context.urgency;
        return bScore - aScore;
      });

    res.json({ suggestions });
  } catch (error) {
    console.error('[Suggestions API] 获取建议失败:', error);
    res.status(500).json({ error: 'Failed to fetch suggestions' });
  }
});

// ✨ 采纳建议核心API
router.post('/:suggestionId/accept', async (req, res) => {
  try {
    const { suggestionId } = req.params;
    const { userId, workspace, suggestion } = req.body;

    if (!userId || !workspace || !suggestion) {
      return res.status(400).json({ 
        error: 'Missing required parameters: userId, workspace, suggestion' 
      });
    }

    console.log(`[Suggestions API] 用户 ${userId} 采纳建议: ${suggestion.title}`);

    // ✅ 1. 标记建议为已采纳  
    await writeMemory({
      userId,
      workspace,
      role: 'assistant',
      content: `[建议已采纳] ${suggestion.title}\n执行指令: ${suggestion.action}`,
      source: 'lifecycle',
      importance: 0.7,
      metadata: {
        type: 'proactive_suggestion',
        suggestion_id: suggestionId,
        status: 'accepted',
        action_taken: suggestion.action,
        timestamp: Date.now()
      }
    });

    // ✅ 2. 触发 SessionSuggestionAccepted Hook
    await hooksManager.trigger('SessionSuggestionAccepted', {
      userId,
      workspace,
      suggestionId,
      suggestion,
      timestamp: Date.now()
    });

    // ✅ 3. 创建任务执行上下文
    const taskContext = {
      userId,
      workspace,
      source: 'proactive_suggestion',
      suggestionId,
      action: suggestion.action,
      originalSuggestion: suggestion,
      timestamp: Date.now()
    };

    // ✅ 4. 将action内容注入到当前会话，让AI执行
    const executionPrompt = `
🎯 【主动建议采纳执行】

用户刚刚采纳了以下建议：
📌 建议标题: ${suggestion.title}
📝 建议描述: ${suggestion.description}
🚀 执行指令: ${suggestion.action}

请根据这个指令，为用户制定具体的执行方案，并按需调用相应工具来实现建议的目标。

执行要求:
1. 分析建议的紧急性和重要性
2. 制定分步执行计划
3. 调用相关工具完成建议目标
4. 向用户汇报执行结果和下一步建议
`;

    // ✅ 5. 保存执行任务到memory，等待AI处理
    await writeMemory({
      userId,
      workspace,
      role: 'user',
      content: executionPrompt,
      source: 'lifecycle',
      importance: 0.8,
      metadata: {
        type: 'suggestion_execution',
        suggestion_id: suggestionId,
        status: 'pending_execution',
        ...taskContext
      }
    });

    // ✅ 6. 如果是实时会话，触发AI立即处理
    const sessionManager = (global as any).sessionManager;
    if (sessionManager) {
      setTimeout(() => {
        try {
          const session = sessionManager.getSession(userId, workspace);
          if (session && session.isActive) {
            // 通知session有新任务需要处理
            session.emit('new_task', {
              type: 'suggestion_execution',
              suggestionId,
              prompt: executionPrompt
            });
          }
        } catch (error) {
          console.warn('[Suggestions API] 无法触发会话任务:', error);
        }
      }, 1000);
    }

    // ✅ 7. 广播建议状态更新到SSE客户端
    const clientKey = `${userId}:${workspace}`;
    broadcastSuggestion(clientKey, suggestion, 'accepted');
    
    // ✅ 8. 返回成功响应
    res.json({
      success: true,
      message: '建议已成功采纳并开始执行',
      execution: {
        suggestionId,
        action: suggestion.action,
        prompt: executionPrompt,
        status: 'executing'
      }
    });

  } catch (error) {
    console.error('[Suggestions API] 采纳建议失败:', error);
    res.status(500).json({ 
      error: 'Failed to accept suggestion',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

// ✨ 忽略建议
router.post('/:suggestionId/dismiss', async (req, res) => {
  try {
    const { suggestionId } = req.params;
    const { userId, workspace, suggestion } = req.body;

    if (!userId || !workspace || !suggestion) {
      return res.status(400).json({ 
        error: 'Missing required parameters: userId, workspace, suggestion' 
      });
    }

    console.log(`[Suggestions API] 用户 ${userId} 忽略建议: ${suggestion.title}`);

    // 标记建议为已忽略
    await writeMemory({
      userId,
      workspace,
      role: 'assistant',
      content: `[建议已忽略] ${suggestion.title}`,
      source: 'lifecycle',
      importance: 0.3,
      metadata: {
        type: 'proactive_suggestion',
        suggestion_id: suggestionId,
        status: 'dismissed',
        timestamp: Date.now()
      }
    });

    // 广播建议状态更新到SSE客户端
    const clientKey = `${userId}:${workspace}`;
    broadcastSuggestion(clientKey, suggestion, 'dismissed');
    
    res.json({
      success: true,
      message: '建议已忽略'
    });

  } catch (error) {
    console.error('[Suggestions API] 忽略建议失败:', error);
    res.status(500).json({ error: 'Failed to dismiss suggestion' });
  }
});

// ✨ 创建自定义建议 (为用户提供手动创建建议的API)
router.post('/', async (req, res) => {
  try {
    const { userId, workspace, title, description, action, category, priority } = req.body;

    if (!userId || !workspace || !title || !description) {
      return res.status(400).json({ 
        error: 'Missing required parameters: userId, workspace, title, description' 
      });
    }

    const suggestionId = `suggest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const urgency = priority === 'critical' ? 0.9 : priority === 'high' ? 0.7 : priority === 'medium' ? 0.5 : 0.3;
    const confidence = 0.8;

    // 创建建议
    await writeMemory({
      userId,
      workspace,
      role: 'assistant',
      content: `[主动建议] ${title}\n${description}`,
      source: 'lifecycle',
      importance: urgency * confidence,
      metadata: {
        type: 'proactive_suggestion',
        suggestion_id: suggestionId,
        status: 'pending',
        action,
        category: category || 'workspace',
        urgency,
        confidence,
        priority: priority || 'medium',
        suggestion_metadata: {
          icon: '💡',
          estimated_effort: 2
        },
        timestamp: Date.now()
      }
    });

    res.json({
      success: true,
      message: '建议创建成功',
      suggestionId
    });

  } catch (error) {
    console.error('[Suggestions API] 创建建议失败:', error);
    res.status(500).json({ error: 'Failed to create suggestion' });
  }
});

// ✨ SSE 建议实时推送
router.get('/stream', (req, res) => {
  const { userId, workspace } = req.query;
  
  if (!userId || !workspace) {
    return res.status(400).json({ error: 'Missing userId and workspace' });
  }

  const clientKey = `${userId}:${workspace}`;

  // 设置SSE响应头
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // 禁用Nginx缓冲

  // 存储客户端连接
  sseClients.set(clientKey, res);
  
  console.log(`[SSE] 客户端连接: ${clientKey}`);

  // 发送初始连接确认
  res.write(`data: ${JSON.stringify({ type: 'connected', message: '建议推送已连接' })}\n\n`);

  // 清理函数
  const cleanup = () => {
    sseClients.delete(clientKey);
    console.log(`[SSE] 客户端断开: ${clientKey}`);
  };

  // 监听连接关闭
  req.on('close', cleanup);
  req.on('end', cleanup);
});

// ✨ 发送建议更新到所有SSE客户端
export function broadcastSuggestion(clientKey: string, suggestion: Suggestion, action: 'new' | 'accepted' | 'dismissed') {
  const client = sseClients.get(clientKey);
  if (client) {
    const data = {
      type: 'suggestion_update',
      action,
      suggestion,
      timestamp: Date.now()
    };
    client.write(`data: ${JSON.stringify(data)}\n\n`);
  }
}

// ✨ 触发所有连接客户端的建议重新加载
export function broadcastReload(clientKey: string) {
  const client = sseClients.get(clientKey);
  if (client) {
    const data = {
      type: 'reload_suggestions',
      timestamp: Date.now()
    };
    client.write(`data: ${JSON.stringify(data)}\n\n`);
  }
}

export default router;