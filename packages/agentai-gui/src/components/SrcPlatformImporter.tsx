/**
 * SrcPlatformImporter — SRC 规则页 → 平台档案 (归属 + 授权目标 + 禁止项)
 * ---------------------------------------------------------------------------
 * 为什么有这个: 之前多 SRC 并行时, 挖到的洞不知道报给谁(归属丢失), 而且
 * "禁止项"只存在于规则页文字里, 代码层没有硬闸门 → AI 容易越界。
 * 本组件把规则页变成**落盘的确定性档案**:
 *   ① 三种输入: 粘贴正文 / 平台 URL(后端自动抓) / 规则页截图(多模态识别)
 *   ② /parse 预览 → **人逐条核对**(OCR 和自动解析都可能漏)
 *   ③ /import (confirmed=false) → ④ 人点「确认」→ /confirm → ⑤ /sync-scope 进授权范围
 *
 * ⚠️ 安全立场: 导入 ≠ 授权。未经 confirm 的档案 AI 不得据此开扫
 *   (后端 confirmed 恒 false, 只有 confirm 端点能置true, AI 工具集里没有 confirm)。
 */
import React, { useState, useCallback } from 'react';
import {
  Button, Input, Tag, Collapse, Spin, Empty, Tooltip, message as antdMsg, Upload, Alert,
} from 'antd';
import {
  ImportOutlined, LinkOutlined, FileImageOutlined, CheckCircleOutlined, SyncOutlined,
  SafetyCertificateOutlined, StopOutlined, GiftOutlined,
} from '@ant-design/icons';
import { GATEWAY_HTTP } from '../services/config';
import { useProfileStore } from '../store';

/** 后端返回的解析结果形状 (只列前端用到的字段) */
interface ParseResult {
  platform: {
    id: string; name: string; baseUrl?: string;
    hosts: string[]; deny: string[];
    forbiddenActions: string[]; rewards: string[];
    confidence?: number; confirmed: boolean; importedFrom?: string;
  };
  parsed: { confidence?: number; notes?: string[] };
  sourceText?: string;
  ocr?: { note: string; warning: string } | null;
  warning?: string;
}

