/**
 * SandboxResultPanel — 沙箱执行结果展示面板
 * ----------------------------------------------------
 * 轻量级内联面板, 在 ChatView 底部展示:
 *   - 沙箱启用状态 (指示灯)
 *   - AI 最近执行的沙箱结果 (代码 + 输出 + 错误)
 *   - 可折叠/展开
 *
 * 数据源: taskOrchestratorStore.sandboxRuns + Gateway /v1/sandbox/status
 */
import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Tag, Badge, Space,
} from 'antd';
import {
  SafetyOutlined, CheckCircleOutlined, CloseCircleOutlined,
  LoadingOutlined, PlayCircleOutlined, WarningOutlined,
  CodeOutlined,
} from '@ant-design/icons';
import { useTaskOrchestrator, type SandboxRecord } from '../store/taskOrchestratorStore';
import { apiGet } from '../services/api';

interface SandboxConfig {
  enabled: boolean;
  workingDir: string;
}

export const SandboxResultPanel: React.FC = () => {
  const { activeTask, lastCompletedTask } = useTaskOrchestrator();
  const [config, setConfig] = useState<SandboxConfig | null>(null);
  const [expanded, setExpanded] = useState(true);

  // 获取沙箱配置
  const fetchConfig = useCallback(async () => {
    try {
      const res = await apiGet('/v1/sandbox/status');
      if (res.ok && res.data) {
        setConfig({
          enabled: res.data.enabled,
          workingDir: res.data.workingDir,
        });
      }
    } catch { /* Gateway 不可达 */ }
  }, []);

  useEffect(() => {
    fetchConfig();
    const interval = setInterval(fetchConfig, 30000);
    return () => clearInterval(interval);
  }, [fetchConfig]);

  // 合并活跃任务 + 最近完成任务的沙箱执行记录
  const sandboxRuns: SandboxRecord[] = useMemo(() => {
    const runs: SandboxRecord[] = [];
    if (activeTask) {
      runs.push(...activeTask.sandboxRuns);
    }
    if (lastCompletedTask && !activeTask) {
      runs.push(...lastCompletedTask.sandboxRuns);
    }
    return runs;
  }, [activeTask, lastCompletedTask]);

  // 无沙箱执行记录且沙箱未启用 → 不显示
  if (sandboxRuns.length === 0 && !config?.enabled) return null;

  const latestRun = sandboxRuns[sandboxRuns.length - 1];

  return (
    <div style={{
      margin: '0 16px 4px',
      borderRadius: 6,
      background: 'var(--panel)',
      border: '1px solid var(--border)',
      overflow: 'hidden',
      fontSize: 11,
    }}>
      {/* 标题栏 */}
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '4px 10px',
          background: 'rgba(88,166,255,0.04)',
          borderBottom: expanded ? '1px solid var(--border)' : 'none',
          cursor: 'pointer',
        }}
      >
        <SafetyOutlined style={{ color: config?.enabled ? '#4ade80' : '#666', fontSize: 12 }} />
        <span style={{ fontWeight: 600, color: 'var(--fg-2)', fontSize: 11 }}>沙箱</span>

        {config && (
          <Badge
            status={config.enabled ? 'success' : 'default'}
            text={<span style={{ fontSize: 10, color: config.enabled ? '#4ade80' : 'var(--muted-2)' }}>
              {config.enabled ? '已启用' : '未启用'}
            </span>}
          />
        )}

        {sandboxRuns.length > 0 && (
          <Tag color={latestRun?.status === 'success' ? 'success' : latestRun?.status === 'failed' ? 'error' : 'processing'}
            style={{ fontSize: 9, margin: 0, marginLeft: 4 }}>
            {sandboxRuns.length} 次执行
          </Tag>
        )}

        <span style={{ marginLeft: 'auto', color: 'var(--muted-2)', fontSize: 9 }}>
          {expanded ? '▲' : '▼'}
        </span>
      </div>

      {/* 展开内容: 最新执行结果 */}
      {expanded && latestRun && (
        <div style={{ padding: '6px 10px' }}>
          {/* 执行状态 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            {latestRun.status === 'success' ? (
              <CheckCircleOutlined style={{ color: '#4ade80', fontSize: 12 }} />
            ) : latestRun.status === 'failed' ? (
              <CloseCircleOutlined style={{ color: '#ef4444', fontSize: 12 }} />
            ) : (
              <LoadingOutlined style={{ color: '#58a6ff', fontSize: 12 }} />
            )}
            <span style={{ color: latestRun.status === 'success' ? '#4ade80' : latestRun.status === 'failed' ? '#ef4444' : '#58a6ff', fontWeight: 600 }}>
              {latestRun.status === 'success' ? '执行成功' : latestRun.status === 'failed' ? '执行失败' : '执行中...'}
            </span>
            <Tag style={{ fontSize: 9, margin: 0 }}>{latestRun.language}</Tag>
            {latestRun.exitCode !== undefined && (
              <span style={{ fontSize: 9, color: 'var(--muted-2)' }}>exit: {latestRun.exitCode}</span>
            )}
            {latestRun.durationMs !== undefined && (
              <span style={{ fontSize: 9, color: 'var(--muted-2)' }}>{latestRun.durationMs}ms</span>
            )}
          </div>

          {/* 代码 */}
          <div style={{ marginBottom: 4 }}>
            <div style={{ color: 'var(--muted-2)', fontSize: 9, marginBottom: 2 }}>
              <CodeOutlined style={{ marginRight: 4 }} />代码:
            </div>
            <pre style={{
              margin: 0, fontSize: 10, fontFamily: 'Consolas, monospace',
              color: '#c9d1d9', background: '#0a0a0a',
              padding: '3px 6px', borderRadius: 3,
              overflow: 'auto', maxHeight: 60,
              border: '1px solid var(--border)',
            }}>
              {latestRun.code.slice(0, 300)}
              {latestRun.code.length > 300 ? '\n...' : ''}
            </pre>
          </div>

          {/* 输出 */}
          {latestRun.output && (
            <div style={{ marginBottom: 4 }}>
              <div style={{ color: '#4ade80', fontSize: 9, marginBottom: 2 }}>✓ 输出:</div>
              <pre style={{
                margin: 0, fontSize: 10, fontFamily: 'Consolas, monospace',
                color: '#7ee787', background: '#0a0a0a',
                padding: '3px 6px', borderRadius: 3,
                overflow: 'auto', maxHeight: 60,
                border: '1px solid rgba(78,233,135,0.15)',
              }}>
                {latestRun.output.slice(0, 300)}
                {latestRun.output.length > 300 ? '\n...' : ''}
              </pre>
            </div>
          )}

          {/* 错误 */}
          {latestRun.error && (
            <div>
              <div style={{ color: '#f97583', fontSize: 9, marginBottom: 2 }}>❌ 错误:</div>
              <pre style={{
                margin: 0, fontSize: 10, fontFamily: 'Consolas, monospace',
                color: '#f97583', background: 'rgba(249,117,131,0.04)',
                padding: '3px 6px', borderRadius: 3,
                overflow: 'auto', maxHeight: 40,
                border: '1px solid rgba(249,117,131,0.15)',
              }}>
                {latestRun.error.slice(0, 200)}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* 展开但无执行记录 */}
      {expanded && !latestRun && (
        <div style={{ padding: '8px 10px', color: 'var(--muted-2)', fontSize: 10 }}>
          {config?.enabled ? '🛡️ 沙箱已就绪, AI 执行代码时将显示结果' : '⚠️ 沙箱未启用'}
        </div>
      )}
    </div>
  );
};

export default SandboxResultPanel;
