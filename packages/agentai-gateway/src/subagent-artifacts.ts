/**
 * subagent-artifacts — 子智能体「任务产物」落盘/读取/删除
 * ----------------------------------------------------------------
 * 2026-10-21 新增。
 *
 * 背景 (实锤事故):
 *   主 AI 被用户中断后, 子智能体**仍在跑**(子循环不继承 abortSignal, 现状即如此)。
 *   但它跑完的成果**无处可去**:
 *     · `_pendingSubagentResults` 只在「主循环发起下一次 LLM 调用前」被消费
 *       → 主循环已死 = 永远不消费 = 随 loop 实例一起被 GC
 *     · `subagent:done` 事件写向**已 res.end() 的 SSE 连接** → 被 catch 静默丢弃
 *   → 结论: 主任务一断, 子智能体就是纯烧 token, 成果全丢 (用户原话「不是白发了」)。
 *
 * 定位:
 *   子智能体是**独立任务单元** —— 它的产出是"产物"(artifact), 不依附于主对话的存活。
 *   落盘路径沿用项目既有惯例 (`persistent-memory.saveSessionSummary` 同款):
 *     {workspace}/.agentai/subagent-artifacts/{subId}.json
 *   按用户拍板: **不脱敏**, 全量原样落盘 (本地文件, 敏感性由用户自行掌握)。
 *
 * 写入时机: 子智能体 done/error 的**那一刻**立即写 (不依赖主循环存活)。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

/** 产物目录名 (位于 {workspace}/.agentai/ 下) */
const ARTIFACT_DIR = 'subagent-artifacts';

/** 单条过程记录 (思考 / 正文 / 工具调用) */
export interface ArtifactTranscriptEntry {
  /** thinking = 深度思考; text = 模型正文; tool = 工具调用 */
  kind: 'thinking' | 'text' | 'tool';
  /** 正文/思考内容; 工具调用时是描述 */
  text: string;
  /** 工具名 (kind==='tool' 时有值) */
  tool?: string;
  /** 相对时间戳 (ms, 从子任务启动算起) */
  t: number;
}

export interface SubagentArtifact {
  /** 子智能体 ID */
  id: string;
  /** 类型 (research / pentest_recon / explore ...) */
  type: string;
  /** 任务描述 */
  task: string;
  /** running | done | error */
  status: 'running' | 'done' | 'error';
  /** 最终结果 (done 时) */
  result?: string;
  /** 错误信息 (error 时) */
  error?: string;
  /** 完整过程 (思考 + 正文 + 工具调用) —— 治「黑箱」的关键 */
  transcript: ArtifactTranscriptEntry[];
  /** 工具调用次数 */
  toolCalls: number;
  /** 迭代轮数 */
  iterations?: number;
  /** 耗时 (ms) */
  durationMs?: number;
  /** 父会话 ID (用于唤醒续跑) */
  parentSessionId?: string;
  /** 工作区 */
  workspace: string;
  startedAt: number;
  finishedAt?: number;
  /** 最后更新时间 */
  updatedAt: number;
}

/** 产物根目录: {workspace}/.agentai/subagent-artifacts */
export function artifactsDir(workspace: string): string {
  return path.join(workspace || '.', '.agentai', ARTIFACT_DIR);
}

/** 单个产物文件路径 */
export function artifactPath(workspace: string, subId: string): string {
  // subId 来自内部生成, 但仍做文件名净化 —— 防止路径穿越。
  // ⚠️ 净化必须**连点号一起去**: 只把分隔符换成下划线的话, '../../evil' 会变成
  //   '.._.._evil' —— 虽然不再是路径穿越, 但仍是可疑文件名, 且在某些展开器里危险。
  //   这里把连续的点也压成下划线, 保证结果只含 [A-Za-z0-9._-] 且不含 '..'。
  const raw = String(subId || '').replace(/[^a-zA-Z0-9._-]/g, '_');
  const safe = raw.replace(/\.{2,}/g, '_').replace(/^\.+/, '_').slice(0, 120) || 'unknown';
  return path.join(artifactsDir(workspace), `${safe}.json`);
}

/**
 * 写产物 (原子写: 先写临时文件再 rename —— 避免读到半截 JSON)
 * 永不抛异常: 落盘失败不能拖垮子智能体主流程。
 */
export function saveArtifact(artifact: SubagentArtifact): boolean {
  try {
    const dir = artifactsDir(artifact.workspace);
    fs.mkdirSync(dir, { recursive: true });
    const target = artifactPath(artifact.workspace, artifact.id);
    const tmp = `${target}.tmp-${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(artifact, null, 2), 'utf8');
    fs.renameSync(tmp, target);
    return true;
  } catch (e: any) {
    console.warn('[subagent-artifacts] 写产物失败:', e?.message);
    return false;
  }
}

/** 读单个产物 */
export function loadArtifact(workspace: string, subId: string): SubagentArtifact | null {
  try {
    const p = artifactPath(workspace, subId);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as SubagentArtifact;
  } catch (e: any) {
    console.warn('[subagent-artifacts] 读产物失败:', e?.message);
    return null;
  }
}

/** 列出某工作区的全部产物 (按 startedAt 倒序) */
export function listArtifacts(workspace: string): SubagentArtifact[] {
  try {
    const dir = artifactsDir(workspace);
    if (!fs.existsSync(dir)) return [];
    const out: SubagentArtifact[] = [];
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')) as SubagentArtifact;
        if (raw && raw.id) out.push(raw);
      } catch { /* 跳过损坏文件 */ }
    }
    out.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
    return out;
  } catch (e: any) {
    console.warn('[subagent-artifacts] 列产物失败:', e?.message);
    return [];
  }
}

/** 删除单个产物 */
export function deleteArtifact(workspace: string, subId: string): boolean {
  try {
    const p = artifactPath(workspace, subId);
    if (!fs.existsSync(p)) return false;
    fs.unlinkSync(p);
    return true;
  } catch (e: any) {
    console.warn('[subagent-artifacts] 删产物失败:', e?.message);
    return false;
  }
}

/** 追加一条过程记录到产物 (子智能体运行中实时写, 供「黑箱可见」与断电兜底) */
export function appendTranscript(
  workspace: string,
  subId: string,
  entry: ArtifactTranscriptEntry,
  extra?: Partial<SubagentArtifact>,
): void {
  try {
    const existing = loadArtifact(workspace, subId);
    const now = Date.now();
    let base: SubagentArtifact = existing || {
      id: subId,
      type: extra?.type || 'unknown',
      task: extra?.task || '',
      status: 'running',
      transcript: [],
      toolCalls: 0,
      workspace,
      startedAt: now,
      updatedAt: now,
    };
    base.transcript = [...(base.transcript || []), entry];
    if (entry.kind === 'tool') base.toolCalls = (base.toolCalls || 0) + 1;
    if (extra) base = { ...base, ...extra, updatedAt: now };
    else base.updatedAt = now;
    saveArtifact(base);
  } catch (e: any) {
    console.warn('[subagent-artifacts] 追加过程失败:', e?.message);
  }
}
