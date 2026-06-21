/**
 * WorkspaceSummaryBar — 工作区选择 + 对话摘要 (可折叠)
 * -------------------------------------------------------
 * 位于对话窗口上方, 折叠时只显示紧凑状态栏
 * 展开后显示: 工作区路径选择、对话摘要、Token用量
 */
import React, { useState, useEffect, useCallback } from 'react';
import { Tooltip, Input, Button } from 'antd';
import { FolderOpenOutlined, ReloadOutlined, DownOutlined, RightOutlined, DeleteOutlined } from '@ant-design/icons';
import { useProfileStore } from '../store';
import { INDUSTRY_TEMPLATES } from '../services/IndustryTemplates';

interface Props {
  /** 当前消息数 (用于摘要) */
  messageCount: number;
  /** Token 用量信息 */
  tokenInfo: { tokens: number; ratio: number; pct: number; nearing: boolean; critical: boolean };
  /** 当前对话时间 */
  sessionCreatedAt?: number;
  /** 清空对话 */
  onClear: () => void;
  /** 当前活跃会话ID */
  sessionId?: string | null;
  /** 当前活跃会话标题 */
  sessionTitle?: string;
  /** 行业切换回调 — 通知 ChatView 让 AI 感知变化 */
  onIndustryChange?: (industryId: string, industryLabel: string) => void;
}

