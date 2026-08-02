/**
 * SkillOrchestrator — 通用技能调度器
 * ----------------------------------------------------------------
 * 学自: OpenClaw Unified Orchestrator (handler.py)
 * 
 * 架构:
 *   - 动态技能发现 (扫描技能目录)
 *   - smart_dispatch (关键词匹配自动路由)
 *   - 统一 execute(skillName, params) 接口
 *   - 技能注册 → IndustryEngine 的行业技能接入此调度器
 * 
 * 与 IndustryEngine 的关系:
 *   IndustryEngine 定义行业技能 (装修/建筑/园林)
 *   SkillOrchestrator 统一注册 + 调度
 */

import path from 'path';
import os from 'os';
import fs from 'fs';
import { EventEmitter } from 'events';

const AGENTAI_DIR = path.join(os.homedir(), '.agentai');
const SKILLS_ROOT = path.join(AGENTAI_DIR, 'skills');

export interface SkillDescriptor {
  name: string;
  description: string;
  category: string;
  tags: string[];
  handlerPath?: string;
  handler?: (args: any, ctx?: any) => Promise<{ success: boolean; output: string; data?: any }>;
  parameters?: Record<string, any>;
  parallelSafe?: boolean;
  riskLevel?: 'low' | 'medium' | 'high';
}

export class SkillOrchestrator extends EventEmitter {
  private skills = new Map<string, SkillDescriptor>();
  private keywordIndex = new Map<string, string[]>();

  /** 注册技能 */
  register(skill: SkillDescriptor): void {
    this.skills.set(skill.name, skill);

    // 构建关键词索引
    const keywords = this.extractKeywords(skill);
    for (const kw of keywords) {
      const list = this.keywordIndex.get(kw) || [];
      if (!list.includes(skill.name)) list.push(skill.name);
      this.keywordIndex.set(kw, list);
    }
  }

  /** 批量注册 (行业引擎技能接入点) */
  registerAll(skills: SkillDescriptor[]): void {
    for (const s of skills) this.register(s);
    this.emit('skills:loaded', { count: skills.length });
  }

  /** 注销技能 (进化系统淘汰低质技能时调用) */
  unregister(name: string): boolean {
    const skill = this.skills.get(name);
    if (!skill) return false;
    this.skills.delete(name);
    // 清理关键词索引
    const keywords = this.extractKeywords(skill);
    for (const kw of keywords) {
      const list = this.keywordIndex.get(kw);
      if (list) {
        const idx = list.indexOf(name);
        if (idx >= 0) list.splice(idx, 1);
        if (list.length === 0) this.keywordIndex.delete(kw);
      }
    }
    this.emit('skill:unregistered', { name });
    return true;
  }

