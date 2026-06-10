/**
 * 智能清理器面板 (GUI)
 * - 展示清理器状态 (lastScan / lastFullRun / pendingRiskyPlans / cumulativeBytes / alertsLast24h)
 * - 一键扫描 / 触发清理
 * - 风险计划确认 (approve / reject)
 * - 规则只读预览
 *
 * 接口约定参考 packages/agentai-gateway/src/index.ts 中 /v1/cleaner/* 端点
 */
import React, { useEffect, useState, useCallback } from 'react';
import {
  Card, Button, Space, Tag, Alert, Descriptions, Empty, Spin, Collapse, Popconfirm, message, Statistic, Row, Col, Tooltip,
} from 'antd';
import {
  ThunderboltOutlined, ReloadOutlined, CheckCircleOutlined, StopOutlined, WarningOutlined, SafetyOutlined, ClockCircleOutlined,
} from '@ant-design/icons';
import { apiGet, apiPost } from '../services/api';

/* ═════════════════════════════════════════════════════
   类型定义
   ═════════════════════════════════════════════════════ */

interface CleanerState {
  version: number;
  lastFullRun: number;
  lastScan: number;
  pendingRiskyPlans: RiskyPlan[];
  cumulativeBytes: number;
  alertsLast24h: number;
  lastRuleReload: number;
  nextQuickCheckAt: number;   // 下次磁盘检查时间 (ms); 0=未调度
  nextFullRunAt: number;      // 下次全量清理预估时间 (ms); 0=未调度
}

interface RiskyPlan {
  planId: string;
  ruleId: string;
  file: string;
  size: number;
  reason: string;
  action: string;
  createdAt: number;
}

interface CleanerRule {
  id: string;
  match: { path?: string; name?: string; ext?: string; mtimeDaysAgo?: number; sizeGtMb?: number };
  action: 'delete' | 'gzip' | 'move' | 'llm-free-archive' | 'alert';
  risk: 'safe' | 'risky' | 'alert';
  reason?: string;
  target?: string;
}

interface ScanResult {
  ok: boolean;
  bytesFreed: number;
  riskyCount: number;
  alertCount: number;
  scannedCount: number;
  failures: number;
}

/* ═════════════════════════════════════════════════════
   工具函数
   ═════════════════════════════════════════════════════ */

