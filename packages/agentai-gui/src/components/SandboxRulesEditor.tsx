/**
 * Sandbox 规则编辑器 v3.2
 *
 * 用法:
 *   <SandboxRulesEditor />
 *
 * 拉取 /v1/sandbox/rules 显示, 改后 PUT 回去
 * 支持:
 *   - allow / deny / prompt 3 个 glob 列表 (textarea, 一行一个)
 *   - maxFileSize / maxTotalSize (字节)
 *   - 一键恢复默认
 *   - 试检查 (输入路径 + op → 调 /v1/sandbox/check 显示 verdict)
 *   - 路径预置: 自动识别盘符 + 常用目录, 点击加入 allow 列表
 */

import React, { useEffect, useState } from 'react';
import { Card, Input, Button, Space, Tag, Alert, message, InputNumber, Select, Divider, Tooltip, Switch, Typography } from 'antd';
import { SecurityScanOutlined, SafetyOutlined, ReloadOutlined, ExperimentOutlined, CheckCircleOutlined, StopOutlined, QuestionCircleOutlined, PlusOutlined, HddOutlined, FolderOutlined, HomeOutlined } from '@ant-design/icons';
import { GATEWAY_HTTP } from '../services/config';

const { TextArea } = Input;
const { Text } = Typography;

interface SandboxRules {
  allow: string[];
  deny: string[];
  prompt: string[];
  maxFileSize?: number;
  maxTotalSize?: number;
  exclude?: string[];
  version?: number;
  updatedAt?: number;
}

interface SandboxStatus {
  rules: SandboxRules;
  loaded: boolean;
  enabled: boolean;
  source: 'file' | 'default' | 'invalid' | 'unknown';
  rulesPath: string;
  mtime: number;
  lastReload: number;
}

interface PathPreset {
  path: string;
  label: string;
  category: 'drive' | 'user' | 'workspace' | 'common';
}

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  drive: <HddOutlined />,
  user: <FolderOutlined />,
  workspace: <HomeOutlined />,
  common: <FolderOutlined />,
};

const CATEGORY_COLORS: Record<string, string> = {
  drive: 'blue',
  user: 'green',
  workspace: 'purple',
  common: 'cyan',
};

const httpUrl = () => GATEWAY_HTTP;

const VERDICT_COLOR: Record<string, string> = {
  allow: 'green',
  deny: 'red',
  prompt: 'orange',
  error: 'volcano',
};

const VERDICT_ICON: Record<string, React.ReactNode> = {
  allow: <CheckCircleOutlined />,
  deny: <StopOutlined />,
  prompt: <QuestionCircleOutlined />,
  error: <StopOutlined />,
};

