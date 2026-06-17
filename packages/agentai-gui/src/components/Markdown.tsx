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
  a: (props) => <a target="_blank" rel="noopener noreferrer" {...props} />,
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

  React.useEffect(() => {
    const container = ref.current;
    if (!container) return;

    // 清理 markdown 格式杂质（如反引号包裹的属性值）
    let cleanSvg = svg
      .replace(/`([^`]*)`/g, '$1')       // 去掉反引号包裹
      .replace(/xmlns="\s*`([^`]*)`\s*"/g, 'xmlns="$1"')  // 修复 xmlns 属性
      .trim();

    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(cleanSvg, 'image/svg+xml');
      const errorNode = doc.querySelector('parsererror');
      if (errorNode) {
        container.innerHTML = '<p style="color:var(--muted);font-size:12px;padding:16px;">SVG 解析失败</p>';
        return;
      }

      const scripts = doc.querySelectorAll('script');
      scripts.forEach(s => s.remove());
      const allElements = doc.querySelectorAll('*');
      allElements.forEach(el => {
        const attrs = [...el.attributes];
        for (const attr of attrs) {
          if (/^on/i.test(attr.name) || (attr.name === 'href' && /^javascript:/i.test(attr.value))) {
            el.removeAttribute(attr.name);
          }
        }
      });

      const safeSvg = doc.documentElement.outerHTML;
      container.innerHTML = safeSvg;

      const svgEl = container.querySelector('svg');
      if (svgEl) {
        if (!svgEl.hasAttribute('width')) {
          svgEl.setAttribute('width', '100%');
        }
        svgEl.style.maxWidth = '100%';
        svgEl.style.height = 'auto';
      }
    } catch {
      container.innerHTML = '<p style="color:var(--muted);font-size:12px;padding:16px;">SVG 渲染失败</p>';
    }
  }, [svg]);

  return (
    <div
      ref={ref}
      style={{
        margin: '12px 0',
        padding: '12px',
        borderRadius: 'var(--radius)',
        background: 'var(--panel)',
        border: '1px solid var(--border)',
        overflow: 'auto',
      }}
    />
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
