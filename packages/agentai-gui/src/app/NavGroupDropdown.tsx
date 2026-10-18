/**
 * NavGroupDropdown — 内联下拉 (替代 antd Dropdown) (2026-10-12 从 App.tsx 拆出)
 * ============================================================================
 * 原 App.tsx:352-473。
 * 修复背景 (原文保留): 桌面端 (Tauri transparent 模式) antd Dropdown 的
 * portal popup 不可见 —— antd 把 popup 渲染到 document.body, 被 native
 * compositor 裁剪到窗口外。解法: 内联 position:absolute 弹出面板,
 * 完全不离开 webview DOM 树。
 */
import React, { useState, useRef, useEffect } from 'react';
import { DownOutlined, CheckCircleFilled } from '@ant-design/icons';

export interface NavGroupItem {
  key: string;
  icon: React.ReactNode;
  label: string;
  desc: string;
  active?: boolean;
  badge?: string;
  /** 段标题; 与上一项不同则在本项前渲染一条分隔段头 (空则不渲染) */
  section?: string;
}

export const NavGroupDropdown: React.FC<{
  label: string;
  icon: React.ReactNode;
  active: boolean;
  items: NavGroupItem[];
  onSelect: (key: string) => void;
}> = ({ label, icon, active, items, onSelect }) => {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  return (
    <span
      ref={wrapRef}
      className={`app-tab ${active ? 'active' : ''}`}
      onClick={() => setOpen(v => !v)}
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}
    >
      {icon}
      <span>{label}</span>
      <DownOutlined style={{ fontSize: 'var(--fs-micro)', marginLeft: 2, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
      {open && (
        <div
          role="menu"
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            minWidth: 200,
            maxHeight: 480,
            overflowY: 'auto',
            background: 'var(--panel)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            padding: 4,
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            zIndex: 'var(--z-toast)',
          }}
        >
          {items.map((item, i) => {
            const showSection = !!item.section && item.section !== items[i - 1]?.section;
            return (
            <React.Fragment key={item.key}>
            {showSection && (
              <div style={{
                padding: i === 0 ? '2px 10px 4px' : '8px 10px 4px',
                marginTop: i === 0 ? 0 : 4,
                borderTop: i === 0 ? 'none' : '1px solid var(--border)',
                fontSize: 'var(--fs-micro)', fontWeight: 600, color: 'var(--muted-2)',
              }}>
                {item.section}
              </div>
            )}
            <div
              role="menuitem"
              onClick={() => { onSelect(item.key); setOpen(false); }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 10px',
                borderRadius: 'var(--radius-md)',
                cursor: 'pointer',
                background: item.active ? 'var(--accent-soft)' : 'transparent',
                transition: 'background 0.12s',
              }}
              onMouseEnter={(e) => { if (!item.active) (e.currentTarget as HTMLElement).style.background = 'var(--card-hover)'; }}
              onMouseLeave={(e) => { if (!item.active) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', color: item.active ? 'var(--accent)' : 'var(--fg-2)' }}>
                {item.icon}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-sm)', fontWeight: item.active ? 600 : 500, color: 'var(--fg)' }}>
                  {item.label}
                  {item.badge && (
                    <span style={{ fontSize: 'var(--fs-micro)', padding: '0 5px', borderRadius: 'var(--radius-md)', background: 'var(--accent)', color: 'var(--fg-on-accent)', lineHeight: '14px' }}>
                      {item.badge}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted-2)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.desc}
                </div>
              </div>
              {item.active && <CheckCircleFilled style={{ color: 'var(--accent)', fontSize: 'var(--fs-sm)' }} />}
            </div>
            </React.Fragment>
            );
          })}
        </div>
      )}
    </span>
  );
};

export default NavGroupDropdown;