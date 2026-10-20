/**
 * 消息处理工具函数 — 从 agentai-loop.ts 提取
 * 
 * 包含:
 *   - consolidateSystemInjections: 合并连续 [SYSTEM] 注入消息
 *   - sanitizeToolMessages: 清洗工具消息确保 OpenAI 协议合规
 * 
 * 原位置: agentai-loop.ts 行 ~131-174, 270-302
 * 提取理由: 纯函数，无 this 依赖，置信度 95%+
 */

import type { ChatMessage } from './llm-router.js';

/**
 * 从 string / 结构化 content 中提取纯文本 (2026-10-21)
 * ============================================================================
 * 事故: 任务隔离用 `typeof userMessage === 'string'` 判断, 遇到多模态/结构化
 * 消息时得到空串 → 含"继续/上次"的消息也被判成"新任务" → 跳过进度注入。
 * 统一从这里取文本, 不再各处手写 typeof 判断。
 */
export function extractMessageText(content: any): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((b: any) => b && b.type === 'text')
      .map((b: any) => String(b.text || ''))
      .join('\n')
      .trim();
  }
  if (content && typeof content === 'object' && typeof content.content === 'string') {
    return content.content;
  }
  return '';
}

/**
 * P0-1.3: 合并连续的 [SYSTEM] 注入消息
 * 多个模块可能在一轮中各推一条 [SYSTEM] 指令, 弱模型容易迷失
 * 此函数将连续的 [SYSTEM] 消息合并为一条, 保留最关键信息
 */
export function consolidateSystemInjections(messages: ChatMessage[]): ChatMessage[] {
  if (messages.length <= 1) return messages;
  const result: ChatMessage[] = [];
  let pendingSystem: string[] = [];

  const flushPending = () => {
    if (pendingSystem.length === 0) return;
    if (pendingSystem.length === 1) {
      result.push({ role: 'user', content: pendingSystem[0]! });
    } else {
      // 多条合并: 保留含 [CRITICAL]/[P0] 标记的安全指令, 其余只保留最后一条
      const critical = pendingSystem.filter(s => /\[CRITICAL\]|\[P0\]/i.test(s));
      const latest = pendingSystem[pendingSystem.length - 1]!;
      if (critical.length > 0 && !critical.includes(latest)) {
        const merged = critical.join('\n---\n') + '\n---\n' + latest;
        result.push({ role: 'user', content: merged.slice(0, 3000) });
      } else if (critical.length > 0) {
        result.push({ role: 'user', content: critical.join('\n---\n').slice(0, 3000) });
      } else {
        result.push({ role: 'user', content: latest });
      }
    }
    pendingSystem = [];
  };

  for (const msg of messages) {
    const content = typeof msg.content === 'string' ? msg.content : '';
    const isSystemInjection = msg.role === 'user' && content.startsWith('[SYSTEM]');
    if (isSystemInjection) {
      pendingSystem.push(content);
    } else {
      flushPending();
      result.push(msg);
    }
  }
  flushPending();

  return result;
}

const orphanToolToSystem = (msg: ChatMessage): ChatMessage => {
  const anyMsg = msg as any;
  const toolName = anyMsg.name || 'unknown';
  const content = typeof anyMsg.content === 'string' ? anyMsg.content : JSON.stringify(anyMsg.content ?? '');
  return { role: 'system', content: `[tool-result:${toolName}] ${content}` } as ChatMessage;
};

/**
 * 2026-10-20 G2/G3: 平台级敏感**写**路径谓词 — 与沙箱开关/运行模式无关, 压过用户自定义规则。
 *
 * G2 — `.agentai/scope.json` (授权**生效**文件):
 *   pentest-scope-guard.ts:64-65 的设计意图是「AI 只能 proposeScope(写 pending),
 *   生效必须走人类确认端点」。实锤: write_file 直写生效格式可自我授权
 *   (evil.com 从拒绝变放行, 全程免审批 + auto 模式自动放行)。
 *   `scope-pending.json` 是 AI 的合法提案通道, 刻意不拦。
 * G3 — 凭证文件/目录: `.env*` (`.env.example` 模板除外) + 凭证目录名单
 *   (与 tools.ts SENSITIVE_READ_PATHS 同名单扩展到写侧; 默认配置沙箱未启用时,
 *   .env 写入原本零防护)。
 *
 * 精确匹配原则 (任务丝滑性): 只拦上述真敏感目标 — `.agentai/backups/*.bak`、
 * workspace 日常 .md/.txt/.ts 零误伤; save_api_key 走 cwd/.env 且不经 sandboxGuard, 不受影响。
 */
