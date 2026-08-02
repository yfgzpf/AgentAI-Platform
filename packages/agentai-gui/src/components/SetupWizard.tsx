/**
 * SetupWizard v2 — 首次启动环境检测 + 自动安装 (2026-08-03 P0 全面检查)
 * ═══════════════════════════════════════════════════════════
 * 7 项全检 + 2 项自动安装 + 4 项手动引导:
 * ① Node.js v18+       ← 必需 (引导下载)
 * ② Python 3.10+       ← 必需 (引导下载, 技能集/自进化)
 * ③ Git                ← 必需 (引导下载)
 * ④ WebView2           ← 必需 (Tauri 渲染内核, Win10+ 自带)
 * ⑤ Gateway node_modules ← 必需 (✅自动安装: npm install)
 * ⑥ Playwright Chromium ← 必需 (✅自动安装: npx playwright install chromium)
 * ⑦ AgentAI SKILLS 目录 ← 必需 (检查 resources/agentai-skills 是否打包)
 *
 * 自动安装机制: POST /v1/system/auto-install 白名单执行
 *   (所有命令安全白名单 + Gateway 工作区内执行 + 10 分钟超时)
 * ═══════════════════════════════════════════════════════════
 */
import React, { useState, useEffect } from 'react';
import { Modal, Steps, Button, Alert, Spin, Typography, Space, Tag, Result, Progress } from 'antd';
import {
  CheckCircleFilled, CloseCircleFilled, DownloadOutlined, ReloadOutlined,
  NodeIndexOutlined, CodeOutlined, ChromeOutlined, FolderOutlined,
  CloudServerOutlined, ExperimentOutlined, GithubOutlined,
} from '@ant-design/icons';

const { Text, Link } = Typography;

type DepCategory = 'required' | 'required-auto' | 'required-check';

interface DepStatus {
  name: string;
  depKey: string;            // 传给 auto-install API 的 dep
  label: string;
  icon: React.ReactNode;
  installed: boolean;
  version?: string;
  downloadUrl?: string;
  installGuide: string;
  checkCmd?: string;
  autoInstall: boolean;      // 是否支持自动安装
  category: DepCategory;
}

