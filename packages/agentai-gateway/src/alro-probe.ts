/**
 * ALRO (alro.huazhiweilai.com) 分组权限探测 —— 纯函数, 可单测。
 * ==================================================================
 * 背景: ALRO 把模型按类别授权到令牌。历史上本项目的代码用 6 个分组密钥
 * (FACTORY_CHAT/GPT/CLAUDE/GROK/IMAGE/VIDEO_KEY) 分发, 但 ALRO 后来已合并为
 * 「全权限单令牌」。厂家改分组 / 旧令牌过期时, 调用会**静默 403**, 且错误被
 * 吞成"模型暂时繁忙", 用户完全不知道是哪个类别、哪个 env 变量要改。
 *
 * 本模块在网关启动 / 重校验时, 对每个类别发一次极小请求 (max_tokens=1),
 * 直接报告 ✅/❌, 让"厂家改来改去"一眼可见。
 *
 * 设计为纯函数: 不碰 process.env、不抛异常, 便于单测与在别处复用。
 */

export interface AlroProbeEntry {
  /** 类别中文名 (日志展示) */
  category: string;
  /** 该类别优先使用的分组密钥 env 名 */
  envVar: string;
  /** 用于探测的上游真实模型名 (必须存在于 ALRO 模型广场) */
  subModel: string;
  /**
   * 非空 = 不自动探测的原因 (2026-10-20)。
   *
   * 起因 (用户实锤): 图片/视频端点 `{base}/images/generations` 与 `{base}/video/generations`
   * **一调就创建真实任务并计费**, 用它们做启动探测 = 每次重启都花钱。
   * 而旧实现在文本端点 (chat/completions) 上探测图片/视频, 报出来的
   * "❌ 视频 403 无权限" 完全是误导 —— 那是**文本分组**的权限, 与视频渠道无关。
   * 实测真相: 该令牌的 default 分组**根本没有图片/视频分发渠道**
   * (4 个 seedance 变体全 503 "No available channel for model X under group default"),
   * 而文本对话正常。
   *
   * 所以: 图像/视频一律**不自动探测**(省钱且不误导), 改为给出可复制的手动验证命令。
   */
  skipReason?: string;
}

/** 6 个类别的代表模型, 与 factory-registry.ts 的 groupEnv 分组一一对应 */
export const ALRO_PROBE_MODELS: AlroProbeEntry[] = [
  { category: '国内·对话', envVar: 'FACTORY_CHAT_KEY',   subModel: 'deepseek-flash' },
  { category: 'GPT',       envVar: 'FACTORY_GPT_KEY',    subModel: 'gpt-5.5' },
  { category: 'Claude',    envVar: 'FACTORY_CLAUDE_KEY', subModel: 'claude-haiku-4-5-20250101' },
  { category: 'Grok',      envVar: 'FACTORY_GROK_KEY',   subModel: 'grok-4.5' },
  {
    category: '生图', envVar: 'FACTORY_IMAGE_KEY', subModel: 'nano-banana',
    skipReason: '图片端点一调即创建计费任务, 不自动探测 (否则每次重启都花钱)',
  },
  {
    category: '视频', envVar: 'FACTORY_VIDEO_KEY', subModel: 'doubao-seedance-2.5',
    skipReason: '视频端点一调即创建计费任务, 不自动探测 (否则每次重启都花钱)',
  },
];

export type AlroProbeResultStatus = 'ok' | 'no-key' | 'forbidden' | 'error' | 'other' | 'skipped';

export interface AlroProbeResult {
  category: string;
  subModel: string;
  status: AlroProbeResultStatus;
  httpStatus?: number;
  detail?: string;
}

export interface ProbeAlroOptions {
  baseUrl: string;
  /** 按 env 名取密钥 (模拟路由解析: 分组密钥优先, 缺失回退主令牌) */
  resolveKey: (envVar: string) => string | undefined;
  /** 主令牌 (ALRC_API_KEY), 分组密钥缺失时回退 */
  masterKey?: string;
  /** 注入 fetch (测试用), 默认全局 fetch */
  fetchImpl?: typeof fetch;
  /** 单请求超时 ms, 默认 6000 */
  timeoutMs?: number;
}

/**
 * 探测 ALRO 各分组的实际可调用性。
 * 不抛异常 —— 任何错误都归为 'error' 返回, 保证网关启动不被阻塞。
 */
