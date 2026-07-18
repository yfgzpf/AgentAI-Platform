/**
 * SetupWizard — 首次启动环境检测 + 自动安装引导
 * ------------------------------------------------
 * 检测项: Node.js / Python / WebView2
 * 缺失时自动弹窗, 用户点击即下载安装
 */
import React, { useState, useEffect } from 'react';
import { Modal, Steps, Button, Alert, Spin, Typography, Space, Tag, Result } from 'antd';
import {
  CheckCircleFilled, CloseCircleFilled, DownloadOutlined, ReloadOutlined,
  NodeIndexOutlined, CodeOutlined, ChromeOutlined,
} from '@ant-design/icons';

const { Text, Link } = Typography;

interface DepStatus {
  name: string;
  label: string;
  icon: React.ReactNode;
  installed: boolean;
  version?: string;
  downloadUrl: string;
  installGuide: string;
  checkCmd: string;
}

/** 检测本地是否安装了某个命令 */
async function checkDependency(cmd: string): Promise<{ installed: boolean; version?: string }> {
  try {
    const res = await fetch(`/v1/system/check-dep?cmd=${encodeURIComponent(cmd)}`);
    if (res.ok) {
      const data = await res.json();
      return { installed: !!data.installed, version: data.version };
    }
  } catch {}
  // gateway 可能没启动, 尝试直接检测
  return { installed: false };
}

const DEPS: DepStatus[] = [
  {
    name: 'node',
    label: 'Node.js (v18+)',
    icon: <NodeIndexOutlined />,
    installed: false,
    downloadUrl: 'https://nodejs.org/dist/v22.16.0/node-v22.16.0-x64.msi',
    installGuide: '下载后双击 .msi 文件安装, 全部默认下一步即可',
    checkCmd: 'node',
  },
  {
    name: 'python',
    label: 'Python (3.10+)',
    icon: <CodeOutlined />,
    installed: false,
    downloadUrl: 'https://www.python.org/ftp/python/3.13.3/python-3.13.3-amd64.exe',
    installGuide: '下载后运行安装程序, 勾选 "Add Python to PATH" 再点 Install',
    checkCmd: 'python',
  },
  {
    name: 'webview2',
    label: 'WebView2 (Edge 内核)',
    icon: <ChromeOutlined />,
    installed: false,
    downloadUrl: 'https://go.microsoft.com/fwlink/p/?LinkId=2124703',
    installGuide: '下载后运行安装程序, 自动安装即可',
    checkCmd: 'reg query "HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"',
  },
];

export const SetupWizard: React.FC<{ visible: boolean; onClose: () => void }> = ({ visible, onClose }) => {
  const [checking, setChecking] = useState(false);
  const [deps, setDeps] = useState<DepStatus[]>(DEPS);
  const [current, setCurrent] = useState(0);
  const [allInstalled, setAllInstalled] = useState(false);

  /** 检测所有依赖 */
  const checkAll = async () => {
    setChecking(true);
    const results = await Promise.all(
      DEPS.map(async (dep) => {
        const { installed, version } = await checkDependency(dep.checkCmd);
        return { ...dep, installed, version };
      })
    );
    setDeps(results);
    setAllInstalled(results.every(d => d.installed));
    setChecking(false);
  };

  useEffect(() => {
    if (visible) checkAll();
  }, [visible]);

  /** 打开下载链接 */
  const handleDownload = (url: string) => {
    window.open(url, '_blank');
  };

  /** 重新检测当前项 */
  const handleRecheck = async () => {
    const dep = deps[current];
    setChecking(true);
    const { installed, version } = await checkDependency(dep.checkCmd);
    const newDeps = [...deps];
    newDeps[current] = { ...dep, installed, version };
    setDeps(newDeps);
    setAllInstalled(newDeps.every(d => d.installed));
    setChecking(false);
    if (installed && current < deps.length - 1) {
      setCurrent(current + 1);
    }
  };

  const pendingDeps = deps.filter(d => !d.installed);

  return (
    <Modal
      open={visible}
      onCancel={onClose}
      footer={null}
      width={560}
      closable={allInstalled}
      maskClosable={false}
      title={<Space><ReloadOutlined /> 环境检测 — PulseFlow 初始化</Space>}
    >
      {checking ? (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Spin size="large" />
          <div style={{ marginTop: 12, color: 'var(--muted-2)', fontSize: 12 }}>正在检测运行环境...</div>
        </div>
      ) : allInstalled ? (
        <Result
          status="success"
          title="环境就绪"
          subTitle="所有依赖已安装, PulseFlow · 岐黄 可以正常运行"
          extra={
            <Button type="primary" onClick={onClose}>开始使用</Button>
          }
        />
      ) : (
        <div>
          <Alert
            type="warning"
            message={`检测到 ${pendingDeps.length} 个缺失依赖`}
            description="以下组件是 PulseFlow 运行所必需的。点击「下载」获取安装包, 安装完成后点击「已安装, 重新检测」继续。"
            style={{ marginBottom: 16 }}
          />

          {/* 依赖列表 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
            {deps.map((dep, i) => (
              <div
                key={dep.name}
                onClick={() => setCurrent(i)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 14px', borderRadius: 8,
                  border: current === i ? '1px solid var(--accent)' : '1px solid var(--border)',
                  background: current === i ? 'var(--accent-soft)' : 'var(--card)',
                  cursor: 'pointer', transition: 'all 0.15s',
                }}
              >
                <span style={{ fontSize: 18, color: dep.installed ? 'var(--success, #52c41a)' : 'var(--danger, #ff4d4f)' }}>
                  {dep.installed ? <CheckCircleFilled /> : <CloseCircleFilled />}
                </span>
                <span style={{ fontSize: 16, color: 'var(--accent)' }}>{dep.icon}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-2)' }}>{dep.label}</div>
                  {dep.installed && dep.version && (
                    <div style={{ fontSize: 10, color: 'var(--muted-2)' }}>已安装: {dep.version}</div>
                  )}
                </div>
                <Tag color={dep.installed ? 'success' : 'error'}>
                  {dep.installed ? '已安装' : '缺失'}
                </Tag>
              </div>
            ))}
          </div>

          {/* 当前选中项的详情 */}
          <div style={{ padding: '12px 16px', background: 'var(--bg-2)', borderRadius: 8, marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
              {deps[current].icon} {deps[current].label}
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted-2)', marginBottom: 8 }}>
              {deps[current].installGuide}
            </div>
            <Space>
              {!deps[current].installed && (
                <Button
                  type="primary"
                  icon={<DownloadOutlined />}
                  onClick={() => handleDownload(deps[current].downloadUrl)}
                >
                  下载安装包
                </Button>
              )}
              <Button
                icon={<ReloadOutlined />}
                onClick={handleRecheck}
                loading={checking}
              >
                {deps[current].installed ? '下一项' : '已安装, 重新检测'}
              </Button>
            </Space>
          </div>

          {/* 跳过按钮 */}
          <div style={{ textAlign: 'center' }}>
            <Button type="link" onClick={onClose} style={{ fontSize: 11, color: 'var(--muted-2)' }}>
              暂时跳过 (部分功能不可用)
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
};