export const SrcPlatformImporter: React.FC<{ onChanged?: () => void }> = ({ onChanged }) => {
  const { profile } = useProfileStore();

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'text' | 'url' | 'image'>('text');
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [image, setImage] = useState<{ dataUrl: string; fileName: string } | null>(null);
  const [parsing, setParsing] = useState(false);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [platforms, setPlatforms] = useState<any[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [busy, setBusy] = useState('');

  const baseUrl = () => GATEWAY_HTTP || 'http://127.0.0.1:18789';

  /** 与 ScopeManager 同口径: 工作区走 query 参数 (header 不支持中文路径) */
  const wsUrl = useCallback((path: string) => {
    const ws = (profile?.workspace || localStorage.getItem('agentai.workspace') || '').trim();
    return ws
      ? `${baseUrl()}/${path}?workspace=${encodeURIComponent(ws)}`
      : `${baseUrl()}/${path}`;
  }, [profile]);

  const loadPlatforms = useCallback(async () => {
    setListLoading(true);
    try {
      const r = await fetch(wsUrl('v1/pentest/src-platforms'));
      const d = await r.json();
      if (d.ok) setPlatforms(d.platforms || []);
    } catch { /* 网关不可达 → 面板其他区照常 */ }
    finally { setListLoading(false); }
  }, [wsUrl]);

  const handleParse = async () => {
    setParsing(true); setResult(null); setConfirmed(false);
    try {
      const body: any = {};
      if (mode === 'text') {
        if (!text.trim()) { antdMsg.warning('先粘贴规则页正文'); setParsing(false); return; }
        body.text = text;
      } else if (mode === 'url') {
        if (!url.trim()) { antdMsg.warning('先填平台页面地址'); setParsing(false); return; }
        body.url = url.trim();
      } else {
        if (!image) { antdMsg.warning('先选一张规则页截图'); setParsing(false); return; }
        body.image = image.dataUrl;
      }
      if (name.trim()) body.name = name.trim();

      const r = await fetch(wsUrl('v1/pentest/src-platforms/parse'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!d.ok) {
        antdMsg.error(d.error || '解析失败');
        if (d.hint) antdMsg.info(d.hint);
        return;
      }
      setResult(d);
      // 目标数为 0 时必须拦住 —— 空档案导入进去等于"什么都测不了", 但用户以为配好了
      if (!d.platform?.hosts?.length) {
        antdMsg.warning('未从页面提取到任何授权目标 —— 请检查正文是否完整, 或改用 URL 抓取/截图识别');
      } else {
        antdMsg.success(`提取到 ${d.platform.hosts.length} 个授权目标, 请逐条核对后再导入`);
      }
    } catch (e: any) {
      antdMsg.error(`解析请求失败: ${e?.message || e}`);
    } finally { setParsing(false); }
  };

  const handleImport = async () => {
    if (!result?.platform) return;
    setBusy('import');
    try {
      const r = await fetch(wsUrl('v1/pentest/src-platforms/import'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: result.platform }),
      });
      const d = await r.json();
      if (!d.ok) { antdMsg.error(d.error || '导入失败'); return; }
      antdMsg.success('已导入 (未生效) — 需点「确认」后 AI 才会据此开扫');
      setConfirmed(true);
      void loadPlatforms();
    } catch (e: any) { antdMsg.error(`导入失败: ${e?.message || e}`); }
    finally { setBusy(''); }
  };

  const handleConfirm = async (id: string) => {
    setBusy(`confirm:${id}`);
    try {
      const r = await fetch(wsUrl('v1/pentest/src-platforms/confirm'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const d = await r.json();
      if (!d.ok) { antdMsg.error(d.error || '确认失败'); return; }
      antdMsg.success('已确认 — 该平台归属与禁止项已生效 (deny 进代码层硬闸门)');
      void loadPlatforms();
    } catch (e: any) { antdMsg.error(`确认失败: ${e?.message || e}`); }
    finally { setBusy(''); }
  };

  const handleSync = async (id: string) => {
    setBusy(`sync:${id}`);
    try {
      const r = await fetch(wsUrl('v1/pentest/src-platforms/sync-scope'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const d = await r.json();
      if (!d.ok) { antdMsg.error(d.error || '同步失败'); return; }
      const denyNote = d.added === 0 ? ' (无新增: 可能已在授权范围内, 或全部命中 deny 被跳过)' : '';
      antdMsg.success(`已同步 ${d.added ?? 0} 个目标到授权范围${denyNote}`);
      onChanged?.();
    } catch (e: any) { antdMsg.error(`同步失败: ${e?.message || e}`); }
    finally { setBusy(''); }
  };

  const handleRemove = async (id: string) => {
    setBusy(`rm:${id}`);
    try {
      const r = await fetch(wsUrl(`v1/pentest/src-platforms&id=${encodeURIComponent(id)}`), { method: 'DELETE' });
      const d = await r.json();
      if (!d.ok) { antdMsg.error(d.error || '删除失败'); return; }
      antdMsg.success('已删除该平台档案');
      void loadPlatforms();
    } catch (e: any) { antdMsg.error(`删除失败: ${e?.message || e}`); }
    finally { setBusy(''); }
  };

  const confidence = result?.platform?.confidence ?? 0;
  const confColor = confidence >= 0.8 ? 'var(--success)' : confidence >= 0.6 ? 'var(--warn, #d48806)' : 'var(--danger)';

  return (
    <div style={{ marginBottom: 12 }}>
      <Button
        size="small" type="link" icon={<ImportOutlined />}
        onClick={() => { setOpen(v => !v); if (!open) void loadPlatforms(); }}
        style={{ padding: 0, fontSize: 'var(--fs-micro)' }}
      >
        {open ? '收起 SRC 平台导入' : 'SRC 平台导入 (自动提取归属 / 授权目标 / 禁止项)'}
      </Button>

      {open && (
        <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* ── 输入区: 三种方式 ── */}
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {([
              ['text', '粘贴正文', <FileImageOutlined key="i" />],
              ['url', '平台 URL', <LinkOutlined key="i" />],
              ['image', '规则页截图', <FileImageOutlined key="i" />],
            ] as const).map(([k, label, icon]) => (
              <Tag
                key={k} onClick={() => setMode(k as any)}
                style={{
                  cursor: 'pointer', fontSize: 'var(--fs-micro)', margin: 0,
                  borderRadius: 'var(--radius-sm)', border: 'none',
                  background: mode === k ? 'var(--accent)' : 'var(--panel)',
                  color: mode === k ? 'var(--fg-on-accent)' : 'var(--muted-2)',
                }}
              >
                {icon} {label}
              </Tag>
            ))}
          </div>

          <Input
            size="small" placeholder="平台名称 (留空则从 URL 自动取, 如: 翼支付 SRC)"
            value={name} onChange={e => setName(e.target.value)}
            style={{ fontSize: 'var(--fs-micro)' }}
          />

          {mode === 'text' && (
            <Input.TextArea
              rows={5} value={text} onChange={e => setText(e.target.value)}
              placeholder={'把 SRC 规则页正文粘进来 (授权范围 / out of scope / 禁止行为 / 赏金说明 一起粘):\n\n奖励范围\n*.bestpay.com.cn\napi.bestpay.com.cn\n\nOut of scope\n第三方资产\n社交工程'}
              style={{ fontSize: 'var(--fs-micro)' }}
            />
          )}

          {mode === 'url' && (
            <Input
              size="small" value={url} onChange={e => setUrl(e.target.value)}
              placeholder="https://valasrc.vulbox.com/home  (后端自动抓正文, 20s 超时)"
              style={{ fontSize: 'var(--fs-micro)' }}
            />
          )}

          {mode === 'image' && (
            <>
              <Upload.Dragger
                accept="image/*" maxCount={1} showUploadList={false}
                beforeUpload={(file) => {
                  const reader = new FileReader();
                  reader.onload = () => {
                    setImage({ dataUrl: String(reader.result || ''), fileName: file.name });
                    antdMsg.success(`已读入 ${file.name} — 点「解析」开始识别`);
                  };
                  return false; // 阻止antd 自动上传: 我们只需要本地 base64
                }}
              >
                <p style={{ margin: '4px 0', fontSize: 'var(--fs-micro)' }}>
                  点击或拖入规则页截图 (走多模态模型识别)
                </p>
              </Upload.Dragger>
              {image && (
                <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted-2)' }}>
                  已选: {image.fileName}
                  <Button size="small" type="link" onClick={() => setImage(null)} style={{ fontSize: 'var(--fs-micro)', padding: '0 4px' }}>清除</Button>
                </div>
              )}
              <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--warn, #d48806)' }}>
                ⚠️ 截图识别可能漏字 —— 漏掉一个禁止项就是越权。识别结果必须逐条核对。
              </div>
            </>
          )}

          <div>
            <Button size="small" type="primary" loading={parsing} onClick={() => void handleParse()}>
              解析并预览
            </Button>
          </div>

          {parsing && <Spin size="small" tip="正在解析…" />}

          {/* ── 预览: 逐条给人核对 ── */}
          {result && (
            <div style={{
              border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
              padding: 8, display: 'flex', flexDirection: 'column', gap: 6,
            }}>
              <div style={{ fontSize: 'var(--fs-micro)', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <SafetyCertificateOutlined />
                <strong>{result.platform.name}</strong>
                <Tag style={{ margin: 0, fontSize: 'var(--fs-micro)' }}>置信度 {confidence.toFixed(2)}</Tag>
                {result.ocr && <Tag color="orange" style={{ margin: 0, fontSize: 'var(--fs-micro)' }}>截图识别</Tag>}
              </div>

              {(result.warning || result.ocr?.warning) && (
                <Alert
                  type="warning" showIcon style={{ fontSize: 'var(--fs-micro)' }}
                  message={result.warning || result.ocr?.warning || ''}
                />
              )}

              <PreviewList icon={<CheckCircleOutlined style={{ color: 'var(--success)' }} />}
                label={`授权目标 (${result.platform.hosts?.length || 0})`} items={result.platform.hosts} />
              <PreviewList icon={<StopOutlined style={{ color: 'var(--danger)' }} />}
                label={`明确禁止 (${result.platform.deny?.length || 0})`} items={result.platform.deny} />
              <PreviewList icon={<StopOutlined style={{ color: 'var(--warn, #d48806)' }} />}
                label={`禁止行为 (${result.platform.forbiddenActions?.length || 0})`} items={result.platform.forbiddenActions} />
              <PreviewList icon={<GiftOutlined style={{ color: 'var(--accent)' }} />}
                label={`赏金说明 (${result.platform.rewards?.length || 0})`} items={result.platform.rewards} />

              <div style={{ display: 'flex', gap: 6 }}>
                <Button size="small" type="primary" loading={busy === 'import'} disabled={confirmed} onClick={() => void handleImport()}>
                  {confirmed ? '已导入' : '核对无误, 导入'}
                </Button>
                <Button size="small" onClick={() => { setResult(null); setConfirmed(false); }}>
                  重新解析
                </Button>
              </div>
            </div>
          )}

          {/* ── 已导入的平台档案 ── */}
          <Collapse
            size="small" ghost style={{ background: 'transparent' }}
            items={[{
              key: 'list',
              label: <span style={{ fontSize: 'var(--fs-micro)' }}>
                已导入平台档案 ({platforms.length}) — 归属对应 & deny 硬闸门
              </span>,
              children: listLoading
                ? <Spin size="small" />
                : platforms.length === 0
                  ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE}
                      description={<span style={{ fontSize: 'var(--fs-micro)' }}>还没有导入任何 SRC 平台</span>} />
                  : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {platforms.map(p => (
                        <div key={p.id} style={{
                          border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: 6,
                          display: 'flex', flexDirection: 'column', gap: 4,
                        }}>
                          <div style={{ fontSize: 'var(--fs-micro)', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                            <strong>{p.name}</strong>
                            <Tag style={{ margin: 0, fontSize: 'var(--fs-micro)' }}>{p.id}</Tag>
                            {p.confirmed
                              ? <Tag color="green" style={{ margin: 0, fontSize: 'var(--fs-micro)' }}>已确认</Tag>
                              : <Tag color="orange" style={{ margin: 0, fontSize: 'var(--fs-micro)' }}>待确认 (AI 不得据此开扫)</Tag>}
                            <span style={{ color: 'var(--muted-2)' }}>
                              {p.hosts?.length || 0} 目标 / {p.deny?.length || 0} 禁止
                            </span>
                          </div>
                          {p.hosts?.length > 0 && (
                            <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted-2)', wordBreak: 'break-all' }}>
                              {p.hosts.join(', ')}
                            </div>
                          )}
                          {p.deny?.length > 0 && (
                            <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--danger)', wordBreak: 'break-all' }}>
                              🚫 {p.deny.join(', ')}
                            </div>
                          )}
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                            {!p.confirmed && (
                              <Button size="small" type="primary" loading={busy === `confirm:${p.id}`}
                                onClick={() => void handleConfirm(p.id)}>
                                确认
                              </Button>
                            )}
                            <Button size="small" icon={<SyncOutlined />} loading={busy === `sync:${p.id}`}
                              onClick={() => void handleSync(p.id)}>
                              同步到授权范围
                            </Button>
                            <Tooltip title="删除档案 (不影响已授权范围)">
                              <Button size="small" danger loading={busy === `rm:${p.id}`}
                                onClick={() => void handleRemove(p.id)}>
                                删除
                              </Button>
                            </Tooltip>
                          </div>
                        </div>
                      ))}
                    </div>
                  ),
            }]}
          />
        </div>
      )}
    </div>
  );
};

/** 预览里的一组条目 (授权/禁止/行为/赏金 复用) */
const PreviewList: React.FC<{ icon: React.ReactNode; label: string; items?: string[] }> = ({ icon, label, items }) => {
  if (!items || items.length === 0) return null;
  return (
    <div style={{ fontSize: 'var(--fs-micro)' }}>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center', color: 'var(--muted-2)' }}>
        {icon} {label}
      </div>
      <div style={{ color: 'var(--fg)', wordBreak: 'break-all', marginLeft: 14 }}>
        {items.join(' · ')}
      </div>
    </div>
  );
};