export const WorkspaceSummaryBar: React.FC<Props> = ({
  messageCount, tokenInfo, sessionCreatedAt, onClear, sessionId, sessionTitle, onIndustryChange,
}) => {
  const { profile, setProfile } = useProfileStore();
  const [expanded, setExpanded] = useState(false);
  const [editingWs, setEditingWs] = useState(false);
  const [wsDraft, setWsDraft] = useState(profile?.workspace || '');

  /* ---- 保存工作区 ---- */
  const saveWs = useCallback(() => {
    if (profile && wsDraft.trim()) {
      setProfile({ ...profile, workspace: wsDraft.trim() });
    }
    setEditingWs(false);
  }, [profile, wsDraft, setProfile]);

  /* ---- 对话时长 ---- */
  const duration = sessionCreatedAt
    ? (() => {
        const diff = Date.now() - sessionCreatedAt;
        const mins = Math.floor(diff / 60000);
        if (mins < 1) return '刚刚';
        if (mins < 60) return `${mins} 分钟`;
        const hrs = Math.floor(mins / 60);
        return `${hrs} 小时 ${mins % 60} 分钟`;
      })()
    : '';

  /* ---- 摘要文本 ---- */
  const summary = messageCount > 0
    ? `${messageCount} 条消息 · ${duration}${tokenInfo.tokens > 0 ? ` · ~${(tokenInfo.tokens / 1000).toFixed(1)}K tokens` : ''}`
    : '新对话';

  /* ---- 工作区显示 ---- */
  const wsLabel = profile?.workspace || '未设置工作区';

  return (
    <div style={{
      borderBottom: '1px solid var(--border)',
      background: 'var(--bg-2)',
    }}>
      {/* ===== 折叠状态栏 (总是可见) ===== */}
      <div
        onClick={() => setExpanded(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '4px 16px', cursor: 'pointer', userSelect: 'none',
          fontSize: 11, color: 'var(--muted-2)',
        }}
      >
        <span style={{
          fontSize: 8, transition: 'transform 0.2s',
          transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
          color: 'var(--muted)',
        }}>
          ▶
        </span>
        <FolderOpenOutlined style={{ fontSize: 11, color: 'var(--accent)' }} />
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {wsLabel}
        </span>
        {/* 行业标签 (折叠状态) */}
        {(() => {
          const cur = profile?.industry || 'general';
          const tpl = INDUSTRY_TEMPLATES.find(t => t.id === cur);
          return tpl && cur !== 'general' ? (
            <span style={{
              padding: '0 5px', borderRadius: 3, fontSize: 9,
              background: 'rgba(99,102,241,0.12)', color: 'var(--accent)',
              flexShrink: 0,
            }}>
              {tpl.icon} {tpl.label}
            </span>
          ) : null;
        })()}
        <span style={{ color: 'var(--muted)', fontSize: 10 }}>|</span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>
          {sessionTitle || summary}
        </span>
        {tokenInfo.tokens > 0 && (
          <span style={{
            padding: '1px 5px', borderRadius: 3, fontSize: 9,
            background: tokenInfo.critical ? 'rgba(239,68,68,0.15)' : tokenInfo.nearing ? 'rgba(250,204,21,0.1)' : 'rgba(255,255,255,0.05)',
            color: tokenInfo.critical ? '#ef4444' : tokenInfo.nearing ? '#eab308' : 'var(--muted)',
          }}>
            {(tokenInfo.tokens / 1000).toFixed(1)}K · {tokenInfo.pct}%
          </span>
        )}
        {messageCount > 0 && (
          <Tooltip title="清空对话">
            <span
              onClick={(e) => { e.stopPropagation(); onClear(); }}
              style={{
                padding: '2px 4px', borderRadius: 3, cursor: 'pointer',
                color: 'var(--muted-2)',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--panel)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
            >
              <DeleteOutlined style={{ fontSize: 10 }} />
            </span>
          </Tooltip>
        )}
      </div>

      {/* ===== 展开面板 ===== */}
      {expanded && (
        <div style={{
          padding: '6px 16px 10px',
          display: 'flex', flexDirection: 'column', gap: 6,
        }}>
          {/* 工作区路径编辑 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 10, color: 'var(--muted-2)', width: 56, flexShrink: 0 }}>
              工作目录
            </span>
            {editingWs ? (
              <div style={{ display: 'flex', gap: 4, flex: 1 }}>
                <Input
                  size="small"
                  value={wsDraft}
                  onChange={e => setWsDraft(e.target.value)}
                  placeholder="输入项目目录绝对路径..."
                  style={{ fontSize: 11, height: 26, flex: 1 }}
                  onPressEnter={saveWs}
                />
                <Button size="small" type="primary" onClick={saveWs} style={{ fontSize: 10, height: 26 }}>确定</Button>
                <Button size="small" onClick={() => setEditingWs(false)} style={{ fontSize: 10, height: 26 }}>取消</Button>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 4, flex: 1 }}>
                <div
                  onClick={() => { setWsDraft(profile?.workspace || ''); setEditingWs(true); }}
                  style={{
                    flex: 1, padding: '3px 8px', borderRadius: 4, cursor: 'pointer',
                    fontSize: 11, fontFamily: 'monospace',
                    color: profile?.workspace ? 'var(--fg-2)' : 'var(--muted-2)',
                    background: 'var(--panel)', border: '1px solid var(--border)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}
                >
                  {profile?.workspace || '点击输入路径或浏览选择'}
                </div>
                {/* 原生文件夹浏览器 */}
                <Button
                  size="small"
                  icon={<FolderOpenOutlined />}
                  onClick={() => {
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.webkitdirectory = true;
                    input.onchange = (e: any) => {
                      const path = e.target?.files?.[0]?.path;
                      if (path) {
                        // 取目录路径 (去掉文件名)
                        const dir = path.split(/[\\/]/).slice(0, -1).join('\\');
                        if (profile) setProfile({ ...profile, workspace: dir });
                      }
                    };
                    input.click();
                  }}
                  style={{ fontSize: 10, height: 26, flexShrink: 0 }}
                >
                  浏览
                </Button>
              </div>
            )}
          </div>

          {/* 行业身份选择 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 10, color: 'var(--muted-2)', width: 56, flexShrink: 0 }}>
              行业身份
            </span>
            <div style={{ display: 'flex', gap: 4, flex: 1, flexWrap: 'wrap' }}>
              {INDUSTRY_TEMPLATES.map(t => {
                const active = profile?.industry === t.id || (!profile?.industry && t.id === 'general');
                return (
                  <Tooltip key={t.id} title={t.description}>
                    <button
                      onClick={() => {
                        if (profile) {
                          const prevIndustry = profile.industry || 'general';
                          // 同一行业不重复切换
                          if (prevIndustry === t.id) return;
                          const newProfile = {
                            ...profile,
                            industry: t.id,
                            industrySkills: t.requiredSkills || [],
                          };
                          setProfile(newProfile);
                          // 同步到 localStorage 供 gateway 读取
                          localStorage.setItem('agentai.industry', t.id);
                          if (t.requiredSkills.length) {
                            localStorage.setItem('agentai.industry.skills', JSON.stringify({
                              industry: t.id,
                              skills: t.requiredSkills,
                            }));
                          } else {
                            localStorage.removeItem('agentai.industry.skills');
                          }
                          // 通知 gateway 行业切换 (AI 立即感知)
                          fetch('/v1/profile', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              industry: t.id,
                              industrySkills: t.requiredSkills || [],
                            }),
                          }).catch(() => { /* gateway 可能离线 */ });
                          // 通知 ChatView 让 AI 感知行业变化并自动响应
                          if (onIndustryChange) {
                            onIndustryChange(t.id, t.label);
                          }
                        }
                      }}
                      style={{
                        padding: '2px 8px', borderRadius: 4, fontSize: 10,
                        border: active ? '1px solid var(--accent)' : '1px solid var(--border)',
                        background: active ? 'rgba(99,102,241,0.12)' : 'var(--panel)',
                        color: active ? 'var(--accent)' : 'var(--muted-2)',
                        cursor: 'pointer', transition: 'all 0.15s',
                        display: 'inline-flex', alignItems: 'center', gap: 3,
                      }}
                    >
                      <span>{t.icon}</span>
                      <span>{t.label}</span>
                    </button>
                  </Tooltip>
                );
              })}
            </div>
          </div>

          {/* 对话摘要 */}
          {messageCount > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 10, color: 'var(--muted-2)', width: 56, flexShrink: 0 }}>
                对话摘要
              </span>
              <div style={{
                flex: 1, fontSize: 11, color: 'var(--fg-2)',
                display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
              }}>
                <span>{messageCount} 条消息</span>
                <span style={{ color: 'var(--muted)' }}>·</span>
                <span>{duration}</span>
                {tokenInfo.tokens > 0 && (
                  <>
                    <span style={{ color: 'var(--muted)' }}>·</span>
                    <span>{(tokenInfo.tokens / 1000).toFixed(1)}K tokens</span>
                    <span style={{
                      display: 'inline-block', width: 60, height: 4, borderRadius: 2,
                      background: 'var(--border)',
                    }}>
                      <span style={{
                        display: 'block', height: '100%', borderRadius: 2,
                        width: `${Math.min(100, tokenInfo.pct)}%`,
                        background: tokenInfo.critical
                          ? '#ef4444'
                          : tokenInfo.nearing
                            ? '#f59e0b'
                            : 'var(--accent)',
                      }} />
                    </span>
                    <span style={{
                      fontSize: 9, color: tokenInfo.critical ? '#ef4444' : tokenInfo.nearing ? '#f59e0b' : 'var(--muted-2)',
                    }}>
                      {tokenInfo.pct}%
                    </span>
                  </>
                )}
              </div>
            </div>
          )}

          {/* 时间线 - 显示当前会话信息 */}
          {sessionId && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 10, color: 'var(--muted-2)', width: 56, flexShrink: 0 }}>
                时间线
              </span>
              <div style={{
                flex: 1, fontSize: 10, color: 'var(--muted-2)',
                display: 'flex', alignItems: 'center', gap: 4,
              }}>
                <span style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: 'var(--accent)', display: 'inline-block',
                }} />
                {sessionCreatedAt && (
                  <span>
                    {new Date(sessionCreatedAt).toLocaleString('zh-CN', {
                      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                    })}
                  </span>
                )}
                <span style={{ marginLeft: 'auto', fontSize: 9, color: 'var(--muted-2)' }}>
                  会话ID: {sessionId.slice(-8)}
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
