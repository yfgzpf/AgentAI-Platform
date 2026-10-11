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
  // 智能折叠: 15 行以下不折叠 (用户能快速浏览), 超过 15 行折叠
  const shouldCollapse = lineCount > 15;
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
      borderRadius: 'var(--radius-md)',
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
        fontSize: 'var(--fs-micro)',
      }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--muted-2)' }}>
          <span style={{
            background: 'var(--accent)',
            color: 'var(--fg-on-accent)',
            padding: '1px 6px',
            borderRadius: 'var(--radius-sm)',
            fontSize: 'var(--fs-micro)',
            fontWeight: 600,
          }}>{langLabel}</span>
          {shouldCollapse && (
            <span style={{ fontSize: 'var(--fs-micro)', opacity: 0.6 }}>{lineCount} 行 · 点击{isCollapsed ? '展开' : '折叠'}</span>
          )}
          {!shouldCollapse && lineCount > 3 && (
            <span style={{ fontSize: 'var(--fs-micro)', opacity: 0.4 }}>{lineCount} 行</span>
          )}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            onClick={handleCopy}
            style={{ cursor: 'pointer', color: copied ? 'var(--success)' : 'var(--muted-2)', fontSize: 'var(--fs-micro)' }}
          >
            {copied ? '✓ 已复制' : <><CopyOutlined style={{ marginRight: 3 }} />复制</>}
          </span>
          {shouldCollapse && (
            <span
              onClick={() => setExpanded(!expanded)}
              style={{ cursor: 'pointer', color: 'var(--accent)', fontSize: 'var(--fs-micro)' }}
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
        fontSize: 'var(--fs-sm)',
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
      // 安全解析: 不用 URL() (某些环境不支持自定义协议)
      const pathMatch = href.match(/[?&]path=([^&]*)/);
      const filePath = pathMatch ? decodeURIComponent(pathMatch[1]) : '';
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
              // P0: 走 pending 机制
              window.dispatchEvent(new CustomEvent('agentai:navigate', { detail: { page: 'editor' } }));
              window.dispatchEvent(new CustomEvent('agentai:open-file-pending', { detail: { path: filePath } }));
            }
          }}
          style={{
            color: 'var(--accent)', cursor: 'pointer', textDecoration: 'underline',
            display: 'inline-flex', alignItems: 'center', gap: 3,
          }}
        >
          {isBinary && <span style={{ fontSize: 'var(--fs-micro)' }}>⬇</span>}
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
          style={{ color: 'var(--success)', cursor: 'pointer', textDecoration: 'underline', fontSize: '0.9em' }}
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
    return <pre style={{ background: 'var(--bg-2)', color: 'var(--fg)', padding: 12, borderRadius: 'var(--radius-md)', margin: '8px 0', overflow: 'auto' }}>{children}</pre>;
  },
  code: ({ className, children, ...props }: any) => {
    if (className?.includes('language-')) {
      return <CollapsibleCodeBlock className={className} language={className.replace('language-', '')}>{children}</CollapsibleCodeBlock>;
    }
    return <code className={className} style={{ background: '#2a2a2a', color: '#ce9178', padding: '2px 4px', borderRadius: 'var(--radius-sm)' }} {...props}>{children}</code>;
  },
  ul: (props) => <ul style={{ paddingLeft: 20, margin: '4px 0' }} {...props} />,
  ol: (props) => <ol style={{ paddingLeft: 20, margin: '4px 0' }} {...props} />,
  // 标题统一缩小 — 避免浏览器默认 h1=2em 过大
  h1: (props) => <h1 style={{ fontSize: '1.3em', margin: '10px 0 6px', fontWeight: 700, lineHeight: 1.4 }} {...props} />,
  h2: (props) => <h2 style={{ fontSize: '1.2em', margin: '8px 0 4px', fontWeight: 700, lineHeight: 1.4 }} {...props} />,
  h3: (props) => <h3 style={{ fontSize: '1.1em', margin: '6px 0 3px', fontWeight: 600, lineHeight: 1.4 }} {...props} />,
  h4: (props) => <h4 style={{ fontSize: '1.05em', margin: '4px 0 2px', fontWeight: 600, lineHeight: 1.4 }} {...props} />,
  h5: (props) => <h5 style={{ fontSize: '1em', margin: '4px 0 2px', fontWeight: 600, lineHeight: 1.4 }} {...props} />,
  h6: (props) => <h6 style={{ fontSize: '0.95em', margin: '3px 0 2px', fontWeight: 600, lineHeight: 1.4, opacity: 0.85 }} {...props} />,
  p: (props) => <p style={{ margin: '3px 0', lineHeight: 'var(--chat-line-height)' }} {...props} />,
  blockquote: (props) => <blockquote style={{ borderLeft: '4px solid var(--accent)', paddingLeft: 12, margin: '6px 0', color: 'var(--muted-2)', fontSize: '0.95em' }} {...props} />,
  table: (props) => (
    <div style={{ overflow: 'auto', margin: '8px 0' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%' }} {...props} />
    </div>
  ),
  th: (props) => <th style={{ border: '1px solid var(--border)', padding: 8, background: 'var(--bg-2)', textAlign: 'left' }} {...props} />,
  td: (props) => <td style={{ border: '1px solid var(--border)', padding: 8 }} {...props} />,
};

const MARKDOWN_PROPS = {
  remarkPlugins: [remarkGfm, remarkMath] as any,
  rehypePlugins: [rehypeHighlight] as any,
  components: REACT_MARKDOWN_COMPONENTS,
  // 允许 agentai:// 自定义协议 (ReactMarkdown 默认可能过滤非标准协议)
  urlTransform: (url: string) => url,
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
          container.innerHTML = '<p style="color:var(--muted);font-size:var(--fs-sm);padding:16px;">SVG 解析失败 — 点击下方复制源码查看</p>';
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
      container.innerHTML = '<p style="color:var(--muted);font-size:var(--fs-sm);padding:16px;">SVG 渲染失败</p>';
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
          fontSize: 'var(--fs-micro)', padding: '2px 8px', borderRadius: 'var(--radius-sm)',
          background: 'transparent', border: '1px solid var(--border)',
          color: 'var(--muted)', cursor: 'pointer',
        }}>复制 SVG</button>
        <button onClick={handleDownload} style={{
          fontSize: 'var(--fs-micro)', padding: '2px 8px', borderRadius: 'var(--radius-sm)',
          background: 'transparent', border: '1px solid var(--border)',
          color: 'var(--muted)', cursor: 'pointer',
        }}>下载 SVG</button>
      </div>
    </div>
  );
};

