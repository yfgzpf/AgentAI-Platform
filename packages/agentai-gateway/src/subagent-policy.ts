/**
 * subagent-policy — 子智能体委托策略 (代码闸门)
 * ----------------------------------------------------------------
 * 2026-10-21 新增。
 *
 * 富哥拍板 (2026-10-21):
 *   「做赏金任务要不要子智能体其实没什么用, 其它长任务是可以用的,
 *     我给它讲不要发子智能体了」—— 提示词层面对模型只是"建议",
 *   模型不听话时没有任何兜底。本模块把这句话变成**代码闸门**。
 *
 * 实证事故: F:\挖洞赏金 工作区, AI 在赏金任务里随手派了 pentest_recon
 *   子智能体 → 独立上下文丢失父任务的授权范围/已有发现 → 模型层空转
 *   撞失败上限 → 主任务被打断、成果无人认领。赏金/渗透是**主智能体
 *   串行推进**的活: 上下文连续、节奏不拖、scope 不丢。
 *
 * 策略:
 *   ① type 以 pentest 开头        → 禁 (AI 随手派四角色)
 *   ② 工作区路径命中赏金/渗透关键词 → 禁 (整间屋子都是赏金活)
 *   ③ 其它 (research/explore/通用长任务) → 放行
 *
 * ⚠️ 两条边界 (富哥 2026-10-21 拍板):
 *   · pentest_pipeline 工具**不受限** —— 那是显式编排链
 *     (planner→recon→exploit→validator), 它直接调 runSubagent,
 *     不走本闸门的两个执行点 (内联 spawn / spawn_subagent handler)。
 *   · **不做 task 文本匹配** —— "修复登录漏洞"这类开发任务会误伤,
 *     宁可漏放 (模型层还有提示词双保险) 不可错杀。
 */

export interface SpawnPolicyInput {
  /** 子智能体类型 (research / pentest_recon / explore / battle ...) */
  type?: string;
  /** 任务描述 (仅用于日志, 不参与判定) */
  task?: string;
  /** 工作区绝对路径 */
  workspace?: string;
}

export interface SpawnPolicyResult {
  allowed: boolean;
  /** 命中哪条规则 (blocked 时有值) */
  rule?: 'pentest_type' | 'bounty_workspace';
  /** 给 AI 看的理由 + 替代路径 (blocked 时有值) */
  reason?: string;
}

/**
 * 赏金/渗透工作区特征。
 * 刻意不收 'src' (每个项目都有 src/) 与裸 '漏洞' (开发任务常说"修复漏洞")。
 */
const BOUNTY_WS_RE = /(赏金|挖洞|漏洞猎|渗透测试|渗透|hackerone|bug\s?bounty|bounty)/i;

/** 给 AI 的替代指引 (blocked 时随理由一起返回) */
const ALT_GUIDE = '请主智能体自行串行推进 (上下文连续/scope 不丢); '
  + '批量目标用 batch_pentest, 深度串链用 pentest_pipeline (planner→recon→exploit→validator 显式编排)。';

/**
 * 工作区是否是赏金/渗透专用 (供 agentai-loop 的工具下发判断用:
 *   赏金工作区 = security 上下文, 与 taskType 棘轮解耦 —— 后者会被
 *   "改一下这个脚本" 这类消息打落成 coding, 连带渗透工具全被滤掉)。
 */
export function isBountyWorkspace(workspace: string | undefined | null): boolean {
  const ws = String(workspace || '');
  return !!ws && BOUNTY_WS_RE.test(ws);
}

export function checkSubagentSpawnPolicy(input: SpawnPolicyInput): SpawnPolicyResult {
  const type = String(input.type || '').trim();

  // ① AI 随手派渗透角色 → 禁
  if (/^pentest/i.test(type)) {
    return {
      allowed: false,
      rule: 'pentest_type',
      reason: `❌ 赏金/渗透任务禁止派子智能体 (type=${type})。`
        + `子智能体是独立上下文, 会丢失父任务的授权范围与已有发现, 且该类任务模型层容易空转。`
        + ALT_GUIDE,
    };
  }

  // ② 赏金/渗透专用工作区 → 禁 (不论 type)
  const ws = String(input.workspace || '');
  if (ws && BOUNTY_WS_RE.test(ws)) {
    return {
      allowed: false,
      rule: 'bounty_workspace',
      reason: `❌ 当前工作区是赏金/渗透专用 (${ws}) — 该类任务禁止派子智能体。`
        + ALT_GUIDE,
    };
  }

  // ③ 放行
  return { allowed: true };
}
