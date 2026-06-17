/**
 * Proactive Engine — AI 主动建议引擎
 * ----------------------------------------------------
 * 核心理念: AI 不再被动等问, 而是主动扫描工作区状态并建议
 *
 * 触发时机:
 *   1. 用户打开对话时, 自动扫描工作区
 *   2. 行业切换时, 基于新行业上下文建议
 *   3. 检测到工作区变化时 (新文件/报错/未完成任务)
 *
 * 建议类型:
 *   - workspace: 工作区状态建议 (如: 检测到报错日志)
 *   - industry: 行业相关建议 (如: 装修行业检测到新图纸)
 *   - memory: 记忆相关建议 (如: 上次未完成的任务)
 *   - optimization: 优化建议 (如: 代码可以重构)
 */

import * as fs from 'fs';
import * as path from 'path';
import { WorkspaceManager } from './workspace-manager.js';

export interface ProactiveSuggestion {
  id: string;
  type: 'workspace' | 'industry' | 'memory' | 'optimization';
  priority: 'high' | 'medium' | 'low';
  title: string;
  description: string;
  action: string; // 建议用户说的话 / AI 自动执行的操作
  icon: string;   // 前端显示的图标
  industry?: string;
  timestamp: number;
}

export class ProactiveEngine {
  private lastScanTime = 0;
  private cachedSuggestions: ProactiveSuggestion[] = [];
  private scanIntervalMs = 60_000; // 1分钟扫描间隔

  /**
   * 扫描工作区状态, 生成主动建议
   * @param workspace 工作区路径
   * @param currentIndustry 当前行业
   * @param forceScan 强制扫描 (忽略间隔)
   */
  async scan(
    workspace: string,
    currentIndustry: string = 'general',
    forceScan: boolean = false,
  ): Promise<ProactiveSuggestion[]> {
    // 节流: 避免频繁扫描
    const now = Date.now();
    if (!forceScan && now - this.lastScanTime < this.scanIntervalMs) {
      return this.cachedSuggestions;
    }
    this.lastScanTime = now;

    const suggestions: ProactiveSuggestion[] = [];

    // 1. 工作区状态扫描
    suggestions.push(...await this.scanWorkspaceState(workspace));

    // 2. 行业相关建议
    suggestions.push(...this.scanIndustryContext(currentIndustry));

    // 3. 记忆相关建议
    suggestions.push(...await this.scanMemoryContext(workspace));

    // 按优先级排序
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    suggestions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

    // 最多返回 5 条建议
    this.cachedSuggestions = suggestions.slice(0, 5);
    return this.cachedSuggestions;
  }

