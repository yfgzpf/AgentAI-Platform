import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeHighlight from 'rehype-highlight';
import { Skeleton, Typography } from 'antd';

const { Text } = Typography;

interface Props {
  content: string;
  streaming?: boolean;
}

// ===== 共享 Markdown 组件配置 (避免重复) =====

const REACT_MARKDOWN_COMPONENTS: Parameters<typeof ReactMarkdown>[0]['components'] = {
  a: (props) => {
    const href = props.href || '';
    // agentai:// 协议: 打开文件
    if (href.startsWith('agentai://open')) {
      const url = new URL(href);
      const filePath = decodeURIComponent(url.searchParams.get('path') || '');
      const ext = filePath.split('.').pop()?.toLowerCase() || '';
      const binaryExts = ['xlsx', 'xls', 'docx', 'doc', 'pdf', 'pptx', 'ppt', 'zip', 'rar', '7z', 'exe', 'dmg', 'mp3', 'mp4', 'avi', 'mov'];
      const isBinary = binaryExts.includes(ext);
      return (
        <a
          href={isBinary ? `/api/files/download?path=${encodeURIComponent(filePath)}` : '#'}
          download={isBinary ? filePath.split(/[\\/]/).pop() : undefined}
          onClick={isBinary ? undefined : (e) => {
            e.preventDefault();
            if (filePath) {
              window.dispatchEvent(new CustomEvent('agentai:open-file', { detail: { path: filePath } }));
              try {
                const store = (window as any).__agentai_app_store__;
                if (store?.getState?.().setView) store.getState().setView('editor');
              } catch { /* optional */ }
            }
          }}
          style={{
            color: 'var(--accent)', cursor: 'pointer', textDecoration: 'underline',
            display: 'inline-flex', alignItems: 'center', gap: 3,
          }}
        >
          {isBinary && <span style={{ fontSize: 10 }}>⬇</span>}
          {props.children}
        </a>
      );
    }
    // agentai:// 协议: 查看修改 (Diff)
    if (href.startsWith('agentai://diff')) {
      const url = new URL(href);
      const filePath = decodeURIComponent(url.searchParams.get('path') || '');
      return (
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            if (filePath) {
              window.dispatchEvent(new CustomEvent('agentai:show-diff', { detail: { path: filePath } }));
            }
          }}
          style={{ color: '#22c55e', cursor: 'pointer', textDecoration: 'underline', fontSize: '0.9em' }}
        >
          {props.children}
        </a>
      );
    }
    return <a target="_blank" rel="noopener noreferrer" {...props} />;
  },
  pre: ({ children }) => (
    <pre style={{ background: '#1e1e1e', color: '#d4d4d4', padding: 12, borderRadius: 6, margin: '8px 0', overflow: 'auto' }}>
      {children}
    </pre>
  ),
  code: ({ className, children, ...props }: any) => {
    if (className?.includes('language-')) {
      return <pre style={{ background: '#1e1e1e', color: '#d4d4d4', padding: 12, borderRadius: 6, margin: '8px 0', overflow: 'auto' }}>{children}</pre>;
    }
    return <code className={className} style={{ background: '#2a2a2a', color: '#ce9178', padding: '2px 4px', borderRadius: 3 }} {...props}>{children}</code>;
  },
  ul: (props) => <ul style={{ paddingLeft: 20, margin: '4px 0' }} {...props} />,
  ol: (props) => <ol style={{ paddingLeft: 20, margin: '4px 0' }} {...props} />,
  blockquote: (props) => <blockquote style={{ borderLeft: '4px solid #4F46E5', paddingLeft: 12, margin: '8px 0', color: '#888' }} {...props} />,
  table: (props) => (
    <div style={{ overflow: 'auto', margin: '8px 0' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%' }} {...props} />
    </div>
  ),
  th: (props) => <th style={{ border: '1px solid #333', padding: 8, background: '#1e1e1e', textAlign: 'left' }} {...props} />,
  td: (props) => <td style={{ border: '1px solid #333', padding: 8 }} {...props} />,
};

const MARKDOWN_PROPS = {
  remarkPlugins: [remarkGfm, remarkMath] as any,
  rehypePlugins: [rehypeHighlight] as any,
  components: REACT_MARKDOWN_COMPONENTS,
};

// ===== SVG 分割与渲染 =====

/**
 * 检测并提取 markdown 中的 ```svg ... ``` 代码块内容
 * 如果包含 SVG，拆分为: before text + SVG + after text
 */
function splitSvgBlocks(md: string): Array<{ type: 'text' | 'svg'; content: string }> {
  const parts: Array<{ type: 'text' | 'svg'; content: string }> = [];
  const re = /```svg\s*\n([\s\S]*?)```/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(md)) !== null) {
    if (match.index > lastIdx) {
      parts.push({ type: 'text', content: md.slice(lastIdx, match.index) });
    }
    parts.push({ type: 'svg', content: (match[1] || '').trim() });
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < md.length) {
    parts.push({ type: 'text', content: md.slice(lastIdx) });
  }

  return parts;
}

/**
 * SvgDiagram — 安全的 SVG 渲染组件
 * 使用 DOMParser 验证 + sanitize，防止 XSS
 */
