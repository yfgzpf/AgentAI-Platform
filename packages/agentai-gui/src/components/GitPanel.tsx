/**
 * Git 面板 — 类似 Trae/ZCode 的 Git 集成界面
 * 显示文件变更、diff、提交历史，支持提交、推送、分支切换
 */

import React, { useState, useEffect, useCallback } from 'react';
import { gitService, GitStatus, GitFile, GitCommit } from '../services/gitService';
import { GitAuthPanel } from './GitAuthPanel';

interface GitPanelProps {
  visible: boolean;
  onClose: () => void;
}

type TabType = 'changes' | 'history' | 'branches';

export const GitPanel: React.FC<GitPanelProps> = ({ visible, onClose }) => {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [activeTab, setActiveTab] = useState<TabType>('changes');
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [diffContent, setDiffContent] = useState<string>('');
  const [commitMessage, setCommitMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [authPanelVisible, setAuthPanelVisible] = useState(false);

  // 加载 Git 状态
  const loadStatus = useCallback(async () => {
    try {
      const s = await gitService.getStatus();
      setStatus(s);
      if (s && s.files && s.files.length > 0 && !selectedFile) {
        setSelectedFile(s.files[0].path);
      }
    } catch (e: any) {
      setError('Failed to load git status: ' + e.message);
    }
  }, [selectedFile]);

  // 加载提交历史
  const loadCommits = useCallback(async () => {
    try {
      const log = await gitService.getLog(20);
      setCommits(log.commits);
    } catch (e: any) {
      setError('Failed to load commits: ' + e.message);
    }
  }, []);

  // 加载 diff
  const loadDiff = useCallback(async (file: string) => {
    try {
      const d = await gitService.getDiff(file);
      setDiffContent(d.diff);
    } catch (e: any) {
      setDiffContent('Error loading diff: ' + e.message);
    }
  }, []);

  // 初始加载和轮询
  useEffect(() => {
    if (!visible) return;
    
    loadStatus();
    loadCommits();
    gitService.startPolling(3000);
    const unsubscribe = gitService.onStatusChange(setStatus);

    return () => {
      gitService.stopPolling();
      unsubscribe();
    };
  }, [visible, loadStatus, loadCommits]);

  // 选中文件时加载 diff
  useEffect(() => {
    if (selectedFile) {
      loadDiff(selectedFile);
    }
  }, [selectedFile, loadDiff]);

  // Stage 文件
  const handleStage = async (files: string[]) => {
    setLoading(true);
    try {
      await gitService.add(files);
      await loadStatus();
      showSuccess(`Staged ${files.length} file(s)`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  // 提交
  const handleCommit = async () => {
    if (!commitMessage.trim()) {
      setError('Please enter a commit message');
      return;
    }
    setLoading(true);
    try {
      const result = await gitService.commit(commitMessage);
      if (result.success) {
        setCommitMessage('');
        await loadStatus();
        await loadCommits();
        showSuccess(`Committed: ${result.commitHash}`);
      } else {
        setError(result.message);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  // 推送
  const handlePush = async () => {
    setLoading(true);
    try {
      const result = await gitService.push();
      if (result.success) {
        await loadStatus();
        showSuccess(`Pushed to ${(result as any).remote || 'origin'}/${(result as any).branch || 'main'}`);
      } else {
        setError(result.message);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  // 拉取
  const handlePull = async () => {
    setLoading(true);
    try {
      const result = await gitService.pull();
      if (result.success) {
        await loadStatus();
        await loadCommits();
        showSuccess(`Pulled from ${(result as any).remote || 'origin'}/${(result as any).branch || 'main'}`);
      } else {
        setError(result.message);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const showSuccess = (msg: string) => {
    setSuccess(msg);
    setTimeout(() => setSuccess(null), 3000);
  };

  if (!visible) return null;

  const getStatusIcon = (status: GitFile['status']) => {
    switch (status) {
      case 'modified': return 'M';
      case 'added': return 'A';
      case 'deleted': return 'D';
      case 'renamed': return 'R';
      case 'untracked': return '?';
      default: return '•';
    }
  };

  const getStatusColor = (status: GitFile['status']) => {
    switch (status) {
      case 'modified': return '#e6a700';
      case 'added': return '#238636';
      case 'deleted': return '#da3633';
      case 'renamed': return '#8957e5';
      case 'untracked': return '#8b949e';
      default: return '#8b949e';
    }
  };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.panel} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={styles.header}>
          <div style={styles.headerLeft}>
            <span style={styles.icon}>📦</span>
            <span style={styles.title}>Source Control</span>
            {status && (
              <span style={styles.branchBadge}>
                <span style={styles.branchIcon}>🌿</span>
                {status.branch}
                {status.ahead > 0 && <span style={styles.ahead}>↑{status.ahead}</span>}
                {status.behind > 0 && <span style={styles.behind}>↓{status.behind}</span>}
              </span>
            )}
          </div>
          <div style={styles.headerRight}>
            <button style={styles.headerBtn} onClick={() => setAuthPanelVisible(true)} title="Git 授权配置">
              🔐
            </button>
            <button style={styles.headerBtn} onClick={handlePull} disabled={loading} title="Pull">
              ⬇️
            </button>
            <button style={styles.headerBtn} onClick={handlePush} disabled={loading} title="Push">
              ⬆️
            </button>
            <button style={styles.closeBtn} onClick={onClose}>×</button>
          </div>
        </div>

        {/* Alerts */}
        {error && <div style={styles.alertError}>{error}</div>}
        {success && <div style={styles.alertSuccess}>{success}</div>}

        {/* Tabs */}
        <div style={styles.tabs}>
          <button
            style={{ ...styles.tab, ...(activeTab === 'changes' ? styles.tabActive : {}) }}
            onClick={() => setActiveTab('changes')}
          >
            Changes {status?.summary.staged ? `(${status.summary.staged})` : ''}
          </button>
          <button
            style={{ ...styles.tab, ...(activeTab === 'history' ? styles.tabActive : {}) }}
            onClick={() => setActiveTab('history')}
          >
            History
          </button>
          <button
            style={{ ...styles.tab, ...(activeTab === 'branches' ? styles.tabActive : {}) }}
            onClick={() => setActiveTab('branches')}
          >
            Branches
          </button>
        </div>

        {/* Content */}
        <div style={styles.content}>
          {activeTab === 'changes' && (
            <div style={styles.changesTab}>
              {/* Summary */}
              {status && (
                <div style={styles.summary}>
                  <span style={styles.summaryItem}>
                    <span style={{ ...styles.dot, background: '#e6a700' }} /> {status.summary.modified} modified
                  </span>
                  <span style={styles.summaryItem}>
                    <span style={{ ...styles.dot, background: '#238636' }} /> {status.summary.added} added
                  </span>
                  <span style={styles.summaryItem}>
                    <span style={{ ...styles.dot, background: '#da3633' }} /> {status.summary.deleted} deleted
                  </span>
                  {status.summary.totalAdditions > 0 && (
                    <span style={styles.summaryItem}>
                      +{status.summary.totalAdditions} -{status.summary.totalDeletions}
                    </span>
                  )}
                </div>
              )}

              <div style={styles.changesSplit}>
                {/* File List */}
                <div style={styles.fileList}>
                  {status?.files.length === 0 && (
                    <div style={styles.empty}>No changes</div>
                  )}
                  {status?.files.map(file => (
                    <div
                      key={file.path}
                      style={{ ...styles.fileItem, ...(selectedFile === file.path ? styles.fileItemActive : {}) }}
                      onClick={() => setSelectedFile(file.path)}
                    >
                      <span style={{ ...styles.fileStatus, color: getStatusColor(file.status) }}>
                        {getStatusIcon(file.status)}
                      </span>
                      <span style={styles.filePath}>{file.path}</span>
                      {!file.staged && file.status !== 'untracked' && (
                        <button
                          style={styles.stageBtn}
                          onClick={e => { e.stopPropagation(); handleStage([file.path]); }}
                          title="Stage"
                        >
                          +
                        </button>
                      )}
                      {file.staged && <span style={styles.stagedBadge}>✓</span>}
                    </div>
                  ))}
                </div>

                {/* Diff View */}
                <div style={styles.diffView}>
                  {selectedFile ? (
                    <>
                      <div style={styles.diffHeader}>{selectedFile}</div>
                      <pre style={styles.diffContent}>{diffContent || 'Loading diff...'}</pre>
                    </>
                  ) : (
                    <div style={styles.empty}>Select a file to view diff</div>
                  )}
                </div>
              </div>

              {/* Commit Box */}
              {status && status.files.some(f => f.staged || f.status === 'untracked') && (
                <div style={styles.commitBox}>
                  <textarea
                    style={styles.commitInput}
                    placeholder="Message (Ctrl+Enter to commit)"
                    value={commitMessage}
                    onChange={e => setCommitMessage(e.target.value)}
                    onKeyDown={e => {
                      if (e.ctrlKey && e.key === 'Enter') {
                        handleCommit();
                      }
                    }}
                  />
                  <div style={styles.commitActions}>
                    <button
                      style={styles.commitBtn}
                      onClick={handleCommit}
                      disabled={loading || !commitMessage.trim()}
                    >
                      {loading ? '...' : '✓ Commit'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'history' && (
            <div style={styles.historyTab}>
              {commits.map(commit => (
                <div key={commit.hash} style={styles.commitItem}>
                  <div style={styles.commitHash}>{commit.shortHash}</div>
                  <div style={styles.commitInfo}>
                    <div style={styles.commitMessage}>{commit.message}</div>
                    <div style={styles.commitMeta}>
                      {commit.author} • {commit.date}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'branches' && (
            <div style={styles.branchesTab}>
              <div style={styles.empty}>Branch management coming soon...</div>
            </div>
          )}
        </div>
      </div>

      {/* Git 授权配置面板 */}
      <GitAuthPanel visible={authPanelVisible} onClose={() => setAuthPanelVisible(false)} />
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0,0,0,0.5)',
    zIndex: 1000,
    display: 'flex',
    justifyContent: 'flex-end',
  },
  panel: {
    width: '700px',
    height: '100%',
    background: 'var(--panel, #1e1e1e)',
    borderLeft: '1px solid var(--border, #333)',
    display: 'flex',
    flexDirection: 'column',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 16px',
    borderBottom: '1px solid var(--border, #333)',
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  icon: {
    fontSize: '18px',
  },
  title: {
    fontSize: '14px',
    fontWeight: 600,
    color: 'var(--fg, #e0e0e0)',
  },
  branchBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '4px 10px',
    background: 'var(--bg, #252525)',
    borderRadius: '4px',
    fontSize: '12px',
    color: 'var(--fg-muted, #888)',
  },
  branchIcon: {
    fontSize: '12px',
  },
  ahead: {
    color: '#238636',
    fontWeight: 600,
  },
  behind: {
    color: '#da3633',
    fontWeight: 600,
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  headerBtn: {
    padding: '6px 10px',
    background: 'transparent',
    border: '1px solid var(--border, #444)',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '14px',
  },
  closeBtn: {
    padding: '6px 12px',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    fontSize: '20px',
    color: 'var(--fg-muted, #888)',
  },
  alertError: {
    padding: '10px 16px',
    background: '#da363322',
    borderLeft: '3px solid #da3633',
    color: '#da3633',
    fontSize: '13px',
  },
  alertSuccess: {
    padding: '10px 16px',
    background: '#23863622',
    borderLeft: '3px solid #238636',
    color: '#238636',
    fontSize: '13px',
  },
  tabs: {
    display: 'flex',
    borderBottom: '1px solid var(--border, #333)',
  },
  tab: {
    padding: '12px 20px',
    background: 'transparent',
    border: 'none',
    borderBottom: '2px solid transparent',
    cursor: 'pointer',
    fontSize: '13px',
    color: 'var(--fg-muted, #888)',
  },
  tabActive: {
    color: 'var(--fg, #e0e0e0)',
    borderBottomColor: '#58a6ff',
  },
  content: {
    flex: 1,
    overflow: 'auto',
  },
  changesTab: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
  },
  summary: {
    display: 'flex',
    gap: '16px',
    padding: '12px 16px',
    borderBottom: '1px solid var(--border, #333)',
    fontSize: '12px',
    color: 'var(--fg-muted, #888)',
  },
  summaryItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  dot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
  },
  changesSplit: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden',
  },
  fileList: {
    width: '250px',
    borderRight: '1px solid var(--border, #333)',
    overflow: 'auto',
  },
  fileItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 12px',
    cursor: 'pointer',
    fontSize: '12px',
    borderBottom: '1px solid var(--border, #222)',
  },
  fileItemActive: {
    background: 'var(--bg, #252525)',
  },
  fileStatus: {
    width: '16px',
    textAlign: 'center',
    fontWeight: 600,
    fontSize: '11px',
  },
  filePath: {
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: 'var(--fg, #e0e0e0)',
  },
  stageBtn: {
    padding: '2px 6px',
    background: 'transparent',
    border: '1px solid var(--border, #444)',
    borderRadius: '3px',
    cursor: 'pointer',
    fontSize: '12px',
    color: 'var(--fg-muted, #888)',
  },
  stagedBadge: {
    color: '#238636',
    fontSize: '12px',
  },
  diffView: {
    flex: 1,
    overflow: 'auto',
    background: 'var(--bg, #0d0d0d)',
  },
  diffHeader: {
    padding: '10px 16px',
    background: 'var(--panel, #1e1e1e)',
    borderBottom: '1px solid var(--border, #333)',
    fontSize: '12px',
    fontWeight: 500,
    color: 'var(--fg, #e0e0e0)',
  },
  diffContent: {
    padding: '16px',
    margin: 0,
    fontSize: '12px',
    lineHeight: 1.5,
    fontFamily: 'monospace',
    color: 'var(--fg, #e0e0e0)',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
  },
  commitBox: {
    padding: '16px',
    borderTop: '1px solid var(--border, #333)',
    background: 'var(--panel, #1e1e1e)',
  },
  commitInput: {
    width: '100%',
    minHeight: '60px',
    padding: '10px',
    background: 'var(--bg, #0d0d0d)',
    border: '1px solid var(--border, #444)',
    borderRadius: '4px',
    color: 'var(--fg, #e0e0e0)',
    fontSize: '13px',
    resize: 'vertical',
    marginBottom: '10px',
  },
  commitActions: {
    display: 'flex',
    justifyContent: 'flex-end',
  },
  commitBtn: {
    padding: '8px 20px',
    background: '#238636',
    border: 'none',
    borderRadius: '4px',
    color: '#fff',
    fontSize: '13px',
    fontWeight: 500,
    cursor: 'pointer',
  },
  historyTab: {
    padding: '8px 0',
  },
  commitItem: {
    display: 'flex',
    gap: '12px',
    padding: '12px 16px',
    borderBottom: '1px solid var(--border, #222)',
  },
  commitHash: {
    fontFamily: 'monospace',
    fontSize: '12px',
    color: '#58a6ff',
    minWidth: '60px',
  },
  commitInfo: {
    flex: 1,
  },
  commitMessage: {
    fontSize: '13px',
    color: 'var(--fg, #e0e0e0)',
    marginBottom: '4px',
  },
  commitMeta: {
    fontSize: '11px',
    color: 'var(--fg-muted, #666)',
  },
  branchesTab: {
    padding: '16px',
  },
  empty: {
    padding: '40px',
    textAlign: 'center',
    color: 'var(--fg-muted, #666)',
    fontSize: '13px',
  },
};

export default GitPanel;
