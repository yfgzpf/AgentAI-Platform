/**
 * 环境体检面板 (2026-10-17)
 * ══════════════════════════════════════════════════════════════════════
 * 解决富哥的问题: "别人拿到我们项目安装后, 缺什么会主动装什么?"
 * 现状是黑盒 —— auto-install 白名单只覆盖 gateway-deps/playwright,
 * node/python/git 只给下载链接, Kali 工具链完全不管。
 * 本面板把这件事显式化: 缺什么 / 能不能自动装 / 怎么装, 一屏看清。
 *
 * 设计原则: **只读**。点击不触发任何安装, 只把命令复制出来或给出官方链接。
 * 安装动作留给 AI(用户已授权 AI 自己装 Kali) 或用户本人。
 *
 * 主题契约 (2026-10-17 修正): 本文件初版整页 GitHub 风格硬编码色
 * (#8b949e/#d29922/#3fb950/#30363d...), 打包态 (桌面 5 主题) 下与
 * 其他页面不一致 —— 正是"打包后控件与开发态不一致"的又一实例。
 * 现已全量走 CSS 变量: 成功 → var(--success), 警告 → var(--warning),
 * 错误 → var(--danger), 边框 → var(--border), 次要文字 → var(--muted-2),
 * 字号走 var(--fs-*) 尺度, 圆角走 var(--radius-*) 四档。
 */
import React, { useCallback, useEffect, useState } from 'react';
import { apiGet } from '../services/api';

interface EnvItem {
  id: string;
  name: string;
  group: 'core' | 'pentest' | 'browser';
  dep?: string;
  installHint: string;
  autoInstallable: boolean;
  installed: boolean;
  version?: string;
  detail?: string;
}
interface EnvReport {
  checkedAt: number;
  isDesktop: boolean;
  summary: { total: number; installed: number; missing: number; pentestReady: boolean };
  items: EnvItem[];
}

const GROUP_LABEL: Record<string, string> = {
  core: '核心运行时',
  browser: '浏览器自动化',
  pentest: '渗透工具链 (Kali/WSL)',
};

export function EnvCheckPanel({ onClose }: { onClose?: () => void }) {
  const [report, setReport] = useState<EnvReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set(['core']));
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await apiGet<EnvReport>('/v1/system/env-check');
      setReport(r);
    } catch (e: any) {
      setErr(e?.message || '体检请求失败 — 网关可能未启动');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const copy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied((c) => (c === id ? null : c)), 1600);
    } catch { /* 剪贴板不可用则忽略 */ }
  };

  if (loading && !report) {
    return <div style={{ padding: 16, color: 'var(--muted-2)' }}>正在体检环境…</div>;
  }
  if (err) {
    return (
      <div style={{ padding: 16 }}>
        <div style={{ color: 'var(--danger)', marginBottom: 8 }}>❌ {err}</div>
        <button onClick={() => void load()} style={{ fontSize: 'var(--fs-md)' }}>重试</button>
      </div>
    );
  }
  if (!report) return null;

  const groups = ['core', 'browser', 'pentest'] as const;
  const s = report.summary;

  return (
    <div style={{ padding: 12, fontSize: 'var(--fs-md)', lineHeight: 1.6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <strong style={{ fontSize: 'var(--fs-lg)' }}>环境体检</strong>
        <span style={{
          padding: '1px 7px', borderRadius: 'var(--radius-pill)', fontSize: 'var(--fs-micro)',
          background: s.missing === 0 ? 'var(--success-soft)' : 'var(--warning-soft)',
          color: s.missing === 0 ? 'var(--success)' : 'var(--warning)',
        }}>
          {s.installed}/{s.total} 就绪
        </span>
        {report.isDesktop && <span style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted-2)' }}>桌面版</span>}
        <div style={{ flex: 1 }} />
        <button onClick={() => void load()} style={{ fontSize: 'var(--fs-micro)' }}>重新检测</button>
        {onClose && <button onClick={onClose} style={{ fontSize: 'var(--fs-micro)' }}>关闭</button>}
      </div>

      {s.missing > 0 && (
        <div style={{
          padding: '8px 10px', marginBottom: 10, borderRadius: 'var(--radius-sm)',
          background: 'var(--warning-soft)', border: '1px solid var(--warning)', fontSize: 'var(--fs-sm)',
        }}>
          缺 {s.missing} 项。
          {s.pentestReady
            ? '渗透工具链完整, 可正常挖洞。'
            : '渗透工具链不全 — 挖洞能力会降级, 但不影响日常编码/问答。'}
          <div style={{ color: 'var(--muted-2)', marginTop: 4 }}>
            安装动作由 AI 或你本人执行, 本面板不会静默装任何东西。
          </div>
        </div>
      )}

      {groups.map((g) => {
        const items = report.items.filter((i) => i.group === g);
        if (!items.length) return null;
        const opened = openGroups.has(g);
        const miss = items.filter((i) => !i.installed).length;
        return (
          <div key={g} style={{ marginBottom: 8, border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
            <button
              onClick={() => setOpenGroups((prev) => {
                const n = new Set(prev);
                n.has(g) ? n.delete(g) : n.add(g);
                return n;
              })}
              style={{
                width: '100%', textAlign: 'left', padding: '7px 10px',
                background: 'transparent', border: 0, display: 'flex', alignItems: 'center', gap: 8,
              }}
            >
              <span style={{ color: 'var(--muted-2)', fontSize: 'var(--fs-micro)' }}>{opened ? '▼' : '▶'}</span>
              <span style={{ fontWeight: 600 }}>{GROUP_LABEL[g]}</span>
              <span style={{ fontSize: 'var(--fs-micro)', color: miss ? 'var(--warning)' : 'var(--success)' }}>
                {miss ? `${miss} 项缺失` : '全部就绪'}
              </span>
            </button>
            {opened && items.map((i) => (
              <div
                key={i.id}
                style={{
                  padding: '7px 10px', borderTop: '1px solid var(--border)',
                  display: 'flex', gap: 8, alignItems: 'flex-start',
                }}
              >
                <span style={{ color: i.installed ? 'var(--success)' : 'var(--danger)', flexShrink: 0 }}>
                  {i.installed ? '✓' : '✗'}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap' }}>
                    <span>{i.name}</span>
                    {i.version && (
                      <code style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted-2)' }}>{i.version}</code>
                    )}
                    {i.autoInstallable && !i.installed && (
                      <span style={{ fontSize: 'var(--fs-micro)', color: 'var(--success)' }}>可自动安装</span>
                    )}
                  </div>
                  {!i.installed && (
                    <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted-2)', marginTop: 2 }}>
                      <code style={{ wordBreak: 'break-all' }}>{i.installHint}</code>
                      <button
                        onClick={() => void copy(i.id, i.installHint)}
                        style={{ marginLeft: 6, fontSize: 'var(--fs-micro)' }}
                      >
                        {copied === i.id ? '已复制' : '复制'}
                      </button>
                      {i.detail && (
                        <div style={{ marginTop: 2, opacity: 0.7 }}>
                          探测输出: <code>{i.detail}</code>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

export default EnvCheckPanel;
