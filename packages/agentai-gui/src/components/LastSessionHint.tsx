/**
 * LastSessionHint — 上轮会话摘要提示
 * =============================================
 *
 * 场景: 用户开启新对话时, 如果 .agentai/last-session.json 有上轮记录,
 *       显示一个简洁的提示条, 提醒用户"上轮做了什么"
 *
 * 解决问题: AI 进入新会话后, 即便有跨会话记忆, 用户也不清楚 AI 是否记得
 *           这个 Hint 给用户**双保险**:
 *           1. 视觉提示, 用户知道 AI 知道
 *           2. 提供"上轮工具/文件" 快捷操作入口
 *
 * v3.1 (2026-07-15) 新增
 */
import React, { useEffect, useState } from 'react';
import { Tag, Tooltip, Button, Space } from 'antd';
import { HistoryOutlined, FileTextOutlined, ToolOutlined, CloseOutlined } from '@ant-design/icons';

interface LastSession {
  userGoal: string;
  toolsUsed: string[];
  filesModified: string[];
  summary: string;
  taskType?: string;
  timestamp: number;
}

const DISMISS_KEY = 'agentai.lastSessionHint.dismissed';

const AUTO_HIDE_MS = 10000; // 10 秒后自动收起

export const LastSessionHint: React.FC<{ workspace?: string }> = ({ workspace }) => {
  const [data, setData] = useState<LastSession | null>(null);
  const [hidden, setHidden] = useState(() => {
    // localStorage 持久化: 用户主动关闭后永久不显示
    try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; }
  });
  const [dismissed, setDismissed] = useState(false); // 自动消失但不永久关闭

  useEffect(() => {
    if (!workspace) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/sessions/last?workspace=${encodeURIComponent(workspace)}`);
        if (!r.ok) return;
        const json = await r.json();
        if (cancelled) return;
        if (json?.summary) setData(json);
      } catch { /* silent */ }
    })();
    return () => { cancelled = true; };
  }, [workspace]);

  // 自动消失: 10 秒后自动收起
  useEffect(() => {
    if (!data) return;
    const timer = setTimeout(() => setDismissed(true), AUTO_HIDE_MS);
    return () => clearTimeout(timer);
  }, [data]);

  // 用户开始输入后自动消失
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // 普通按键 + 不是修饰键
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        setDismissed(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  if (hidden || dismissed || !data) return null;

  const ageMin = Math.round((Date.now() - data.timestamp) / 60000);
  const ageStr = ageMin < 60 ? `${ageMin}分钟前` : ageMin < 1440 ? `${Math.round(ageMin / 60)}小时前` : `${Math.round(ageMin / 1440)}天前`;

  const tools = (data.toolsUsed || []).slice(0, 4);
  const files = (data.filesModified || []).slice(0, 3);

  return (
    <div
      style={{
        margin: '12px 16px 0 16px',
        padding: '10px 14px',
        background: 'linear-gradient(135deg, rgba(205, 122, 58, 0.08) 0%, rgba(26, 26, 34, 0.4) 100%)',
        border: '1px solid rgba(205, 122, 58, 0.25)',
        borderRadius: 10,
        fontSize: 12,
        color: 'var(--fg-2)',
        position: 'relative',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <HistoryOutlined style={{ color: '#CD7A3A', fontSize: 14, marginTop: 2 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: 'var(--fg)', fontWeight: 600, marginBottom: 4 }}>
            上轮会话 ({ageStr})
            {data.taskType && (
              <Tag color="orange" style={{ marginLeft: 6, fontSize: 10, padding: '0 6px' }}>
                {data.taskType}
              </Tag>
            )}
          </div>
          {data.userGoal && (
            <div style={{ marginBottom: 4, color: 'var(--fg-2)' }}>
              <span style={{ opacity: 0.7 }}>目标: </span>
              <span style={{ color: 'var(--fg)' }}>{data.userGoal.slice(0, 80)}{data.userGoal.length > 80 ? '...' : ''}</span>
            </div>
          )}
          {tools.length > 0 && (
            <div style={{ marginBottom: 4 }}>
              <Space size={4} wrap>
                <span style={{ opacity: 0.7 }}><ToolOutlined /> 工具:</span>
                {tools.map(t => (
                  <Tag key={t} color="geekblue" style={{ fontSize: 10, margin: 0, padding: '0 5px', lineHeight: '16px' }}>
                    {t}
                  </Tag>
                ))}
              </Space>
            </div>
          )}
          {files.length > 0 && (
            <div style={{ marginBottom: 4 }}>
              <Space size={4} wrap>
                <span style={{ opacity: 0.7 }}><FileTextOutlined /> 文件:</span>
                {files.map(f => (
                  <Tag key={f} color="cyan" style={{ fontSize: 10, margin: 0, padding: '0 5px', lineHeight: '16px' }}>
                    {f.split(/[\\/]/).pop()}
                  </Tag>
                ))}
              </Space>
            </div>
          )}
          {data.summary && (
            <details style={{ marginTop: 4, opacity: 0.85 }}>
              <summary style={{ cursor: 'pointer', fontSize: 11, color: 'var(--muted)' }}>查看详情</summary>
              <div style={{ marginTop: 4, padding: 6, background: 'rgba(0,0,0,0.2)', borderRadius: 4, fontSize: 11, lineHeight: 1.5, color: 'var(--muted-2)' }}>
                {data.summary.slice(0, 400)}
                {data.summary.length > 400 && '...'}
              </div>
            </details>
          )}
        </div>
        <Button
          type="text" size="small" icon={<CloseOutlined />}
          onClick={() => { localStorage.setItem(DISMISS_KEY, '1'); setHidden(true); }}
          style={{ color: 'var(--muted)' }}
        />
      </div>
    </div>
  );
};

export default LastSessionHint;