const SvgDiagram: React.FC<{ svg: string }> = ({ svg }) => {
  const ref = React.useRef<HTMLDivElement>(null);
  const [svgSource, setSvgSource] = React.useState('');

  React.useEffect(() => {
    const container = ref.current;
    if (!container) return;

    // 清理 markdown 格式杂质
    let cleanSvg = svg
      .replace(/`([^`]*)`/g, '$1')
      .replace(/xmlns="\s*`([^`]*)`\s*"/g, 'xmlns="$1"')
      .replace(/\\n/g, '\n')
      .replace(/\\"/g, '"')
      .trim();

    // 如果不以 <svg 开头，尝试提取 <svg>...</svg>
    if (!cleanSvg.startsWith('<svg') && !cleanSvg.startsWith('<?xml')) {
      const svgMatch = cleanSvg.match(/<svg[\s\S]*<\/svg>/i);
      if (svgMatch) cleanSvg = svgMatch[0];
    }

    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(cleanSvg, 'image/svg+xml');
      const errorNode = doc.querySelector('parsererror');
      if (errorNode) {
        // 二次尝试: 包裹 xmlns
        const retry = cleanSvg.includes('xmlns') ? cleanSvg
          : cleanSvg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
        const doc2 = parser.parseFromString(retry, 'image/svg+xml');
        if (doc2.querySelector('parsererror')) {
          container.innerHTML = '<p style="color:var(--muted);font-size:12px;padding:16px;">SVG 解析失败 — 点击下方复制源码查看</p>';
          setSvgSource(cleanSvg);
          return;
        }
        cleanSvg = retry;
      }

      // 安全清理
      const finalDoc = parser.parseFromString(cleanSvg, 'image/svg+xml');
      finalDoc.querySelectorAll('script').forEach(s => s.remove());
      finalDoc.querySelectorAll('*').forEach(el => {
        [...el.attributes].forEach(attr => {
          if (/^on/i.test(attr.name) || (attr.name === 'href' && /^javascript:/i.test(attr.value))) {
            el.removeAttribute(attr.name);
          }
        });
      });

      const safeSvg = finalDoc.documentElement.outerHTML;
      container.innerHTML = safeSvg;
      setSvgSource(safeSvg);

      const svgEl = container.querySelector('svg');
      if (svgEl) {
        if (!svgEl.hasAttribute('width')) svgEl.setAttribute('width', '100%');
        svgEl.style.maxWidth = '100%';
        svgEl.style.height = 'auto';
      }
    } catch {
      container.innerHTML = '<p style="color:var(--muted);font-size:12px;padding:16px;">SVG 渲染失败</p>';
      setSvgSource(cleanSvg);
    }
  }, [svg]);

  const handleCopy = () => {
    navigator.clipboard.writeText(svgSource || svg).then(() => {
      const btn = document.activeElement as HTMLElement;
      if (btn) { btn.textContent = '已复制'; setTimeout(() => { btn.textContent = '复制 SVG'; }, 1500); }
    });
  };

  const handleDownload = () => {
    const blob = new Blob([svgSource || svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'diagram.svg';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ margin: '12px 0' }}>
      <div
        ref={ref}
        style={{
          padding: '12px',
          borderRadius: 'var(--radius)',
          background: 'var(--panel)',
          border: '1px solid var(--border)',
          overflow: 'auto',
        }}
      />
      <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
        <button onClick={handleCopy} style={{
          fontSize: 10, padding: '2px 8px', borderRadius: 4,
          background: 'transparent', border: '1px solid var(--border)',
          color: 'var(--muted)', cursor: 'pointer',
        }}>复制 SVG</button>
        <button onClick={handleDownload} style={{
          fontSize: 10, padding: '2px 8px', borderRadius: 4,
          background: 'transparent', border: '1px solid var(--border)',
          color: 'var(--muted)', cursor: 'pointer',
        }}>下载 SVG</button>
      </div>
    </div>
  );
};

/**
 * Markdown — Markdown 渲染组件，支持内嵌 SVG 图表
 */
export const Markdown: React.FC<Props> = ({ content, streaming }) => {
  if (streaming && !content) {
    return <Skeleton active paragraph={{ rows: 6 }} />;
  }

  const text = streaming ? content + '▍' : content;

  // 检测 SVG 代码块并分段渲染
  const parts = splitSvgBlocks(text);

  // 如果没有 SVG，走纯 Markdown 路径 (性能最优)
  if (parts.length === 1 && parts[0].type === 'text') {
    return (
      <div className="markdown-body" style={{ fontSize: 14, lineHeight: 1.6, wordBreak: 'break-word' }}>
        <ReactMarkdown {...MARKDOWN_PROPS}>{text}</ReactMarkdown>
      </div>
    );
  }

  // 混合渲染: 文本 + SVG 交替
  return (
    <div style={{ fontSize: 14, lineHeight: 1.6, wordBreak: 'break-word' }}>
      {parts.map((part, i) =>
        part.type === 'svg' ? (
          <SvgDiagram key={i} svg={part.content} />
        ) : (
          <div key={i} className="markdown-body">
            <ReactMarkdown {...MARKDOWN_PROPS}>{part.content}</ReactMarkdown>
          </div>
        ),
      )}
    </div>
  );
};
