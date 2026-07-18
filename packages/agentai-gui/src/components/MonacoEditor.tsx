/**
 * MonacoEditor — 代码编辑器 (真正的 @monaco-editor/react)
 * --------------------------------------------------------
 * 使用 @monaco-editor/react 提供的 Monaco Editor (VS Code 内核)
 * 功能: 语法高亮 / 自动补全 / 代码折叠 / 行号 / minimap / 暗色主题 / Ctrl+S
 *       AI 代码修改注释: 接收全局事件, 在编辑器中高亮 AI 修改的行 + 行内注释
 */
import React, { useCallback, useRef, useEffect } from 'react';
import Editor, { type OnMount, type BeforeMount } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';

const EXT_LANG_MAP: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
  py: 'python', json: 'json', md: 'markdown', txt: 'plaintext',
  yml: 'yaml', yaml: 'yaml', html: 'html', css: 'css',
  rs: 'rust', go: 'go', java: 'java', c: 'c', cpp: 'cpp',
  sql: 'sql', xml: 'xml', sh: 'shell', bat: 'bat', ps1: 'powershell',
};

export function detectLangFromPath(filepath: string): string {
  const name = filepath.split(/[\\/]/).pop() || filepath;
  const idx = name.lastIndexOf('.');
  if (idx < 0) return 'plaintext';
  const ext = name.slice(idx + 1).toLowerCase();
  return EXT_LANG_MAP[ext] || 'plaintext';
}

/** AI 代码修改装饰信息 */
export interface AICodeDecoration {
  filePath: string;
  type: 'created' | 'modified' | 'deleted';
  startLine?: number;
  endLine?: number;
  summary?: string;
}

export interface MonacoEditorProps {
  value: string;
  language?: string;
  path?: string;
  readOnly?: boolean;
  height?: string | number;
  onChange?: (value: string) => void;
  onSave?: () => void;
  onMount?: (editor: any, monaco: any) => void;
  minimap?: boolean;
  lineNumbers?: 'on' | 'off' | 'relative' | 'interval';
  /** AI 代码修改装饰 (从 taskOrchestratorStore 传入) */
  aiDecorations?: AICodeDecoration[];
}

