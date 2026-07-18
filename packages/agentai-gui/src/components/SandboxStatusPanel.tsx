/**
 * SandboxStatusPanel — 沙箱状态展示面板
 * ----------------------------------------------------
 * 实时显示 AI 执行环境的安全边界和状态:
 *   - 沙箱是否启用
 *   - 文件访问白名单
 *   - 命令执行限制
 *   - 网络访问限制
 *   - 当前工作目录
 *
 * 数据源: Gateway /v1/sandbox/status 端点
 */
import React, { useEffect, useState, useCallback } from 'react';
import { Card, Tag, Badge, Space, Tooltip, Collapse } from 'antd';
import {
  SafetyOutlined, FolderOutlined, BlockOutlined,
  GlobalOutlined, CheckCircleOutlined, CloseCircleOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { apiGet } from '../services/api';

interface SandboxStatus {
  enabled: boolean;
  workingDir: string;
  fileWhitelist: string[];
  fileDenylist: string[];
  commandWhitelist: string[];
  commandDenylist: string[];
  networkAccess: 'allow' | 'deny' | 'whitelist';
  networkWhitelist: string[];
  cpuLimit?: number;
  memoryLimit?: number;
  timeout?: number;
}

interface Props {
  className?: string;
}

export const SandboxStatusPanel: React.FC<Props> = ({ className }) => {
  const [status, setStatus] = useState<SandboxStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await apiGet('/v1/sandbox/status');
      if (res.ok && res.data) {
        setStatus(res.data);
        setError(null);
      } else {
        setError(res.error || '获取沙箱状态失败');
      }
    } catch (e: any) {
      setError(e.message || '网络错误');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    // 每30秒刷新一次
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  if (loading) return <div style={{ padding: 16, textAlign: 'center' }}>加载中...</div>;
  if (error) {
    return (
      <Card size="small" style={{ margin: 16 }}>
        <div style={{ color: '#f85149', fontSize: 12 }}>
          <WarningOutlined /> {error}
        </div>
      </Card>
    );
  }

  if (!status) return null;

  const sections = [
    {
      title: '🛡️ 沙箱状态',
      items: [
        { label: '启用', value: status.enabled ? '是' : '否', color: status.enabled ? '#3fb950' : '#f85149' },
        { label: '工作目录', value: status.workingDir, color: '#58a6ff' },
      ],
    },
    {
      title: '📁 文件访问',
      items: [
        { label: '白名单', value: `${status.fileWhitelist.length} 项`, color: '#3fb950' },
        { label: '黑名单', value: `${status.fileDenylist.length} 项`, color: '#f85149' },
      ],
    },
    {
      title: '⚡ 命令限制',
      items: [
        { label: '允许命令', value: `${status.commandWhitelist.length} 项`, color: '#3fb950' },
        { label: '禁止命令', value: `${status.commandDenylist.length} 项`, color: '#f85149' },
      ],
    },
    {
      title: '🌐 网络访问',
      items: [
        { label: '模式', value: status.networkAccess, color: status.networkAccess === 'allow' ? '#3fb950' : status.networkAccess === 'deny' ? '#f85149' : '#d29922' },
        { label: '白名单', value: `${status.networkWhitelist.length} 项`, color: '#58a6ff' },
      ],
    },
  ];

  return (
    <Card
      size="small"
      style={{ margin: 16, background: '#0d1117' }}
      title={
        <Space>
          <SafetyOutlined style={{ color: '#58a6ff' }} />
          <span style={{ fontSize: 13 }}>沙箱状态</span>
          <Badge
            status={status.enabled ? 'success' : 'error'}
            text={status.enabled ? '已启用' : '未启用'}
          />
        </Space>
      }
    >
      <Collapse
        size="small"
        defaultActiveKey={['0']}
        items={sections.map((section, idx) => ({
          key: String(idx),
          label: section.title,
          children: (
            <Space direction="vertical" size="small" style={{ width: '100%' }}>
              {section.items.map((item, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <span style={{ color: '#8b949e' }}>{item.label}</span>
                  <span style={{ color: item.color, fontFamily: 'monospace' }}>
                    {item.value}
                  </span>
                </div>
              ))}
            </Space>
          ),
        }))}
      />
    </Card>
  );
};