/** 检测本地是否安装了某个命令 (走 Gateway check-dep) */
async function checkDependency(cmd: string): Promise<{ installed: boolean; version?: string }> {
  try {
    const { GATEWAY_HTTP } = await import('../services/config');
    const res = await fetch(`${GATEWAY_HTTP}/v1/system/check-dep?cmd=${encodeURIComponent(cmd)}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const data = await res.json();
      return { installed: !!data.installed, version: data.version };
    }
  } catch {}
  return { installed: false };
}

/**
 * 调 Gateway auto-install API 自动安装白名单依赖
 *   depKey ∈ { gateway-deps, playwright, skills-check, node, python, git, webview2 }
 */
async function autoInstall(depKey: string): Promise<{
  ok: boolean; installed: boolean; autoInstall: boolean;
  version?: string; manualInstall?: { name: string; url: string }; error?: string; skipped?: string;
  path?: string; note?: string;
}> {
  try {
    const { GATEWAY_HTTP } = await import('../services/config');
    const res = await fetch(`${GATEWAY_HTTP}/v1/system/auto-install`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dep: depKey }),
      signal: AbortSignal.timeout(10 * 60 * 1000), // 10 分钟 (chromium 下载 3GB)
    });
    return await res.json();
  } catch (e: any) {
    return { ok: false, installed: false, autoInstall: true, error: e?.message || '请求失败' };
  }
}

/** 7 项依赖定义 */
const DEPS: DepStatus[] = [
  {
    name: 'node',
    depKey: 'node',
    label: 'Node.js v18+',
    icon: <NodeIndexOutlined />,
    installed: false,
    downloadUrl: 'https://nodejs.org/dist/v22.16.0/node-v22.16.0-x64.msi',
    installGuide: 'Gateway 运行必需。下载后双击 .msi 全默认下一步即可, 完成后重启 PulseFlow。',
    checkCmd: 'node',
    autoInstall: false,
    category: 'required',
  },
  {
    name: 'python',
    depKey: 'python',
    label: 'Python 3.10+',
    icon: <CodeOutlined />,
    installed: false,
    downloadUrl: 'https://www.python.org/ftp/python/3.13.3/python-3.13.3-amd64.exe',
    installGuide: 'AgentAI SKILLS / 自进化 / 知识提取 必需。安装时务必勾选 ☑ Add Python to PATH。',
    checkCmd: 'python',
    autoInstall: false,
    category: 'required',
  },
  {
    name: 'git',
    depKey: 'git',
    label: 'Git',
    icon: <GithubOutlined />,
    installed: false,
    downloadUrl: 'https://github.com/git-for-windows/git/releases/latest',
    installGuide: 'AI git 工具 / 记忆系统必需。下载后双击安装, 全部默认下一步即可。',
    checkCmd: 'git',
    autoInstall: false,
    category: 'required',
  },
  {
    name: 'webview2',
    depKey: 'webview2',
    label: 'WebView2 (Edge 内核)',
    icon: <ChromeOutlined />,
    installed: false,
    downloadUrl: 'https://go.microsoft.com/fwlink/p/?LinkId=2124703',
    installGuide: 'Tauri 桌面界面渲染内核。Win10+ 一般自带, 若缺失请下载安装。',
    checkCmd: 'reg query "HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"',
    autoInstall: false,
    category: 'required',
  },
  {
    name: 'gateway-deps',
    depKey: 'gateway-deps',
    label: 'Gateway 运行依赖 (node_modules)',
    icon: <CloudServerOutlined />,
    installed: false,
    installGuide: '🚀 支持自动安装! 点击「一键安装」, 将在 gateway-dist-v2/ 目录执行 npm install --production。',
    autoInstall: true,
    category: 'required-auto',
  },
  {
    name: 'playwright',
    depKey: 'playwright',
    label: 'Playwright Chromium (~600MB)',
    icon: <ExperimentOutlined />,
    installed: false,
    installGuide: '🚀 支持自动安装! 浏览器自动化必需。点击「一键安装」, 执行 npx playwright install chromium (~5 分钟, 依网速)。',
    autoInstall: true,
    category: 'required-auto',
  },
  {
    name: 'skills-check',
    depKey: 'skills-check',
    label: 'AgentAI SKILLS 技能集目录',
    icon: <FolderOutlined />,
    installed: false,
    installGuide: '141 工具中大量 Python 技能依赖此目录。打包时 Tauri resources 已自动包含 agentai-skills/ (含 scripts/ + README.md)。',
    autoInstall: false,
    category: 'required-check',
  },
];

export const SetupWizard: React.FC<{ visible: boolean; onClose: () => void }> = ({ visible, onClose }) => {
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState<string | null>(null); // 当前正在自动安装的 depKey
  const [installProgress, setInstallProgress] = useState<Record<string, number>>({});
  const [deps, setDeps] = useState<DepStatus[]>(DEPS);
  const [current, setCurrent] = useState(0);
  const [allInstalled, setAllInstalled] = useState(false);
  const [lastError, setLastError] = useState<string>('');

  /** 检测所有 7 项依赖 */
  const checkAll = async () => {
    setChecking(true);
    setLastError('');
    const results: DepStatus[] = [];
    for (const dep of DEPS) {
      let installed = false;
      let version: string | undefined;
      try {
        if (dep.checkCmd) {
          const r = await checkDependency(dep.checkCmd);
          installed = r.installed;
          version = r.version;
        } else if (dep.depKey) {
          // gateway-deps / playwright / skills-check: 走 auto-install 信息查询端点
          const r = await autoInstall(dep.depKey);
          installed = !!r.installed;
          version = r.version;
          if (r.error) console.warn('[SetupWizard] check:', dep.depKey, r.error);
        }
      } catch (e: any) {
        console.warn('[SetupWizard] check error:', dep.name, e);
      }
      results.push({ ...dep, installed, version });
    }
    setDeps(results);
    setAllInstalled(results.every(d => d.installed));
    setChecking(false);
  };

  useEffect(() => {
    if (visible) checkAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  /** 打开下载链接 (Tauri/Web 通用: window.open → shell.open) */
  const handleDownload = (url: string) => {
    window.open(url, '_blank', 'noopener');
  };

  /** 一键自动安装 (gateway-deps / playwright) */
  const handleAutoInstall = async () => {
    const dep = deps[current];
    if (!dep.autoInstall) return;
    setInstalling(dep.depKey);
    setInstallProgress(prev => ({ ...prev, [dep.depKey]: 20 }));
    setLastError('');

    // 模拟进度 (因为后端同步, 我们分段递增 UI 反馈)
    const timer = window.setInterval(() => {
      setInstallProgress(prev => {
        const cur = prev[dep.depKey] || 0;
        return { ...prev, [dep.depKey]: Math.min(90, cur + (dep.depKey === 'playwright' ? 5 : 12)) };
      });
    }, 1200);

    const r = await autoInstall(dep.depKey);

    clearInterval(timer);
    setInstallProgress(prev => ({ ...prev, [dep.depKey]: 100 }));
    setTimeout(() => setInstallProgress(prev => { const n = { ...prev }; delete n[dep.depKey]; return n; }), 800);

    setInstalling(null);
    if (r.ok && r.installed) {
      const newDeps = [...deps];
      newDeps[current] = { ...dep, installed: true, version: r.version || dep.version };
      setDeps(newDeps);
      setAllInstalled(newDeps.every(d => d.installed));
      if (current < deps.length - 1) setCurrent(current + 1);
    } else {
      setLastError(r.error || `安装失败: ${dep.label}`);
    }
  };

  /** 重新检测当前项 */
  const handleRecheck = async () => {
    const dep = deps[current];
    setChecking(true);
    setLastError('');
    let installed = false;
    let version: string | undefined;
    try {
      if (dep.checkCmd) {
        const r = await checkDependency(dep.checkCmd);
        installed = r.installed; version = r.version;
      } else if (dep.depKey) {
        const r = await autoInstall(dep.depKey);
        installed = !!r.installed; version = r.version;
      }
    } catch {}
    const newDeps = [...deps];
    newDeps[current] = { ...dep, installed, version };
    setDeps(newDeps);
    setAllInstalled(newDeps.every(d => d.installed));
    setChecking(false);
    if (installed && current < deps.length - 1) setCurrent(current + 1);
  };

  const pendingDeps = deps.filter(d => !d.installed);
  const autoInstallablePending = pendingDeps.filter(d => d.autoInstall);
  const firstMissingIdx = deps.findIndex(d => !d.installed);

  // 切换 current 到第一个缺失项 (首次检测完成时)
  useEffect(() => {
    if (!checking && firstMissingIdx >= 0 && current > firstMissingIdx + 1) {
      // 不强制跳, 仅在 current 超出范围时纠正
    }
  }, [checking, firstMissingIdx, current]);

  return (
    <Modal
      open={visible}
      onCancel={onClose}
      footer={null}
      width={640}
      closable={allInstalled}
      maskClosable={false}
      destroyOnClose
      title={
        <Space>
          <ReloadOutlined />
          <span>环境自检 · 首次启动全 7 项</span>
          <Tag color="blue" style={{ marginLeft: 8 }}>PulseFlow · 安装即用</Tag>
        </Space>
      }
    >
      {checking ? (
        <div style={{ textAlign: 'center', padding: 48 }}>
          <Spin size="large" />
          <div style={{ marginTop: 14, color: 'var(--muted)', fontSize: 13 }}>
            正在检测 7 项运行环境依赖...
          </div>
          <Steps
            direction="vertical"
            size="small"
            current={deps.findIndex(d => !d.installed && d.installed === false)}
            style={{ maxWidth: 420, margin: '20px auto 0', textAlign: 'left' }}
            items={DEPS.map(d => ({ title: d.label, description: d.installed ? '✓ 已完成' : '' }))}
          />
        </div>
      ) : allInstalled ? (
        <Result
          status="success"
          title="✅ 全部就绪"
          subTitle="7 项依赖已完整检测/安装, PulseFlow 可立即使用"
          extra={
            <Space>
              <Button type="primary" size="large" onClick={onClose}>开始使用</Button>
              <Button icon={<ReloadOutlined />} onClick={checkAll}>重新确认</Button>
            </Space>
          }
        />
      ) : (
        <div>
          <Alert
            type={pendingDeps.filter(d => d.category !== 'required-check').length > 2 ? 'error' : 'warning'}
            showIcon
            message={`检测到 ${pendingDeps.length} 项未就绪${autoInstallablePending.length > 0 ? `（${autoInstallablePending.length} 项可一键自动安装）` : ''}`}
            description={
              <div style={{ fontSize: 12, lineHeight: 1.8 }}>
                <div>✅ 可自动安装项：{deps.filter(d => d.autoInstall).length} 项（Gateway 依赖 / Playwright Chromium）</div>
                <div>📦 系统安装包：{deps.filter(d => !d.autoInstall && d.downloadUrl).length} 项（Node.js / Python / Git / WebView2）</div>
                <div>📁 目录校验：skills-check（确认打包时已包含 agentai-skills/）</div>
              </div>
            }
            style={{ marginBottom: 14 }}
          />

          {lastError && (
            <Alert
              type="error"
              showIcon
              message="自动安装失败"
              description={<span style={{ fontSize: 12 }}>{lastError}</span>}
              style={{ marginBottom: 12 }}
              closable
              onClose={() => setLastError('')}
            />
          )}

          {/* 依赖列表 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14, maxHeight: 260, overflowY: 'auto', paddingRight: 4 }}>
            {deps.map((dep, i) => {
              const isCurrent = current === i;
              return (
                <div
                  key={dep.name}
                  onClick={() => setCurrent(i)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 14px', borderRadius: 10,
                    border: isCurrent
                      ? '1px solid var(--accent)'
                      : '1px solid var(--border)',
                    background: isCurrent ? 'var(--accent-soft)' : 'var(--card)',
                    cursor: 'pointer', transition: 'all 0.15s',
                    opacity: installing === dep.depKey ? 0.85 : 1,
                  }}
                >
                  <span style={{
                    fontSize: 18,
                    color: dep.installed ? 'var(--success)' : 'var(--danger)',
                    minWidth: 20,
                  }}>
                    {dep.installed ? <CheckCircleFilled /> : <CloseCircleFilled />}
                  </span>
                  <span style={{ fontSize: 16, color: 'var(--accent)', minWidth: 22 }}>{dep.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>
                      {dep.label}
                      {dep.autoInstall && !dep.installed && (
                        <Tag color="processing" style={{ marginLeft: 8 }}>可自动安装</Tag>
                      )}
                    </div>
                    {dep.installed && dep.version && (
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                        已安装: {dep.version}
                      </div>
                    )}
                    {installing === dep.depKey && (
                      <Progress percent={installProgress[dep.depKey] || 0} size="small" showInfo style={{ marginTop: 6, maxWidth: 200 }} />
                    )}
                  </div>
                  <Tag color={dep.installed ? 'success' : dep.autoInstall ? 'blue' : 'red'}>
                    {dep.installed ? '就绪' : dep.autoInstall ? '待安装' : '缺失'}
                  </Tag>
                </div>
              );
            })}
          </div>

          {/* 当前选中项的详情 */}
          <div
            style={{
              padding: '14px 18px',
              background: 'var(--bg-2)',
              borderRadius: 12,
              marginBottom: 16,
              border: '1px solid var(--border)',
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, color: 'var(--fg)' }}>
              <Space>{deps[current].icon}{deps[current].label}</Space>
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12, lineHeight: 1.7 }}>
              {deps[current].installGuide}
              {deps[current].category === 'required-check' && deps[current].installed === false && (
                <div style={{ marginTop: 6, color: 'var(--danger)' }}>
                  ⚠️ 打包校验失败: 请确认 tauri.conf.json resources 中包含 ../../agentai-skills 映射
                </div>
              )}
            </div>
            <Space wrap>
              {!deps[current].installed && deps[current].downloadUrl && (
                <Button
                  type="primary"
                  icon={<DownloadOutlined />}
                  onClick={() => handleDownload(deps[current].downloadUrl!)}
                >
                  下载安装包
                </Button>
              )}
              {!deps[current].installed && deps[current].autoInstall && (
                <Button
                  type="primary"
                  onClick={handleAutoInstall}
                  loading={!!installing}
                  disabled={!!installing && installing !== deps[current].depKey}
                >
                  🚀 一键自动安装
                </Button>
              )}
              <Button
                icon={<ReloadOutlined />}
                onClick={handleRecheck}
                loading={checking}
                disabled={!!installing}
              >
                {deps[current].installed ? '下一项 →' : '重新检测'}
              </Button>
              <Button
                onClick={checkAll}
                loading={checking}
                disabled={!!installing}
              >
                全部重新检测
              </Button>
            </Space>
          </div>

          {/* 跳过 & 底部 */}
          <div style={{ textAlign: 'center' }}>
            <Text type="secondary" style={{ fontSize: 11 }}>
              环境缺失时部分功能不可用；后续可在「设置」→「环境自检」随时重跑
            </Text>
            <br />
            <Button type="link" onClick={onClose} style={{ fontSize: 11, color: 'var(--muted)' }}>
              暂时跳过（仅体验 UI）
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
};
