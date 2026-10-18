/**
 * WorkspacesPanel — 可管理的"工作区清单" (批次8, 2026-10-12)
 * =================================================================
 * 我们自己特色的版本 (不照搬 WorkBuddy 的"空间"):
 *   顶部 = 当前工作区 (名称 + 完整路径 tooltip + 📌置顶 / ✎改名 / 🗑删除)
 *   下面 = 所有用过的工作区 (置顶在前, 其余按最近使用)
 *   点某工作区 = switchWorkspace(path) (自动同步 gateway + 自动进清单)
 *   "＋ 新工作区" 复用现有 WorkspaceSelector 的文件夹选择 (此处只弹提示引导)
 * 全部颜色走 CSS 变量, 无硬编码 hex。
 */
import React, { useMemo, useState } from 'react';
import { Tooltip, message } from 'antd';
import {
  AppstoreOutlined, FolderOutlined, PushpinOutlined, EditOutlined,
  DeleteOutlined, PlusOutlined,
} from '@ant-design/icons';
import { useWorkspaceRegistry, sortWorkspaces } from '../store/workspaceRegistry';
import { useSessionStore } from '../store/sessionStore';
import { getCurrentWorkspace, workspaceLabel, switchWorkspace } from '../utils/workspace-switch';

const WorkspacesPanel: React.FC = () => {
  const items = useWorkspaceRegistry(s => s.items);
  const reg = useWorkspaceRegistry.getState();
  const sessions = useSessionStore(s => s.sessions);
  const currentWs = getCurrentWorkspace();
  const currentKey = useMemo(() => normCurrent(currentWs), [currentWs]);
  const [msgApi, contextHolder] = message.useMessage();

  // 每个工作区下的会话数 (本地 sessionStore 聚合)
  const countByPath = useMemo(() => {
    const m: Record<string, number> = {};
    for (const s of sessions) {
      const k = (s.workspace || '').trim();
      if (!k) continue;
      m[k.toLowerCase()] = (m[k.toLowerCase()] || 0) + 1;
    }
    return m;
  }, [sessions]);

  const currentIdx = items.findIndex(i => normCurrent(i.path) === currentKey);
  const currentItem = currentIdx >= 0 ? items[currentIdx] : undefined;
  const sorted = sortWorkspaces(items);

  const handleSelect = (path: string) => {
    if (switchWorkspace(path)) {
      msgApi.info(`已切换到工作区：${workspaceLabel(path)}`);
    }
  };

  // 批 2-B (2026-10-17): 真创建工作区 — 调 gateway 建目录 + .agentai/ 骨架 + 画像,
  // 建完只进清单 + 告知, **不自动切换** (与 create_workspace 工具同一语义:
  // 创建是创建, 切换是用户显式动作, 别顺手把当前会话的工作区偷走)。
  const handleCreate = async () => {
    const name = window.prompt('新工作区名称（将创建在当前工作区目录下）', '');
    if (!name || !name.trim()) return;
    const gw = (window as any).__AGENTAI_GATEWAY__ || 'http://127.0.0.1:18789';
    try {
      const res = await fetch(`${gw}/v1/workspace/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), parent: currentWs || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      reg.upsert(data.path);
      const ts = data.profile?.techStack;
      const stackHint = ts?.language ? `（${ts.language}${ts.framework ? ' + ' + ts.framework : ''}）` : '';
      msgApi.success(`已创建工作区：${data.path}${stackHint}${data.created ? '' : '（目录已存在，已补初始化）'}`);
    } catch (e: any) {
      msgApi.error(`创建工作区失败：${e?.message || e}`);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--panel)' }}>
      {contextHolder}
      {/* 顶部: 当前工作区 */}
      <div style={{ padding: '8px 6px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, color: 'var(--muted-2)', fontSize: 'var(--fs-micro)' }}>
          <AppstoreOutlined /> 当前工作区
        </div>
        {currentItem ? (
          <Tooltip title={currentItem.path}>
            <div
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderRadius: 'var(--radius-md)', background: 'var(--accent-soft)', border: '1px solid var(--accent)' }}
            >
              <FolderOutlined style={{ color: 'var(--accent)', fontSize: 'var(--fs-sm)' }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: 'var(--fg)', fontSize: 'var(--fs-md)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {currentItem.name || workspaceLabel(currentItem.path)}
                </div>
                <div style={{ color: 'var(--muted)', fontSize: 'var(--fs-micro)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'monospace' }}>
                  {currentItem.path}
                </div>
              </div>
              {currentItem.pinned && <PushpinOutlined style={{ color: 'var(--accent)', fontSize: 'var(--fs-micro)' }} />}
            </div>
          </Tooltip>
        ) : (
          <div style={{ padding: '8px', color: 'var(--muted)', fontSize: 'var(--fs-sm)' }}>未设置工作区</div>
        )}
      </div>

      {/* 列表 */}
      <div style={{ flex: 1, overflow: 'auto', padding: '6px 4px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px 8px', color: 'var(--muted-2)', fontSize: 'var(--fs-micro)' }}>
          <span>工作区清单 ({items.length})</span>
          <button
            title="新建工作区 (在当前工作区目录下创建)"
            onClick={handleCreate}
            style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3, fontSize: 'var(--fs-micro)', padding: 0 }}
          >
            <PlusOutlined /> 新建
          </button>
        </div>

        {sorted.length === 0 && (
          <div style={{ padding: '12px 8px', color: 'var(--muted)', fontSize: 'var(--fs-sm)' }}>
            还没有工作区。切换或新建后会出现在这里。
          </div>
        )}

        {sorted.map(i => {
          const isActive = normCurrent(i.path) === currentKey;
          const cnt = countByPath[i.path.toLowerCase()] || 0;
          return (
            <div
              key={i.path}
              onClick={() => handleSelect(i.path)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', marginBottom: 2, cursor: 'pointer',
                borderRadius: 'var(--radius-md)',
                background: isActive ? 'var(--card)' : 'transparent',
                borderLeft: `2px solid ${isActive ? 'var(--accent)' : 'transparent'}`,
              }}
            >
              {i.pinned && <PushpinOutlined style={{ color: 'var(--accent)', fontSize: 'var(--fs-micro)', flexShrink: 0 }} />}
              <FolderOutlined style={{ color: 'var(--fg-2)', fontSize: 'var(--fs-sm)', flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: isActive ? 'var(--fg)' : 'var(--fg-2)', fontSize: 'var(--fs-sm)', fontWeight: isActive ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {i.name || workspaceLabel(i.path)}
                </div>
                {cnt > 0 && <div style={{ color: 'var(--muted-2)', fontSize: 'var(--fs-micro)' }}>{cnt} 个会话</div>}
              </div>
              {/* 操作 (hover 才显, 阻止冒泡) */}
              <div style={{ display: 'flex', gap: 2, opacity: 0 }} className="ws-row-actions" onClick={e => e.stopPropagation()}>
                <Tooltip title={i.pinned ? '取消置顶' : '置顶'}>
                  <button onClick={() => reg.togglePin(i.path)} style={actBtn}>
                    <PushpinOutlined style={{ fontSize: 'var(--fs-micro)' }} />
                  </button>
                </Tooltip>
                <Tooltip title="改名">
                  <button onClick={() => {
                    const n = window.prompt('工作区名称', i.name || '');
                    if (n) reg.rename(i.path, n.trim());
                  }} style={actBtn}>
                    <EditOutlined style={{ fontSize: 'var(--fs-micro)' }} />
                  </button>
                </Tooltip>
                <Tooltip title="删除 (仅移除清单, 不影响工作区本身)">
                  <button onClick={() => reg.remove(i.path)} style={actBtn}>
                    <DeleteOutlined style={{ fontSize: 'var(--fs-micro)' }} />
                  </button>
                </Tooltip>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const actBtn: React.CSSProperties = {
  background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer',
  padding: '2px', borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center',
};

function normCurrent(p: string): string {
  return (p || '').trim().replace(/[\\/]+$/, '').toLowerCase();
}

export default WorkspacesPanel;
