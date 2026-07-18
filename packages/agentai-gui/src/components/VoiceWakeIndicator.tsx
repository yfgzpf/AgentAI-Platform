/**
 * VoiceWakeIndicator — 语音唤醒状态指示器
 * 放置在 StatusBar 或浮动显示
 *
 * 状态: idle (灰色) → listening (蓝色脉冲) → triggered (绿色闪光)
 */
import React, { useState, useEffect, useCallback } from 'react';
import { Tooltip, Switch } from 'antd';
import {
  startWakeListening, stopWakeListening,
  onWakeEvent, getWakeConfig, setWakeConfig,
  type WakeState, type WakeConfig as WakeConfigType,
} from '../services/voiceWake';
import { isSpeechRecognitionSupported } from '../services/voice';

/* ===== 颜色映射 ===== */
const STATE_COLORS: Record<WakeState, string> = {
  idle: 'var(--muted-2)',
  listening: 'var(--accent)',
  triggered: '#22c55e',
};
const STATE_LABELS: Record<WakeState, string> = {
  idle: '唤醒监听已暂停',
  listening: '正在监听唤醒词...',
  triggered: '已唤醒！',
};
const STATE_ANIMS: Record<WakeState, string | undefined> = {
  idle: undefined,
  listening: 'pulse 1.6s ease-out infinite',
  triggered: 'none',
};

/* ===== Component ===== */
export const VoiceWakeIndicator: React.FC = () => {
  const supported = isSpeechRecognitionSupported();
  const [wakeState, setWakeState] = useState<WakeState>('idle');
  const [cfg, setCfg] = useState<WakeConfigType>(getWakeConfig);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    onWakeEvent((state, transcript) => {
      setWakeState(state);
      if (state === 'triggered' && transcript) {
        // 触发后 3 秒自动恢复
        setTimeout(() => setWakeState('listening'), 3000);
      }
    });
  }, []);

  const handleToggle = useCallback((enabled: boolean) => {
    setWakeConfig({ enabled });
    setCfg(getWakeConfig());
    if (enabled) {
      startWakeListening();
    } else {
      stopWakeListening();
    }
  }, []);

  const handleKeywordChange = useCallback((keyword: string) => {
    setWakeConfig({ keyword });
    setCfg(getWakeConfig());
  }, []);

  const handleSensitivityChange = useCallback((val: number) => {
    setWakeConfig({ sensitivity: Math.max(0, Math.min(1, val)) });
    setCfg(getWakeConfig());
  }, []);

  if (!supported) return null;

  const color = STATE_COLORS[wakeState];
  const label = STATE_LABELS[wakeState];

  const indicatorIcon = (
    <span
      onClick={() => setShowSettings(v => !v)}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        cursor: 'pointer', userSelect: 'none',
      }}
    >
      {/* Mic icon with state indicator */}
      <span style={{ position: 'relative', display: 'inline-flex' }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round"
          style={{ transition: 'stroke 0.3s ease' }}>
          <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" y1="19" x2="12" y2="22" />
        </svg>
        {/* Wake state dot */}
        {cfg.enabled && (
          <span style={{
            position: 'absolute', top: -2, right: -3,
            width: 6, height: 6, borderRadius: '50%',
            background: color,
            animation: STATE_ANIMS[wakeState],
            boxShadow: wakeState === 'triggered' ? '0 0 6px #22c55e' : undefined,
            transition: 'all 0.3s ease',
          }} />
        )}
      </span>
      {wakeState === 'triggered' && (
        <span style={{ fontSize: 9, color: '#22c55e', fontWeight: 600, animation: 'blink 1s infinite' }}>
          已唤醒
        </span>
      )}
    </span>
  );

  return (
    <>
      {/* StatusBar indicator */}
      <Tooltip title={
        <div style={{ fontSize: 11, lineHeight: 1.6 }}>
          <div><b>语音唤醒</b></div>
          <div>状态: {label}</div>
          <div>唤醒词: "{cfg.keyword}"</div>
          <div>灵敏度: {cfg.sensitivity}</div>
          <div style={{ marginTop: 4, color: '#888', fontSize: 10 }}>
            {cfg.enabled ? '点击设置调整参数' : '点击启用语音唤醒'}
          </div>
        </div>
      } mouseEnterDelay={0.5}>
        {indicatorIcon}
      </Tooltip>

      {/* Settings dropdown */}
      {showSettings && (
        <div style={{
          position: 'fixed', bottom: 40, left: 20,
          background: 'var(--card)', border: '1px solid var(--border)',
          borderRadius: 10, padding: '12px 14px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
          zIndex: 1000, width: 260,
          animation: 'msgSlideIn 0.2s ease',
        }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--fg-2)', marginBottom: 10 }}>
            语音唤醒设置
          </div>

          {/* Enable toggle */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>启用唤醒</span>
            <Switch size="small" checked={cfg.enabled} onChange={handleToggle} />
          </div>

          {/* Keyword */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 10, color: 'var(--muted-2)', marginBottom: 4 }}>唤醒词</div>
            <input
              value={cfg.keyword}
              onChange={e => handleKeywordChange(e.target.value)}
              style={{
                width: '100%', padding: '4px 8px', borderRadius: 4,
                border: '1px solid var(--border)', background: 'var(--panel)',
                color: 'var(--fg)', fontSize: 12, outline: 'none',
              }}
              placeholder="输入唤醒词..."
            />
          </div>

          {/* Sensitivity */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--muted-2)', marginBottom: 4 }}>
              <span>灵敏度</span>
              <span>{cfg.sensitivity.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={cfg.sensitivity}
              onChange={e => handleSensitivityChange(parseFloat(e.target.value))}
              style={{ width: '100%', height: 4 }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8, color: 'var(--muted-2)', marginTop: 2 }}>
              <span>严格</span>
              <span>宽松</span>
            </div>
          </div>

          {/* State info */}
          <div style={{
            marginTop: 10, padding: '4px 8px', borderRadius: 4,
            background: cfg.enabled ? 'var(--accent-soft)' : 'var(--panel)',
            fontSize: 10, color: 'var(--muted)',
          }}>
            {cfg.enabled ? `🎤 监听中，说 "${cfg.keyword}" 唤醒` : '唤醒未启用'}
          </div>
        </div>
      )}
    </>
  );
};
