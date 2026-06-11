import React, { useState } from 'react';
import { Button, Input, message as msg, Tooltip, Space } from 'antd';
import { SaveOutlined, FileTextOutlined, ExportOutlined, RobotOutlined } from '@ant-design/icons';
import { Markdown } from './Markdown';
import { useModelStore } from '../store/modelStore';

export const WritePage: React.FC = () => {
  const [content, setContent] = useState(() => localStorage.getItem('agentai-write-draft') || '');
  const [preview, setPreview] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [title, setTitle] = useState(() => {
    const saved = localStorage.getItem('agentai-write-title');
    return saved || '未命名文档';
  });

  const md2html = (md: string): string => {
    let h = md
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^# (.+)$/gm, '<h1>$1</h1>')
      .replace(/```(\w*)\n?([\s\S]*?)```/g, '<pre><code class="lang-$1">$2</code></pre>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
      .replace(/^- (.+)$/gm, '<li>$1</li>')
      .replace(/(\S)\n(\S)/g, '$1<br>$2');
    return `<p>${h.split('\n\n').join('</p><p>')}</p>`;
  };

  const exportDoc = (format: 'md' | 'html' | 'pdf') => {
    if (format === 'pdf') {
      const win = window.open('', '_blank');
      if (!win) { msg.error('浏览器阻止了弹出窗口'); return; }
      win.document.write(`<!DOCTYPE html><html><head><title>${title}</title>
        <style>body{font-family:'Segoe UI',sans-serif;padding:40px;line-height:1.8;max-width:800px;margin:auto;color:#333}
        h1,h2,h3{color:#1a1a1a;margin-top:24px}code{background:#f5f5f5;padding:2px 6px;border-radius:4px;font-size:.9em}
        pre{background:#f5f5f5;padding:16px;border-radius:8px;overflow-x:auto}blockquote{border-left:4px solid #ddd;margin:0;padding-left:16px;color:#666}
        @media print{body{padding:0;margin:0}}</style></head><body>${md2html(content)}</body></html>`);
      win.document.close();
      setTimeout(() => { win.print(); }, 500);
      return;
    }
    const blob = new Blob(
      format === 'md' ? [content] : [`<html><body>${content}</body></html>`],
      { type: format === 'md' ? 'text/markdown' : 'text/html' },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = title.replace(/\.\w+$/, '') + '.' + format;
    a.click();
    URL.revokeObjectURL(url);
  };

  const aiComplete = async () => {
    if (!aiPrompt.trim() || aiBusy) return;
    setAiBusy(true);
    try {
      const provider = useModelStore.getState().activeModelId || 'agentai';
      const resp = await fetch('/v1/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: `请帮我写一段 Markdown 内容: ${aiPrompt}\n\n当前文档最后 500 字:\n${content.slice(-500)}`, stream: false, model: provider }),
      });
      const json = await resp.json();
      if (json.content) setContent(prev => prev + '\n\n' + json.content);
    } catch (e: any) { msg.error(String(e)); }
    finally { setAiBusy(false); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0f0f0f' }}>
      {/* 工具栏 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', borderBottom: '1px solid #1f1f1f', background: '#141414' }}>
        <input value={title} onChange={e => { setTitle(e.target.value); localStorage.setItem('agentai-write-title', e.target.value); }}
          style={{ background: 'transparent', border: 'none', color: '#ddd', fontSize: 14, fontWeight: 600, outline: 'none', flex: 1 }} />
        <Button size="small" type={preview ? 'primary' : 'default'} onClick={() => setPreview(!preview)} style={{ fontSize: 11 }}>
          {preview ? '编辑' : '预览'}
        </Button>
        <Tooltip title="导出 Markdown">
          <Button size="small" type="text" icon={<ExportOutlined />} onClick={() => exportDoc('md')} style={{ color: '#888' }} />
        </Tooltip>
        <Tooltip title="导出 PDF">
          <Button size="small" type="text" icon={<FileTextOutlined />} onClick={() => exportDoc('pdf')} style={{ color: '#888' }}>PDF</Button>
        </Tooltip>
        <Tooltip title="保存">
          <Button size="small" type="text" icon={<SaveOutlined />} onClick={() => { localStorage.setItem('agentai-write-draft', content); msg.success('已保存'); }} style={{ color: '#888' }} />
        </Tooltip>
      </div>

      {/* 编辑器/预览 */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {!preview && (
          <textarea value={content} onChange={e => setContent(e.target.value)}
            style={{ flex: 1, padding: 20, background: '#0a0a0a', color: '#ddd', border: 'none', outline: 'none', fontSize: 14, lineHeight: 1.8, fontFamily: 'monospace', resize: 'none' }} />
        )}
        {preview && (
          <div style={{ flex: 1, padding: 20, overflow: 'auto', color: '#ccc', lineHeight: 1.8 }}>
            <Markdown content={content} />
          </div>
        )}
      </div>

      {/* AI 辅助输入 */}
      <div style={{ display: 'flex', gap: 8, padding: '8px 16px', borderTop: '1px solid #1f1f1f', background: '#141414' }}>
        <Input value={aiPrompt} onChange={e => setAiPrompt(e.target.value)} placeholder="AI 写作辅助: 输入指令..." onPressEnter={aiComplete}
          style={{ flex: 1, background: '#0f0f0f', borderColor: '#262626', color: '#ddd' }} />
        <Button icon={<RobotOutlined />} onClick={aiComplete} loading={aiBusy} type="primary" ghost>生成</Button>
      </div>
    </div>
  );
};
