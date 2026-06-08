import React from 'react';
// 简化 Markdown: 用 pre + code 替代 react-markdown (避免传递依赖链)
import { Skeleton } from 'antd';

interface Props {
  content: string;
  streaming?: boolean;
}

export const Markdown: React.FC<Props> = ({ content, streaming }) => {
  if (streaming && !content) {
    return <Skeleton active paragraph={{ rows: 3 }} />;
  }
  // 极简版: 保留换行 + 简单 code block 识别
  const blocks = content.split(/(```[\s\S]*?```)/g);
  return (
    <div className="markdown-body" style={{ fontSize: 14, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
      {blocks.map((b, i) => {
        if (b.startsWith('```') && b.endsWith('```')) {
          const code = b.slice(3, -3).replace(/^.*\n/, '');
          return (
            <pre key={i} style={{ background: '#1e1e1e', color: '#d4d4d4', padding: 12, borderRadius: 6, margin: '8px 0', overflow: 'auto' }}>
              <code>{code}</code>
            </pre>
          );
        }
        return <span key={i}>{b}</span>;
      })}
      {streaming && <span style={{ animation: 'blink 1s infinite' }}>▍</span>}
    </div>
  );
};