export const MonacoEditor: React.FC<MonacoEditorProps> = ({
  value,
  language,
  path,
  readOnly = false,
  height = '100%',
  onChange,
  onSave,
  onMount,
  minimap = true,
  lineNumbers = 'on',
  aiDecorations = [],
}) => {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<any>(null);
  const decorationIdsRef = useRef<string[]>([]);
  const finalLanguage = language || (path ? detectLangFromPath(path) : 'plaintext');
  const h = typeof height === 'number' ? `${height}px` : height || '100%';

  // ===== AI 代码修改装饰 =====
  // 当 aiDecorations 变化时, 更新编辑器中的高亮和注释
  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;

    // 过滤出属于当前文件的装饰
    const currentPath = path || '';
    const relevantDecs = aiDecorations.filter(d => {
      // 标准化路径比较
      const normPath = (p: string) => p.replace(/\\/g, '/').toLowerCase();
      return normPath(d.filePath).includes(normPath(currentPath).split('/').pop() || '');
    });

    if (relevantDecs.length === 0) {
      // 清除旧装饰
      decorationIdsRef.current = editor.deltaDecorations(decorationIdsRef.current, []);
      return;
    }

    const newDecorations: editor.IModelDeltaDecoration[] = [];

    for (const dec of relevantDecs) {
      const lineCount = editor.getModel()?.getLineCount() || 1;
      const startLine = Math.max(1, dec.startLine || 1);
      const endLine = Math.min(lineCount, dec.endLine || startLine + 2);

      // 行背景高亮
      const bgColor = dec.type === 'created'
        ? 'rgba(74,222,128,0.08)'
        : dec.type === 'deleted'
          ? 'rgba(239,68,68,0.08)'
          : 'rgba(232,168,56,0.08)';

      const borderColor = dec.type === 'created'
        ? 'rgba(74,222,128,0.4)'
        : dec.type === 'deleted'
          ? 'rgba(239,68,68,0.4)'
          : 'rgba(232,168,56,0.4)';

      // 整行高亮
      for (let line = startLine; line <= endLine; line++) {
        newDecorations.push({
          range: new monaco.Range(line, 1, line, 1),
          options: {
            isWholeLine: true,
            className: `ai-change-${dec.type}`,
            linesDecorationsClassName: `ai-gutter-${dec.type}`,
            overviewRuler: {
              color: dec.type === 'created' ? '#4ade80' : dec.type === 'deleted' ? '#ef4444' : '#e8a838',
              position: monaco.editor.OverviewRulerLane.Full,
            },
          },
        });
      }

      // 行内注释 (第一行左侧 gutter 区域)
      const typeLabel = dec.type === 'created' ? '✨ AI 新建' : dec.type === 'deleted' ? '🗑️ AI 删除' : '✏️ AI 修改';
      newDecorations.push({
        range: new monaco.Range(startLine, 1, startLine, 1),
        options: {
          isWholeLine: true,
          afterContentClassName: `ai-annotation-${dec.type}`,
          hoverMessage: { value: `**${typeLabel}**${dec.summary ? '\n\n' + dec.summary : ''}` },
        },
      });
    }

    decorationIdsRef.current = editor.deltaDecorations(decorationIdsRef.current, newDecorations);
  }, [aiDecorations, path, value]);

  // Ctrl+S 保存
  const handleEditorDidMount: OnMount = (editorInstance, monaco) => {
    editorRef.current = editorInstance;
    monacoRef.current = monaco;

    // Ctrl+S 快捷键
    editorInstance.addAction({
      id: 'save',
      label: 'Save',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
      run: () => {
        onSave?.();
      },
    });

    // 注入 AI 修改装饰的 CSS 样式
    const styleId = 'agentai-editor-decorations';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
        /* AI 修改行背景 */
        .ai-change-created { background: rgba(74,222,128,0.06) !important; border-left: 3px solid rgba(74,222,128,0.5) !important; }
        .ai-change-modified { background: rgba(232,168,56,0.06) !important; border-left: 3px solid rgba(232,168,56,0.5) !important; }
        .ai-change-deleted { background: rgba(239,68,68,0.06) !important; border-left: 3px solid rgba(239,68,68,0.5) !important; }

        /* AI 修改行号区域图标 */
        .ai-gutter-created::after { content: '✨'; font-size: 10px; margin-left: 2px; }
        .ai-gutter-modified::after { content: '✏️'; font-size: 10px; margin-left: 2px; }
        .ai-gutter-deleted::after { content: '🗑️'; font-size: 10px; margin-left: 2px; }

        /* AI 修改行尾注释 */
        .ai-annotation-created::after { content: ' ← AI 新建'; color: #4ade80; font-size: 11px; opacity: 0.7; margin-left: 12px; }
        .ai-annotation-modified::after { content: ' ← AI 修改'; color: #e8a838; font-size: 11px; opacity: 0.7; margin-left: 12px; }
        .ai-annotation-deleted::after { content: ' ← AI 删除'; color: #ef4444; font-size: 11px; opacity: 0.7; margin-left: 12px; }
      `;
      document.head.appendChild(style);
    }

    onMount?.(editorInstance, monaco);
  };

  // Monaco 加载前的配置
  const handleBeforeMount: BeforeMount = (monaco) => {
    // 暗色主题微调
    monaco.editor.defineTheme('agentai-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': '#0f0f0f',
        'editor.foreground': '#d4d4d4',
        'editor.lineHighlightBackground': '#1a1a1a',
        'editor.selectionBackground': '#264f78',
        'editor.inactiveSelectionBackground': '#3a3d41',
        'editorCursor.foreground': '#aeafad',
        'editorLineNumber.foreground': '#5a5a5a',
        'editorLineNumber.activeForeground': '#c6c6c6',
      },
    });
  };

  const handleChange = useCallback((val: string | undefined) => {
    onChange?.(val || '');
  }, [onChange]);

  return (
    <Editor
      height={h}
      language={finalLanguage}
      value={value}
      onChange={handleChange}
      onMount={handleEditorDidMount}
      beforeMount={handleBeforeMount}
      theme="agentai-dark"
      options={{
        readOnly,
        minimap: { enabled: minimap },
        lineNumbers,
        fontSize: 13,
        fontFamily: 'Consolas, "Courier New", monospace',
        lineHeight: 1.6,
        tabSize: 2,
        scrollBeyondLastLine: false,
        automaticLayout: true,
        wordWrap: 'off',
        renderWhitespace: 'selection',
        smoothScrolling: true,
        cursorBlinking: 'smooth',
        cursorSmoothCaretAnimation: 'on',
        folding: true,
        foldingHighlight: true,
        guides: { indentation: true, bracketPairs: true },
        bracketPairColorization: { enabled: true },
        renderLineHighlight: 'all',
        padding: { top: 8, bottom: 8 },
      }}
    />
  );
};

export default MonacoEditor;
