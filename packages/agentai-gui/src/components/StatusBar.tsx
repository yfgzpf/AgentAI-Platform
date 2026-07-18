/**
 * StatusBar — bottom status bar (P3-3: 透明度仪表盘升级)
 *   - Gateway 连接状态 (监听 GatewayFallback, 不自作 health check)
 *   - QQ/微信实时连接状态 (30s 轮询)
 *   - 音乐播放器
 *   - 当前模式指示
 *   - [P3-3] 透明度仪表盘: 置信度 / 意图 / token / 费用
 */
import React, { useState, useEffect, useCallback } from 'react';
import { Tooltip } from 'antd';
import { useModeStore, MODE_CONFIG } from '../store/modeStore';
import { VoiceWakeIndicator } from './VoiceWakeIndicator';
import { MusicPlayer } from './MusicPlayer';
import { gatewayFallback } from '../services/GatewayFallback';

type GwStatus = 'online' | 'offline' | 'checking';

/* ---- 连接状态定义 ---- */
interface QqStatus {
  online: boolean;
  lastSeen: number;
  messageCount: number;
  clientConnected: boolean;
}
interface WechatStatus {
  bound: boolean;
  accountId?: string;
  createdAt?: number;
}
type ConnStatus = 'connected' | 'disconnected' | 'checking';

/* ---- P3-3: 透明度仪表盘数据 ---- */
interface DashboardInfo {
  confidence?: number;      // 0-100
  intent?: string;          // 表面意图摘要
  planProgress?: string;    // 如 "2/5"
  tokens?: number;          // 当前对话 token 数
  cost?: string;            // 如 "$0.0023"
  model?: string;           // 当前模型名
}