export function isPlatformProtectedWritePath(p: string): boolean {
  if (!p) return false;
  const norm = String(p).replace(/\\/g, '/').toLowerCase();
  // G2: 授权生效文件 — 精确到文件名 (排除 scope-pending.json / backups)
  if (/\/\.agentai\/scope\.json$/.test(norm)) return true;
  // G3: 凭证文件 — .env / .env.local / .env.production ... (.env.example 模板除外)
  const base = norm.split('/').pop() || '';
  if (base === '.env' || (base.startsWith('.env.') && base !== '.env.example')) return true;
  // G3: 凭证目录 (与 READ 侧同名单, 写侧对称保护)
  return [
    '/.ssh/', '/.gnupg/', '/.aws/', '/.azure/', '/.kube/', '/.docker/',
    '/.config/gcloud/', '/.config/gh/',
    '/.npmrc', '/.pypirc', '/.netrc', '/.git-credentials',
    '/login data', '/cookies.sqlite', '/logins.json', '/key3.db', '/key4.db',
  ].some(b => norm.includes(b));
}

/**
 * 判定错误文本中是否出现指定的 HTTP 状态码。
 *
 * ⚠️ 2026-10-20 实锤事故: llm-router 的 _isAccountError 用**裸数字** /402|401/
 *   判账号级失败, deepseek 一次普通 400 (请求格式错误: 重复 tool_call_id) 的
 *   request_id "49ffb34a-34ca-40d2-a25a-77c53401727f" 恰好含 "401" 子串
 *   → 被误判账号级失败 → 跳过救援链 → 整个任务直接收尾 (用户实机日志)。
 *   UUID / request_id / hash / 时间戳 / 端口号都是裸状态码的雷区。
 *
 * 因此: 状态码判定必须带上下文锚点 —
 *   ① "HTTP 401" / "HTTP/1.1 429" / "http_status=503" 协议行文
 *   ② "code": 401 / "status": 403 结构化字段
 * 只匹配 codes 列表中的值, 其余形态一律不认。
 */
export function textHasStatus(text: string | undefined | null, ...codes: number[]): boolean {
  if (!text || codes.length === 0) return false;
  const s = String(text);
  const alt = codes.join('|');
  return new RegExp(`HTTP(?:/[\\d.]+)?[ _/]?\\b(?:${alt})\\b`, 'i').test(s)
    || new RegExp(`["']?(?:code|status|statusCode)["']?\\s*[:=]\\s*["']?(?:${alt})\\b`, 'i').test(s);
}

/**
 * 消毒消息数组: 保证 assistant(tool_calls) 与紧随其后的 tool 消息**逐 id 一一配对**
 *
 * OpenAI/DeepSeek 协议要求: assistant 消息里每个 tool_call_id, 后续都必须有对应的
 * tool 消息回复; 少一个就整体 400:
 *   "An assistant message with 'tool_calls' must be followed by tool messages
 *    responding to each 'tool_call_id'. (insufficient tool messages following tool_calls message)"
 *
 * ⚠️ 2026-10-11 修复真实 400 事故:
 *   原实现只做「孤立 tool 消息降级」, **从不修剪 assistant 侧的 tool_calls**。
 *   上下文压缩 / token 截断 / 救援降级后, 只要某个 assistant 的 N 个 tool_calls
 *   里有 **部分**(而非全部) tool 回复被丢掉, 就会残留 N 个 id 只配到 M<N 条 tool,
 *   上游直接 400, 且重试是确定性重放 → 3 次全挂。
 *   现在改为: 只保留「确有对应 tool 回复」的 tool_calls, 未配对的一律剔除;
 *   若一个都没配上则整个 tool_calls 摘除(assistant 文本仍保留)。
 */
