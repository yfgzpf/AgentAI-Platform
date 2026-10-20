/**
 * ScopeManager — 渗透测试授权范围管理面板
 * -------------------------------------------------
 * 2026-10-15: 让"授权哪些目标可以挖洞"从"改 scope.json / 绕道 AI 对话"变成
 * 前端表单直接操作。调网关 /v1/pentest/scope API, 跟 AI 工具 (grant_scope /
 * scope_guard / wsl_scan) 读写同一份 .agentai/scope.json (按 workspace 隔离)。
 * 用户从赏金平台 (补天/漏洞盒子/HackerOne) 摘出的"可测资产域名"直接加进来。
 *
 * 2026-10-15 P0-2: AI 侧 grant_scope 改为提案制 (只写 scope-pending.json, 不生效),
 * 本面板新增「待确认提案」区 — AI 提案 → 人类点确认才进授权范围。这是"白帽工具"
 * 与"攻击框架"的分界线: AI 不能自我授权。
 */
import React, { useState, useEffect, useCallback } from 'react';
import { Card, Tag, Empty, Input, InputNumber, Button, Space, message as antdMsg, Spin, Tooltip } from 'antd';
import { PlusOutlined, DeleteOutlined, LockOutlined, SafetyCertificateOutlined, ReloadOutlined, CheckOutlined, CloseOutlined, ClockCircleOutlined, ImportOutlined, BugOutlined, WarningOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { GATEWAY_HTTP } from '../services/config';
import { useProfileStore } from '../store';
import { SrcPlatformImporter } from './SrcPlatformImporter';
import { AuthAttestationPanel } from './AuthAttestationPanel';
import { PentestProjectsPanel } from './PentestProjectsPanel';

interface ScopeTarget {
  host: string;
  source: string;
  /** 2026-10-21: 目标级只读/全量 */
  mode?: 'full' | 'readonly';
  /** 2026-10-21: 授权到期时间 (ms); 过期后 scope_guard 视为未授权 */
  expiresAt?: number;
}

interface ScopeState {
  targets: string[];
  targetsWithSource: ScopeTarget[];
  maxRps: number;
  workspace: string;
}

interface PendingProposal {
  target: string;
  proposedBy: string;
  ts: number;
}

interface BatchResult {
  addedCount: number;
  added: string[];
  existing: string[];
  invalid: string[];
}

/** 常见来源快捷标签 (平台名), 可自由输入 */
const SOURCE_PRESETS = ['补天', '漏洞盒子', 'HackerOne', '阿里SRC', '自加', 'AI发现'];

export const ScopeManager: React.FC = () => {
  const { profile } = useProfileStore();
  const [loading, setLoading] = useState(false);
  const [scope, setScope] = useState<ScopeState>({ targets: [], targetsWithSource: [], maxRps: 5, workspace: '' });
  const [newTarget, setNewTarget] = useState('');
  const [newMaxRps, setNewMaxRps] = useState<number | null>(null);
  const [newSource, setNewSource] = useState('');
  // 2026-10-21: 可选授权有效期 (天); 不填 = 不过期
  const [newExpireDays, setNewExpireDays] = useState<number | null>(null);
  // 来源筛选 (空 = 全部)
  const [filterSource, setFilterSource] = useState('');
  // 2026-10-15 P0-2: AI 的授权提案 (grant_scope 只写 pending, 人类在此确认)
  const [pending, setPending] = useState<PendingProposal[]>([]);
  // 2026-10-16 批量导入 (赏金平台 in-scope 清单一次粘贴 + 来源标注)
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchText, setBatchText] = useState('');
  const [batchSource, setBatchSource] = useState('');
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchResult, setBatchResult] = useState<BatchResult | null>(null);
  // 2026-10-16 CVE 盯哨告警 (scheduler 被动盯哨产出; 验证按钮 = 人在场主动动作)
  const [alerts, setAlerts] = useState<any[]>([]);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [verifying, setVerifying] = useState<string>(''); // 正在验证的 cveId::host
  const [lastRun, setLastRun] = useState<{ ts?: number; newAlerts?: number } | null>(null);

  /** 置信度 → 颜色/文案 (跟 scripts/lib/cve-matcher.mjs CONFIDENCE_ORDER 对齐) */
  const confidenceStyle = (c: string): { color: string; label: string } => {
    switch (c) {
      case 'kev+cpe': return { color: 'var(--danger)', label: '在野利用+指纹命中' };
      case 'kev+kw': return { color: 'var(--warn, #d48806)', label: '在野利用+关键词' };
      case 'cpe': return { color: 'var(--accent)', label: '指纹命中' };
      default: return { color: 'var(--muted-2)', label: '关键词命中' };
    }
  };

  const baseUrl = () => GATEWAY_HTTP || 'http://127.0.0.1:18789';

  /** 与 WorkspaceSelector 同口径的当前工作区 → **URL 查询参数** workspace= (encodeURIComponent),
   *  让前端读写的 scope.json 跟 AI 工具侧 (grant_scope/list_scope) 是同一份。
   *  ⚠️ 2026-10-16 修复: 原来走 x-workspace header, 但 header 只允许 ASCII — 工作区路径带中文
   *  (如 F:\目录已检查\澳彩) 时 undici 直接抛 "Cannot convert to ByteString", 请求根本发不出去,
   *  面板加目标/删/批量全失败。改走 query (可编码) 后中文路径正常。 */
  const wsQuery = useCallback((): string => {
    const ws = (profile?.workspace || localStorage.getItem('agentai.workspace') || '').trim();
    return ws ? `?workspace=${encodeURIComponent(ws)}` : '';
  }, [profile]);

  /** 组合请求 URL (查询参数 + 已有 query 合并) */
  const wsUrl = useCallback((path: string, extra?: string) => {
    const base = `${baseUrl()}/${path}`;
    const q = wsQuery();
    if (!q) return extra ? `${base}${extra.startsWith('?') ? extra : `?${extra}`}` : base;
    // 合并: workspace + 额外参数 (如 limit=50)
    return extra ? `${base}${q}${extra.startsWith('?') ? '&' + extra.slice(1) : `&${extra}`}` : base + q;
  }, [baseUrl, wsQuery]);

  /** 拉 CVE 盯哨告警 (scheduler 每 6h 被动跑的产物) */
  const loadAlerts = useCallback(async () => {
    setAlertsLoading(true);
    try {
      const r = await fetch(wsUrl('v1/pentest/cve/alerts', 'limit=50'));
      const d = await r.json();
      if (d.ok) { setAlerts(d.alerts || []); if (d.lastRun) setLastRun(d.lastRun); }
    } catch { /* 网关不可达 → 静默, 授权区照常工作 */ }
    finally { setAlertsLoading(false); }
  }, [baseUrl, wsUrl]);

  /** 一键验证 (nuclei 单模板低交互检测; 未授权资产后端 403) */
  const handleVerify = async (cveId: string, host: string) => {
    setVerifying(`${cveId}::${host}`);
    try {
      const r = await fetch(wsUrl('v1/pentest/cve/verify'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cveId, target: host }),
      });
      const d = await r.json();
      if (d.ok) {
        if (d.skipped) antdMsg.info(`跳过验证: ${d.reason || '本机无 WSL kali'}`);
        else if (d.verified) antdMsg.success(`✅ ${cveId} 真命中! 已落盘 vulns.jsonl + 证据 (${d.evidencePath || ''})`);
        else antdMsg.warning(`${cveId} 模板未命中 — 可能误报, 告警保持 new`);
      } else antdMsg.error(d.error || '验证失败');
      loadAlerts(); // 验证写 vulns.jsonl + 审计, 回来刷新面板
    } catch { antdMsg.error('验证请求失败'); }
    finally { setVerifying(''); }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rScope, rPending] = await Promise.all([
        fetch(wsUrl('v1/pentest/scope')),
        fetch(wsUrl('v1/pentest/scope/pending')),
      ]);
      const d = await rScope.json();
      if (d.ok) setScope({
        targets: d.targets || [],
        targetsWithSource: (d.targetsWithSource && d.targetsWithSource.length > 0)
          ? d.targetsWithSource
          : (d.targets || []).map((h: string) => ({ host: h, source: 'unknown' })),
        maxRps: d.max_rps || 5,
        workspace: d.workspace || '',
      });
      else antdMsg.error(d.error || '读取授权范围失败');
      try {
        const dp = await rPending.json();
        if (dp.ok) setPending(dp.pending || []);
      } catch { /* 旧网关无 pending 端点 → 忽略 */ }
    } catch {
      antdMsg.error('网关不可达, 无法读取授权范围');
    } finally {
      setLoading(false);
    }
  }, [baseUrl, wsUrl]);

  useEffect(() => { load(); loadAlerts(); }, [load, loadAlerts]);

  const handleGrant = async () => {
    const t = newTarget.trim();
    if (!t) return;
    setNewTarget('');
    try {
      const body: Record<string, unknown> = { target: t, source: newSource.trim() || 'manual' };
      if (newMaxRps) body.maxRps = newMaxRps;
      if (newExpireDays && newExpireDays > 0) body.expiresInDays = newExpireDays;
      const r = await fetch(wsUrl('v1/pentest/scope'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (d.ok) {
        antdMsg.success(`${d.granted ? '已授权' : '已更新'} ${d.target} [${d.source || 'manual'}]`);
        load();
      } else antdMsg.error(d.error || '授权失败');
    } catch { antdMsg.error('授权请求失败'); }
  };

  /** 2026-10-21: 切换目标级只读/全量 (后端 POST /scope 支持 mode) */
  const handleSetMode = async (host: string, mode: 'full' | 'readonly', source?: string) => {
    try {
      const r = await fetch(wsUrl('v1/pentest/scope'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: host, source: source || 'manual', mode }),
      });
      const d = await r.json();
      if (d.ok) { antdMsg.success(`${host} 已切换为${mode === 'readonly' ? '只读' : '全量'}模式`); load(); }
      else antdMsg.error(d.error || '切换模式失败');
    } catch { antdMsg.error('切换模式请求失败'); }
  };

  const handleRevoke = async (host: string) => {
    try {
      const r = await fetch(wsUrl('v1/pentest/scope'), {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: host }),
      });
      const d = await r.json();
      if (d.ok) { antdMsg.success(`已取消授权 ${d.target}`); load(); }
      else antdMsg.error(d.error || '取消授权失败');
    } catch { antdMsg.error('取消授权请求失败'); }
  };

  /** 人类确认 AI 的授权提案: pending → scope.json */
  const handleConfirm = async (host: string) => {
    try {
      const r = await fetch(wsUrl('v1/pentest/scope/confirm'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: host }),
      });
      const d = await r.json();
      if (d.ok) { antdMsg.success(`已确认授权 ${d.target}`); load(); }
      else antdMsg.error(d.error || '确认失败');
    } catch { antdMsg.error('确认请求失败'); }
  };

  /** 人类拒绝 AI 的授权提案: 只删 pending */
  const handleReject = async (host: string) => {
    try {
      const r = await fetch(wsUrl('v1/pentest/scope/pending'), {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: host }),
      });
      const d = await r.json();
      if (d.ok) { antdMsg.info(`已拒绝提案 ${host}`); load(); }
      else antdMsg.error(d.error || '拒绝失败');
    } catch { antdMsg.error('拒绝请求失败'); }
  };

  /** 批量导入 (2026-10-16): 平台 in-scope 清单一次粘贴 + 来源标注, 容忍逗号/换号分隔 */
  const handleBatchImport = async () => {
    const text = batchText.trim();
    if (!text) return;
    setBatchLoading(true);
    try {
      const body: Record<string, unknown> = { targets: text.split('\n'), source: batchSource.trim() || 'manual' };
      const r = await fetch(wsUrl('v1/pentest/scope/batch'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (d.ok) {
        setBatchResult({ addedCount: d.addedCount, added: d.added || [], existing: d.existing || [], invalid: d.invalid || [] });
        antdMsg.success(`导入完成: 新增 ${d.addedCount} 个 [${batchSource.trim() || 'manual'}], 已存在 ${d.existing?.length || 0} 个${d.invalid?.length ? `, 无法解析 ${d.invalid.length} 个` : ''}`);
        setBatchText('');
        load();
      } else antdMsg.error(d.error || '批量导入失败');
    } catch { antdMsg.error('批量导入请求失败'); }
    finally { setBatchLoading(false); }
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

      {/* 添加目标 (+ 来源标注: 这批资产属于哪个平台) */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
        <Input
          size="small"
          placeholder="目标域名, 如 admin.example.com / *.bestpay.com.cn"
          value={newTarget}
          onChange={e => setNewTarget(e.target.value)}
          onPressEnter={handleGrant}
          style={{ flex: 1, fontSize: 'var(--fs-micro)' }}
        />
        <Input
          size="small"
          placeholder="来源, 如 补天/盒子/自加"
          value={newSource}
          onChange={e => setNewSource(e.target.value)}
          onPressEnter={handleGrant}
          style={{ width: 110, fontSize: 'var(--fs-micro)' }}
        />
        <InputNumber
          size="small"
          min={1}
          max={100}
          placeholder="rps"
          value={newMaxRps}
          onChange={setNewMaxRps}
          style={{ width: 56, fontSize: 'var(--fs-micro)' }}
        />
        <Tooltip title="可选: 授权有效天数。到期后 scope_guard 视为未授权, 需重新授权">
          <InputNumber
            size="small"
            min={1}
            max={3650}
            placeholder="天"
            value={newExpireDays}
            onChange={setNewExpireDays}
            style={{ width: 58, fontSize: 'var(--fs-micro)' }}
          />
        </Tooltip>
        <Button size="small" type="primary" icon={<PlusOutlined />} onClick={handleGrant}>
          授权
        </Button>
      </div>
      {/* 来源快捷标签 (点击填入, 再授权) */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap' }}>
        {SOURCE_PRESETS.map(s => (
          <Tag
            key={s}
            onClick={() => setNewSource(s)}
            style={{
              cursor: 'pointer', fontSize: 'var(--fs-micro)', margin: 0, borderRadius: 'var(--radius-sm)',
              border: 'none',
              background: newSource === s ? 'var(--accent)' : 'var(--panel)',
              color: newSource === s ? 'var(--fg-on-accent)' : 'var(--muted-2)',
            }}
          >
            {s}
          </Tag>
        ))}
      </div>

      {/* ═══════════ 2026-10-16 批量导入 (赏金平台 in-scope 清单一次粘贴) ═══════════ */}
      <div style={{ marginBottom: 8 }}>
        <Button size="small" type="link" icon={<ImportOutlined />} onClick={() => setBatchOpen(v => !v)} style={{ padding: 0, fontSize: 'var(--fs-micro)' }}>
          {batchOpen ? '收起批量导入' : '批量导入 (从赏金平台清单粘贴, 一次存多个)'}
        </Button>
        {batchOpen && (
          <div style={{ marginTop: 6 }}>
            <Input.TextArea
              rows={4}
              placeholder={'每行一个 (也支持逗号分隔), 形如:\nwww.example.com\napi.example.com\n*.bestpay.com.cn\n# 注释行和空行自动忽略'}
              value={batchText}
              onChange={e => setBatchText(e.target.value)}
              style={{ fontSize: 'var(--fs-micro)' }}
            />
            <div style={{ display: 'flex', gap: 6, marginTop: 4, alignItems: 'center', flexWrap: 'wrap' }}>
              <Button size="small" type="primary" loading={batchLoading} onClick={() => void handleBatchImport()}>
                导入授权
              </Button>
              <Input
                size="small"
                placeholder="来源, 如 补天/盒子"
                value={batchSource}
                onChange={e => setBatchSource(e.target.value)}
                style={{ width: 110, fontSize: 'var(--fs-micro)' }}
              />
              <span style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted-2)' }}>
                只加平台明文授权的资产; 支付/生产/out-of-scope 别粘进来
              </span>
            </div>
            {batchResult && (
              <div style={{ marginTop: 6, fontSize: 'var(--fs-micro)', display: 'flex', flexDirection: 'column', gap: 2 }}>
                {batchResult.added.length > 0 && (
                  <div style={{ color: 'var(--success)' }}>✅ 新增 {batchResult.addedCount}: {batchResult.added.join(', ')}</div>
                )}
                {batchResult.existing.length > 0 && (
                  <div style={{ color: 'var(--muted-2)' }}>ℹ️ 已存在 {batchResult.existing.length}: {batchResult.existing.join(', ')}</div>
                )}
                {batchResult.invalid.length > 0 && (
                  <div style={{ color: 'var(--danger)' }}>❌ 无法解析 {batchResult.invalid.length}: {batchResult.invalid.join(', ')}</div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ═══════════ 2026-10-21 项目视图 (按根域: 目标 + 发现 + 提交门槛) ═══════════ */}
      <PentestProjectsPanel />

      {/* ═══════════ 2026-10-16 SRC 平台导入 (归属 + 授权目标 + 禁止项 一次提取) ═══════════ */}
      <SrcPlatformImporter onChanged={() => void load()} />

      {/* ═══════════ 2026-10-16 授权声明 (声明一次, AI 不再反复核实授权真伪) ═══════════ */}
      <AuthAttestationPanel onChanged={() => void load()} />

      {/* ═══════════ 2026-10-15 P0-2: AI 授权提案待确认区 (人类确认才生效) ═══════════ */}
      {pending.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--warn, #d48806)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
            <ClockCircleOutlined /> AI 发起的授权提案 ({pending.length}) — 需你确认后才生效
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {pending.map(p => (
              <div
                key={p.target}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '4px 8px', borderRadius: 'var(--radius-sm)',
                  background: 'rgba(250,173,20,0.08)', border: '1px solid rgba(250,173,20,0.35)',
                  fontSize: 'var(--fs-micro)',
                }}
              >
                <ClockCircleOutlined style={{ color: '#d48806', fontSize: 'var(--fs-micro)', flexShrink: 0 }} />
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--fg-2)' }}>
                  {p.target}
                </span>
                <span style={{ color: 'var(--muted-2)', fontSize: 'var(--fs-micro)', flexShrink: 0 }}>
                  {p.proposedBy === 'agent' ? 'AI 提案' : p.proposedBy}
                </span>
                <Button
                  size="small" type="text" icon={<CheckOutlined />}
                  onClick={() => handleConfirm(p.target)}
                  style={{ color: 'var(--success)', height: 20, padding: '0 4px' }}
                />
                <Button
                  size="small" type="text" danger icon={<CloseOutlined />}
                  onClick={() => handleReject(p.target)}
                  style={{ color: 'var(--danger)', height: 20, padding: '0 4px' }}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 当前授权列表 — 按来源分组 (2026-10-16: 多平台清单可管理) */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 12 }}><Spin size="small" /></div>
      ) : scope.targets.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={<span style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted-2)' }}>尚未授权任何目标 — AI 挖洞前需先授权</span>}
          style={{ margin: '4px 0' }}
        />
      ) : (
        <div>
          {/* 来源筛选 */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted-2)' }}>按来源:</span>
            <Tag
              onClick={() => setFilterSource('')}
              style={{ cursor: 'pointer', fontSize: 'var(--fs-micro)', margin: 0, borderRadius: 'var(--radius-sm)', border: 'none',
                background: filterSource === '' ? 'var(--accent)' : 'var(--panel)',
                color: filterSource === '' ? 'var(--fg-on-accent)' : 'var(--fg-2)' }}>
              全部 {scope.targets.length}
            </Tag>
            {Array.from(new Set(scope.targetsWithSource.map(t => t.source))).map(src => (
              <Tag
                key={src}
                onClick={() => setFilterSource(src)}
                style={{ cursor: 'pointer', fontSize: 'var(--fs-micro)', margin: 0, borderRadius: 'var(--radius-sm)', border: 'none',
                  background: filterSource === src ? 'var(--accent)' : 'var(--panel)',
                  color: filterSource === src ? 'var(--fg-on-accent)' : 'var(--muted-2)' }}>
                {src} {scope.targetsWithSource.filter(t => t.source === src).length}
              </Tag>
            ))}
          </div>

          {/* 分组列表 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 280, overflowY: 'auto' }}>
            {(() => {
              const visible = filterSource
                ? scope.targetsWithSource.filter(t => t.source === filterSource)
                : scope.targetsWithSource;
              const groups = Array.from(new Set(visible.map(t => t.source)));
              return groups.map(g => (
                <div key={g} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--accent)', fontWeight: 600, padding: '2px 2px 0' }}>
                    {g === 'unknown' ? '未标注' : g}
                    <span style={{ color: 'var(--muted-2)', fontWeight: 400 }}> · {visible.filter(t => t.source === g).length}</span>
                  </div>
                  {visible.filter(t => t.source === g).map((t) => (
                    <div
                      key={t.host}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        padding: '4px 8px', borderRadius: 'var(--radius-sm)',
                        background: 'var(--panel)', border: '1px solid var(--border)',
                        fontSize: 'var(--fs-micro)',
                      }}
                    >
                      <LockOutlined style={{ color: 'var(--success)', fontSize: 'var(--fs-micro)', flexShrink: 0 }} />
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--fg-2)' }}>
                        {t.host}
                      </span>
                      {/* 2026-10-21: 目标级只读/全量 (点击切换) */}
                      <Tooltip title="点击切换: 只读只允许 GET/HEAD; 全量允许写方法">
                        <Tag
                          onClick={() => void handleSetMode(t.host, t.mode === 'readonly' ? 'full' : 'readonly', t.source)}
                          color={t.mode === 'readonly' ? 'gold' : 'blue'}
                          style={{ cursor: 'pointer', fontSize: 'var(--fs-micro)', margin: 0, borderRadius: 'var(--radius-sm)' }}
                        >
                          {t.mode === 'readonly' ? '只读' : '全量'}
                        </Tag>
                      </Tooltip>
                      {/* 2026-10-21: 授权到期标记 */}
                      {typeof t.expiresAt === 'number' && t.expiresAt > 0 && (
                        t.expiresAt <= Date.now()
                          ? <Tag color="red" style={{ fontSize: 'var(--fs-micro)', margin: 0, borderRadius: 'var(--radius-sm)' }}>已过期</Tag>
                          : <Tag style={{ fontSize: 'var(--fs-micro)', margin: 0, borderRadius: 'var(--radius-sm)' }}>
                              至 {new Date(t.expiresAt).toLocaleDateString('zh-CN')}
                            </Tag>
                      )}
                      <Button
                        size="small"
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={() => handleRevoke(t.host)}
                        style={{ color: 'var(--danger)', fontSize: 'var(--fs-micro)', height: 20, padding: '0 4px' }}
                      />
                    </div>
                  ))}
                </div>
              ));
            })()}
          </div>
        </div>
      )}

      {/* ═══════════ 2026-10-16 CVE 盯哨告警 (被动情报盯哨产出; 验证 = 人在场手动) ═══════════ */}
      <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4,
          fontSize: 'var(--fs-micro)', color: 'var(--fg-2)',
        }}>
          <BugOutlined style={{ color: 'var(--danger)' }} />
          <span style={{ flex: 1 }}>
            CVE 盯哨告警 {alerts.length > 0 && <Tag style={{ fontSize: 'var(--fs-micro)', margin: 0, border: 'none', borderRadius: 'var(--radius-sm)' }} color="red">{alerts.length}</Tag>}
          </span>
          <Tooltip title="盯哨全自动 (每 6h 拉 NVD/CISA 情报 + 本地资产比对, 不打目标)。验证一律你点按钮才跑 — nuclei 单模板低交互检测, 且只验已授权资产。">
            <WarningOutlined style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted-2)' }} />
          </Tooltip>
          <Button size="small" type="text" icon={<ReloadOutlined />} loading={alertsLoading} onClick={() => void loadAlerts()} style={{ height: 20, padding: '0 4px', fontSize: 'var(--fs-micro)' }} />
        </div>
        {lastRun?.ts && (
          <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted-2)', marginBottom: 6 }}>
            上次盯哨 {new Date(lastRun.ts).toLocaleString('zh-CN', { hour12: false })}
            {lastRun.newAlerts != null && ` · 新增 ${lastRun.newAlerts} 条`}
          </div>
        )}
        {alerts.length === 0 ? (
          <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted-2)' }}>
            暂无告警 — 盯哨在跑, 命中「已授权资产的指纹 × 新 CVE」时出现在这里
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 240, overflowY: 'auto' }}>
            {alerts.map((a: any) => {
              const cs = confidenceStyle(a.confidence || 'kw');
              const key = `${a.cveId}::${a.host}`;
              const busy = verifying === key;
              return (
                <div
                  key={key}
                  style={{
                    padding: '6px 8px', borderRadius: 'var(--radius-sm)',
                    background: 'var(--panel)', border: '1px solid var(--border)',
                    borderLeft: `3px solid ${cs.color}`, fontSize: 'var(--fs-micro)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <a
                      href={`https://nvd.nist.gov/vuln/detail/${a.cveId}`}
                      target="_blank" rel="noreferrer"
                      style={{ color: 'var(--fg)', fontWeight: 600 }}
                    >
                      {a.cveId}
                    </a>
                    {a.kev && (
                      <Tag color="red" style={{ fontSize: 'var(--fs-micro)', margin: 0, border: 'none', borderRadius: 'var(--radius-sm)' }}>在野利用</Tag>
                    )}
                    {a.cvss != null && (
                      <Tag style={{ fontSize: 'var(--fs-micro)', margin: 0, border: 'none', borderRadius: 'var(--radius-sm)' }}>CVSS {a.cvss}</Tag>
                    )}
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--fg-2)' }}>
                      {a.host}
                    </span>
                    <Button
                      size="small" type="primary" icon={<ThunderboltOutlined />} loading={busy}
                      onClick={() => handleVerify(a.cveId, a.host)}
                      style={{ height: 20, padding: '0 6px', fontSize: 'var(--fs-micro)' }}
                    >
                      验证
                    </Button>
                  </div>
                  <div style={{ color: cs.color, marginTop: 2 }}>{cs.label}</div>
                  {a.title && (
                    <div style={{ color: 'var(--muted-2)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={a.title}>
                      {a.title}
                    </div>
                  )}
                  {Array.isArray(a.matchedOn) && a.matchedOn.length > 0 && (
                    <div style={{ color: 'var(--muted-2)', marginTop: 2 }}>
                      依据: {a.matchedOn.join(', ')}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 速率上限 */}
      <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted-2)', marginTop: 8, display: 'flex', justifyContent: 'space-between' }}>
        <span>速率上限</span>
        <Tag style={{ fontSize: 'var(--fs-micro)', margin: 0, borderRadius: 'var(--radius-sm)', border: 'none' }}>{scope.maxRps} rps</Tag>
      </div>
    </Card>
  );
};

export default ScopeManager;
