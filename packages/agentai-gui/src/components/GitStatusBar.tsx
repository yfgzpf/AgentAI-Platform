/**
 * Git 状态栏 — 类似 Trae/ZCode 底部的 Git 状态显示
 * 显示当前分支、变更文件数、 ahead/behind 数量
 *
 * 修复: 添加 8 秒超时控制，防止网关未响应时永久 pending
 */

import React, { useState, useEffect, useCallback } from 'react';
import { gitService, GitStatus } from '../services/gitService';

interface GitStatusBarProps {
  onClick?: () => void;
}

export const GitStatusBar: React.FC<GitStatusBarProps> = ({ onClick }) => {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorHint, setErrorHint] = useState<string>('');

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setErrorHint('');
    try {
      // 添加 8 秒超时，防止网关未响应时永久 pending
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      const s = await gitService.getStatus({ signal: controller.signal });
      clearTimeout(timeoutId);
      if (s) setStatus(s);
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        setErrorHint('timeout');
        console.warn('[GitStatusBar] 网关请求超时 (>8s)，可能 gateway 未启动');
      } else {
        setErrorHint('error');
        console.warn('[GitStatusBar] 获取状态失败:', err?.message || err);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
    // 每 10 秒轮询一次（从 5s 改为 10s 减少无效请求）
    const interval = setInterval(loadStatus, 10000);
    return () => clearInterval(interval);
  }, [loadStatus]);

  // 监听外部触发刷新
  useEffect(() => {
    const handle = () => loadStatus();
    window.addEventListener('git:refresh', handle);
    return () => window.removeEventListener('git:refresh', handle);
  }, [loadStatus]);

  // 监听工作区变更，自动刷新 Git 状态
  useEffect(() => {
    const handleWorkspaceChange = () => {
      loadStatus();
    };
    window.addEventListener('agentai:workspace-changed', handleWorkspaceChange);
    return () => window.removeEventListener('agentai:workspace-changed', handleWorkspaceChange);
  }, [loadStatus]);

  // 错误/超时降级显示
  if (errorHint === 'timeout') {
    return (
      <div style={styles.container} onClick={onClick} title="网关未响应，请确认 gateway 已启动">
        <span style={styles.icon}>⚠️</span>
        <span style={{ ...styles.text, color: '#eab308' }}>Git 超时</span>
      </div>
    );
  }

  if (!status || !status.summary) {
    return (
      <div style={styles.container} onClick={onClick}>
        <span style={styles.icon}>📦</span>
        <span style={styles.text}>Git</span>
        {loading && <span style={styles.spinner}>⟳</span>}
      </div>
    );
  }

  const totalChanges = status.summary.modified + status.summary.added + status.summary.deleted + status.summary.untracked;

  // ⚠️ gateway 在 git 取不到分支时返回字面量 'unknown' (routes/git-simple.ts:48),
  //    直接渲染成 "🌿 unknown" —— 一个给机器看的哨兵值泄漏到了用户界面。
  //    常见诱因: 工作区被设成了一个非仓库目录 (如盘符根 F:\), 见 workspace.json。
  //    这里不给 sentinel 兜底文案, 而是明确告诉用户"这不是仓库", 并解释为什么。
  const hasBranch = !!status.branch && status.branch !== 'unknown';

  return (
    <div style={styles.container} onClick={onClick}>
      {/* Branch */}
      {hasBranch ? (
        <span style={styles.branch}>
          <span style={styles.branchIcon}>🌿</span>
          {status.branch}
        </span>
      ) : (
        <span style={styles.text} title={`当前工作区不是 Git 仓库, 或 git 不可用\n(${status.branch || '无分支信息'})`}>
          📦 非 Git 仓库
        </span>
      )}

      {/* Changes */}
      {/* 2026-10-11: 原来直接渲染 `-30528` —— 5 位数、无单位、无说明, 用户看不出这是"删除了
          30528 行"。加千分位 + 单位 + 悬浮说明 (title, 不引入新的 antd 依赖)。 */}
      {totalChanges > 0 && (
        <span
          style={styles.changes}
          title={
            `已变更 ${totalChanges} 个文件` +
            (status.summary.totalAdditions > 0 ? `\n新增 ${status.summary.totalAdditions.toLocaleString()} 行` : '') +
            (status.summary.totalDeletions > 0 ? `\n删除 ${status.summary.totalDeletions.toLocaleString()} 行` : '') +
            `\n点击打开 Git 面板`
          }
        >
          <span style={styles.changeIcon}>✏️</span>
          {totalChanges} 个文件
          {status.summary.totalAdditions > 0 && (
            <span style={styles.additions}>+{status.summary.totalAdditions.toLocaleString()}</span>
          )}
          {status.summary.totalDeletions > 0 && (
            <span style={styles.deletions}>−{status.summary.totalDeletions.toLocaleString()}</span>
          )}
        </span>
      )}

      {/* Ahead/Behind */}
      {(status.ahead > 0 || status.behind > 0) && (
        <span style={styles.sync}>
          {status.ahead > 0 && <span style={styles.ahead}>↑{status.ahead}</span>}
          {status.behind > 0 && <span style={styles.behind}>↓{status.behind}</span>}
        </span>
      )}

      {/* Sync indicator */}
      {loading && <span style={styles.spinner}>⟳</span>}
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    // 2026-10-11: 原 padding '4px 12px' + fontSize 12 → 实测整块高 31px,
    // 而宿主 .app-statusbar 只有 24px (agentai-theme.css:907) → 底栏被顶出 4px,
    // 全页多出一条 4px 滚动条 (活体 DOM: body.scrollHeight 724 vs clientHeight 720)。
    // 改为无纵向内边距 + height 100% + 继承 11px 字号, 与底栏对齐。
    padding: '0 10px',
    height: '100%',
    boxSizing: 'border-box',
    background: 'var(--bg, #252525)',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '11px',
    color: 'var(--fg, #e0e0e0)',
    transition: 'background 0.2s',
    userSelect: 'none',
  },
  icon: {
    fontSize: '14px',
  },
  text: {
    color: 'var(--fg-muted)',
  },
  branch: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    fontWeight: 500,
  },
  branchIcon: {
    fontSize: '10px',
  },
  changes: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '2px 8px',
    background: 'var(--panel, #1e1e1e)',
    borderRadius: '3px',
  },
  changeIcon: {
    fontSize: '10px',
  },
  additions: {
    color: '#238636',
    fontWeight: 500,
  },
  deletions: {
    color: '#da3633',
    fontWeight: 500,
  },
  sync: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
  },
  ahead: {
    color: '#238636',
    fontWeight: 600,
  },
  behind: {
    color: '#da3633',
    fontWeight: 600,
  },
  spinner: {
    animation: 'spin 1s linear infinite',
    fontSize: '12px',
  },
};

export default GitStatusBar;
