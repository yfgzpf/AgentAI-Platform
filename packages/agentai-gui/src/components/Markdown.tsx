import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeHighlight from 'rehype-highlight';
import { Skeleton, Typography } from 'antd';
import { CopyOutlined, DownOutlined, UpOutlined } from '@ant-design/icons';

const { Text } = Typography;

interface Props {
  content: string;
  streaming?: boolean;
}

// ===== 共享 Markdown 组件配置 (避免重复) =====

// ===== 可折叠代码块 (ZCode 风格: 大代码默认折叠) =====

const CollapsibleCodeBlock: React.FC<{
  className?: string;
  children: React.ReactNode;
  language?: string;
}> = ({ className, children, language }) => {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  
  // 提取代码文本
  const codeText = typeof children === 'string' ? children : String(children || '');
  const lineCount = codeText.split('\n').length;
  // 超过 8 行的代码块默认折叠
  const shouldCollapse = lineCount > 8;
  const isCollapsed = shouldCollapse && !expanded;

  // 语言标签
  const langLabel = (className?.replace('language-', '') || language || 'code').toUpperCase();

  const handleCopy = () => {
    navigator.clipboard.writeText(codeText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div style={{
      margin: '8px 0',
      borderRadius: 6,
      border: '1px solid var(--border)',
      background: '#1a1a2e',
      overflow: 'hidden',
    }}>
      {/* 代码头栏 */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '4px 10px',
        background: 'rgba(0,0,0,0.3)',
        borderBottom: isCollapsed ? 'none' : '1px solid var(--border)',
        fontSize: 10,
      }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--muted-2)' }}>
          <span style={{
            background: 'var(--accent)',
            color: '#fff',
            padding: '1px 6px',
            borderRadius: 3,
            fontSize: 9,
            fontWeight: 600,
          }}>{langLabel}</span>
          {shouldCollapse && (
            <span style={{ fontSize: 9 }}>{lineCount} 行</span>
          )}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            onClick={handleCopy}
            style={{ cursor: 'pointer', color: copied ? 'var(--success)' : 'var(--muted-2)', fontSize: 9 }}
          >
            {copied ? '✓ 已复制' : <><CopyOutlined style={{ marginRight: 3 }} />复制</>}
          </span>
          {shouldCollapse && (
            <span
              onClick={() => setExpanded(!expanded)}
              style={{ cursor: 'pointer', color: 'var(--accent)', fontSize: 9 }}
            >
              {isCollapsed ? <><DownOutlined /> 展开</> : <><UpOutlined /> 折叠</>}
            </span>
          )}
        </span>
      </div>

      {/* 代码内容 */}
      <pre style={{
        margin: 0,
        padding: isCollapsed ? '8px 12px' : '12px',
        overflow: isCollapsed ? 'hidden' : 'auto',
        maxHeight: isCollapsed ? 120 : 600,
        background: '#1a1a2e',
        color: '#d4d4d4',
        fontSize: 11.5,
        lineHeight: 1.5,
        fontFamily: 'Consolas, "Courier New", monospace',
      }}>
        {children}
      </pre>

      {/* 折叠时的渐变遮罩 */}
      {isCollapsed && (
        <div style={{
          position: 'absolute',
          bottom: 28,
          left: 0, right: 0,
          height: 40,
          background: 'linear-gradient(transparent, #1a1a2e)',
          pointerEvents: 'none',
        }} />
      )}
    </div>
  );
};

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
  pre: ({ children }) => {
    // 检查是否是代码块 (有 code 子元素且有语言类名)
    const child = React.Children.toArray(children)[0] as any;
    if (child?.props?.className?.includes('language-') || child?.props?.className === undefined) {
      return <CollapsibleCodeBlock className={child?.props?.className}>{child?.props?.children}</CollapsibleCodeBlock>;
    }
    return <pre style={{ background: '#1e1e1e', color: '#d4d4d4', padding: 12, borderRadius: 6, margin: '8px 0', overflow: 'auto' }}>{children}</pre>;
  },
  code: ({ className, children, ...props }: any) => {
    if (className?.includes('language-')) {
      return <CollapsibleCodeBlock className={className} language={className.replace('language-', '')}>{children}</CollapsibleCodeBlock>;
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
 * 清理工具调用标记，防止显示在对话中
 */
function cleanToolCalls(text: string): string {
  // 移除 <tool_call>...</tool_call> 标记及其内容
  return text
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '')
    .replace(/<tool_call\s+[^>]*>[\s\S]*?<\/tool_call>/g, '')
    .replace(/<arg_key>[^<]*<\/arg_key>/g, '')
    .replace(/<arg_value>[^<]*<\/arg_value>/g, '')
    .trim();
}

/**
 * Markdown — Markdown 渲染组件，支持内嵌 SVG 图表
 */
export const Markdown: React.FC<Props> = ({ content, streaming }) => {
  if (streaming && !content) {
    return <Skeleton active paragraph={{ rows: 6 }} />;
  }

  // 清理工具调用标记
  const cleanedContent = cleanToolCalls(content);
  const text = streaming ? cleanedContent + '▍' : cleanedContent;

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
