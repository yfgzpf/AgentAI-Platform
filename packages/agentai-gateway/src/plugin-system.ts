/**
 * Plugin System - 插件系统
 * 
 * 提供框架扩展能力：
 * - 中间件机制
 * - 钩子系统
 * - 插件生命周期管理
 */

import { EventEmitter } from 'events';

// ═══════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════

export interface Plugin {
  name: string;
  version: string;
  description?: string;
  
  // 生命周期
  initialize?: () => Promise<void> | void;
  destroy?: () => Promise<void> | void;
  
  // 钩子注册
  hooks?: Partial<HookRegistry>;
  
  // 中间件
  middlewares?: Middleware[];
}

export interface HookRegistry {
  'before:skill:execute': (context: SkillContext) => Promise<void> | void;
  'after:skill:execute': (context: SkillContext, result: any) => Promise<void> | void;
  'before:tool:call': (context: ToolContext) => Promise<void> | void;
  'after:tool:call': (context: ToolContext, result: any) => Promise<void> | void;
  'before:message:process': (message: string) => Promise<string> | string;
  'after:message:process': (response: string) => Promise<string> | string;
  'error': (error: Error, context: any) => Promise<void> | void;
}

export interface SkillContext {
  skillName: string;
  params: any;
  userId: string;
  workspace: string;
}

export interface ToolContext {
  toolName: string;
  args: any;
  userId: string;
}

export type Middleware = (
  context: any,
  next: () => Promise<any>
) => Promise<any>;

export interface PluginMetadata {
  name: string;
  version: string;
  description?: string;
  author?: string;
  dependencies?: string[];
  enabled: boolean;
}

// ═══════════════════════════════════════════════════════════
// 插件系统核心类
// ═══════════════════════════════════════════════════════════

export class PluginSystem extends EventEmitter {
  private plugins: Map<string, Plugin> = new Map();
  private hooks: Map<string, Set<Function>> = new Map();
  private middlewares: Map<string, Middleware[]> = new Map();
  private metadata: Map<string, PluginMetadata> = new Map();

  /**
   * 注册插件
   */
  async register(plugin: Plugin): Promise<void> {
    if (this.plugins.has(plugin.name)) {
      throw new Error(`Plugin ${plugin.name} already registered`);
    }

    console.log(`[PluginSystem] 注册插件: ${plugin.name}@${plugin.version}`);

    // 检查依赖
    if (plugin.hooks) {
      for (const hookName of Object.keys(plugin.hooks)) {
        if (!this.hooks.has(hookName)) {
          this.hooks.set(hookName, new Set());
        }
      }
    }

    // 存储插件
    this.plugins.set(plugin.name, plugin);
    this.metadata.set(plugin.name, {
      name: plugin.name,
      version: plugin.version,
      description: plugin.description,
      enabled: true,
    });

    // 注册钩子
    if (plugin.hooks) {
      for (const [hookName, handler] of Object.entries(plugin.hooks)) {
        this.registerHook(hookName, handler as Function);
      }
    }

    // 注册中间件
    if (plugin.middlewares) {
      for (const middleware of plugin.middlewares) {
        this.use(plugin.name, middleware);
      }
    }

    // 初始化
    if (plugin.initialize) {
      await plugin.initialize();
    }

    this.emit('plugin:registered', { name: plugin.name, version: plugin.version });
  }

  /**
   * 卸载插件
   */
  async unregister(name: string): Promise<void> {
    const plugin = this.plugins.get(name);
    if (!plugin) {
      throw new Error(`Plugin ${name} not found`);
    }

    console.log(`[PluginSystem] 卸载插件: ${name}`);

    // 销毁
    if (plugin.destroy) {
      await plugin.destroy();
    }

    // 移除钩子
    if (plugin.hooks) {
      for (const [hookName, handler] of Object.entries(plugin.hooks)) {
        this.unregisterHook(hookName, handler as Function);
      }
    }

    // 移除中间件
    this.middlewares.delete(name);

    // 移除插件
    this.plugins.delete(name);
    this.metadata.delete(name);

    this.emit('plugin:unregistered', { name });
  }

  /**
   * 注册钩子
   */
  registerHook(hookName: string, handler: Function): void {
    if (!this.hooks.has(hookName)) {
      this.hooks.set(hookName, new Set());
    }
    this.hooks.get(hookName)!.add(handler);
  }

  /**
   * 注销钩子
   */
  unregisterHook(hookName: string, handler: Function): void {
    const handlers = this.hooks.get(hookName);
    if (handlers) {
      handlers.delete(handler);
    }
  }

