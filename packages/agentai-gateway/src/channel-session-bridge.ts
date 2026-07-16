/**
 * ChannelSessionBridge — 渠道身份映射器
 * ==================================================================
 * 解决问题: QQ/微信消息创建独立 session, 与 Web 对话上下文隔离
 *
 * 三种模式:
 *   bridge    — 外部渠道消息复用 Web 当前对话 session (上下文同步)
 *   standalone— 外部渠道独立 session (原行为, 隔离)
 *   auto      — 首次创建映射后后续复用 (默认)
 *
 * 数据流:
 *   QQ openid → bridge.resolve() → 统一 sessionId → /v1/chat
 *   微信 userId → bridge.resolve() → 统一 sessionId → /v1/chat
 *
 * 存储: ~/.agentai/channel-bridge.json (原子写入)
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// ===== 类型定义 =====

export type ChannelType = 'qq' | 'wechat' | 'web' | 'phone';
export type BridgeMode = 'bridge' | 'standalone' | 'auto';

export interface ChannelMapping {
  /** 渠道类型 */
  channel: ChannelType;
  /** 渠道内唯一标识 (QQ openid / 微信 userId / web sessionId) */
  channelId: string;
  /** 映射到的统一 sessionId (与 Gateway sessionKey 关联) */
  unifiedSessionId: string;
  /** 显示名 (QQ昵称/微信名) */
  label?: string;
  /** 绑定的客户ID (Phase B 客户跟踪) */
  customerId?: string;
  /** 创建时间 */
  boundAt: number;
  /** 最后活跃时间 */
  lastActiveAt: number;
  /** 消息计数 */
  messageCount: number;
}

interface BridgeData {
  mappings: Record<string, ChannelMapping>;  // key: `${channel}:${channelId}`
  /** Web 当前活跃 sessionId (bridge 模式时使用) */
  webActiveSessionId: string | null;
  mode: BridgeMode;
  updatedAt: number;
}

// ===== 持久化 =====

const BRIDGE_DIR = path.join(os.homedir(), '.agentai');
const BRIDGE_FILE = path.join(BRIDGE_DIR, 'channel-bridge.json');

let _cache: BridgeData | null = null;

function load(): BridgeData {
  if (_cache) return _cache;
  try {
    if (fs.existsSync(BRIDGE_FILE)) {
      const raw = fs.readFileSync(BRIDGE_FILE, 'utf-8');
      _cache = JSON.parse(raw);
    } else {
      _cache = { mappings: {}, webActiveSessionId: null, mode: 'auto', updatedAt: Date.now() };
    }
  } catch {
    _cache = { mappings: {}, webActiveSessionId: null, mode: 'auto', updatedAt: Date.now() };
  }
  return _cache!;
}

function save(): void {
  const data = load();
  data.updatedAt = Date.now();
  try {
    if (!fs.existsSync(BRIDGE_DIR)) fs.mkdirSync(BRIDGE_DIR, { recursive: true });
    // 原子写入: 写临时文件 → rename
    const tmp = BRIDGE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmp, BRIDGE_FILE);
  } catch (e: any) {
    console.warn('[channel-bridge] save failed:', e?.message);
  }
}

function mappingKey(channel: ChannelType, channelId: string): string {
  return `${channel}:${channelId}`;
}

// ===== 核心 API =====

/**
 * 解析渠道身份 → 统一 sessionId
 *
 * @param channel  渠道类型
 * @param channelId 渠道内唯一标识
 * @param opts     可选: 指定模式 / 强制创建新映射 / 指定 unifiedSessionId
 * @returns 统一 sessionId (用于 /v1/chat 的 userId 参数)
 */
