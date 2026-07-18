/**
 * ProjectRulesPanel — 项目规范与规则展示
 * ----------------------------------------------------
 * 展示 .agentai/config 中的项目级规则和沙箱策略
 */
import React, { useState, useEffect, useCallback } from 'react';
import { Card, Tag, Spin, Empty, Button } from 'antd';
import { FileTextOutlined, SafetyOutlined, ReloadOutlined } from '@ant-design/icons';

export const ProjectRulesPanel: React.FC = () => {
  const [sandbox, setSandbox] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/v1/sandbox/rules');
      if (r.ok) setSandbox(await r.json());
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <Card
      size="small"
      title={<span style={{ fontSize: 12, color: 'var(--fg-2)' }}><FileTextOutlined style={{ marginRight: 4 }} />项目规范</span>}
      extra={<Button size="small" type="text" icon={<ReloadOutlined />} onClick={load} loading={loading} style={{ color: 'var(--muted-2)', fontSize: 11, height: 22 }} />}
      style={{ borderRadius: 8, background: 'var(--card)', border: '1px solid var(--border)' }}
      styles={{ body: { padding: '8px 12px' } }}
    >
      {loading ? (
        <div style={{ textAlign: 'center', padding: 16 }}><Spin size="small" /></div>
      ) : !sandbox ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<span style={{ fontSize: 11, color: 'var(--muted-2)' }}>暂无项目规范</span>} style={{ margin: '8px 0' }} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* 文件限制 */}
          <div>
            <div style={{ fontSize: 9, color: 'var(--muted-2)', marginBottom: 4 }}>文件限制</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {sandbox.maxFileSize && <Tag style={{ fontSize: 9, borderRadius: 3 }}>最大文件: {formatBytes(sandbox.maxFileSize)}</Tag>}
              {sandbox.maxTotalSize && <Tag style={{ fontSize: 9, borderRadius: 3 }}>总计上限: {formatBytes(sandbox.maxTotalSize)}</Tag>}
            </div>
          </div>

          {/* 允许列表 */}
          {sandbox.allowed?.length > 0 && (
            <div>
              <div style={{ fontSize: 9, color: '#22c55e', marginBottom: 4 }}>允许</div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {sandbox.allowed.map((a: string, i: number) => (
                  <Tag key={i} color="green" style={{ fontSize: 9, borderRadius: 3, margin: 0 }}>{a}</Tag>
                ))}
              </div>
            </div>
          )}

          {/* 拒绝列表 */}
          {sandbox.denied?.length > 0 && (
            <div>
              <div style={{ fontSize: 9, color: '#ef4444', marginBottom: 4 }}>拒绝</div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {sandbox.denied.map((d: string, i: number) => (
                  <Tag key={i} color="red" style={{ fontSize: 9, borderRadius: 3, margin: 0 }}>{d}</Tag>
                ))}
              </div>
            </div>
          )}

          {/* 提示列表 */}
          {sandbox.prompt?.length > 0 && (
            <div>
              <div style={{ fontSize: 9, color: '#f59e0b', marginBottom: 4 }}>需确认</div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {sandbox.prompt.map((p: string, i: number) => (
                  <Tag key={i} color="orange" style={{ fontSize: 9, borderRadius: 3, margin: 0 }}>{p}</Tag>
                ))}
              </div>
            </div>
          )}

          {/* 工作区 */}
          {sandbox.workspace && (
            <div>
              <div style={{ fontSize: 9, color: 'var(--muted-2)', marginBottom: 2 }}>工作区</div>
              <code style={{ fontSize: 10, color: 'var(--fg-2)', background: 'var(--bg-2)', padding: '2px 6px', borderRadius: 3, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {sandbox.workspace}
              </code>
            </div>
          )}

          {/* 全局规范提示 */}
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8, fontSize: 10, color: 'var(--muted-2)', lineHeight: 1.6 }}>
            规范来自 <code style={{ background: 'var(--bg-2)', padding: '1px 4px', borderRadius: 2 }}>~/.agentai/config/sandbox-rules.json</code>，可在设置 → 沙箱规则中编辑
          </div>
        </div>
      )}
    </Card>
  );
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}