  /**
   * 执行钩子
   */
  async executeHook(hookName: string, ...args: any[]): Promise<any> {
    const handlers = this.hooks.get(hookName);
    if (!handlers || handlers.size === 0) {
      return args[0]; // 返回第一个参数（用于before钩子）
    }

    let result = args[0];

    for (const handler of handlers) {
      try {
        const handlerResult = await handler(...args);
        // 如果钩子返回结果，更新result（用于before钩子链）
        if (handlerResult !== undefined) {
          result = handlerResult;
          args[0] = result;
        }
      } catch (error) {
        console.error(`[PluginSystem] Hook ${hookName} failed:`, error);
        this.emit('hook:error', { hookName, error });
      }
    }

    return result;
  }

  /**
   * 添加中间件
   */
  use(pluginName: string, middleware: Middleware): void {
    if (!this.middlewares.has(pluginName)) {
      this.middlewares.set(pluginName, []);
    }
    this.middlewares.get(pluginName)!.push(middleware);
  }

  /**
   * 执行中间件链
   */
  async executeMiddleware(context: any, pluginName?: string): Promise<any> {
    const middlewares: Middleware[] = [];

    if (pluginName) {
      // 执行指定插件的中间件
      const pluginMiddlewares = this.middlewares.get(pluginName);
      if (pluginMiddlewares) {
        middlewares.push(...pluginMiddlewares);
      }
    } else {
      // 执行所有中间件
      for (const [, pluginMiddlewares] of this.middlewares) {
        middlewares.push(...pluginMiddlewares);
      }
    }

    // 构建中间件链
    let index = 0;
    const next = async (): Promise<any> => {
      if (index >= middlewares.length) {
        return context;
      }
      const middleware = middlewares[index++];
      return middleware(context, next);
    };

    return next();
  }

  /**
   * 获取插件列表
   */
  list(): PluginMetadata[] {
    return Array.from(this.metadata.values());
  }

  /**
   * 获取插件详情
   */
  get(name: string): Plugin | undefined {
    return this.plugins.get(name);
  }

  /**
   * 启用/禁用插件
   */
  setEnabled(name: string, enabled: boolean): void {
    const metadata = this.metadata.get(name);
    if (metadata) {
      metadata.enabled = enabled;
      this.emit('plugin:status', { name, enabled });
    }
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      totalPlugins: this.plugins.size,
      totalHooks: this.hooks.size,
      totalMiddlewares: Array.from(this.middlewares.values()).reduce(
        (sum, arr) => sum + arr.length, 0
      ),
      hooks: Array.from(this.hooks.keys()),
    };
  }

  /**
   * 创建内置插件
   */
  createBuiltinPlugins() {
    // 日志插件
    const loggingPlugin: Plugin = {
      name: 'logging',
      version: '1.0.0',
      description: '操作日志记录',
      hooks: {
        'before:skill:execute': (ctx) => {
          console.log(`[Plugin:Logging] 执行技能: ${ctx.skillName}`);
        },
        'after:skill:execute': (ctx, result) => {
          console.log(`[Plugin:Logging] 技能完成: ${ctx.skillName}, 成功: ${result.success}`);
        },
        'error': (error, context) => {
          console.error(`[Plugin:Logging] 错误:`, error.message);
        },
      },
    };

    // 性能监控插件
    const performancePlugin: Plugin = {
      name: 'performance',
      version: '1.0.0',
      description: '性能监控',
      hooks: {
        'before:skill:execute': async (ctx) => {
          (ctx as any)._startTime = Date.now();
        },
        'after:skill:execute': async (ctx, result) => {
          const duration = Date.now() - ((ctx as any)._startTime || Date.now());
          console.log(`[Plugin:Performance] ${ctx.skillName} 耗时: ${duration}ms`);
        },
      },
    };

    // 缓存插件
    const cachePlugin: Plugin = {
      name: 'cache',
      version: '1.0.0',
      description: '结果缓存',
      hooks: {
        'before:skill:execute': async (ctx) => {
          // 检查缓存
          const cacheKey = `${ctx.skillName}:${JSON.stringify(ctx.params)}`;
          const cached = (cachePlugin as any)._cache?.get(cacheKey);
          if (cached && Date.now() - cached.time < 60000) {
            console.log(`[Plugin:Cache] 命中缓存: ${ctx.skillName}`);
            throw { __cached: true, result: cached.result };
          }
        },
        'after:skill:execute': async (ctx, result) => {
          // 存储缓存
          if (!(cachePlugin as any)._cache) {
            (cachePlugin as any)._cache = new Map();
          }
          const cacheKey = `${ctx.skillName}:${JSON.stringify(ctx.params)}`;
          (cachePlugin as any)._cache.set(cacheKey, {
            result,
            time: Date.now(),
          });
        },
      },
    };

    return [loggingPlugin, performancePlugin, cachePlugin];
  }
}

// 单例导出
export const pluginSystem = new PluginSystem();