export function sanitizeToolMessages(messages: ChatMessage[]): ChatMessage[] {
  const result: ChatMessage[] = [];
  let i = 0;

  while (i < messages.length) {
    const m = messages[i] as any;

    if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
      // 收集紧随其后的连续 tool 消息 (协议要求 tool 必须紧跟在 assistant(tool_calls) 之后)
      const toolById = new Set<string>();
      let j = i + 1;
      while (j < messages.length && (messages[j] as any).role === 'tool') {
        const tcId = (messages[j] as any).tool_call_id;
        if (tcId) toolById.add(tcId);
        j++;
      }

      // 只保留有对应 tool 回复的 tool_calls
      const keptCalls = m.tool_calls.filter((tc: any) => tc.id && toolById.has(tc.id));

      if (keptCalls.length === m.tool_calls.length) {
        result.push(messages[i]);
      } else if (keptCalls.length > 0) {
        // 部分配对: 修剪 tool_calls 至已回复的子集 (这是原实现漏掉的 400 根因)
        result.push({ ...m, tool_calls: keptCalls } as ChatMessage);
      } else {
        // 一个都没配上 → 摘除整个 tool_calls; assistant 若还有正文则保留为普通消息
        const { tool_calls: _dropped, ...rest } = m;
        const hasText = typeof m.content === 'string' ? m.content.trim().length > 0 : !!m.content;
        if (hasText) result.push(rest as ChatMessage);
      }

      // 保留命中的 tool 消息; 未命中的降级为 system, 避免协议违规
      // ⚠️ 2026-10-20: 同一 tool_call_id 只保留**第一条** tool 回复。
      //   tool:result 双发 (dispatchToolCalls 与主循环两处 emit 互覆, 见记忆铁律)
      //   会让同一 id 出现两条 tool 消息; deepseek 对重复回复直接确定性 400:
      //   "Messages with role 'tool' must be a response to a preceding message
      //    with 'tool_calls'" (curl 实测复刻: 同 id 两条回复即触发)。
      //   原实现两条都放行 → 每次重试原样 400, 白烧 3 次 attempt。
      const _emittedIds = new Set<string>();
      for (let k = i + 1; k < j; k++) {
        const t = messages[k] as any;
        const tcId = t.tool_call_id;
        if (tcId && keptCalls.some((tc: any) => tc.id === tcId)) {
          if (_emittedIds.has(tcId)) continue; // 重复回复 → 丢弃 (协议只认一条)
          _emittedIds.add(tcId);
          result.push(messages[k]);
        } else {
          result.push(orphanToolToSystem(messages[k]!));
        }
      }
      i = j;
      continue;
    }

    if (m.role === 'tool') {
      // 前面没有 assistant(tool_calls) 的孤立 tool 消息 → 降级为 system 消息
      result.push(orphanToolToSystem(messages[i]!));
      i++;
      continue;
    }

    result.push(messages[i]!);
    i++;
  }

  return result;
}

/**
 * 工具结果「失败」判据 — 全系统唯一来源 (2026-10-20 P0)
 * =====================================================================
 * 事故 (富哥实锤, D1): scope/hook/审批三类拒绝的结果 (rejectedResults) 不带
 *   success 字段, output 又以 "[SCOPE REJECTED]"/"[BLOCKED BY HOOK]"/"[用户拒绝]"
 *   开头 —— 原判据只认 'Error:'/'[ERROR]' 前缀 + success===false, 三类全漏判 →
 *   ① 被记进 _toolCallHistory「成功池」→ grant_scope 授权后重发同命令被跨轮
 *     去重静默跳过 (人类授权被状态机废掉); ② 前端 ok:true 显示 ✅;
 *   ③ 失败计数被清零。node 字符级复刻实锤三条全判成功。
 *
 * 语义: 「没有成功执行」= 失败。拒绝/拦截/超时都算 —— 漏判「未执行」
 * 比漏判「失败」更危险, 因为它污染的是成功语义本身。
 */
export function isFailedToolOutput(output: string | undefined | null, success?: boolean): boolean {
  const o = output || '';
  return !o
    || o.startsWith('Error:')
    || o.startsWith('[ERROR]')
    || success === false
    || (o.length < 5 && /err|fail|null|undef/i.test(o))
    // 拒绝/拦截类: 安全闸门拒绝 / Hook 拦截 / 用户拒绝 / 超时硬闸门
    || /^\[(SCOPE REJECTED|BLOCKED BY HOOK|用户拒绝|TIMEOUT GATE)\]/.test(o);
}