export const StatusBar: React.FC = () => {
  const { mode } = useModeStore();
  const [gw, setGw] = useState<GwStatus>(gatewayFallback.currentStatus.toLowerCase() as GwStatus);
  const [musicOpen, setMusicOpen] = useState(false);
  const [musicPlaying, setMusicPlaying] = useState(false);
  const [showMusicTip, setShowMusicTip] = useState(false); // 首次启动音乐入口提示

  /* ---- QQ 状态 ---- */
  const [qq, setQq] = useState<ConnStatus>('checking');
  const [qqData, setQqData] = useState<QqStatus | null>(null);

  /* ---- 微信状态 ---- */
  const [wx, setWx] = useState<ConnStatus>('checking');
  const [wxData, setWxData] = useState<WechatStatus | null>(null);

  /* ---- P3-3: 仪表盘数据 ---- */
  const [dash, setDash] = useState<DashboardInfo>({});

  /* ---- Gateway 状态监听 GatewayFallback ---- */
  useEffect(() => {
    const unsub = gatewayFallback.onChange((s) => {
      setGw(s as GwStatus);
    });
    return () => { unsub(); };
  }, []);

  /* ---- P3-3: 监听 AI 透明度事件 ---- */
  useEffect(() => {
    const onConfidence = (e: CustomEvent) => {
      const val = e.detail?.score ?? e.detail?.confidence;
      if (typeof val === 'number') setDash(d => ({ ...d, confidence: Math.round(val * 100) }));
    };
    const onIntent = (e: CustomEvent) => {
      const intent = e.detail?.surfaceGoal || e.detail?.intent;
      if (intent) setDash(d => ({ ...d, intent: String(intent).slice(0, 20) }));
    };
    const onPlan = (e: CustomEvent) => {
      const completed = e.detail?.completed ?? 0;
      const total = e.detail?.total ?? 0;
      if (total > 0) setDash(d => ({ ...d, planProgress: `${completed}/${total}` }));
    };
    const onTokens = (e: CustomEvent) => {
      const tokens = e.detail?.tokens ?? e.detail?.total;
      if (typeof tokens === 'number') setDash(d => ({
        ...d,
        tokens,
        cost: e.detail?.cost ? `$${Number(e.detail.cost).toFixed(4)}` : d.cost,
      }));
    };
    const onModel = (e: CustomEvent) => {
      const model = e.detail?.model || e.detail?.modelName;
      if (model) setDash(d => ({ ...d, model: String(model).slice(0, 15) }));
    };

    window.addEventListener('agentai:confidence', onConfidence as EventListener);
    window.addEventListener('agentai:intent', onIntent as EventListener);
    window.addEventListener('agentai:plan-update', onPlan as EventListener);
    window.addEventListener('agentai:token-usage', onTokens as EventListener);
    window.addEventListener('agentai:model-changed', onModel as EventListener);
    return () => {
      window.removeEventListener('agentai:confidence', onConfidence as EventListener);
      window.removeEventListener('agentai:intent', onIntent as EventListener);
      window.removeEventListener('agentai:plan-update', onPlan as EventListener);
      window.removeEventListener('agentai:token-usage', onTokens as EventListener);
      window.removeEventListener('agentai:model-changed', onModel as EventListener);
    };
  }, []);

  /* ---- 工具轮询: QQ + 微信 (仅此两, Gateway 已由 GatewayFallback 接管) ---- */
  const poll = useCallback(() => {
    // QQ status
    setQq('checking');
    fetch('/v1/qq/status', { signal: AbortSignal.timeout(3000) })
      .then(r => r.json())
      .then(d => {
        setQqData(d);
        setQq(d.online ? 'connected' : 'disconnected');
      })
      .catch(() => { setQq('disconnected'); setQqData(null); });

    // WeChat status
    setWx('checking');
    fetch('/api/wechat/status', { signal: AbortSignal.timeout(3000) })
      .then(r => r.json())
      .then(d => {
        setWxData(d);
        setWx(d.bound ? 'connected' : 'disconnected');
      })
      .catch(() => { setWx('disconnected'); setWxData(null); });
  }, []);

  useEffect(() => {
    poll();
    // 轮询间隔: 30s 改为 60s (减少 LLM 阻塞时的误判)
    const timer = setInterval(poll, 60_000);
    return () => clearInterval(timer);
  }, [poll]);

  /* ---- 监听播放状态 → ♪ 图标动画 ---- */
  useEffect(() => {
    const handler = (e: CustomEvent) => {
      setMusicPlaying(e.detail?.playing === true);
    };
    window.addEventListener('agentai:music-state', handler as EventListener);
    return () => window.removeEventListener('agentai:music-state', handler as EventListener);
  }, []);

  /* ---- AI 触发音乐时自动弹出播放器 ---- */
  useEffect(() => {
    const handler = (e: CustomEvent) => {
      const { action } = e.detail || {};
      if (['play', 'show', 'load_free'].includes(action)) {
        setMusicOpen(true);
      }
    };
    window.addEventListener('agentai:music-action', handler as EventListener);
    return () => window.removeEventListener('agentai:music-action', handler as EventListener);
  }, []);

  /* ---- 启动时自动播放音乐 ---- */
  useEffect(() => {
    // 每次启动都自动加载免费音乐（用户可在设置中关闭）
    const autoPlayMusic = localStorage.getItem('agentai-music-autoplay-setting');
    if (autoPlayMusic !== 'false') {
      // 延迟 3 秒后自动加载免费音乐并播放
      setTimeout(() => {
        // 触发音乐播放器自动加载免费音乐
        window.dispatchEvent(new CustomEvent('agentai:music-action', {
          detail: { action: 'load_free' },
        }));
        // 显示音乐入口提示（仅在首次启动时显示）
        const hasShownTip = localStorage.getItem('agentai-music-tip-shown');
        if (!hasShownTip) {
          setShowMusicTip(true);
          setTimeout(() => setShowMusicTip(false), 5000);
          localStorage.setItem('agentai-music-tip-shown', 'true');
        }
      }, 3000);
    }
  }, []);

  /* ---- 渲染状态点 ---- */
  const statusDot = (state: ConnStatus, colorOnline: string) => {
    const color = state === 'connected' ? colorOnline
      : state === 'disconnected' ? 'var(--danger)'
      : 'var(--muted)';
    return (
      <span style={{
        width: 6, height: 6, borderRadius: '50%',
        background: color, flexShrink: 0, display: 'inline-block',
        transition: 'background 0.3s ease',
      }} />
    );
  };

  /* ---- 工具提示卡片 ---- */
  const qqTooltip = () => {
    if (!qqData) return 'QQ Bot: 未配置';
    return (
      <div style={{ fontSize: 11, lineHeight: 1.6 }}>
        <div><b>QQ Bot 状态</b></div>
        <div>状态: {qqData.online ? '✅ 在线' : '❌ 离线'}</div>
        <div>客户端: {qqData.clientConnected ? '已连接' : '未连接'}</div>
        <div>消息数: {qqData.messageCount}</div>
        {qqData.lastSeen > 0 && (
          <div>最后活跃: {new Date(qqData.lastSeen).toLocaleTimeString()}</div>
        )}
        <div style={{ marginTop: 4, color: 'var(--muted-2)', fontSize: 10 }}>
          每 30 秒自动检测 · 超时 45 秒判离线
        </div>
      </div>
    );
  };

  const wxTooltip = () => {
    if (!wxData) return '微信: 未配置';
    return (
      <div style={{ fontSize: 11, lineHeight: 1.6 }}>
        <div><b>微信状态</b></div>
        <div>绑定: {wxData.bound ? '✅ 已绑定' : '❌ 未绑定'}</div>
        {wxData.accountId && <div>账号: {wxData.accountId}</div>}
        {wxData.createdAt && (
          <div>绑定于: {new Date(wxData.createdAt).toLocaleDateString()}</div>
        )}
        <div style={{ marginTop: 4, color: 'var(--muted-2)', fontSize: 10 }}>
          每 30 秒自动检测
        </div>
      </div>
    );
  };

  /* ---- P3-3: 置信度颜色 ---- */
  const confColor = dash.confidence != null
    ? dash.confidence >= 80 ? 'var(--success)'
    : dash.confidence >= 50 ? 'var(--warning)'
    : 'var(--danger)'
    : 'var(--muted-2)';
  const confLabel = dash.confidence != null ? `${dash.confidence}%` : '--';

  /* ---- P3-3: token 格式化 ---- */
  const fmtTokens = (t?: number) => {
    if (!t) return null;
    if (t < 1000) return `${t}`;
    if (t < 1000000) return `${(t / 1000).toFixed(1)}K`;
    return `${(t / 1000000).toFixed(1)}M`;
  };
  const tokenStr = fmtTokens(dash.tokens);

  /* ---- Gateway 状态色 ---- */
  const gwDotColor = gw === 'online' ? 'var(--success)'
    : gw === 'offline' ? 'var(--danger)' : 'var(--muted)';
  const gwLabel = gw === 'online' ? 'Gateway 在线'
    : gw === 'offline' ? 'Gateway 离线' : '检测中...';

  return (
    <>
      {/* Gateway */}
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <span style={{
          width: 6, height: 6, borderRadius: '50%',
          background: gwDotColor, flexShrink: 0, transition: 'background 0.3s',
        }} />
        {gwLabel}
      </span>

      {/* QQ 状态 */}
      <Tooltip title={qqTooltip} mouseEnterDelay={0.3}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, marginLeft: 8, cursor: 'pointer' }}>
          {statusDot(qq, 'var(--accent)')}
          <span style={{ fontSize: 10, color: 'var(--muted-2)' }}>QQ</span>
        </span>
      </Tooltip>

      {/* 微信状态 */}
      <Tooltip title={wxTooltip} mouseEnterDelay={0.3}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, marginLeft: 6, cursor: 'pointer' }}>
          {statusDot(wx, 'var(--success)')}
          <span style={{ fontSize: 10, color: 'var(--muted-2)' }}>微信</span>
        </span>
      </Tooltip>

      {/* 语音唤醒 */}
      <span style={{ marginLeft: 8, display: 'inline-flex', alignItems: 'center' }}>
        <VoiceWakeIndicator />
      </span>

      {/* ═══ P3-3: 透明度仪表盘 ═══ */}
      <span className="ui-divider" />

      {/* 置信度 */}
      <Tooltip title={`AI 置信度: ${dash.confidence != null ? dash.confidence + '%' : '暂无数据'}`} mouseEnterDelay={0.3}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, cursor: 'help' }}>
          <span style={{ fontSize: 10, color: 'var(--muted-2)' }}>置信</span>
          <span style={{ fontSize: 10, fontWeight: 700, color: confColor }}>{confLabel}</span>
        </span>
      </Tooltip>

      {/* 意图 */}
      {dash.intent && (
        <Tooltip title={`AI 理解的意图: ${dash.intent}`} mouseEnterDelay={0.3}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, cursor: 'help' }}>
            <span style={{ fontSize: 10, color: 'var(--muted-2)' }}>意图</span>
            <span style={{ fontSize: 10, color: 'var(--fg-2)', maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {dash.intent}
            </span>
          </span>
        </Tooltip>
      )}

      {/* 任务计划进度 */}
      {dash.planProgress && (
        <Tooltip title={`任务计划进度: ${dash.planProgress}`} mouseEnterDelay={0.3}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, cursor: 'help' }}>
            <span style={{ fontSize: 10, color: 'var(--muted-2)' }}>计划</span>
            <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--violet)' }}>{dash.planProgress}</span>
          </span>
        </Tooltip>
      )}

      {/* Token 用量 */}
      {tokenStr && (
        <Tooltip title={`上下文 Token: ${dash.tokens?.toLocaleString() || tokenStr}`} mouseEnterDelay={0.3}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, cursor: 'help' }}>
            <span style={{ fontSize: 10, color: 'var(--muted-2)' }}>Token</span>
            <span style={{ fontSize: 10, color: 'var(--fg-2)' }}>{tokenStr}</span>
          </span>
        </Tooltip>
      )}

      {/* 费用 */}
      {dash.cost && (
        <Tooltip title={`本次对话费用: ${dash.cost}`} mouseEnterDelay={0.3}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, cursor: 'help' }}>
            <span style={{ fontSize: 10, color: 'var(--muted-2)' }}>费用</span>
            <span style={{ fontSize: 10, color: 'var(--warning)' }}>{dash.cost}</span>
          </span>
        </Tooltip>
      )}

      {/* 当前模型 */}
      {dash.model && (
        <Tooltip title={`当前模型: ${dash.model}`} mouseEnterDelay={0.3}>
          <span style={{ fontSize: 10, color: 'var(--accent)', maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {dash.model}
          </span>
        </Tooltip>
      )}

      <span style={{ flex: 1 }} />

      {/* Music player toggle */}
      <span
        onClick={() => setMusicOpen(v => !v)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          cursor: 'pointer', color: musicOpen ? 'var(--accent)' : 'var(--muted-2)',
          marginRight: 8, fontSize: 12,
          animation: musicPlaying ? 'musicPulse 1.5s ease-in-out infinite' : undefined,
        }}
        title="音乐播放器"
      >
        ♪
      </span>

      {/* 首次启动音乐入口提示 */}
      {showMusicTip && (
        <div style={{
          position: 'fixed', bottom: 60, right: 16,
          background: 'var(--card)', border: '1px solid var(--accent)',
          borderRadius: 8, padding: '8px 12px',
          boxShadow: 'var(--shadow-md)',
          animation: 'msgSlideIn 0.3s ease-out',
          maxWidth: 280,
          zIndex: 1000,
        }}>
          <div style={{ fontSize: 12, color: 'var(--fg)', marginBottom: 4 }}>
            🎵 背景音乐已自动播放
          </div>
          <div style={{ fontSize: 10, color: 'var(--muted-2)' }}>
            点击右下角 ♪ 图标可控制播放器
          </div>
          <button
            onClick={() => setShowMusicTip(false)}
            style={{
              marginTop: 8, padding: '2px 8px', borderRadius: 4,
              background: 'var(--accent)', color: '#fff',
              border: 'none', fontSize: 10, cursor: 'pointer',
            }}
          >
            知道了
          </button>
        </div>
      )}

      {/* Music player panel */}
      <MusicPlayer visible={musicOpen} onClose={() => setMusicOpen(false)} />

      {/* mode */}
      <span style={{ color: MODE_CONFIG[mode].color }}>
        {MODE_CONFIG[mode].icon} {MODE_CONFIG[mode].label}模式
      </span>
    </>
  );
};