export const SandboxRulesEditor: React.FC = () => {
  const [status, setStatus] = useState<SandboxStatus | null>(null);
  const [allow, setAllow] = useState('');
  const [deny, setDeny] = useState('');
  const [prompt, setPrompt] = useState('');
  const [maxFileSize, setMaxFileSize] = useState<number | null>(null);
  const [maxTotalSize, setMaxTotalSize] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [probe, setProbe] = useState({ path: '', op: 'read' as 'read' | 'write' | 'delete' | 'execute' });
  const [probeResult, setProbeResult] = useState<any>(null);

  const [sandboxUnavailable, setSandboxUnavailable] = useState(false);

  // 路径预置
  const [presets, setPresets] = useState<PathPreset[]>([]);
  const [presetsLoading, setPresetsLoading] = useState(false);

  const loadPresets = async () => {
    setPresetsLoading(true);
    try {
      const r = await fetch(httpUrl() + '/v1/sandbox/presets');
      if (r.ok) {
        const data = await r.json();
        setPresets(data.presets || []);
      }
    } catch { /* presets optional */ }
    setPresetsLoading(false);
  };

  const load = async () => {
    try {
      const r = await fetch(httpUrl() + '/v1/sandbox/rules');
      if (r.status === 404) {
        setSandboxUnavailable(true);
        return;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data: SandboxStatus = await r.json();
      setStatus(data);
      setAllow(data.rules.allow.join('\n'));
      setDeny(data.rules.deny.join('\n'));
      setPrompt(data.rules.prompt.join('\n'));
      setMaxFileSize(data.rules.maxFileSize ?? null);
      setMaxTotalSize(data.rules.maxTotalSize ?? null);
    } catch (e: any) {
      setSandboxUnavailable(true);
    }
  };

  useEffect(() => { load(); loadPresets(); }, []);

  const save = async () => {
    setSaving(true);
    try {
      const rules: SandboxRules = {
        allow: allow.split('\n').map(s => s.trim()).filter(Boolean),
        deny: deny.split('\n').map(s => s.trim()).filter(Boolean),
        prompt: prompt.split('\n').map(s => s.trim()).filter(Boolean),
        maxFileSize: maxFileSize ?? undefined,
        maxTotalSize: maxTotalSize ?? undefined,
      };
      const r = await fetch(httpUrl() + '/v1/sandbox/rules', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rules }),
      });
      if (!r.ok) {
        const err = await r.json();
        throw new Error(err.error + (err.errors ? ': ' + err.errors.join('; ') : ''));
      }
      message.success('沙箱规则已保存');
      await load();
    } catch (e: any) {
      message.error('保存失败: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  /** 点击预设路径: 加入 allow 列表 (去重) */
  const addPresetToAllow = (presetPath: string) => {
    const current = allow.split('\n').map(s => s.trim()).filter(Boolean);
    if (current.includes(presetPath)) {
      message.info('该路径已在 allow 列表中');
      return;
    }
    setAllow([...current, presetPath].join('\n'));
    message.success(`已添加: ${presetPath}`);
  };

  const runProbe = async () => {
    try {
      const r = await fetch(httpUrl() + '/v1/sandbox/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: probe.path, op: probe.op }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setProbeResult(data);
    } catch (e: any) {
      message.error('试检查失败: ' + e.message);
    }
  };

  return (
    <Card
      title={<span><SecurityScanOutlined /> 沙箱规则 (Sandbox Rules)</span>}
      extra={
        <Space>
          {status && (
            <Tooltip title={status.rulesPath}>
              <Tag color={status.source === 'file' ? 'blue' : status.source === 'default' ? 'gold' : 'red'}>
                {status.source}
              </Tag>
            </Tooltip>
          )}
          <Button icon={<ReloadOutlined />} onClick={load} size="small">刷新</Button>
        </Space>
      }
    >
      {!status && !sandboxUnavailable && <Alert type="info" message="加载中..." showIcon />}
      {sandboxUnavailable && (
        <Alert
          type="warning"
          message="沙箱服务未启用"
          description="Gateway 沙箱模块未初始化或未注册路由。沙箱规则编辑功能不可用。请检查 Gateway 启动日志中 [sandbox] 相关信息。"
          showIcon
          style={{ marginBottom: 12 }}
        />
      )}
      {status && (
        <>
          <Alert
            type={status.enabled ? 'success' : 'warning'}
            showIcon
            message={
              <span>
                <b>沙箱当前: {status.enabled ? '已启用 ✅' : '未启用 ⏸ (旁路模式, 所有操作放行)'}</b>
                {status.enabled
                  ? ' — 文件操作受规则保护, 命中 deny/prompt 会被拦截'
                  : ' — 切换上方开关启用'}
              </span>
            }
            style={{ marginBottom: 16 }}
            action={
              <Switch
                checked={status.enabled}
                checkedChildren="启用"
                unCheckedChildren="关闭"
                onChange={async (checked) => {
                  try {
                    const r = await fetch(httpUrl() + '/v1/sandbox/enable', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ enabled: checked }),
                    });
                    if (!r.ok) throw new Error(`HTTP ${r.status}`);
                    message.success(checked ? '沙箱已启用' : '沙箱已关闭');
                    await load();
                  } catch (e: any) {
                    message.error('切换失败: ' + e.message);
                  }
                }}
              />
            }
          />

          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            {/* 路径预置面板 — 自动识别盘符 + 常用目录 */}
            {presets.length > 0 && (
              <div>
                <label>
                  <PlusOutlined /> 路径预置 (点击加入 Allow 列表)
                  <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                    系统自动识别, v3.2 默认全放行已无需手动配置allow
                  </Text>
                </label>
                <div style={{ marginTop: 4 }}>
                  {(['drive', 'user', 'workspace', 'common'] as const).map(cat => {
                    const items = presets.filter(p => p.category === cat);
                    if (items.length === 0) return null;
                    return (
                      <div key={cat} style={{ marginBottom: 4 }}>
                        <Text type="secondary" style={{ fontSize: 11, marginRight: 8 }}>
                          {cat === 'drive' ? '盘符' : cat === 'user' ? '用户目录' : cat === 'workspace' ? '项目' : '常用'}:
                        </Text>
                        {items.map(p => (
                          <Tooltip key={p.path} title={`添加 ${p.path} 到 Allow 列表`}>
                            <Tag
                              icon={CATEGORY_ICONS[p.category]}
                              color={CATEGORY_COLORS[p.category]}
                              style={{ cursor: 'pointer', marginBottom: 4 }}
                              onClick={() => addPresetToAllow(p.path)}
                            >
                              {p.label}
                            </Tag>
                          </Tooltip>
                        ))}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div>
              <label>✅ Allow (白名单, 一行一个 glob, 支持 *, **, ?, {`{a,b}`})</label>
              <TextArea
                value={allow}
                onChange={e => setAllow(e.target.value)}
                rows={5}
                placeholder={'/workspace/**\n/Users/me/projects/**'}
                style={{ fontFamily: 'monospace' }}
              />
            </div>

            <div>
              <label>🚫 Deny (黑名单, 永远拒绝)</label>
              <TextArea
                value={deny}
                onChange={e => setDeny(e.target.value)}
                rows={5}
                placeholder={'C:/Windows/**\n/etc/**\n~/.ssh/**'}
                style={{ fontFamily: 'monospace' }}
              />
            </div>

            <div>
              <label>⚠️ Prompt (敏感, 操作前需用户确认)</label>
              <TextArea
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                rows={3}
                placeholder={'**/.env*\n**/id_rsa*\n**/credentials.json'}
                style={{ fontFamily: 'monospace' }}
              />
            </div>

            <Space>
              <span>单文件上限:</span>
              <InputNumber
                value={maxFileSize}
                onChange={v => setMaxFileSize(v)}
                placeholder="bytes"
                min={0}
                step={1024 * 1024}
                formatter={v => v ? `${v} (${(v / 1024 / 1024).toFixed(1)} MB)` : ''}
                parser={(v: string | undefined) => v ? Number(v.replace(/[^\d]/g, '')) : 0}
              />
              <span>累计上限:</span>
              <InputNumber
                value={maxTotalSize}
                onChange={v => setMaxTotalSize(v)}
                placeholder="bytes"
                min={0}
                step={1024 * 1024}
                formatter={v => v ? `${v} (${(v / 1024 / 1024).toFixed(1)} MB)` : ''}
                parser={(v: string | undefined) => v ? Number(v.replace(/[^\d]/g, '')) : 0}
              />
            </Space>

            <Space>
              <Button type="primary" icon={<SafetyOutlined />} onClick={save} loading={saving}>
                保存
              </Button>
              <Button onClick={async () => {
                try {
                  const r = await fetch(httpUrl() + '/v1/sandbox/rules', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ rules: { allow: [], deny: [], prompt: [], maxFileSize: 10485760, maxTotalSize: 104857600 } }),
                  });
                  if (r.ok) { message.success('已重置为空白'); await load(); }
                } catch (e: any) { message.error(String(e)); }
              }}>重置为空白</Button>
            </Space>
          </Space>

          <Divider>试检查 (Dry-run)</Divider>
          <Space.Compact style={{ width: '100%' }}>
            <Select
              value={probe.op}
              onChange={v => setProbe({ ...probe, op: v })}
              options={[
                { value: 'read', label: 'read' },
                { value: 'write', label: 'write' },
                { value: 'delete', label: 'delete' },
                { value: 'execute', label: 'execute' },
              ]}
              style={{ width: 120 }}
            />
            <Input
              value={probe.path}
              onChange={e => setProbe({ ...probe, path: e.target.value })}
              placeholder="C:/Users/test/secrets.txt"
              style={{ flex: 1 }}
            />
            <Button icon={<ExperimentOutlined />} onClick={runProbe} disabled={!probe.path}>检查</Button>
          </Space.Compact>

          {probeResult && (
            <Alert
              type={probeResult.verdict === 'allow' ? 'success' : probeResult.verdict === 'prompt' ? 'warning' : 'error'}
              showIcon
              icon={VERDICT_ICON[probeResult.verdict]}
              message={
                <span>
                  <Tag color={VERDICT_COLOR[probeResult.verdict]}>{probeResult.verdict.toUpperCase()}</Tag>
                  {probeResult.reason}
                </span>
              }
              description={probeResult.matchedRule && `匹配规则: ${probeResult.matchedRule}`}
              style={{ marginTop: 12 }}
            />
          )}
        </>
      )}
    </Card>
  );
};
