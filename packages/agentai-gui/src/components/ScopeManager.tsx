/**
 * ScopeManager — 渗透测试授权范围管理面板
 * -------------------------------------------------
 * 2026-10-15: 让"授权哪些目标可以挖洞"从"改 scope.json / 绕道 AI 对话"变成
 * 前端表单直接操作。调网关 /v1/pentest/scope API, 跟 AI 工具 (grant_scope /
 * scope_guard / wsl_scan) 读写同一份 .agentai/scope.json (按 workspace 隔离)。
 * 用户从赏金平台 (补天/漏洞盒子/HackerOne) 摘出的"可测资产域名"直接加进来。
 */
import React, { useState, useEffect, useCallback } from 'react';
import { Card, Tag, Empty, Input, InputNumber, Button, Space, message as antdMsg, Spin, Tooltip } from 'antd';
import { PlusOutlined, DeleteOutlined, LockOutlined, SafetyCertificateOutlined, ReloadOutlined } from '@ant-design/icons';
import { GATEWAY_HTTP } from '../services/config';

interface ScopeState {
  targets: string[];
  maxRps: number;
  workspace: string;
}

export const ScopeManager: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [scope, setScope] = useState<ScopeState>({ targets: [], maxRps: 5, workspace: '' });
  const [newTarget, setNewTarget] = useState('');
  const [newMaxRps, setNewMaxRps] = useState<number | null>(null);

  const baseUrl = () => GATEWAY_HTTP || 'http://127.0.0.1:18789';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${baseUrl()}/v1/pentest/scope`);
      const d = await r.json();
      if (d.ok) setScope({ targets: d.targets || [], maxRps: d.max_rps || 5, workspace: d.workspace || '' });
      else antdMsg.error(d.error || '读取授权范围失败');
    } catch {
      antdMsg.error('网关不可达, 无法读取授权范围');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleGrant = async () => {
    const t = newTarget.trim();
    if (!t) return;
    setNewTarget('');
    try {
      const body: Record<string, unknown> = { target: t };
      if (newMaxRps) body.maxRps = newMaxRps;
      const r = await fetch(`${baseUrl()}/v1/pentest/scope`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (d.ok) {
        antdMsg.success(d.granted ? `已授权 ${d.target}` : `${d.target} 已在授权范围`);
        load();
      } else antdMsg.error(d.error || '授权失败');
    } catch { antdMsg.error('授权请求失败'); }
  };

  const handleRevoke = async (host: string) => {
    try {
      const r = await fetch(`${baseUrl()}/v1/pentest/scope?target=${encodeURIComponent(host)}`, { method: 'DELETE' });
      const d = await r.json();
      if (d.ok) { antdMsg.success(`已取消授权 ${d.target}`); load(); }
      else antdMsg.error(d.error || '取消授权失败');
    } catch { antdMsg.error('取消授权请求失败'); }
  };

  return (
    <Card
      size="small"
      title={
        <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-2)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <LockOutlined style={{ color: 'var(--accent)' }} />
          渗透测试授权范围
          <Tooltip title="这些是 AI 挖洞 (scope_guard / wsl_scan) 能动手的目标。out-of-scope 资产别加进来。">
            <SafetyCertificateOutlined style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted-2)' }} />
          </Tooltip>
        </span>
      }
      extra={<Button size="small" icon={<ReloadOutlined />} onClick={load}>刷新</Button>}
      style={{ borderRadius: 'var(--radius-md)', background: 'var(--card)', border: '1px solid var(--border)' }}
      styles={{ body: { padding: '8px 12px' } }}
    >
      {/* 合规提示 */}
      <div style={{
        fontSize: 'var(--fs-micro)', color: 'var(--muted-2)', marginBottom: 8,
        padding: '6px 8px', borderRadius: 'var(--radius-sm)',
        background: 'rgba(250,173,20,0.08)', border: '1px solid rgba(250,173,20,0.25)',
      }}>
        只加**平台明文授权**的资产 (补天/盒子项目页"可测"清单)。禁止把 out-of-scope / 支付 / 生产 加进来。
      </div>

      {/* 添加目标 */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        <Input
          size="small"
          placeholder="目标域名, 如 admin.example.com / https://x.example.com"
          value={newTarget}
          onChange={e => setNewTarget(e.target.value)}
          onPressEnter={handleGrant}
          style={{ flex: 1, fontSize: 'var(--fs-micro)' }}
        />
        <InputNumber
          size="small"
          min={1}
          max={100}
          placeholder="rps"
          value={newMaxRps}
          onChange={setNewMaxRps}
          style={{ width: 64, fontSize: 'var(--fs-micro)' }}
        />
        <Button size="small" type="primary" icon={<PlusOutlined />} onClick={handleGrant}>
          授权
        </Button>
      </div>

      {/* 当前授权列表 */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 12 }}><Spin size="small" /></div>
      ) : scope.targets.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={<span style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted-2)' }}>尚未授权任何目标 — AI 挖洞前需先授权</span>}
          style={{ margin: '4px 0' }}
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 260, overflowY: 'auto' }}>
          {scope.targets.map((t) => (
            <div
              key={t}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '4px 8px', borderRadius: 'var(--radius-sm)',
                background: 'var(--panel)', border: '1px solid var(--border)',
                fontSize: 'var(--fs-micro)',
              }}
            >
              <LockOutlined style={{ color: 'var(--success)', fontSize: 'var(--fs-micro)', flexShrink: 0 }} />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--fg-2)' }}>
                {t}
              </span>
              <Tag style={{ fontSize: 'var(--fs-micro)', margin: 0, borderRadius: 'var(--radius-sm)', border: 'none' }}
                color="green">可测</Tag>
              <Button
                size="small"
                type="text"
                danger
                icon={<DeleteOutlined />}
                onClick={() => handleRevoke(t)}
                style={{ color: 'var(--danger)', fontSize: 'var(--fs-micro)', height: 20, padding: '0 4px' }}
              />
            </div>
          ))}
        </div>
      )}

      {/* 速率上限 */}
      <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted-2)', marginTop: 8, display: 'flex', justifyContent: 'space-between' }}>
        <span>速率上限</span>
        <Tag style={{ fontSize: 'var(--fs-micro)', margin: 0, borderRadius: 'var(--radius-sm)', border: 'none' }}>{scope.maxRps} rps</Tag>
      </div>
    </Card>
  );
};

export default ScopeManager;
