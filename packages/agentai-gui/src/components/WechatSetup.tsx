/**
 * 微信绑定页面
 * 功能: 渲染二维码 → 轮询扫码状态 → 绑定成功
 */
import React, { useState, useEffect, useCallback } from 'react';
import { Card, Button, Tag, message, Spin, Space, Descriptions } from 'antd';
import { QrcodeOutlined, CheckCircleOutlined, ReloadOutlined, LogoutOutlined } from '@ant-design/icons';
import { GATEWAY_HTTP } from '../services/config';

const POLL_INTERVAL = 3000;

export const WechatSetup: React.FC = () => {
  const [status, setStatus] = useState<'idle' | 'loading' | 'qr' | 'scanning' | 'confirmed' | 'error'>('idle');
  const [qrImageUrl, setQrImageUrl] = useState<string>('');     // QR 图片直接 URL (备用)
  const [qrcodeImage, setQrcodeImage] = useState<string>('');   // base64 png
  const [qrcodeId, setQrcodeId] = useState<string>('');
  const [account, setAccount] = useState<any>(null);
  const [error, setError] = useState<string>('');

  // --- 查询绑定状态 ---
  const checkStatus = useCallback(async () => {
    try {
      const res = await fetch(`${GATEWAY_HTTP}/api/wechat/status`);
      const data = await res.json();
      if (data.bound) {
        setStatus('confirmed');
        setAccount({ accountId: data.accountId, createdAt: data.createdAt });
      } else {
        setStatus('idle');
      }
    } catch (err: any) {
      console.warn('[wechat] status check failed:', err.message);
      setStatus('idle');
    }
  }, []);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  // --- 获取二维码 ---
  const fetchQrCode = useCallback(async () => {
    setStatus('loading');
    setError('');
    try {
      const res = await fetch(`${GATEWAY_HTTP}/api/wechat/qrcode`);
      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || '获取二维码失败');
      }
      setQrImageUrl(data.qrImageUrl || '');
      setQrcodeImage(data.qrcodeImage || '');
      setQrcodeId(data.qrcodeId);
      setStatus('qr');
    } catch (err: any) {
      setError(err.message);
      setStatus('error');
    }
  }, []);

  // --- 轮询扫码状态 (qr 或 scanning 状态下持续轮询) ---
  useEffect(() => {
    if (status !== 'qr' && status !== 'scanning') return;

    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`${GATEWAY_HTTP}/api/wechat/check/${qrcodeId}`);
        const data = await res.json();

        if (cancelled) return;

        if (data.status === 'confirmed') {
          setStatus('confirmed');
          setAccount(data.account);
          message.success('微信绑定成功！');
        } else if (data.status === 'scaned') {
          setStatus('scanning');
        } else if (data.status === 'expired') {
          setStatus('error');
          setError('二维码已过期，请刷新重试');
        }
        // 'wait' / error → 继续轮询
      } catch (err: any) {
        if (!cancelled) console.warn('[wechat] poll error:', err.message);
      }
    };

    const interval = setInterval(poll, POLL_INTERVAL);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [status, qrcodeId]);

  // --- 刷新二维码 ---
  const handleRefresh = () => {
    setQrcodeId('');
    setQrImageUrl('');
    setQrcodeImage('');
    fetchQrCode();
  };

  // --- 未绑定状态 ---
  if (status === 'idle') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 40 }}>
        <Card style={{ width: 380, textAlign: 'center', borderRadius: 16 }}>
          <QrcodeOutlined style={{ fontSize: 48, color: '#CD7A3A', marginBottom: 16, display: 'block' }} />
          <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>绑定微信账号</div>
          <div style={{ color: 'var(--muted)', marginBottom: 24, fontSize: 13 }}>
            点击下方按钮，用微信扫描二维码完成绑定
          </div>
          <Button
            type="primary"
            size="large"
            icon={<QrcodeOutlined />}
            onClick={fetchQrCode}
            style={{
              width: '100%',
              height: 44,
              borderRadius: 10,
              background: '#CD7A3A',
              border: 'none',
            }}
          >
            开始绑定
          </Button>
          <div style={{ marginTop: 12, fontSize: 11, color: 'var(--muted-2)' }}>
            支持微信 ≥ 8.0.70 · 需要 ClawBot 插件
          </div>
        </Card>
      </div>
    );
  }

  // --- 绑定成功状态 ---
  if (status === 'confirmed') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 40 }}>
        <Card style={{ width: 380, textAlign: 'center', borderRadius: 16 }}>
          <CheckCircleOutlined style={{ fontSize: 48, color: '#52c41a', marginBottom: 16, display: 'block' }} />
          <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>微信绑定成功</div>
          <div style={{ color: 'var(--muted)', marginBottom: 24 }}>通过微信接收 AI 消息</div>

          <Descriptions
            bordered
            size="small"
            column={1}
            style={{ fontSize: 12, marginBottom: 20 }}
          >
            <Descriptions.Item label="账号 ID">{account?.accountId || '—'}</Descriptions.Item>
            <Descriptions.Item label="绑定时间">
              {account?.createdAt ? new Date(account.createdAt).toLocaleString('zh-CN') : '—'}
            </Descriptions.Item>
          </Descriptions>

          <Space style={{ width: '100%' }}>
            <Button
              icon={<ReloadOutlined />}
              onClick={handleRefresh}
              style={{ flex: 1, height: 38, borderRadius: 8 }}
            >
              更换账号
            </Button>
            <Button
              icon={<LogoutOutlined />}
              danger
              style={{ flex: 1, height: 38, borderRadius: 8 }}
              onClick={async () => {
                try {
                  const res = await fetch(`${GATEWAY_HTTP}/api/wechat/account/${account?.accountId}`, { method: 'DELETE' });
                  const data = await res.json();
                  if (data.success) {
                    message.success('微信已解绑');
                    setStatus('idle');
                    setAccount(null);
                  } else {
                    message.error(data.error || '解绑失败');
                  }
                } catch (err: any) {
                  message.error('解绑失败: ' + err.message);
                }
              }}
            >
              解绑
            </Button>
          </Space>
        </Card>
      </div>
    );
  }

  // --- 二维码展示状态 ---
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 40 }}>
      <Card style={{ width: 380, textAlign: 'center', borderRadius: 16 }}>
        <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>
          微信扫码绑定
        </div>
        <div style={{ color: 'var(--muted)', marginBottom: 20, fontSize: 13 }}>
          请使用微信扫描二维码
        </div>

        {status === 'loading' && <Spin size="large" style={{ display: 'block', margin: '20px auto' }} />}

        {status === 'qr' && (
          <div style={{ marginBottom: 20 }}>
            {/* 方案 1: base64 (后端从 qrserver API 下载的 QR 图, 最可靠) */}
            {qrcodeImage ? (
              <img
                src={`data:image/png;base64,${qrcodeImage}`}
                alt="微信绑定二维码"
                style={{ width: 220, height: 220, borderRadius: 12, border: '2px solid var(--border)' }}
              />
            ) : qrImageUrl ? (
              /* 方案 2: 浏览器直接从 qrserver API 加载 QR 图片 */
              <img
                src={qrImageUrl}
                alt="微信绑定二维码"
                style={{ width: 220, height: 220, borderRadius: 12, border: '2px solid var(--border)' }}
                onError={() => {
                  const el = document.getElementById('wechat-qr-fallback');
                  if (el) el.style.display = 'block';
                }}
              />
            ) : (
              <div style={{ width: 220, height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--panel)', borderRadius: 12 }}>
                <span style={{ color: 'var(--muted)' }}>二维码加载中...</span>
              </div>
            )}
            <div id="wechat-qr-fallback" style={{ display: 'none', marginTop: 8, fontSize: 12, color: 'var(--muted-2)' }}>
              图片加载失败。请确认 API 服务可用，或联系管理员。
            </div>
            <Tag color="orange" style={{ marginTop: 12, display: 'block' }}>
              等待扫码...
            </Tag>
          </div>
        )}

        {status === 'scanning' && (
          <div style={{ marginBottom: 20, color: '#1677ff' }}>
            <Spin size="small" /> 扫码中...
          </div>
        )}

        {error && (
          <div style={{ color: '#ff4d4f', marginBottom: 16, fontSize: 13 }}>
            {error}
          </div>
        )}

        <Space style={{ width: '100%' }}>
          <Button
            icon={<ReloadOutlined />}
            onClick={handleRefresh}
            style={{ flex: 1, height: 38, borderRadius: 8 }}
          >
            刷新二维码
          </Button>
          <Button
            onClick={() => setStatus('idle')}
            style={{ flex: 1, height: 38, borderRadius: 8 }}
          >
            取消
          </Button>
        </Space>
      </Card>
    </div>
  );
};
