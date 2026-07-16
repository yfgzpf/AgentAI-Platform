/**
 * CodeSandbox - 代码沙箱展示容器
 * 
 * 参考 Reasonix 的代码展示：
 * 1. 显示代码编辑器
 * 2. 支持语法高亮
 * 3. 显示文件路径
 * 4. 支持运行/复制
 */
import React, { useState, useEffect } from 'react';
import { Button, Tooltip, Tag } from 'antd';
import {
  PlayCircleOutlined,
  CopyOutlined,
  CheckOutlined,
  CodeOutlined,
  FileTextOutlined,
  DownloadOutlined,
} from '@ant-design/icons';

interface CodeSandboxProps {
  code: string;
  language?: string;
  filename?: string;
  path?: string;
  onRun?: (code: string) => void;
  readOnly?: boolean;
  height?: number | string;
}

export const CodeSandbox: React.FC<CodeSandboxProps> = ({
  code,
  language = 'typescript',
  filename,
  path,
  onRun,
  readOnly = false,
  height = 300,
}) => {
  const [copied, setCopied] = useState(false);
  const [isRunning, setIsRunning] = useState(false);

  // 复制到剪贴板
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 降级方案
      const textarea = document.createElement('textarea');
      textarea.value = code;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // 运行代码
  const handleRun = () => {
    if (onRun) {
      setIsRunning(true);
      onRun(code);
      setTimeout(() => setIsRunning(false), 1000);
    }
  };

  // 获取语言颜色
  const getLanguageColor = (lang: string): string => {
    const colors: Record<string, string> = {
      typescript: '#3178c6',
      javascript: '#f7df1e',
      python: '#3572A5',
      java: '#b07219',
      go: '#00ADD8',
      rust: '#dea584',
      html: '#e34c26',
      css: '#264de4',
      json: '#2980b9',
      markdown: '#083fa1',
      bash: '#89e051',
      sql: '#e38c00',
    };
    return colors[lang] || '#666';
  };

  // 简单的语法高亮
  const highlightCode = (code: string, lang: string): string => {
    // 这里使用简单的处理，实际应该用 prism.js 或 highlight.js
    return code
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"([^"]*)"/g, '<span style="color:#ce9178">"$1"</span>')
      .replace(/'([^']*)'/g, "<span style='color:#ce9178'>'$1'</span>")
      .replace(/\b(const|let|var|function|return|if|else|for|while|import|export|from|class|interface|type|async|await)\b/g, 
        '<span style="color:#c586c0">$1</span>')
      .replace(/\b(true|false|null|undefined)\b/g, 
        '<span style="color:#569cd6">$1</span>')
      .replace(/\b(\d+)\b/g, 
        '<span style="color:#b5cea8">$1</span>');
  };

  return (
    <div style={{
      border: '1px solid var(--border)',
      borderRadius: 8,
      overflow: 'hidden',
      background: '#1e1e1e', // VS Code dark theme
      fontFamily: "'Fira Code', 'Cascadia Code', Consolas, monospace",
      fontSize: 13,
      lineHeight: 1.5,
      height: typeof height === 'number' ? `${height}px` : height,
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* 头部 */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 12px',
        background: '#252526',
        borderBottom: '1px solid #3c3c3c',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* 文件图标 */}
          <FileTextOutlined style={{ color: '#cccccc' }} />
          
          {/* 文件名 */}
          {filename && (
            <span style={{ color: '#cccccc', fontSize: 13 }}>
              {filename}
            </span>
          )}
          
          {/* 文件路径 */}
          {path && (
            <span style={{ color: '#808080', fontSize: 11 }}>
              {path}
            </span>
          )}
          
          {/* 语言标签 */}
          <Tag 
            color={getLanguageColor(language)} 
            style={{ fontSize: 11, margin: 0 }}
          >
            {language.toUpperCase()}
          </Tag>
        </div>

        {/* 操作按钮 */}
        <div style={{ display: 'flex', gap: 6 }}>
          {onRun && (
            <Tooltip title="运行">
              <Button
                type="text"
                size="small"
                icon={isRunning ? <PlayCircleOutlined spin /> : <PlayCircleOutlined />}
                onClick={handleRun}
                disabled={isRunning}
                style={{ color: isRunning ? '#4ade80' : '#cccccc' }}
              />
            </Tooltip>
          )}
          
          <Tooltip title={copied ? '已复制' : '复制'}>
            <Button
              type="text"
              size="small"
              icon={copied ? <CheckOutlined /> : <CopyOutlined />}
              onClick={handleCopy}
              style={{ color: copied ? '#4ade80' : '#cccccc' }}
            />
          </Tooltip>

          <Tooltip title="下载">
            <Button
              type="text"
              size="small"
              icon={<DownloadOutlined />}
              onClick={() => {
                const blob = new Blob([code], { type: 'text/plain' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename || `code.${language}`;
                a.click();
                URL.revokeObjectURL(url);
              }}
              style={{ color: '#cccccc' }}
            />
          </Tooltip>
        </div>
      </div>

      {/* 代码区域 */}
      <pre style={{
        flex: 1,
        margin: 0,
        padding: '12px 16px',
        overflow: 'auto',
        background: '#1e1e1e',
        color: '#d4d4d4',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}>
        <code dangerouslySetInnerHTML={{ __html: highlightCode(code, language) }} />
      </pre>

      {/* 底部状态栏 */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '6px 12px',
        background: '#252526',
        borderTop: '1px solid #3c3c3c',
        fontSize: 11,
        color: '#808080',
      }}>
        <span>{code.split('\n').length} 行</span>
        <span>{code.length.toLocaleString()} 字符</span>
      </div>
    </div>
  );
};

/**
 * 多文件代码沙箱
 */
export interface MultiFileSandboxProps {
  files: Array<{
    name: string;
    content: string;
    language?: string;
    path?: string;
  }>;
  activeFile?: string;
  onFileChange?: (name: string) => void;
  onRun?: (files: Array<{ name: string; content: string; language?: string }>) => void;
}

export const MultiFileSandbox: React.FC<MultiFileSandboxProps> = ({
  files,
  activeFile,
  onFileChange,
  onRun,
}) => {
  const [currentFile, setCurrentFile] = useState(activeFile || files[0]?.name);

  const activeContent = files.find(f => f.name === currentFile);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      border: '1px solid var(--border)',
      borderRadius: 8,
      overflow: 'hidden',
      background: '#1e1e1e',
      height: 400,
    }}>
      {/* 文件标签栏 */}
      <div style={{
        display: 'flex',
        background: '#252526',
        borderBottom: '1px solid #3c3c3c',
        overflowX: 'auto',
      }}>
        {files.map((file) => (
          <button
            key={file.name}
            onClick={() => {
              setCurrentFile(file.name);
              onFileChange?.(file.name);
            }}
            style={{
              padding: '8px 16px',
              border: 'none',
              background: file.name === currentFile ? '#1e1e1e' : 'transparent',
              color: file.name === currentFile ? '#fff' : '#999',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: file.name === currentFile ? 500 : 400,
              borderBottom: file.name === currentFile ? '2px solid var(--accent)' : 'none',
              whiteSpace: 'nowrap',
            }}
          >
            <CodeOutlined style={{ marginRight: 6, fontSize: 11 }} />
            {file.name}
          </button>
        ))}
        
        {onRun && (
          <button
            onClick={() => onRun(files)}
            style={{
              marginLeft: 'auto',
              padding: '6px 12px',
              marginRight: 8,
              marginTop: 4,
              marginBottom: 4,
              borderRadius: 4,
              border: 'none',
              background: 'var(--accent)',
              color: '#fff',
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            <PlayCircleOutlined style={{ marginRight: 4 }} />
            运行全部
          </button>
        )}
      </div>

      {/* 代码区域 */}
      {activeContent && (
        <CodeSandbox
          code={activeContent.content}
          language={activeContent.language || getFileLanguage(activeContent.name)}
          filename={activeContent.name}
          path={activeContent.path}
          onRun={(code) => onRun?.([activeContent])}
          height="100%"
        />
      )}
    </div>
  );
};

function getFileLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    py: 'python',
    java: 'java',
    go: 'go',
    rs: 'rust',
    html: 'html',
    css: 'css',
    json: 'json',
    md: 'markdown',
    sh: 'bash',
    sql: 'sql',
  };
  return map[ext || ''] || 'text';
}
