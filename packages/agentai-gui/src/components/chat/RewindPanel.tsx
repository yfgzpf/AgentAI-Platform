/**
 * RewindPanel — 会话级 checkpoint 回退面板 (2026-10-16)
 * ---------------------------------------------------------
 * 让"AI 这一轮改错了"有个秒级的退路: 列出本会话每一轮 (checkpoint),
 * 选中先 dryRun 预览"会恢复哪些 / 删除哪些 / 跳过哪些", 用户确认才真回滚。
 *
 * 设计约束 (与后端 session-checkpoint.ts 一致, 前端不放宽):
 *   - 永远先预览后执行 (apply 只在用户点确认后发)
 *   - 只显示后端返回的 action, 前端不自己推断"会动哪些文件"
 *   - 已知的覆盖不到的地方必须说出来 (bash 改的文件 / subagent 改的文件不在其中)
 *
 * 与 git 的分工: 这个是"回合内秒退"; 跨会话/永久历史仍靠 commit + 锚点 (git-manager skill)。
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Button, Spin, message as antdMsg, Popconfirm, Tooltip } from 'antd';
import { HistoryOutlined, ReloadOutlined, RollbackOutlined, ClockCircleOutlined } from '@ant-design/icons';
import { GATEWAY_HTTP } from '../../services/config';
import { useProfileStore } from '../../store';

interface Checkpoint {
  id: string;
  ts: number;
  label: string;
  fileCount: number;
  current?: boolean;
}

interface PlanAction {
  path: string;
  action: 'restore' | 'delete' | 'unchanged' | 'skip';
  reason?: string;
}

export const RewindPanel: React.FC<{ sessionId?: string; onRewound?: () => void }> = ({ sessionId, onRewound }) => {
  const { profile } = useProfileStore();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [list, setList] = useState<Checkpoint[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [plan, setPlan] = useState<{ actions: PlanAction[]; restored: number; deleted: number; unchanged: number; skipped: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const baseUrl = () => GATEWAY_HTTP || 'http://127.0.0.1:18789';
  const ws = (profile?.workspace || localStorage.getItem('agentai.workspace') || '').trim();
  const wsHeader = useMemo<Record<string, string>>(() => {
    // 逐字段构造 (不用三元: TS 会把空对象分支推成 { 'x-workspace'?: undefined }, 过不了 HeadersInit)
    const h: Record<string, string> = {};
    if (ws) h['x-workspace'] = ws;
    return h;
  }, [ws]);
  const sid = (sessionId || '').trim();

  const load = useCallback(async () => {
    if (!sid) { setList([]); return; }
    setLoading(true);
    try {
      const r = await fetch(`${baseUrl()}/v1/session/checkpoints?sessionId=${encodeURIComponent(sid)}&limit=50`, { headers: wsHeader });
      const d = await r.json();
      if (d.ok) { setList(d.checkpoints || []); setPlan(null); }
      else antdMsg.warning(d.error || '读取 checkpoint 失败');
    } catch { /* 网关不可达 → 面板静默, 不打断聊天 */ }
    finally { setLoading(false); }
  }, [sid, baseUrl, wsHeader]);

  useEffect(() => { if (open) void load(); }, [open, load]);

  /** 选中一轮 → dryRun 预览 (不落任何盘) */
  const handleSelect = async (cp: Checkpoint) => {
    setSelected(cp.id);
    setPlan(null);
    if (cp.fileCount === 0) return;
    try {
      const r = await fetch(`${baseUrl()}/v1/session/checkpoints/rewind`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...wsHeader },
        body: JSON.stringify({ sessionId: sid, checkpointId: cp.id }),
      });
      const d = await r.json();
      if (d.ok) setPlan(d);
    } catch { antdMsg.error('预览失败'); }
  };

  /** 真回滚 (用户确认后) */
  const handleApply = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const r = await fetch(`${baseUrl()}/v1/session/checkpoints/rewind`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...wsHeader },
        body: JSON.stringify({ sessionId: sid, checkpointId: selected, apply: true }),
      });
      const d = await r.json();
      if (d.ok) {
        antdMsg.success(`已回滚: 恢复 ${d.restored} 个 / 删除 ${d.deleted} 个${d.skipped ? ` / 跳过 ${d.skipped} 个` : ''}`);
        await load();
        setSelected('');
        onRewound?.();
      } else antdMsg.error(d.error || '回滚失败');
    } catch { antdMsg.error('回滚请求失败'); }
    finally { setBusy(false); }
  };

  const ACTION_LABEL: Record<string, string> = {
    restore: '恢复', delete: '删除 (本轮新建的)', unchanged: '无需改动', skip: '跳过',
  };
  const ACTION_CLASS: Record<string, string> = {
    restore: 'rewind-plan-restore', delete: 'rewind-plan-delete',
    unchanged: '', skip: 'rewind-plan-skip',
  };

  const selCp = list.find(c => c.id === selected);

  return (
    <div className="rewind-panel">
      <div className="rewind-panel-head">
        <HistoryOutlined />
        <span style={{ flex: 1 }}>回退到某一轮</span>
        <Button
          size="small" type="text" icon={<ReloadOutlined />} loading={loading}
          onClick={() => void load()} style={{ height: 20, padding: '0 4px' }}
        />
      </div>

      <div className="rewind-panel-warn">
        只能回退<strong>本会话内 AI 用编辑工具改过的文件</strong>。用命令改的文件 (rm/mv/sed) 和
        子智能体在别的进程改的文件不在其中 —— 那些要靠 git 提交兜底。
      </div>

      {loading && list.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 8 }}><Spin size="small" /></div>
      ) : list.length === 0 ? (
        <div className="rewind-item rewind-item-empty">
          本会话还没有可回退的轮次 (AI 还没改过文件)
        </div>
      ) : (
        <div className="rewind-list">
          {list.map((c) => (
            <div
              key={c.id}
              className={`rewind-item${selected === c.id ? ' rewind-item-selected' : ''}`}
              onClick={() => void handleSelect(c)}
              title={c.label || '(空输入)'}
            >
              <ClockCircleOutlined style={{ color: 'var(--muted-2)' }} />
              <span className="rewind-item-label">
                {c.label || '(空输入)'}
              </span>
              <span style={{ color: 'var(--muted-2)' }}>
                {new Date(c.ts).toLocaleTimeString('zh-CN', { hour12: false })}
              </span>
              {c.fileCount > 0 ? (
                <span style={{ color: 'var(--accent)' }}>{c.fileCount} 文件</span>
              ) : (
                <Tooltip title="这一轮 AI 没有改文件 (只回答/只读) — 无代码可回退">
                  <span style={{ color: 'var(--muted-2)', opacity: 0.6 }}>无改动</span>
                </Tooltip>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 预览计划: 破坏性操作必须先看见会动什么 */}
      {plan && selCp && (
        <div className="rewind-plan">
          <div className="rewind-plan-row">
            <span>将恢复到这一轮开始前:</span>
            <span style={{ color: 'var(--muted-2)' }}>{selCp.label.slice(0, 24) || '(空)'}</span>
          </div>
          <div className="rewind-plan-row">
            <span className="rewind-plan-restore">恢复 {plan.restored} 个文件</span>
            <span className="rewind-plan-delete">删除 {plan.deleted} 个新建文件</span>
          </div>
          {plan.unchanged > 0 && (
            <div className="rewind-plan-row">
              <span className="rewind-plan-skip">{plan.unchanged} 个无需改动</span>
              {plan.skipped > 0 && <span className="rewind-plan-skip">{plan.skipped} 个跳过</span>}
            </div>
          )}
          <div className="rewind-file-list">
            {plan.actions.filter(a => a.action === 'restore' || a.action === 'delete').map((a, i) => (
              <div key={i} className="rewind-file-row">
                <span className={ACTION_CLASS[a.action]}>[{ACTION_LABEL[a.action]}]</span> {a.path}
              </div>
            ))}
            {plan.actions.filter(a => a.action === 'skip').map((a, i) => (
              <div key={`s${i}`} className="rewind-file-row" title={a.reason}>
                <span className="rewind-plan-skip">[跳过]</span> {a.path} — {a.reason}
              </div>
            ))}
          </div>
          <div style={{ marginTop: 6, display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <Button size="small" onClick={() => { setSelected(''); setPlan(null); }}>取消</Button>
            <Popconfirm
              title="确认回滚代码?"
              description={`将覆盖磁盘上的 ${plan.restored} 个文件、删除 ${plan.deleted} 个新建文件。对话记录不受影响。`}
              okText="确认回滚"
              cancelText="再想想"
              onConfirm={() => void handleApply()}
            >
              <Button size="small" type="primary" danger icon={<RollbackOutlined />} loading={busy} disabled={!selected}>
                回滚代码
              </Button>
            </Popconfirm>
          </div>
        </div>
      )}

      {!open && (
        <Button size="small" type="link" onClick={() => setOpen(true)} style={{ padding: 0, alignSelf: 'flex-start' }}>
          展开回退面板
        </Button>
      )}
    </div>
  );
};

export default RewindPanel;