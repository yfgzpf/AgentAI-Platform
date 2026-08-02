/**
 * SimpleGitPanel — 简化版 Git 面板
 * 真实的 GitHub OAuth 授权连接
 * 
 * 核心功能:
 * 1. 自动检测 Git 仓库
 * 2. 真实 GitHub OAuth 授权
 * 3. 简洁的变更列表
 * 4. 快速提交推送
 * 5. AI 自主保存和更新仓库
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Button, Input, List, Tag, Space, Typography, message, Spin, Select } from 'antd';
import { 
  GithubOutlined, 
  CheckCircleOutlined, 
  FileOutlined, 
  PlusOutlined,
  UploadOutlined,
  DownOutlined,
  UpOutlined,
  ReloadOutlined,
  LogoutOutlined,
  RobotOutlined,
  SaveOutlined
} from '@ant-design/icons';
import { gitService, GitStatus, GitFile } from '../services/gitService';

const { Text, Title } = Typography;
const { Option } = Select;

interface SimpleGitPanelProps {
  visible: boolean;
  onClose: () => void;
}

// GitHub OAuth 配置
const GITHUB_CLIENT_ID = 'Ov23li1p5i1eS7q7l0j6';
const GATEWAY_URL = 'http://127.0.0.1:18789';

export const SimpleGitPanel: React.FC<SimpleGitPanelProps> = ({ visible, onClose }) => {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [commitMessage, setCommitMessage] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [githubUser, setGithubUser] = useState<any>(null);
  const [expanded, setExpanded] = useState(true);
  const [repos, setRepos] = useState<any[]>([]);
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(false);

  // 加载 Git 状态
  const loadStatus = useCallback(async () => {
    try {
      const s = await gitService.getStatus();
      setStatus(s);
    } catch (e: any) {
      message.error('获取 Git 状态失败: ' + e.message);
    }
  }, []);

  // 检查 GitHub 授权状态
  const checkAuthStatus = useCallback(async () => {
    try {
      const res = await fetch(`${GATEWAY_URL}/auth/github/status`);
      const data = await res.json();
      setIsAuthenticated(data.authenticated);
      if (data.authenticated) {
        loadRepos();
      }
    } catch (e) {
      console.error('检查授权状态失败:', e);
    }
  }, []);

  // 加载仓库列表
  const loadRepos = async () => {
    try {
      const res = await fetch(`${GATEWAY_URL}/auth/github/repos`);
      const data = await res.json();
      if (data.success) {
        setRepos(data.repos);
      }
    } catch (e) {
      console.error('加载仓库列表失败:', e);
    }
  };

  // 初始加载
  useEffect(() => {
    if (!visible) return;
    loadStatus();
    checkAuthStatus();
    const interval = setInterval(() => {
      loadStatus();
      if (autoSaveEnabled) {
        autoCommit();
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [visible, loadStatus, checkAuthStatus, autoSaveEnabled]);

  // 监听 OAuth 回调
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'github-oauth-success') {
        setIsAuthenticated(true);
        setGithubUser(event.data.user);
        message.success('GitHub 授权成功');
        loadRepos();
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // GitHub OAuth 授权
  const handleGitHubAuth = () => {
    setLoading(true);
    
    // 构建 OAuth URL
    const redirectUri = encodeURIComponent(`${GATEWAY_URL}/auth/github/callback`);
    const scope = encodeURIComponent('repo user');
    const authUrl = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${redirectUri}&scope=${scope}`;
    
    // 打开授权窗口
    const width = 800;
    const height = 600;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;
    
    const popup = window.open(
      authUrl,
      'github-oauth',
      `width=${width},height=${height},left=${left},top=${top},popup=1`
    );

    // 轮询检查授权结果
    const checkPopup = setInterval(async () => {
      if (popup?.closed) {
        clearInterval(checkPopup);
        setLoading(false);
        // 重新检查授权状态
        await checkAuthStatus();
      }
    }, 1000);
  };

  // 注销授权
  const handleLogout = async () => {
    try {
      await fetch(`${GATEWAY_URL}/auth/github/logout`, { method: 'POST' });
      setIsAuthenticated(false);
      setGithubUser(null);
      setRepos([]);
      message.success('已注销 GitHub 授权');
    } catch (e) {
      message.error('注销失败');
    }
  };

  // Stage 文件
  const handleStage = async (file: GitFile) => {
    try {
      await gitService.add([file.path]);
      await loadStatus();
      message.success(`已暂存 ${file.path}`);
    } catch (e: any) {
      message.error(e.message);
    }
  };

  // 提交
  const handleCommit = async () => {
    if (!commitMessage.trim()) {
      message.warning('请输入提交信息');
      return;
    }
    setLoading(true);
    try {
      await gitService.commit(commitMessage);
      setCommitMessage('');
      await loadStatus();
      message.success('提交成功');
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  // 推送
  const handlePush = async () => {
    setLoading(true);
    try {
      await gitService.push();
      await loadStatus();
      message.success('推送成功');
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  // AI 自动保存
  const autoCommit = async () => {
    const changes = status?.summary ? 
      status.summary.modified + status.summary.added + status.summary.deleted : 0;
    
    if (changes > 0 && !loading) {
      try {
        // 暂存所有变更
        await gitService.add(['.']);
        // 自动提交
        const autoMessage = `Auto-save: ${new Date().toLocaleString('zh-CN')}`;
        await gitService.commit(autoMessage);
        // 自动推送
        await gitService.push();
        await loadStatus();
        message.success('自动保存并推送成功');
      } catch (e) {
        console.error('自动保存失败:', e);
      }
    }
  };

  // 克隆仓库到当前工作区
  const handleClone = async (repoFullName: string) => {
    setLoading(true);
    try {
      const workspace = localStorage.getItem('agentai.workspace') || process.cwd();
      const res = await fetch(`${GATEWAY_URL}/auth/github/clone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo: repoFullName, workspace }),
      });
      const data = await res.json();
      if (data.success) {
        message.success(`已克隆 ${repoFullName}`);
        // 切换到新克隆的目录
        localStorage.setItem('agentai.workspace', data.path);
        window.location.reload();
      } else {
        message.error(data.error || '克隆失败');
      }
    } catch (e: any) {
      message.error('克隆失败: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  if (!visible) return null;

  const totalChanges = status?.summary ? 
    status.summary.modified + status.summary.added + 
    status.summary.deleted + status.summary.untracked : 0;

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.panel} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={styles.header}>
          <Space>
            <GithubOutlined style={{ fontSize: 20 }} />
            <Title level={5} style={{ margin: 0 }}>
              Git {status?.branch && `· ${status.branch}`}
            </Title>
            {totalChanges > 0 && (
              <Tag color="blue">{totalChanges} 个变更</Tag>
            )}
          </Space>
          <Space>
            <Button 
              icon={<ReloadOutlined />} 
              size="small"
              onClick={loadStatus}
              loading={loading}
            />
            <Button 
              icon={expanded ? <UpOutlined /> : <DownOutlined />}
              size="small"
              onClick={() => setExpanded(!expanded)}
            />
          </Space>
        </div>

        {/* GitHub Auth */}
        {!isAuthenticated ? (
          <div style={styles.authSection}>
            <Text type="secondary">连接 GitHub 以推送代码</Text>
            <Button 
              type="primary" 
              icon={<GithubOutlined />}
              onClick={handleGitHubAuth}
              loading={loading}
              block
            >
              授权 GitHub
            </Button>
          </div>
        ) : (
          <div style={styles.authSection}>
            <Space direction="vertical" style={{ width: '100%' }}>
              <Space>
                <CheckCircleOutlined style={{ color: '#52c41a' }} />
                <Text>已连接 GitHub</Text>
                <Button 
                  icon={<LogoutOutlined />}
                  size="small"
                  onClick={handleLogout}
                >
                  断开
                </Button>
              </Space>
              
              {/* 仓库选择 */}
              <Select
                placeholder="选择仓库克隆到当前工作区"
                style={{ width: '100%' }}
                onChange={handleClone}
                loading={loading}
              >
                {repos.map(repo => (
                  <Option key={repo.full_name} value={repo.full_name}>
                    {repo.full_name} {repo.private && <Tag style={{ fontSize: 12 }}>私有</Tag>}
                  </Option>
                ))}
              </Select>

              {/* AI 自动保存 */}
              <Space>
                <RobotOutlined />
                <Text>AI 自动保存</Text>
                <Button
                  type={autoSaveEnabled ? 'primary' : 'default'}
                  size="small"
                  icon={<SaveOutlined />}
                  onClick={() => setAutoSaveEnabled(!autoSaveEnabled)}
                >
                  {autoSaveEnabled ? '已启用' : '启用'}
                </Button>
              </Space>
            </Space>
          </div>
        )}

        {expanded && (
          <>
            {/* Changes List */}
            <div style={styles.changesSection}>
              {status?.files.length === 0 ? (
                <div style={styles.empty}>
                  <CheckCircleOutlined style={{ fontSize: 32, color: '#52c41a' }} />
                  <Text type="secondary">没有未提交的变更</Text>
                </div>
              ) : (
                <List
                  size="small"
                  dataSource={status?.files || []}
                  renderItem={file => (
                    <List.Item
                      style={styles.fileItem}
                      actions={[
                        !file.staged && (
                          <Button
                            icon={<PlusOutlined />}
                            size="small"
                            type="text"
                            onClick={() => handleStage(file)}
                          />
                        )
                      ]}
                    >
                      <Space>
                        <FileOutlined />
                        <Text style={{ 
                          color: file.status === 'added' ? '#52c41a' :
                                 file.status === 'deleted' ? '#ff4d4f' :
                                 file.status === 'modified' ? '#faad14' : undefined
                        }}>
                          {file.path}
                        </Text>
                        {file.staged && <Tag style={{ fontSize: 12 }} color="success">已暂存</Tag>}
                      </Space>
                    </List.Item>
                  )}
                />
              )}
            </div>

            {/* Commit Section */}
            {totalChanges > 0 && (
              <div style={styles.commitSection}>
                <Input.TextArea
                  placeholder="输入提交信息..."
                  value={commitMessage}
                  onChange={e => setCommitMessage(e.target.value)}
                  rows={2}
                  style={{ marginBottom: 8 }}
                />
                <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
                  <Button onClick={onClose}>取消</Button>
                  <Button 
                    type="primary"
                    onClick={handleCommit}
                    loading={loading}
                    disabled={!commitMessage.trim()}
                  >
                    提交
                  </Button>
                  {isAuthenticated && (
                    <Button
                      icon={<UploadOutlined />}
                      onClick={handlePush}
                      loading={loading}
                    >
                      推送
                    </Button>
                  )}
                </Space>
              </div>
            )}
          </>
        )}
      </div>
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
    alignItems: 'center',
    justifyContent: 'center',
  },
  panel: {
    width: 480,
    maxHeight: '80vh',
    background: 'var(--panel, #1e1e1e)',
    borderRadius: 8,
    boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    padding: '12px 16px',
    borderBottom: '1px solid var(--border, #333)',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  authSection: {
    padding: 16,
    borderBottom: '1px solid var(--border, #333)',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  changesSection: {
    flex: 1,
    overflow: 'auto',
    maxHeight: 300,
  },
  fileItem: {
    padding: '8px 16px',
    borderBottom: '1px solid var(--border, #333)',
  },
  commitSection: {
    padding: 16,
    borderTop: '1px solid var(--border, #333)',
    background: 'var(--bg, #252525)',
  },
  empty: {
    padding: 40,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 12,
  },
};

export default SimpleGitPanel;
