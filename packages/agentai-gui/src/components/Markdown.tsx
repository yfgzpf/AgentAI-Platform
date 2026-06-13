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

export const Markdown: React.FC<Props> = ({ content, streaming }) => {
  if (streaming && !content) {
    return <Skeleton active paragraph={{ rows: 6 }} />;
  }

  const text = streaming ? content + '▍' : content;

  return (
    <div className="markdown-body" style={{ fontSize: 14, lineHeight: 1.6, wordBreak: 'break-word' }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          // 链接新窗口打开
          a: (props) => <a target="_blank" rel="noopener noreferrer" {...props} />,
          // 代码块样式
          pre: ({ children }) => (
            <pre style={{ background: '#1e1e1e', color: '#d4d4d4', padding: 12, borderRadius: 6, margin: '8px 0', overflow: 'auto' }}>
              {children}
            </pre>
          ),
          // 行内代码
          code: ({ className, children, ...props }: any) => {
            if (className?.includes('language-')) {
              return <pre style={{ background: '#1e1e1e', color: '#d4d4d4', padding: 12, borderRadius: 6, margin: '8px 0', overflow: 'auto' }}>{children}</pre>;
            }
            return <code className={className} style={{ background: '#2a2a2a', color: '#ce9178', padding: '2px 4px', borderRadius: 3 }} {...props}>{children}</code>;
          },
          // 列表样式
          ul: (props) => <ul style={{ paddingLeft: 20, margin: '4px 0' }} {...props} />,
          ol: (props) => <ol style={{ paddingLeft: 20, margin: '4px 0' }} {...props} />,
          // 引用块
          blockquote: (props) => <blockquote style={{ borderLeft: '4px solid #4F46E5', paddingLeft: 12, margin: '8px 0', color: '#888' }} {...props} />,
          // 表格
          table: (props) => (
            <div style={{ overflow: 'auto', margin: '8px 0' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%' }} {...props} />
            </div>
          ),
          th: (props) => <th style={{ border: '1px solid #333', padding: 8, background: '#1e1e1e', textAlign: 'left' }} {...props} />,
          td: (props) => <td style={{ border: '1px solid #333', padding: 8 }} {...props} />,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
};