export function resolve(
  channel: ChannelType,
  channelId: string,
  opts?: {
    mode?: BridgeMode;
    /** 指定要桥接到的 sessionId (bridge 模式必填) */
    targetSessionId?: string;
    /** 显示名 */
    label?: string;
  },
): string {
  const data = load();
  const key = mappingKey(channel, channelId);
  const mode = opts?.mode || data.mode;

  // 查找已有映射
  const existing = data.mappings[key];
  if (existing && mode !== 'bridge') {
    // auto / standalone 模式: 复用已映射的 sessionId
    existing.lastActiveAt = Date.now();
    existing.messageCount++;
    if (opts?.label) existing.label = opts.label;
    save();
    return existing.unifiedSessionId;
  }

  // bridge 模式: 总是使用指定的 targetSessionId 或 webActiveSessionId
  if (mode === 'bridge') {
    const target = opts?.targetSessionId || data.webActiveSessionId;
    if (target) {
      // 更新或创建映射
      data.mappings[key] = {
        channel,
        channelId,
        unifiedSessionId: target,
        label: opts?.label,
        boundAt: existing?.boundAt || Date.now(),
        lastActiveAt: Date.now(),
        messageCount: (existing?.messageCount || 0) + 1,
      };
      save();
      return target;
    }
    // 没有可用的 web sessionId, 降级为 auto
  }

  // auto 模式: 首次创建新映射, 后续复用
  if (mode === 'auto' && existing) {
    existing.lastActiveAt = Date.now();
    existing.messageCount++;
    save();
    return existing.unifiedSessionId;
  }

  // 创建新映射 (auto 首次 / standalone)
  const unifiedSessionId = opts?.targetSessionId || generateUnifiedSessionId(channel, channelId);
  data.mappings[key] = {
    channel,
    channelId,
    unifiedSessionId,
    label: opts?.label,
    boundAt: Date.now(),
    lastActiveAt: Date.now(),
    messageCount: 1,
  };
  save();
  return unifiedSessionId;
}

/**
 * 设置 Web 当前活跃 sessionId (供 bridge 模式使用)
 */
export function setWebActiveSession(sessionId: string): void {
  const data = load();
  data.webActiveSessionId = sessionId;
  save();
}

/**
 * 获取渠道映射信息 (用于前端显示来源)
 */
export function getMapping(channel: ChannelType, channelId: string): ChannelMapping | null {
  const data = load();
  return data.mappings[mappingKey(channel, channelId)] || null;
}

/**
 * 根据统一 sessionId 反查所有渠道身份
 */
export function getChannelsBySession(unifiedSessionId: string): ChannelMapping[] {
  const data = load();
  return Object.values(data.mappings).filter(m => m.unifiedSessionId === unifiedSessionId);
}

/**
 * 设置桥接模式
 */
export function setMode(mode: BridgeMode): void {
  const data = load();
  data.mode = mode;
  save();
}

/**
 * 获取当前模式
 */
export function getMode(): BridgeMode {
  return load().mode;
}

/**
 * 绑定客户ID到渠道映射 (Phase B 客户跟踪)
 */
export function bindCustomer(channel: ChannelType, channelId: string, customerId: string): void {
  const data = load();
  const key = mappingKey(channel, channelId);
  const mapping = data.mappings[key];
  if (mapping) {
    mapping.customerId = customerId;
    save();
  }
}

/**
 * 列出所有映射 (调试/管理用)
 */
export function listMappings(): ChannelMapping[] {
  return Object.values(load().mappings).sort((a, b) => b.lastActiveAt - a.lastActiveAt);
}

/**
 * 删除映射 (解绑渠道)
 */
export function removeMapping(channel: ChannelType, channelId: string): boolean {
  const data = load();
  const key = mappingKey(channel, channelId);
  if (data.mappings[key]) {
    delete data.mappings[key];
    save();
    return true;
  }
  return false;
}

// ===== 工具函数 =====

function generateUnifiedSessionId(channel: ChannelType, channelId: string): string {
  // 格式: unified-{channel}-{shortHash}
  const hash = channelId.length > 8
    ? channelId.slice(0, 4) + channelId.slice(-4)
    : channelId;
  return `unified-${channel}-${hash}`;
}