  /** 工作区状态扫描 */
  private async scanWorkspaceState(workspace: string): Promise<ProactiveSuggestion[]> {
    const suggestions: ProactiveSuggestion[] = [];
    const uid = () => `ws-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    try {
      // 检查是否有报错日志
      const errorLogPaths = [
        path.join(workspace, 'error.log'),
        path.join(workspace, '.agentai', 'error.log'),
        path.join(workspace, 'npm-debug.log'),
      ];
      for (const logPath of errorLogPaths) {
        if (fs.existsSync(logPath)) {
          const stat = fs.statSync(logPath);
          const ageHours = (Date.now() - stat.mtimeMs) / 3600000;
          if (ageHours < 24) {
            suggestions.push({
              id: uid(),
              type: 'workspace',
              priority: 'high',
              title: '检测到近期报错日志',
              description: `${path.basename(logPath)} 在 ${Math.round(ageHours)} 小时前更新`,
              action: `分析 ${path.basename(logPath)} 中的错误并提供修复建议`,
              icon: 'warning',
            });
            break;
          }
        }
      }

      // 检查未提交的 git 变更
      try {
        const { execSync } = await import('child_process');
        const status = execSync('git status --porcelain', { cwd: workspace, encoding: 'utf-8', timeout: 5000 });
        const changedFiles = status.trim().split('\n').filter(l => l.trim()).length;
        if (changedFiles > 5) {
          suggestions.push({
            id: uid(),
            type: 'workspace',
            priority: 'medium',
            title: `${changedFiles} 个文件未提交`,
            description: '工作区有较多未提交的变更, 建议及时提交',
            action: '查看 git diff 并帮我提交这些变更',
            icon: 'git',
          });
        }
      } catch {
        // 不是 git 仓库, 忽略
      }

      // 检查 package.json 中的过期依赖
      const pkgPath = path.join(workspace, 'package.json');
      if (fs.existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
          const deps = { ...pkg.dependencies, ...pkg.devDependencies };
          const depCount = Object.keys(deps).length;
          if (depCount > 20) {
            suggestions.push({
              id: uid(),
              type: 'optimization',
              priority: 'low',
              title: `${depCount} 个依赖项`,
              description: '项目依赖较多, 可能有优化空间',
              action: '检查是否有可以替换或移除的依赖',
              icon: 'package',
            });
          }
        } catch {
          // 解析失败, 忽略
        }
      }
    } catch {
      // 工作区扫描失败, 忽略
    }

    return suggestions;
  }

  /** 行业相关建议 */
  private scanIndustryContext(currentIndustry: string): ProactiveSuggestion[] {
    const suggestions: ProactiveSuggestion[] = [];
    const uid = () => `ind-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    const industrySuggestions: Record<string, ProactiveSuggestion[]> = {
      renovation: [
        {
          id: uid(), type: 'industry', priority: 'medium',
          title: '装修行业模式已激活',
          description: '我可以帮你生成报价表、效果图描述、施工方案、材料清单',
          action: '帮我生成一份装修报价表',
          icon: 'home', industry: 'renovation',
        },
      ],
      ecommerce: [
        {
          id: uid(), type: 'industry', priority: 'medium',
          title: '电商行业模式已激活',
          description: '我可以帮你生成商品图、广告文案、营销方案',
          action: '帮我写一个商品详情页文案',
          icon: 'shopping', industry: 'ecommerce',
        },
      ],
      manga: [
        {
          id: uid(), type: 'industry', priority: 'medium',
          title: '漫剧行业模式已激活',
          description: '我可以帮你生成剧本、角色设定、分镜、视频脚本',
          action: '帮我构思一个短剧剧本',
          icon: 'video', industry: 'manga',
        },
      ],
      developer: [
        {
          id: uid(), type: 'industry', priority: 'medium',
          title: '开发者模式已激活',
          description: '我可以帮你生成代码、调试、架构设计、代码审查',
          action: '帮我审查当前项目的代码质量',
          icon: 'code', industry: 'developer',
        },
      ],
    };

    if (currentIndustry !== 'general' && industrySuggestions[currentIndustry]) {
      suggestions.push(...industrySuggestions[currentIndustry]);
    }

    return suggestions;
  }

  /** 记忆相关建议 */
  private async scanMemoryContext(workspace: string): Promise<ProactiveSuggestion[]> {
    const suggestions: ProactiveSuggestion[] = [];
    const uid = () => `mem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    try {
      const { readMemory } = await import('./memory.js');
      const mems = await readMemory({ userId: 'default', workspace, limit: 5 });
      // 检查是否有未完成的任务记忆
      const unfinished = mems.filter(m =>
        m.content.includes('待完成') || m.content.includes('TODO') || m.content.includes('未完成'),
      );
      if (unfinished.length > 0) {
        suggestions.push({
          id: uid(),
          type: 'memory',
          priority: 'medium',
          title: `发现 ${unfinished.length} 个未完成任务`,
          description: unfinished[0].content.slice(0, 80),
          action: '继续上次未完成的任务',
          icon: 'task',
        });
      }
    } catch {
      // 记忆读取失败, 忽略
    }

    return suggestions;
  }
}

// 单例
let _instance: ProactiveEngine | null = null;
export function getProactiveEngine(): ProactiveEngine {
  if (!_instance) _instance = new ProactiveEngine();
  return _instance;
}