function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i > 0 ? 2 : 1)} ${units[i]}`;
}

function formatTime(ms: number): string {
  if (!ms) return '—';
  const d = new Date(ms);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const riskColor = (r: string) => r === 'safe' ? 'green' : r === 'risky' ? 'orange' : 'red';

/* ═════════════════════════════════════════════════════
   主组件
   ═════════════════════════════════════════════════════ */

export const CleanerPanel: React.FC = () => {
  const [state, setState] = useState<CleanerState | null>(null);
  const [rules, setRules] = useState<CleanerRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [lastScan, setLastScan] = useState<ScanResult | null>(null);

  /** 加载清理器状态 */
  const loadState = useCallback(async () => {
    setLoading(true);
    try {
      const s = await apiGet<CleanerState>('/v1/cleaner/status');
      setState(s);
    } catch (e: any) {
      message.error('加载状态失败: ' + (e?.message || '未知错误'));
    } finally {
      setLoading(false);
    }
  }, []);

  /** 加载规则 */
  const loadRules = useCallback(async () => {
    try {
      const r = await apiGet<{ rules: CleanerRule[] }>('/v1/cleaner/rules');
      setRules(r?.rules || []);
    } catch {
      // 静默: 规则可能未配置
      setRules([]);
    }
  }, []);

  useEffect(() => {
    loadState();
    loadRules();
    const t = setInterval(() => { loadState(); }, 15000);
    return () => clearInterval(t);
  }, [loadState, loadRules]);

  /** 一键扫描 (safe scope) */
  const handleScan = async () => {
    setScanning(true);
    try {
      const r = await apiPost<ScanResult>('/v1/cleaner/scan', {});
      setLastScan(r);
      message.success(`扫描完成: 释放 ${formatBytes(r.bytesFreed)} / 风险 ${r.riskyCount} / 告警 ${r.alertCount}`);
      await loadState();
    } catch (e: any) {
      message.error('扫描失败: ' + (e?.message || '未知错误'));
    } finally {
      setScanning(false);
    }
  };

  /** 确认/拒绝 风险计划 */
  const handleConfirm = async (planId: string, action: 'approve' | 'reject') => {
    setConfirmingId(planId);
    try {
      const r = await apiPost<{ ok: boolean; reason?: string }>('/v1/cleaner/confirm', { planId, action });
      if (r?.ok) {
        message.success(action === 'approve' ? '✓ 已批准并执行' : '✓ 已拒绝');
        await loadState();
      } else {
        message.warning(r?.reason || '操作未生效');
      }
    } catch (e: any) {
      message.error('操作失败: ' + (e?.message || '未知错误'));
    } finally {
      setConfirmingId(null);
    }
  };

  /** 用户心跳 (通知清理器用户活跃) */
  const handleHeartbeat = async () => {
    try {
      await apiPost('/v1/cleaner/heartbeat', {});
      message.success('已上报心跳,清理器会避开你的操作');
    } catch (e: any) {
      message.error('心跳失败: ' + (e?.message || '未知错误'));
    }
  };

  /* ---------- 渲染 ---------- */

  if (loading && !state) {
    return <div style={{ padding: 24, textAlign: 'center' }}><Spin tip="加载清理器状态..." /></div>;
  }

  const s = state;
  const pending = s?.pendingRiskyPlans || [];

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={16}>

      {/* 顶部说明 */}
      <Alert
        type="info"
        showIcon
        message="智能清理器 (仿 360 风格)"
        description={
          <span>
            自动扫描 <code>~/.agentai</code> 下的临时/缓存/审计归档,SAFE 规则直接执行,RISKY 需在此确认,ALERT 仅告警不执行。
            清理状态在 Gateway 端持久化,GUI 仅做展示与确认。
          </span>
        }
      />

      {/* 状态卡片 */}
      <Card title={<span><SafetyOutlined /> 清理器状态</span>} extra={
        <Space>
          <Tooltip title="上报用户心跳,告诉清理器当前用户活跃">
            <Button icon={<ThunderboltOutlined />} onClick={handleHeartbeat}>心跳</Button>
          </Tooltip>
          <Button icon={<ReloadOutlined />} onClick={loadState} loading={loading}>刷新</Button>
        </Space>
      }>
        {s ? (
          <>
            <Row gutter={16}>
              <Col span={6}><Statistic title="最近扫描" value={formatTime(s.lastScan)} /></Col>
              <Col span={6}><Statistic title="最近完整清理" value={formatTime(s.lastFullRun)} /></Col>
              <Col span={6}><Statistic title="累计释放" value={formatBytes(s.cumulativeBytes)} /></Col>
              <Col span={6}><Statistic
                title="24h 告警"
                value={s.alertsLast24h}
                valueStyle={{ color: s.alertsLast24h > 0 ? '#cf1322' : undefined }}
              /></Col>
            </Row>

            <Card
              size="small"
              title={<span><ClockCircleOutlined /> 调度状态</span>}
              style={{ marginTop: 12 }}
            >
              <Descriptions size="small" column={1} bordered>
                <Descriptions.Item label="下次磁盘检查">
                  {formatRelative(s.nextQuickCheckAt)}
                </Descriptions.Item>
                <Descriptions.Item label="下次全量清理">
                  {formatRelative(s.nextFullRunAt)}
                </Descriptions.Item>
              </Descriptions>
            </Card>
          </>
        ) : (
          <Empty description="无状态数据" />
        )}
      </Card>

      {/* 操作 + 上次扫描结果 */}
      <Card title={<span><ThunderboltOutlined /> 触发清理</span>}>
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <Space wrap>
            <Popconfirm
              title="执行安全扫描?"
              description="将按 SAFE 规则自动删除/压缩缓存文件,不会触碰工作区"
              okText="执行"
              cancelText="取消"
              onConfirm={handleScan}
            >
              <Button type="primary" icon={<ThunderboltOutlined />} loading={scanning}>
                一键扫描 (safe)
              </Button>
            </Popconfirm>
            <Tooltip title="每次扫描会自动调用 /v1/cleaner/scan">
              <span style={{ color: 'rgba(255,255,255,0.45)' }}>执行范围: 仅 safe 规则自动处理,risky 需下方确认</span>
            </Tooltip>
          </Space>
          {lastScan && (
            <Alert
              type={lastScan.failures > 0 ? 'warning' : 'success'}
              showIcon
              message="最近一次扫描结果"
              description={
                <span>
                  扫描文件 {lastScan.scannedCount} 个, 释放 {formatBytes(lastScan.bytesFreed)},
                  风险计划 {lastScan.riskyCount} 个, 告警 {lastScan.alertCount} 个, 失败 {lastScan.failures} 个
                </span>
              }
            />
          )}
        </Space>
      </Card>

      {/* 风险计划列表 */}
      <Card title={<span><WarningOutlined /> 风险计划 ({pending.length})</span>}>
        {pending.length === 0 ? (
          <Empty description="暂无待确认的风险计划" />
        ) : (
          <Space direction="vertical" style={{ width: '100%' }} size={8}>
            {pending.map((p) => (
              <Card key={p.planId} size="small" type="inner"
                title={<Space><Tag color="orange">RISKY</Tag><code>{p.planId}</code></Space>}
                extra={
                  <Space>
                    <Button
                      type="primary" size="small" icon={<CheckCircleOutlined />}
                      loading={confirmingId === p.planId}
                      onClick={() => handleConfirm(p.planId, 'approve')}
                    >批准</Button>
                    <Button
                      danger size="small" icon={<StopOutlined />}
                      loading={confirmingId === p.planId}
                      onClick={() => handleConfirm(p.planId, 'reject')}
                    >拒绝</Button>
                  </Space>
                }
              >
                <Descriptions size="small" column={1}>
                  <Descriptions.Item label="规则"><code>{p.ruleId}</code></Descriptions.Item>
                  <Descriptions.Item label="文件"><code>{p.file}</code></Descriptions.Item>
                  <Descriptions.Item label="大小">{formatBytes(p.size)}</Descriptions.Item>
                  <Descriptions.Item label="动作"><Tag color="blue">{p.action}</Tag></Descriptions.Item>
                  <Descriptions.Item label="原因">{p.reason || '—'}</Descriptions.Item>
                  <Descriptions.Item label="创建时间">{formatTime(p.createdAt)}</Descriptions.Item>
                </Descriptions>
              </Card>
            ))}
          </Space>
        )}
      </Card>

      {/* 规则只读预览 */}
      <Card title="规则预览 (只读)">
        <Collapse ghost>
          <Collapse.Panel header={`已加载 ${rules.length} 条规则`} key="rules">
            {rules.length === 0 ? (
              <Empty description="无规则 (Gateway 启动时未加载 rules.json)" />
            ) : (
              <Space direction="vertical" style={{ width: '100%' }} size={8}>
                {rules.map((r) => (
                  <Card key={r.id} size="small" type="inner"
                    title={<Space><Tag color={riskColor(r.risk)}>{r.risk.toUpperCase()}</Tag><code>{r.id}</code></Space>}
                  >
                    <Space direction="vertical" size={4} style={{ width: '100%' }}>
                      <div><b>动作:</b> <Tag color="blue">{r.action}</Tag></div>
                      <div><b>匹配:</b> <code style={{ wordBreak: 'break-all' }}>{JSON.stringify(r.match)}</code></div>
                      {r.target && <div><b>目标:</b> <code style={{ wordBreak: 'break-all' }}>{r.target}</code></div>}
                      {r.reason && <div><b>说明:</b> {r.reason}</div>}
                    </Space>
                  </Card>
                ))}
              </Space>
            )}
          </Collapse.Panel>
        </Collapse>
      </Card>
    </Space>
  );
};

/**
 * 把时间戳格式化为相对时间显示(纯函数, 测试时注入 now)
 * @param ts 目标时间戳 (ms)
 * @param now 基准时间戳 (ms), 默认为 Date.now()。测试时注入固定值
 */
export function formatRelative(ts: number, now: number = Date.now()): string {
  if (!ts || isNaN(ts)) return '未调度';
  const diff = ts - now;
  if (diff <= 0) return '即将执行';
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec} 秒后`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分钟后`;
  const hr = Math.floor(min / 60);
  const minLeft = min % 60;
  if (hr < 24) return minLeft > 0 ? `${hr} 小时 ${minLeft} 分后` : `${hr} 小时后`;
  const day = Math.floor(hr / 24);
  return `${day} 天后`;
}

export default CleanerPanel;
