/**
 * TokenPressureBar.tsx — 实时 token 压力预警条
 * =================================================
 *
 * 功能:
 *   1. 实时显示当前上下文压力 (颜色 + 进度条)
 *   2. 超过 0.7 时主动提醒 "AI 即将开始自动总结"
 *   3. 超过 0.85 时显示 "紧急压缩中" 状态
 *   4. 超过 0.95 时显示 "建议开启新会话"
 *
 * 设计原则:
 *   - 始终可见 (右上角, 不折叠)
 *   - 颜色变化足够明显
 *   - 鼠标悬浮显示详细数据
 *   - 与 StatusBar 联动
 */
import React from 'react';
import { Tooltip } from 'antd';

interface Props {
  used: number;
  max: number;
  messageCount?: number;
  toolCallCount?: number;
}

function calcPressure(used: number, max: number): {
  pressure: number;
  level: 'safe' | 'caution' | 'warning' | 'critical' | 'overflow';
  color: string;
  label: string;
  advice: string;
} {
  const pressure = Math.min(1.0, used / max);

  if (pressure < 0.5) {
    return {
      pressure,
      level: 'safe',
      color: '#22c55e',
      label: '充裕',
      advice: '正常运行',
    };
  } else if (pressure < 0.7) {
    return {
      pressure,
      level: 'caution',
      color: '#3b82f6',
      label: '关注',
      advice: '开始记录关键决策',
    };
  } else if (pressure < 0.85) {
    return {
      pressure,
      level: 'warning',
      color: '#f59e0b',
      label: '紧张',
      advice: 'AI 即将自动总结',
    };
  } else if (pressure < 0.95) {
    return {
      pressure,
      level: 'critical',
      color: '#ef4444',
      label: '紧急',
      advice: '正在压缩历史消息',
    };
  } else {
    return {
      pressure,
      level: 'overflow',
      color: '#dc2626',
      label: '溢出',
      advice: '建议开启新会话',
    };
  }
}

export const TokenPressureBar: React.FC<Props> = ({
  used,
  max,
  messageCount = 0,
  toolCallCount = 0,
}) => {
  const { pressure, level, color, label, advice } = calcPressure(used, max);
  const percent = (pressure * 100).toFixed(1);
  const isWarning = pressure >= 0.7;

  return (
    <Tooltip
      title={
        <div style={{ fontSize: 11 }}>
          <div>已用: {used.toLocaleString()} / {max.toLocaleString()} tokens</div>
          <div>压力: {percent}% ({label})</div>
          <div>消息数: {messageCount}</div>
          <div>工具调用: {toolCallCount}</div>
          <div style={{ marginTop: 4, color }}>建议: {advice}</div>
        </div>
      }
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '2px 8px',
          borderRadius: 4,
          background: isWarning ? `${color}15` : 'transparent',
          border: isWarning ? `1px solid ${color}40` : '1px solid transparent',
          transition: 'all 0.3s',
        }}
      >
        <div style={{
          fontSize: 10,
          color: isWarning ? color : 'var(--muted-2)',
          fontWeight: isWarning ? 600 : 400,
          whiteSpace: 'nowrap',
        }}>
          {isWarning ? '⚠️' : '📊'} {percent}%
        </div>
        <div style={{
          width: 60,
          height: 4,
          background: 'var(--border)',
          borderRadius: 2,
          overflow: 'hidden',
        }}>
          <div style={{
            width: `${Math.min(100, pressure * 100)}%`,
            height: '100%',
            background: color,
            transition: 'width 0.3s, background 0.3s',
          }} />
        </div>
      </div>
    </Tooltip>
  );
};