  /** 从目录扫描 SKILL.md/skill.json 并注册 (动态绑定 handler) */
  scanDirectory(dir: string): number {
    if (!fs.existsSync(dir)) return 0;
    let count = 0;
    try {
      // 递归扫描 (最多 3 层): skills/<category>/<skill>/SKILL.md|skill.json
      const walk = (currentDir: string, depth: number) => {
        if (depth > 3) return;
        for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === '_lib') continue;
          const subDir = path.join(currentDir, entry.name);
          const skillMd = path.join(subDir, 'SKILL.md');
          const skillJson = path.join(subDir, 'skill.json');
          if (fs.existsSync(skillMd)) {
            count += this._registerFromDir(subDir, skillMd, /*isJson*/ false);
          } else if (fs.existsSync(skillJson)) {
            // ✅ 兼容 skill.json (用户场景: packages/agentai-gateway/skills/read-excel/skill.json)
            count += this._registerFromDir(subDir, skillJson, /*isJson*/ true);
          } else {
            walk(subDir, depth + 1);
          }
        }
      };
      walk(dir, 0);
    } catch {}
    if (count > 0) console.log(`[orchestrator] scanned ${count} skills from ${dir}`);
    return count;
  }

  private _registerFromDir(skillDir: string, metaFile: string, isJson = false): number {
    let meta: Partial<SkillDescriptor & { triggers?: string[]; version?: string }> = {};
    if (isJson) {
      try {
        meta = JSON.parse(fs.readFileSync(metaFile, 'utf-8'));
      } catch { return 0; }
    } else {
      meta = this.parseSkillMd(metaFile);
    }
    if (!meta.name) return 0;

    const handlerPy = path.join(skillDir, 'handler.py');
    const handlerTs = path.join(skillDir, 'handler.ts');
    const handlerJs = path.join(skillDir, 'index.js');
    const mainPy = path.join(skillDir, 'main.py');
    const skillPy = path.join(skillDir, 'skill.py');
    const skillTs = path.join(skillDir, 'skill.ts');

    // 动态构建 handler — 发现脚本文件后自动绑定执行器
    let handler: SkillDescriptor['handler'] | undefined;
    let handlerPath: string | undefined;

    // ✅ 兼容: index.js 里写的可能是 python 代码（AI 自动生成错误内容）
    //   场景: skills/read-excel/index.js 实际存的是 python 代码
    const detectFileContent = (file: string): 'js' | 'py' | 'unknown' => {
      try {
        const text = fs.readFileSync(file, 'utf-8').trim();
        if (!text) return 'unknown';
        // 以 " 或 ' 开头（JSON 字符串化）或包含 def xxx(...): 的 → python
        const maybePy = /^["']|^\s*def\s+\w+\s*\(|^\s*import\s+\w+|^\s*from\s+\w+\s+import/.test(text);
        const maybeJs = /^\s*(export\s+|module\.exports\s*=|const\s+\w+\s*=|async\s+function\s*\(|function\s+\w+\s*\()/.test(text);
        if (maybeJs && !maybePy) return 'js';
        if (maybePy) return 'py';
        // 简单启发: 含 python 保留字多 → py
        const pyScore = (text.match(/\b(def|import|from|print|pandas|pd\.)\b/g) || []).length;
        const jsScore = (text.match(/\b(const|let|var|require|module|export|function|=>)\b/g) || []).length;
        return pyScore > jsScore ? 'py' : jsScore > pyScore ? 'js' : 'unknown';
      } catch { return 'unknown'; }
    };
    const pyExecutor = (file: string) => async (args: any) => {
      try {
        const { callPython } = await import('./python-bridge.js');
        return await callPython(file, args);
      } catch (e: any) { return { success: false, output: `Python skill error: ${e.message}` }; }
    };

    if (fs.existsSync(handlerPy)) {
      handlerPath = handlerPy; handler = pyExecutor(handlerPy);
    } else if (fs.existsSync(mainPy)) {
      handlerPath = mainPy; handler = pyExecutor(mainPy);
    } else if (fs.existsSync(skillPy)) {
      handlerPath = skillPy; handler = pyExecutor(skillPy);
    } else if (fs.existsSync(handlerTs)) {
      handlerPath = handlerTs;
      handler = async (args: any) => {
        try {
          const mod = await import(handlerTs!);
          const fn = typeof mod === 'function' ? mod : mod.default || mod.handler || mod.execute;
          if (typeof fn === 'function') return await fn(args);
          return { success: false, output: `TS skill has no executable export` };
        } catch (e: any) { return { success: false, output: `TS skill error: ${e.message}` }; }
      };
    } else if (fs.existsSync(skillTs)) {
      handlerPath = skillTs;
      handler = async (args: any) => {
        try {
          const mod = await import(skillTs);
          const fn = typeof mod === 'function' ? mod : mod.default || mod.handler || mod.execute;
          if (typeof fn === 'function') return await fn(args);
          return { success: false, output: `skill.ts has no executable export` };
        } catch (e: any) { return { success: false, output: e.message }; }
      };
    } else if (fs.existsSync(handlerJs)) {
      handlerPath = handlerJs;
      const kind = detectFileContent(handlerJs);
      if (kind === 'py') {
        // ✅ 2026-08-03: 兼容 AI 错误把 python 代码写进 index.js 的情况
        console.warn(`[orchestrator] ⚠️ ${handlerJs} 检测为 Python 代码 (AI 错误写入)，改用 python-bridge 执行`);
        // 写到临时 .py 文件再执行
        const tmpPy = path.join(os.tmpdir(), `agentai-skill-${meta.name}-${Date.now()}.py`);
        fs.writeFileSync(tmpPy, fs.readFileSync(handlerJs, 'utf-8').replace(/^["']|["']$/g, ''), 'utf-8');
        handler = pyExecutor(tmpPy);
      } else {
        handler = async (args: any) => {
          try {
            const mod = await import(handlerJs!);
            const fn = typeof mod === 'function' ? mod : mod.default || mod.handler || mod.execute;
            if (typeof fn === 'function') return await fn(args);
            return { success: false, output: `JS skill has no executable export` };
          } catch (e: any) { return { success: false, output: `JS skill error: ${e.message}` }; }
        };
      }
    }

    const skillName = meta.name;
    this.register({
      name: skillName,
      description: meta.description || skillName,
      category: meta.category || 'uncategorized',
      tags: meta.tags || [],
      handlerPath,
      handler,
      parameters: meta.parameters,
      parallelSafe: true,
      riskLevel: 'low',
      // @ts-ignore - 扩展字段
      triggers: (meta as any).triggers || [],
    });

    // ✅ 双别名注册: read-excel ↔ read_excel (下划线名)
    //    解决用户调用 "read_excel" 但注册名是 "read-excel" 的不一致问题
    if (/-/.test(skillName) && !this.skills.has(skillName.replace(/-/g, '_'))) {
      const aliasName = skillName.replace(/-/g, '_');
      this.register({
        name: aliasName,
        description: `[alias of ${skillName}] ${meta.description || skillName}`,
        category: meta.category || 'uncategorized',
        tags: (meta.tags || []).concat(['alias']),
        handlerPath,
        handler,
        parameters: meta.parameters,
        parallelSafe: true,
        riskLevel: 'low',
        // @ts-ignore
        triggers: (meta as any).triggers || [],
      });
      return 2;
    }
    if (/_/.test(skillName) && !this.skills.has(skillName.replace(/_/g, '-'))) {
      const aliasName = skillName.replace(/_/g, '-');
      this.register({
        name: aliasName,
        description: `[alias of ${skillName}] ${meta.description || skillName}`,
        category: meta.category || 'uncategorized',
        tags: (meta.tags || []).concat(['alias']),
        handlerPath,
        handler,
        parameters: meta.parameters,
        parallelSafe: true,
        riskLevel: 'low',
      });
      return 2;
    }
    return 1;
  }

  /**
   * smart_dispatch: 根据用户消息自动匹配最合适的技能
   * 返回技能名称列表，按匹配度排序
   * 
   * 改进：支持 metadata.triggers 中的正则匹配
   */
  smartDispatch(userMessage: string, limit = 3): Array<{ name: string; score: number; description: string; triggers?: string[] }> {
    const lower = userMessage.toLowerCase();
    const scores = new Map<string, { score: number; triggers: string[] }>();

    for (const [name, skill] of this.skills) {
      let score = 0;
      const matchedTriggers: string[] = [];

      // 1. 检查 metadata.triggers（最高优先级）
      if ((skill as any).triggers && Array.isArray((skill as any).triggers)) {
        for (const trigger of (skill as any).triggers) {
          try {
            const regex = new RegExp(trigger, 'i');
            if (regex.test(userMessage)) {
              score += 20; // 触发词匹配给高分
              matchedTriggers.push(trigger);
            }
          } catch {
            // 无效正则，忽略
          }
        }
      }

      // 2. 名称匹配
      if (lower.includes(skill.name.toLowerCase())) {
        score += 10;
      }

      // 3. 标签匹配
      for (const tag of skill.tags) {
        if (lower.includes(tag.toLowerCase())) {
          score += 5;
        }
      }

      // 4. 描述关键词匹配
      const descWords = skill.description.toLowerCase().split(/[\s,，、]+/);
      for (const w of descWords) {
        if (w.length >= 2 && lower.includes(w)) {
          score += 1;
        }
      }

      if (score > 0) {
        scores.set(name, { score, triggers: matchedTriggers });
      }
    }

    return [...scores.entries()]
      .sort((a, b) => b[1].score - a[1].score)
      .slice(0, limit)
      .map(([name, data]) => ({
        name,
        score: data.score,
        description: this.skills.get(name)?.description || '',
        triggers: data.triggers,
      }));
  }

  /**
   * 获取技能的触发词（用于 System Prompt）
   */
  getSkillTriggers(skillName: string): string[] {
    const skill = this.skills.get(skillName);
    if (!skill) return [];
    return (skill as any).triggers || [];
  }

  /** 按名称查找技能 */
  get(name: string): SkillDescriptor | undefined {
    return this.skills.get(name);
  }

  /** 列出所有技能 */
  list(): SkillDescriptor[] {
    return [...this.skills.values()];
  }

  /** 列出指定分类的技能 */
  listByCategory(category: string): SkillDescriptor[] {
    return [...this.skills.values()].filter(s => s.category === category);
  }

  /** 构建系统提示词片段 (列出可用技能) */
  buildAvailableSkillsPrompt(tokenLimit = 2000): string {
    const lines: string[] = ['## 可用技能\n'];
    let tokens = 0;
    for (const [name, skill] of this.skills) {
      const line = `- **${name}**: ${skill.description} [${skill.category}]`;
      if (tokens + line.length > tokenLimit) {
        lines.push(`- … 还有 ${this.skills.size - lines.length} 个技能`);
        break;
      }
      tokens += line.length;
      lines.push(line);
    }
    return lines.join('\n');
  }

  private extractKeywords(skill: SkillDescriptor): string[] {
    const words = new Set<string>();
    for (const tag of skill.tags) words.add(tag.toLowerCase());
    for (const w of skill.description.toLowerCase().split(/[\s,，、]+/)) {
      if (w.length >= 2) words.add(w);
    }
    words.add(skill.name.toLowerCase());
    return [...words];
  }

  private parseSkillMd(filePath: string): Partial<SkillDescriptor & { triggers?: string[] }> {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const frontMatter = content.match(/^---\n([\s\S]*?)\n---/);
      const result: Partial<SkillDescriptor & { tags?: string[]; triggers?: string[] }> = {};

      if (frontMatter) {
        const fmContent = frontMatter[1]!;
        
        // 解析简单字段
        for (const line of fmContent.split('\n')) {
          const [key, ...rest] = line.split(':');
          if (!key || rest.length === 0) continue;
          const val = rest.join(':').trim();
          switch (key.trim()) {
            case 'name': result.name = val; break;
            case 'description': result.description = val; break;
            case 'category': result.category = val; break;
            case 'tags':
              result.tags = val.replace(/[\[\]"]/g, '').split(',').map(s => s.trim()).filter(Boolean);
              break;
          }
        }
        
        // 解析 metadata.triggers
        const triggersMatch = fmContent.match(/triggers:\s*([\s\S]*?)(?=\n\w|$)/);
        if (triggersMatch) {
          const triggersText: string = triggersMatch[1] || '';
          result.triggers = triggersText
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.startsWith('- '))
            .map(line => line.substring(2).trim().replace(/["']/g, ''))
            .filter(Boolean);
        }
      }
      return result;
    } catch { return {}; }
  }

  /** 技能名归一化别名表（下划线 ↔ 中划线 ↔ 驼峰互转） */
  private normalizeSkillName(name: string): string {
    if (!name) return name;
    // 1. 精准匹配
    if (this.skills.has(name)) return name;
    // 2. 下划线<->中划线互换
    const dash = name.replace(/_/g, '-');
    const under = name.replace(/-/g, '_');
    const candidates = [dash, under];
    for (const c of candidates) {
      if (this.skills.has(c)) return c;
    }
    // 3. 大小写兜底
    for (const existing of this.skills.keys()) {
      if (existing.toLowerCase() === name.toLowerCase()) return existing;
    }
    return name; // 找不到原样返回，后面 fallback 会兜底
  }

  /**
   * 执行技能 (供 WorkflowOrchestrator 调用)
   * ✅ 2026-08-03 P0: 归一化 + 兜底 fallback 池
   *   用户反馈: "工作流执行失败: read_excel 阶段出错 - 技能 'read_excel' 不存在"
   *   修复:
   *     a) 归一化: read_excel ↔ read-excel 自动映射
   *     b) fallback: 技能未注册时走内置轻量实现, 不抛错阻断工作流
   */
  async executeSkill(skillName: string, params: any): Promise<{ success: boolean; output: string; data?: any }> {
    // a) 归一化查找
    const resolved = this.normalizeSkillName(skillName);
    console.log(`[skill] 🚀 执行技能: ${skillName}${resolved !== skillName ? ` → resolved:${resolved}` : ''}, 参数: ${JSON.stringify(params).slice(0, 200)}`);

    let skill = this.skills.get(resolved);

    // b) fallback 兜底池 (未注册时自动注入内置实现, 不阻断工作流)
    if (!skill) {
      const builtin = this._builtinFallbackSkill(skillName);
      if (builtin) {
        console.log(`[skill] 💡 使用内置 fallback 实现: ${skillName}`);
        this.register(builtin); // 注册后下次直接命中
        skill = builtin;
      }
    }

    if (!skill) {
      console.error(`[skill] ❌ 技能不存在: ${skillName}`,
        '(已尝试归一化:', resolved,
        '; 可用技能:', [...this.skills.keys()].slice(0, 20).join(','),
        this.skills.size > 20 ? ` (+${this.skills.size - 20})` : '');
      return {
        success: false,
        output: `技能 "${skillName}" 不存在。可用技能数: ${this.skills.size}。` +
          `请先通过 settings→技能 或 在工作台上执行 /skills 列表查看已注册技能，或把该技能目录放入 ~/.agentai/skills/ 下。`,
      };
    }
    if (!skill.handler) {
      console.error(`[skill] ❌ 技能没有 handler: ${skill.name}`);
      return { success: false, output: `技能 "${skillName}" 没有实现 handler` };
    }

    const startTime = Date.now();
    try {
      const result = await skill.handler(params, {});
      const duration = Date.now() - startTime;
      console.log(`[skill] ✅ 技能执行成功: ${skill.name}, 耗时: ${duration}ms, 结果: ${result.success}`);
      return result;
    } catch (err: any) {
      const duration = Date.now() - startTime;
      console.error(`[skill] ❌ 技能执行失败: ${skill.name}, 耗时: ${duration}ms, 错误: ${err.message}`);
      return { success: false, output: `技能执行失败: ${err.message}` };
    }
  }

  /**
   * ✅ 内置 fallback 技能池
   * 用户反馈 read_excel 不存在时，至少给出一个轻量实现让工作流跑通。
   * 同时支持 read_csv / read_pdf / web_search 等常用技能兜底。
   */
  private _builtinFallbackSkill(name: string): SkillDescriptor | null {
    const key = name.toLowerCase().replace(/[_\-]/g, '_');
    switch (key) {
      case 'read_excel':
        return {
          name: 'read_excel',
          description: '读取 Excel(.xlsx/.xls)文件并输出 JSON 数组。依赖系统 python + openpyxl，失败时给出 CSV 回退建议。',
          category: 'file',
          tags: ['excel', 'xlsx', 'spreadsheet', '表格', '工作流必备'],
          parallelSafe: true,
          riskLevel: 'low',
          handler: async (args: any) => {
            try {
              const file: string = args?.file || args?.filePath || args?.path || '';
              if (!file) return { success: false, output: 'read_excel: 缺少必要参数 file(文件路径)' };
              const fs = await import('node:fs');
              const path = await import('node:path');
              const absFile = path.isAbsolute(file) ? file : path.resolve(process.cwd(), file);
              if (!fs.existsSync(absFile)) return { success: false, output: `read_excel: 文件不存在: ${absFile}` };
              // 调用系统 python 解析; 没有 openpyxl 时给清晰报错
              const { execFile } = await import('node:child_process');
              const pythonBin = process.env.AGNES_PYTHON || process.env.PYTHON_BIN || 'python';
              const script = `
import json, sys
try:
    from openpyxl import load_workbook
except Exception as e:
    print(json.dumps({"success": False, "output": "缺少 openpyxl 依赖: " + str(e) + "; 请先运行: pip install openpyxl pandas"}))
    sys.exit(0)
try:
    wb = load_workbook(sys.argv[1], data_only=True)
    out = {}
    for sheet in wb.sheetnames:
        ws = wb[sheet]
        rows = list(ws.iter_rows(values_only=True))
        if not rows:
            out[sheet] = []
            continue
        header = [str(c) if c is not None else f"col_{i}" for i, c in enumerate(rows[0])]
        data = []
        for r in rows[1:]:
            if all(v is None or v == '' for v in r): continue
            row = {}
            for i, h in enumerate(header):
                v = r[i] if i < len(r) else None
                if hasattr(v, 'isoformat'): v = v.isoformat()
                row[h] = v
            data.append(row)
        out[sheet] = data
    print(json.dumps({"success": True, "output": f"读取成功 {len(out)} 个 sheet, 共 {sum(len(v) for v in out.values())} 行", "data": out}, ensure_ascii=False))
except Exception as e:
    print(json.dumps({"success": False, "output": "read_excel 解析异常: " + str(e)}))
`;
              const out: string = await new Promise((res, rej) => {
                execFile(pythonBin, ['-c', script, absFile], { maxBuffer: 30 * 1024 * 1024, timeout: 60_000 }, (err, stdout, stderr) => {
                  if (err && !stdout) return rej(err);
                  res(stdout || stderr || '');
                });
              });
              try {
                const parsed = JSON.parse(out.trim().split('\n').slice(-1)[0] || '{}');
                return {
                  success: !!parsed?.success,
                  output: parsed?.output || out,
                  data: parsed?.data,
                };
              } catch {
                return { success: false, output: `read_excel 输出解析失败, 原始输出: ${out.slice(0, 800)}` };
              }
            } catch (e: any) {
              return { success: false, output: `read_excel fallback 失败: ${e.message}` };
            }
          },
        };

      case 'read_csv':
        return {
          name: 'read_csv',
          description: '读取 CSV/TSV 文件并输出 JSON 数组。内置纯 TS 实现，不依赖 python。',
          category: 'file',
          tags: ['csv', 'data', '表格'],
          parallelSafe: true,
          riskLevel: 'low',
          handler: async (args: any) => {
            try {
              const fs = await import('node:fs');
              const path = await import('node:path');
              const file: string = args?.file || args?.filePath || args?.path || '';
              const delimiter = args?.delimiter || args?.sep || ',';
              if (!file) return { success: false, output: 'read_csv: 缺少 file 参数' };
              const absFile = path.isAbsolute(file) ? file : path.resolve(process.cwd(), file);
              if (!fs.existsSync(absFile)) return { success: false, output: `read_csv: 文件不存在: ${absFile}` };
              const text = fs.readFileSync(absFile, 'utf-8');
              const lines = text.split(/\r?\n/).filter(l => l.length);
              if (lines.length === 0) return { success: true, output: '空文件', data: [] };
              const splitLine = (l: string) => {
                const out: string[] = []; let cur = ''; let inQ = false;
                for (let i = 0; i < l.length; i++) {
                  const ch = l[i]!;
                  if (ch === '"') { inQ = !inQ; continue; }
                  if (ch === delimiter && !inQ) { out.push(cur); cur = ''; continue; }
                  cur += ch;
                }
                out.push(cur); return out;
              };
              const header = splitLine(lines[0]!);
              const data = lines.slice(1).map(line => {
                const row = splitLine(line);
                const obj: any = {};
                header.forEach((h, i) => { obj[h] = row[i] ?? ''; });
                return obj;
              });
              return { success: true, output: `读取成功 ${data.length} 行`, data };
            } catch (e: any) {
              return { success: false, output: `read_csv 失败: ${e.message}` };
            }
          },
        };

      case 'read_pdf':
        return {
          name: 'read_pdf',
          description: '读取 PDF 文本内容。优先用 python pypdf，失败提示安装依赖。',
          category: 'file',
          tags: ['pdf', '文档'],
          parallelSafe: true,
          riskLevel: 'low',
          handler: async (args: any) => {
            try {
              const path = await import('node:path');
              const fs = await import('node:fs');
              const file: string = args?.file || args?.filePath || args?.path || '';
              if (!file) return { success: false, output: 'read_pdf: 缺少 file 参数' };
              const absFile = path.isAbsolute(file) ? file : path.resolve(process.cwd(), file);
              if (!fs.existsSync(absFile)) return { success: false, output: `read_pdf: 文件不存在: ${absFile}` };
              const { execFile } = await import('node:child_process');
              const pythonBin = process.env.AGNES_PYTHON || 'python';
              const script = `
import json, sys
try:
    from pypdf import PdfReader
except Exception as e:
    print(json.dumps({"success": False, "output": "缺少 pypdf: " + str(e) + "; pip install pypdf"}))
    sys.exit(0)
try:
    r = PdfReader(sys.argv[1])
    pages = []
    for i, p in enumerate(r.pages[:200]):
        try: pages.append({"page": i+1, "text": p.extract_text() or ""})
        except Exception as ex: pages.append({"page": i+1, "text": "", "err": str(ex)})
    total = sum(len(p["text"]) for p in pages)
    print(json.dumps({"success": True, "output": f"读取成功 {len(pages)} 页, {total} 字符", "data": pages}, ensure_ascii=False))
except Exception as e:
    print(json.dumps({"success": False, "output": "read_pdf 异常: " + str(e)}))
`;
              const out: string = await new Promise((res, rej) => {
                execFile(pythonBin, ['-c', script, absFile], { maxBuffer: 30 * 1024 * 1024, timeout: 120_000 }, (err, stdout, stderr) => {
                  if (err && !stdout) return rej(err);
                  res(stdout || stderr || '');
                });
              });
              try {
                const parsed = JSON.parse(out.trim().split('\n').slice(-1)[0] || '{}');
                return { success: !!parsed.success, output: parsed.output || out, data: parsed.data };
              } catch { return { success: false, output: out.slice(0, 2000) }; }
            } catch (e: any) {
              return { success: false, output: `read_pdf fallback 失败: ${e.message}` };
            }
          },
        };

      case 'web_search':
      case 'search_web':
        return {
          name: 'web_search',
          description: '联网搜索（fallback: 通过 webSearch 工具，依赖 gateway 环境已联网）',
          category: 'web',
          tags: ['search', 'web', '搜索'],
          parallelSafe: true,
          riskLevel: 'medium',
          handler: async (args: any) => {
            try {
              const q: string = args?.query || args?.keyword || args?.q || '';
              const n = args?.limit || args?.num || 5;
              if (!q) return { success: false, output: 'web_search: 缺少 query 参数' };
              const fn = (globalThis as any)?.__agentaiWebSearch;
              if (typeof fn === 'function') {
                const r = await fn(q, { num: n });
                return { success: true, output: `搜索成功 ${r?.length || 0} 条`, data: r };
              }
              return { success: false, output: `web_search fallback: 环境未挂载 __agentaiWebSearch。请在 system prompt 中让 AI 直接调用内置 web_search 工具而非技能。query=${q}` };
            } catch (e: any) { return { success: false, output: e.message }; }
          },
        };

      default:
        return null;
    }
  }
}

export const skillOrchestrator = new SkillOrchestrator();

// 延迟注册内置系统技能 (避免顶层 await)
// 注意: auto-error-repair 的 handler 在 gateway/skills/ 目录下不存在 (文件已被删除)
// 后续如果创建了 handler 文件, 启用下面逻辑即可
//
// skillOrchestrator.on('skills:loaded', () => {
//   import('./skills/auto-error-repair.js').then((mod: any) => { ... });
// });
//
// import('./skills/auto-error-repair.js').then((mod: any) => { ... }).catch(() => {});