/**
 * 清理工具调用标记，防止显示在对话中
 * 支持多种格式：
 * 1. <tool_call>...</tool_call>
 * 2. <tool_call> <function=name> <parameter=key> value </parameter> </function> </tool_call>
 * 3. <function=name> ... </function>
 * 4. <parameter=key> value </parameter>
 */
function cleanToolCalls(text: string): string {
  // 移除各种工具调用格式
  return text
    // 标准 XML 格式 <tool_call>...</tool_call>
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '')
    .replace(/<tool_call\s+[^>]*>[\s\S]*?<\/tool_call>/g, '')
    // 函数调用格式 <function=name> ... </function>
    .replace(/<function=[^>]+>[\s\S]*?<\/function>/g, '')
    // 参数格式 <parameter=key> value </parameter>
    .replace(/<parameter=[^>]+>[\s\S]*?<\/parameter>/g, '')
    // 旧格式兼容
    .replace(/<arg_key>[^<]*<\/arg_key>/g, '')
    .replace(/<arg_value>[^<]*<\/arg_value>/g, '')
    // 清理多余的空行（保留最多两行）
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * 自动检测文本中的文件路径，转为可点击的 agentai://open 链接
 */
function linkifyFilePaths(text: string): string {
  // 不处理代码块中的内容
  const codeBlocks: string[] = [];
  let processed = text.replace(/```[\s\S]*?```/g, (m) => {
    codeBlocks.push(m);
    return `__CODEBLOCK_${codeBlocks.length - 1}__`;
  });

  // 文件扩展名 (常见)
  const extPattern = '(?:tsx?|jsx?|py|rs|go|java|css|scss|sass|less|html?|json|ya?ml|toml|md|txt|csv|sql|sh|bash|zsh|vue|svelte|swift|kt|dart|c|cpp|cs|php|rb|lua|xlsx?|docx?|pptx?|pdf|zip|rar|7z|tar|gz|bz2|mp3|mp4|avi|mov|webm|wav|flac|ogg|bmp|jpe?g|png|gif|svg|webp|ico|psd|fig)';

  // 1. 绝对路径 Windows: F:\path\to\file.ts — 用简单字符集避免范围问题
  //    匹配: 盘符冒号反斜杠 + 非空白字符 + .扩展名
  const winPathRe = new RegExp('([A-Za-z]:\\\\[^\\s<>|"\'*|?\\n\\r]+\\.' + extPattern + ')', 'gi');
  processed = processed.replace(winPathRe, (match) => {
    const clean = match.replace(/[)\]},;:>]+$/, '');
    return `[${clean}](${'agentai://open?path=' + encodeURIComponent(clean)})`;
  });

  // 2. 绝对路径 Unix: /home/user/file.py
  const unixPathRe = new RegExp('(/(?:home|Users|opt|var|tmp|root|etc)/[^\\s<>|"\'*|?\\n\\r]+\\.' + extPattern + ')', 'gi');
  processed = processed.replace(unixPathRe, (match) => {
    const clean = match.replace(/[)\]},;:>]+$/, '');
    return `[${clean}](${'agentai://open?path=' + encodeURIComponent(clean)})`;
  });

  // 3. 相对路径带关键词: "已生成 xxx.ts" / "文件: xxx.js"
  const keywordRe = new RegExp('(已生成|已创建|已保存|文件[:：]?|路径[:：]?|生成[:：]?|创建[:：]?|保存[:：]?)\\s*[`"\']?([^\\s`"\'\\n\\r<>]+\\.' + extPattern + ')[`"\']?', 'gi');
  processed = processed.replace(keywordRe, (_match, prefix, file) => {
    return `${prefix} [\`${file}\`](${'agentai://open?path=' + encodeURIComponent(file)})`;
  });

  // 4. 反引号文件名: `xxx.ts` → 可点击 (但不动已有链接中的)
  const backtickRe = new RegExp('`([^`\\n\\r<>]+\\.' + extPattern + ')`', 'gi');
  processed = processed.replace(backtickRe, (match, file) => {
    // 如果已经在 agentai:// 链接中, 跳过 (检测前后的 ]( 标记)
    return `[\`${file}\`](${'agentai://open?path=' + encodeURIComponent(file)})`;
  });

  // 恢复代码块
  processed = processed.replace(/__CODEBLOCK_(\d+)__/g, (_, i) => codeBlocks[parseInt(i)] || '');

  return processed;
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
  // 自动将文本中的文件路径转为可点击链接
  const linkedContent = linkifyFilePaths(cleanedContent);
  const text = streaming ? linkedContent + '▍' : linkedContent;

  // 检测 SVG 代码块并分段渲染
  const parts = splitSvgBlocks(text);

  // 如果没有 SVG，走纯 Markdown 路径 (性能最优)
  if (parts.length === 1 && parts[0].type === 'text') {
    return (
      <div className="markdown-body" style={{ fontSize: 'var(--chat-font-size)', lineHeight: 'var(--chat-line-height)', wordBreak: 'break-word' }}>
        <ReactMarkdown {...MARKDOWN_PROPS}>{text}</ReactMarkdown>
      </div>
    );
  }

  // 混合渲染: 文本 + SVG 交替
  return (
    <div style={{ fontSize: 'var(--chat-font-size)', lineHeight: 'var(--chat-line-height)', wordBreak: 'break-word' }}>
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
