/**
 * AutoIdentifyPanel — 界面元素自动识别面板
 * ----------------------------------------------------
 * 自动识别当前页面的 UI 元素结构
 * 将识别结果发送到 AI 上下文, 支持 AI 自动化控制
 *
 * 功能:
 *   - 扫描页面 DOM 生成元素列表
 *   - 识别可交互元素 (button, input, a, select, etc.)
 *   - 高亮选中的元素
 *   - 将元素结构发送到 AI 上下文
 */
import React, { useState, useCallback } from 'react';
import { Card, Tag, Button, Tooltip, Space, Input, message, Empty } from 'antd';
import { ScanOutlined, AimOutlined, SendOutlined, ReloadOutlined } from '@ant-design/icons';

interface UIElement {
  tag: string;
  id?: string;
  className?: string;
  text?: string;
  type?: string;
  selector: string;
}

export const AutoIdentifyPanel: React.FC = () => {
  const [elements, setElements] = useState<UIElement[]>([]);
  const [scanning, setScanning] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  const scanPage = useCallback(() => {
    setScanning(true);
    try {
      const result: UIElement[] = [];
      const interactive = document.querySelectorAll('button, input, a, select, textarea, [role="button"], [onclick]');
      interactive.forEach((el, i) => {
        if (i > 50) return;
        const tag = el.tagName.toLowerCase();
        result.push({
          tag,
          id: (el as HTMLElement).id || undefined,
          className: (el as HTMLElement).className?.toString().slice(0, 60) || undefined,
          text: (el as HTMLElement).textContent?.trim().slice(0, 40) || undefined,
          type: (el as HTMLInputElement).type || undefined,
          selector: `${tag}${(el as HTMLElement).id ? '#' + (el as HTMLElement).id : (el as HTMLElement).className ? '.' + (el as HTMLElement).className?.toString().split(' ')[0] : ''}`,
        });
      });
      setElements(result);
      setSelectedIdx(null);
    } catch { /* ignore */ }
    setScanning(false);
  }, []);

  const sendToAI = (selector: string) => {
    const input = document.querySelector('textarea') as HTMLTextAreaElement;
    if (input) {
      input.value = `操作页面元素: ${selector}`;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      message.success(`已填入: ${selector}`);
    }
  };

  return (
    <Card
      size="small"
      title={<span style={{ fontSize: 12, color: 'var(--fg-2)' }}><ScanOutlined style={{ marginRight: 4 }} />页面元素识别</span>}
      extra={<Button size="small" type="text" icon={<ReloadOutlined />} loading={scanning} onClick={scanPage} style={{ color: 'var(--muted-2)', fontSize: 10, height: 22 }} />}
      style={{ borderRadius: 8, background: 'var(--card)', border: '1px solid var(--border)' }}
      styles={{ body: { padding: '8px 12px', maxHeight: 300, overflowY: 'auto' } }}
    >
      {elements.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<span style={{ fontSize: 11, color: 'var(--muted-2)' }}>点击刷新按钮扫描页面</span>} style={{ margin: '8px 0' }} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 10, color: 'var(--muted-2)', marginBottom: 4 }}>找到 {elements.length} 个可交互元素</div>
          {elements.map((el, i) => (
            <div key={i} style={{
              padding: '4px 8px', borderRadius: 4,
              background: selectedIdx === i ? 'rgba(99,102,241,0.1)' : 'var(--bg-2)',
              border: `1px solid ${selectedIdx === i ? 'rgba(99,102,241,0.3)' : 'var(--border)'}`,
              cursor: 'pointer',
            }} onClick={() => setSelectedIdx(i)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <Tag style={{ fontSize: 8, borderRadius: 2, lineHeight: '14px', height: 16, margin: 0 }}>{el.tag}</Tag>
                {el.id && <span style={{ fontSize: 9, color: '#6366f1', fontFamily: 'monospace' }}>#{el.id}</span>}
                <span style={{ fontSize: 9, color: 'var(--fg-2)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {el.text || el.type || el.selector}
                </span>
                <Tooltip title="发送到AI输入框">
                  <Button size="small" type="text" icon={<SendOutlined />} onClick={(e) => { e.stopPropagation(); sendToAI(el.selector); }} style={{ fontSize: 10, height: 18, padding: '0 4px' }} />
                </Tooltip>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
};
