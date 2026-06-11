/**
 * StatusBar — bottom status bar
 *   - Gateway connection status
 *   - Tool count
 *   - Current mode indicator
 */
import React, { useState, useEffect, useCallback } from 'react';
import { useModeStore } from '../store/modeStore';

type GwStatus = 'online' | 'offline' | 'checking';

export const StatusBar: React.FC = () => {
  const { mode } = useModeStore();
  const [gw, setGw] = useState<GwStatus>('checking');

  const check = useCallback(() => {
    setGw('checking');
    fetch('/api/health', { signal: AbortSignal.timeout(3000) })
      .then(r => setGw(r.ok ? 'online' : 'offline'))
      .catch(() => setGw('offline'));
  }, []);

  useEffect(() => { check(); }, [check]);

  const dotColor = gw === 'online' ? 'var(--success)' : gw === 'offline' ? 'var(--danger)' : 'var(--muted)';
  const label = gw === 'online' ? 'Gateway 在线' : gw === 'offline' ? 'Gateway 离线' : '检测中...';

  return (
    <>
      {/* Gateway status */}
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: dotColor, flexShrink: 0 }} />
        {label}
      </span>

      <span style={{ marginLeft: 12, color: 'var(--success)' }}>43 tools</span>

      <span style={{ flex: 1 }} />

      {/* mode */}
      <span>
        {mode === 'readonly' ? '只读' : mode === 'planning' ? '规划' : '自动'} 模式
      </span>
    </>
  );
};
