/**
 * EditorMode — 编辑器模式子组件
 * ----------------------------------------------------
 * 复用现有 Editor.tsx 的核心功能，但作为 UnifiedWorkspace 的一个模式运行。
 *
 * 设计决策：
 *   - 不重新实现编辑器逻辑，而是包装现有的 Editor + MonacoEditor
 *   - 从 workspaceStore 读取 currentFile / activeFilePath
 *   - 支持空状态引导（无文件时显示打开文件夹提示）
 *   - 保持与现有 Editor 相同的 API 和 Gateway 通信方式
 */
import React, { useEffect, useCallback, useState, useRef } from 'react';
import { Empty, Button, Tooltip, message } from 'antd';
import {
  FolderOpenOutlined, CodeOutlined, PlusOutlined,
  SaveOutlined,
} from '@ant-design/icons';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { gatewayFallback } from '../../services/GatewayFallback';
import { MonacoEditor, detectLangFromPath, type AICodeDecoration } from '../MonacoEditor';

const baseUrl = () => gatewayFallback.url || 'http://127.0.0.1:18789';

/** 编辑器空状态 —— 无文件打开时的引导 UI */
const EditorEmptyState: React.FC = () => {
  const workspace = useWorkspaceStore.getState();

  const handleOpenFolder = useCallback(async () => {
    try {
      const resp = await fetch(`${baseUrl()}/v1/fs/drives`);
      const data = await resp.json();
      if (data.drives?.length > 0) {
        // 使用第一个可用盘符作为工作区根目录
        const rootDir = data.drives[0];
        workspace.setCurrentFile(null);
        localStorage.setItem('agentai.workspace', rootDir);
        // 通过自定义事件通知外部
        window.dispatchEvent(new CustomEvent('agentai:editor-open-folder', { detail: { dir: rootDir } }));
      }
    } catch (e) {
      console.error('[EditorMode] Failed to open folder:', e);
    }
  }, []);

  return (
    <div className="editor-empty-state" style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
      gap: 20,
      color: 'var(--text-tertiary)',
    }}>
      <CodeOutlined style={{ fontSize: 64, opacity: 0.3 }} />
      <h2 style={{ margin: 0, fontWeight: 500, fontSize: 'var(--fs-lg)', color: 'var(--text-secondary)' }}>
        选择文件开始编辑
      </h2>
      <p style={{ margin: 0, fontSize: 'var(--fs-md)', maxWidth: 360, textAlign: 'center', lineHeight: 1.6 }}>
        从左侧文件树选择文件，或打开文件夹开始浏览项目代码
      </p>

      <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
        <Tooltip title="从文件系统打开文件夹">
          <Button
            type="primary"
            icon={<FolderOpenOutlined />}
            onClick={handleOpenFolder}
            style={{ borderRadius: 'var(--radius-md)' }}
          >
            打开文件夹
          </Button>
        </Tooltip>
        <Tooltip title="创建新文件">
          <Button
            icon={<PlusOutlined />}
            onClick={() => {
              window.dispatchEvent(new CustomEvent('agentai:editor-new-file'));
            }}
            style={{ borderRadius: 'var(--radius-md)' }}
          >
            新建文件
          </Button>
        </Tooltip>
      </div>

      {/* 快捷键提示 */}
      <div style={{
        marginTop: 24,
        padding: '12px 20px',
        borderRadius: 'var(--radius-md)',
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.06)',
        fontSize: 'var(--fs-sm)',
        color: 'var(--text-tertiary)',
        lineHeight: 2,
      }}>
        <div><kbd>Ctrl+N</kbd> &nbsp; 新建文件</div>
        <div><kbd>Ctrl+O</kbd> &nbsp; 打开文件</div>
        <div><kbd>Ctrl+S</kbd> &nbsp; 保存</div>
        <div><kbd>Ctrl+2</kbd> &nbsp; 切换到浏览器</div>
      </div>
    </div>
  );
};