export async function probeAlroAccess(opts: ProbeAlroOptions): Promise<AlroProbeResult[]> {
  const base = (opts.baseUrl || 'https://alro.huazhiweilai.com/v1').replace(/\/+$/, '');
  const fetchImpl: typeof fetch = opts.fetchImpl ?? ((...args: any[]) => (globalThis as any).fetch(...args));
  const timeoutMs = opts.timeoutMs ?? 6000;

  const tasks = ALRO_PROBE_MODELS.map(async (entry): Promise<AlroProbeResult> => {
    // 2026-10-20: 创建计费任务的端点一律不自动探测 (省钱 + 不给误导结论)
    if (entry.skipReason) {
      return {
        category: entry.category,
        subModel: entry.subModel,
        status: 'skipped',
        detail: entry.skipReason,
      };
    }
    const key = opts.resolveKey(entry.envVar) || opts.masterKey;
    if (!key) {
      return {
        category: entry.category,
        subModel: entry.subModel,
        status: 'no-key',
        detail: `${entry.envVar} 与 ALRC_API_KEY 均空`,
      };
    }
    try {
      const res = await fetchImpl(`${base}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: entry.subModel,
          messages: [{ role: 'user', content: 'ping' }],
          stream: false,
          max_tokens: 1,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      } as any);

      if (res.status === 200) {
        return { category: entry.category, subModel: entry.subModel, status: 'ok', httpStatus: 200 };
      }
      if (res.status === 403) {
        const txt = await res.text().catch(() => '');
        return {
          category: entry.category,
          subModel: entry.subModel,
          status: 'forbidden',
          httpStatus: 403,
          detail: txt.slice(0, 120),
        };
      }
      const txt = await res.text().catch(() => '');
      return {
        category: entry.category,
        subModel: entry.subModel,
        status: 'other',
        httpStatus: res.status,
        detail: txt.slice(0, 120),
      };
    } catch (e: any) {
      return {
        category: entry.category,
        subModel: entry.subModel,
        status: 'error',
        detail: String(e?.message || e).slice(0, 80),
      };
    }
  });

  return Promise.all(tasks);
}

/**
 * 汇总 ALRO 分组 403, 生成「同源合并」提示文案。
 * 关键场景: 用户只有一把 domestic-only 令牌时, 5 个类别全部 403 且 detail
 * 都是「无权访问 国内模型 分组」—— 这说明**只需一把全权限 ALRC_API_KEY**,
 * 不是缺 5 把分组密钥。合并成一行避免用户误判。
 * 纯函数, 可单测。返回 null 表示没有 forbidden。
 */
export function summarizeAlroForbidden(results: AlroProbeResult[]): string | null {
  const forbids = results.filter((r) => r.status === 'forbidden');
  if (forbids.length === 0) return null;

  // 同源判定: 所有 forbidden 的 detail 都提到「分组」(即 ALRO 仍按分组鉴权)
  const allGrouped = forbids.every((r) => /分组/.test(r.detail || ''));
  if (allGrouped && forbids.length >= 2) {
    const cats = forbids.map((r) => r.category).join('/');
    return (
      `⚠️ ALRO 有 ${forbids.length} 个类别 403 无权限, 且全部来自同一把 domestic 令牌 ` +
      `(detail 均含"分组"): ${cats}。\n` +
      `    你只需一把「全权限」ALRC_API_KEY 令牌即可通全部模型 —— ` +
      `当前令牌仅挂"国内模型"分组, GPT/Claude/Grok/生图/视频 均被拒。\n` +
      `    去 ALRO 令牌管理重新生成全权限令牌, 填 ALRC_API_KEY, 其余 FACTORY_*_KEY 留空 (网关自动回退主令牌)。`
    );
  }
  return (
    `⚠️ ALRO 有 ${forbids.length} 个类别 403 无权限: ` +
    `${forbids.map((r) => r.category).join('/')} — 去 ALRO 重新生成全权限令牌并填 ALRC_API_KEY`
  );
}

/** 把探测结果渲染成日志行 (供网关复用, 也便于测试断言) */
export function formatAlroProbeLog(results: AlroProbeResult[], base = 'https://alro.huazhiweilai.com/v1'): string[] {
  const baseForHint = base.replace(/\/+$/, '');
  return results.map((r) => {
    switch (r.status) {
      case 'ok':
        return `  ✅ ${r.category} (${r.subModel})`;
      case 'forbidden':
        return `  ❌ ${r.category} (${r.subModel}) 403 无权限 — 令牌缺该分组, 去 ALRO 重新生成全权限令牌或填 ALRC_API_KEY; ${r.detail || ''}`.trim();
      case 'no-key':
        return `  ➖ ${r.category} 未配置密钥 (${r.detail || ''})`;
      case 'skipped':
        // 不给 ✅/❌ 结论 (探不了就是探不了), 附手动验证命令
        return `  ⏭️ ${r.category} (${r.subModel}) 未自动探测 — ${r.detail || ''}`
          + `\n       手动验证(会创建计费任务, 确认渠道是否开通): `
          + `curl -X POST ${baseForHint}/video/generations -H "Authorization: Bearer $ALRC_API_KEY" `
          + `-H "Content-Type: application/json" -d '{"model":"${r.subModel}","prompt":"probe"}'`
          + `\n       (生图把路径换成 /images/generations; 报 "No available channel" = 该分组未开通此模型渠道)`;
      case 'error':
        return `  ⚠️ ${r.category} 探测失败: ${r.detail || ''}`;
      default:
        return `  ⚠️ ${r.category} HTTP ${r.httpStatus ?? '?'} ${r.detail || ''}`.trim();
    }
  });
}
