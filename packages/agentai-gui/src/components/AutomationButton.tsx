/**
 * 自动化按钮 - 放在 Composer 底部栏
 * 快速查看和触发自动化任务
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Tooltip, Dropdown, Badge, Modal, List, Tag, Button, message } from 'antd';
import { ThunderboltOutlined, PlayCircleOutlined, PauseCircleOutlined, HistoryOutlined, PlusOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { GATEWAY_HTTP } from '../services/config';

interface AutomationTask {
  id: string;
  name: string;
  description: string;
  status: 'active' | 'paused' | 'disabled';
  type: string;
  lastRunAt?: string;
  successRate: string;
}

export const AutomationButton: React.FC = () => {
  const [tasks, setTasks] = useState<AutomationTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const navigate = useNavigate();

  const loadTasks = useCallback(async () => {
    try {
      const res = await fetch(`${GATEWAY_HTTP}/v1/automation/tasks`);
      const data = await res.json();
      if (data.tasks) {
        setTasks(data.tasks.slice(0, 5)); // 只显示前5个
      }
    } catch (e) {
      console.warn('[Automation] Failed to load tasks:', e);
    }
  }, []);

  useEffect(() => {
    loadTasks();
    const interval = setInterval(loadTasks, 30000); // 每30秒刷新
    return () => clearInterval(interval);
  }, [loadTasks]);

  const triggerTask = async (taskId: string) => {
    setLoading(true);
    try {
      const res = await fetch(`${GATEWAY_HTTP}/v1/automation/tasks/${taskId}/trigger`, {
        method: 'POST',
      });
      const data = await res.json();
      if (data.success) {
        message.success('任务已触发');
        loadTasks();
      } else {
        message.error(data.error || '触发失败');
      }
    } catch (e) {
      message.error('触发失败');
    } finally {
      setLoading(false);
    }
  };

  const activeCount = tasks.filter(t => t.status === 'active').length;

  const menuItems = [
    ...tasks.map(task => ({
      key: task.id,
      label: (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', minWidth: 200 }}>
          <Badge
            status={task.status === 'active' ? 'success' : task.status === 'paused' ? 'warning' : 'default'}
          />
          <span style={{ flex: 1, fontSize: 13 }}>{task.name}</span>
          <Tag style={{ fontSize: 10, padding: '0 4px', lineHeight: '16px' }}>{task.successRate}</Tag>
          {task.status === 'active' && (
            <PlayCircleOutlined
              style={{ color: '#52c41a', cursor: 'pointer' }}
              onClick={(e) => { e.stopPropagation(); triggerTask(task.id); }}
            />
          )}
        </div>
      ),
      onClick: () => {},
    })),
    { type: 'divider' as const },
    {
      key: 'manage',
      label: (
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <HistoryOutlined /> 管理自动化
        </span>
      ),
      onClick: () => navigate('/automation'),
    },
    {
      key: 'create',
      label: (
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <PlusOutlined /> 创建任务
        </span>
      ),
      onClick: () => navigate('/automation?create=true'),
    },
  ];

  return (
    <>
      <Dropdown
        menu={{ items: menuItems }}
        placement="topLeft"
        trigger={['click']}
      >
        <Tooltip title={`自动化任务 (${activeCount} 个运行中)`}>
          <button
            className="icon-btn-sm"
            style={{
              color: activeCount > 0 ? '#faad14' : 'var(--muted-2)',
              position: 'relative',
            }}
          >
            <ThunderboltOutlined style={{ fontSize: 14 }} />
            {activeCount > 0 && (
              <span
                style={{
                  position: 'absolute',
                  top: 2,
                  right: 2,
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: '#faad14',
                }}
              />
            )}
          </button>
        </Tooltip>
      </Dropdown>
    </>
  );
};

export default AutomationButton;