/** 编辑器模式主组件 */
export const EditorMode: React.FC = () => {
  const { currentFile, activeFilePath, openFiles, setActiveFile, removeOpenFile, setCurrentFile } = useWorkspaceStore();
  const [fileContent, setFileContent] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msgApi, contextHolder] = message.useMessage();

  // ═══ D2 (2026-09-05): AI 代码变更装饰 (真实行号, 来自 write_file/multi_edit 的 lineRanges) ═══
  const [aiDecors, setAiDecors] = useState<AICodeDecoration[]>([]);
  const currentPathRef = useRef<string | null>(currentFile?.path || null);
  const dirtyRef = useRef<boolean>(dirty);
  currentPathRef.current = currentFile?.path || null;
  dirtyRef.current = dirty;

  useEffect(() => {
    const onAiChange = async (e: any) => {
      const detail = e.detail || {};
      const file: string = detail.file;
      if (!file || !Array.isArray(detail.entries) || detail.entries.length === 0) return;
      const decs: AICodeDecoration[] = detail.entries
        .filter((en: any) => typeof en.startLine === 'number')
        .map((en: any) => ({
          filePath: file,
          type: en.type === 'created' || en.type === 'deleted' ? en.type : 'modified',
          startLine: Math.max(1, en.startLine),
          endLine: Math.max(en.startLine, en.endLine || en.startLine),
          summary: en.summary || `${detail.tool || 'AI'}: ${file.split(/[\\/]/).pop()}`,
        }));
      if (decs.length === 0) return;
      setAiDecors((prev) => [...prev.filter((d) => d.filePath !== file), ...decs]);
      // 当前打开文件被 AI 写入且用户无未保存改动 → 重载, 保证装饰行号与内容一致
      if (file === currentPathRef.current && !dirtyRef.current) {
        try {
          const resp = await fetch(`${baseUrl()}/v1/files/read?path=${encodeURIComponent(file)}`);
          const data = await resp.json();
          if (!data.error) { setFileContent(data.content || ''); setDirty(false); }
        } catch { /* best-effort reload */ }
      }
    };
    window.addEventListener('agentai:ai-change', onAiChange);
    return () => window.removeEventListener('agentai:ai-change', onAiChange);
  }, []);

  // 切换文件 → 清空装饰, 避免残留到其它文件
  useEffect(() => { setAiDecors([]); }, [currentFile?.path]);

  // 当 currentFile 变化时加载文件内容
  useEffect(() => {
    if (!currentFile?.path) {
      setFileContent('');
      setDirty(false);
      return;
    }

    const loadFile = async () => {
      setLoading(true);
      try {
        const resp = await fetch(`${baseUrl()}/v1/files/read?path=${encodeURIComponent(currentFile!.path)}`);
        const data = await resp.json();
        if (data.error) {
          console.error('[EditorMode] Load error:', data.error);
          setFileContent(`/* 加载失败: ${data.error} */`);
        } else {
          setFileContent(data.content || data || '');
        }
        setDirty(false);
      } catch (e) {
        console.error('[EditorMode] Load exception:', e);
        setFileContent(`/* 无法读取文件: ${currentFile?.path} */`);
      } finally {
        setLoading(false);
      }
    };

    loadFile();
  }, [currentFile?.path]);

  // ===== 保存文件 =====
  const handleSave = useCallback(async () => {
    if (!currentFile?.path || !dirty) return;
    setSaving(true);
    try {
      const resp = await fetch(`${baseUrl()}/v1/files/write`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: currentFile.path, content: fileContent }),
      });
      const data = await resp.json();
      if (data.error) {
        msgApi.error(`保存失败: ${data.error}`);
      } else {
        setDirty(false);
        msgApi.success(`✅ ${currentFile.name} 已保存`);
      }
    } catch (e: any) {
      msgApi.error(`保存失败: ${e.message}`);
    } finally {
      setSaving(false);
    }
  }, [currentFile, fileContent, dirty, msgApi]);

  // ===== 内容变更 =====
  const handleChange = useCallback((val: string) => {
    setFileContent(val || '');
    setDirty(true);
  }, []);

  // 快捷键: Ctrl+S 保存 (必须在 early return 之前, 遵守 Hooks 规则)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleSave]);

  // 无文件时显示空状态
  if (!currentFile || !activeFilePath) {
    return <EditorEmptyState />;
  }

  // 文件标签栏
  const renderTabs = () => (
    <div className="editor-tabs-bar" style={{
      display: 'flex',
      alignItems: 'center',
      height: 36,
      background: 'rgba(0,0,0,0.3)',
      borderBottom: '1px solid rgba(255,255,255,0.06)',
      paddingLeft: 8,
      overflowX: 'auto',
      flexShrink: 0,
    }}>
      {openFiles.map(file => {
        const isActive = file.path === activeFilePath;
        const lang = detectLangFromPath(file.name) || 'plaintext';
        // 当前文件的 dirty 状态
        const isDirty = isActive && dirty;
        return (
          <div
            key={file.path}
            onClick={() => setActiveFile(file.path)}
            onMouseDown={(e) => {
              if (e.button === 1) { // 中键关闭
                removeOpenFile(file.path);
              }
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '0 12px',
              height: '100%',
              fontSize: 'var(--fs-sm)',
              color: isActive ? 'var(--text-primary)' : 'var(--text-tertiary)',
              background: isActive ? 'rgba(255,255,255,0.06)' : 'transparent',
              borderBottom: isActive ? '2px solid var(--accent)' : '2px solid transparent',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              userSelect: 'none',
              transition: 'all 0.15s',
            }}
          >
            <span style={{ fontSize: 'var(--fs-micro)', opacity: 0.5 }}>{lang.toUpperCase()}</span>
            <span>{file.name}</span>
            {isDirty && <span style={{ color: '#facc15', fontSize: 'var(--fs-micro)' }}>●</span>}
            {openFiles.length > 1 && (
              <span
                onClick={(e) => { e.stopPropagation(); removeOpenFile(file.path); }}
                className="editor-tab-close"
                style={{
                  marginLeft: 4,
                  fontSize: 'var(--fs-lg)',
                  lineHeight: 1,
                  opacity: 0.4,
                  cursor: 'pointer',
                }}
              >
                ×
              </span>
            )}
          </div>
        );
      })}
      {/* 保存按钮 */}
      <div style={{ flex: 1 }} />
      {dirty && (
        <Tooltip title="保存 (Ctrl+S)">
          <Button
            size="small"
            type="primary"
            icon={<SaveOutlined />}
            loading={saving}
            onClick={handleSave}
            style={{ marginRight: 8, fontSize: 'var(--fs-micro)' }}
          >
            保存
          </Button>
        </Tooltip>
      )}
    </div>
  );

  return (
    <div className="editor-mode" style={{
      display: 'flex',
      flexDirection: 'column',
      width: '100%',
      height: '100%',
      overflow: 'hidden',
    }}>
      {contextHolder}
      {/* 标签栏 */}
      {openFiles.length > 0 && renderTabs()}

      {/* Monaco 编辑器区域 */}
      <div className="editor-content" style={{ flex: 1, overflow: 'hidden' }}>
        {loading ? (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            height: '100%', color: 'var(--text-tertiary)',
          }}>
            加载中...
          </div>
        ) : (
          <MonacoEditor
            path={currentFile.path}
            value={fileContent}
            onChange={handleChange}
            onSave={handleSave}
            language={detectLangFromPath(currentFile.name) || undefined}
            readOnly={false}
            aiDecorations={aiDecors}
          />
        )}
      </div>

      {/* 底部状态栏 */}
      <div className="editor-statusbar" style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: 24,
        paddingLeft: 12,
        paddingRight: 12,
        fontSize: 'var(--fs-micro)',
        color: 'var(--text-tertiary)',
        background: 'rgba(0,0,0,0.2)',
        borderTop: '1px solid rgba(255,255,255,0.04)',
        flexShrink: 0,
      }}>
        <span>{currentFile.path}</span>
        <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {dirty && <span style={{ color: '#facc15' }}>● 未保存</span>}
          <span>{detectLangFromPath(currentFile.name) || 'plaintext'} · UTF-8</span>
        </span>
      </div>
    </div>
  );
};

/** hover 样式（内联 style 不支持 :hover，用全局 CSS 补充） */
if (typeof document !== 'undefined' && !document.getElementById('editor-mode-styles')) {
  const style = document.createElement('style');
  style.id = 'editor-mode-styles';
  style.textContent = `.editor-tab-close:hover { opacity: 1 !important; }`;
  document.head.appendChild(style);
}
