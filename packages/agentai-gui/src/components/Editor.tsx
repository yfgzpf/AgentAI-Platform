/**
 * Editor - VSCode 风格代码编辑器
 * 左侧文件树 + 右侧编辑器 + 上传 + AI 操作
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Tree, Input, Button, Space, message, Spin, Dropdown, Modal, Empty, Tooltip, Select } from 'antd';
import {
  FolderOutlined, FileOutlined, ReloadOutlined, SaveOutlined,
  EditOutlined, FolderOpenOutlined, FileAddOutlined, FolderAddOutlined,
  SearchOutlined, CloudUploadOutlined, RobotOutlined,
} from '@ant-design/icons';

interface FileNode {
  name: string;
  path: string;
  type: 'directory' | 'file';
  size: number;
  children?: FileNode[];
}

interface OpenFile {
  path: string;
  name: string;
  content: string;
  dirty: boolean;
  language: string;
}

const httpUrl = ((window as any).__AGENTAI_GATEWAY__ || 'ws://127.0.0.1:18789').replace(/^ws/, 'http');

const LANGS: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'typescript', '.js': 'javascript', '.jsx': 'javascript',
  '.py': 'python', '.json': 'json', '.md': 'markdown', '.txt': 'text',
  '.yml': 'yaml', '.yaml': 'yaml', '.toml': 'text', '.html': 'html', '.css': 'css',
  '.rs': 'rust', '.go': 'go', '.java': 'java', '.c': 'c', '.cpp': 'cpp', '.h': 'cpp',
};

const detectLang = (filename: string): string => {
  for (const ext in LANGS) {
    if (filename.endsWith(ext)) return LANGS[ext]!;
  }
  return 'text';
};

const RECENT_WORKSPACES = [
  { label: '📁 AgentAI Platform', value: 'F:\\agentai-platform' },
  { label: '📁 AgentAI GUI', value: 'F:\\agentai-platform\\packages\\agentai-gui' },
  { label: '📁 AgentAI Gateway', value: 'F:\\agentai-platform\\packages\\agentai-gateway' },
  { label: '📁 AgentAI VSCode', value: 'F:\\agentai-platform\\packages\\agentai-vscode' },
  { label: '📁 Desktop', value: 'C:\\Users\\Administrator\\Desktop' },
];

export const Editor: React.FC = () => {
  const [workspace, setWorkspace] = useState('F:\\agentai-platform');
  const [tree, setTree] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [searchQ, setSearchQ] = useState('');
  const [workspaceModal, setWorkspaceModal] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 加载文件树
  const loadTree = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${httpUrl}/v1/files?workspace=${encodeURIComponent(workspace)}`);
      const data = await r.json();
      setTree(data.tree || []);
    } catch (e: any) {
      message.error('加载文件树失败: ' + e.message);
    } finally {
      setLoading(false);
    }
  }, [workspace]);

  useEffect(() => { loadTree(); }, [loadTree]);

  // 打开文件
  const openFile = async (filePath: string) => {
    if (openFiles.find(f => f.path === filePath)) {
      setActiveIdx(openFiles.findIndex(f => f.path === filePath));
      return;
    }
    try {
      const r = await fetch(`${httpUrl}/v1/files/read?path=${encodeURIComponent(filePath)}`);
      const data = await r.json();
      if (data.error) { message.error('打开失败: ' + data.error); return; }
      const file: OpenFile = {
        path: filePath,
        name: filePath.split(/[\\/]/).pop() || filePath,
        content: data.content || '',
        dirty: false,
        language: detectLang(filePath),
      };
      setOpenFiles([...openFiles, file]);
      setActiveIdx(openFiles.length);
    } catch (e: any) {
      message.error('读文件失败: ' + e.message);
    }
  };

  // 保存
  const saveActive = async () => {
    if (activeIdx < 0) return;
    const f = openFiles[activeIdx]!;
    try {
      const r = await fetch(`${httpUrl}/v1/files/write`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: f.path, content: f.content }),
      });
      const data = await r.json();
      if (data.error) { message.error('保存失败: ' + data.error); return; }
      const updated = [...openFiles];
      updated[activeIdx] = { ...f, dirty: false };
      setOpenFiles(updated);
      message.success(`✅ ${f.name} 已保存`);
    } catch (e: any) {
      message.error('保存失败: ' + e.message);
    }
  };

  // 编辑
  const editContent = (val: string) => {
    if (activeIdx < 0) return;
    const updated = [...openFiles];
    updated[activeIdx] = { ...updated[activeIdx]!, content: val, dirty: true };
    setOpenFiles(updated);
  };

  // 关闭 tab
  const closeTab = (idx: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const f = openFiles[idx]!;
    if (f.dirty) {
      Modal.confirm({
        title: `${f.name} 未保存, 确定关闭?`,
        onOk: () => {
          setOpenFiles(openFiles.filter((_, i) => i !== idx));
          setActiveIdx(Math.max(0, Math.min(activeIdx, openFiles.length - 2)));
        },
      });
    } else {
      setOpenFiles(openFiles.filter((_, i) => i !== idx));
      setActiveIdx(Math.max(0, Math.min(activeIdx, openFiles.length - 2)));
    }
  };

  // AI 操作当前文件
  const aiEdit = async (instruction: string) => {
    if (activeIdx < 0) {
      message.warning('先打开一个文件');
      return;
    }
    const f = openFiles[activeIdx]!;
    setAiBusy(true);
    try {
      const r = await fetch(`${httpUrl}/v1/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `请改写这段 ${f.name} 代码, 需求: ${instruction}\n\n原代码:\n\`\`\`\n${f.content}\n\`\`\`\n\n只输出改写后的完整代码, 不要解释, 不要 markdown 围栏。`,
          userId: 'editor',
          workspace,
        }),
      });
      const data = await r.json();
      let code = data.content || '';
      code = code.replace(/^```[\w]*\n/, '').replace(/\n```$/, '').trim();
      editContent(code);
      message.success('✨ AI 已改写, 按 Ctrl+S 保存');
    } catch (e: any) {
      message.error('AI 失败: ' + e.message);
    } finally {
      setAiBusy(false);
      setAiPrompt('');
    }
  };

  // 简单语法高亮 (基于正则)
  const renderHighlighted = (code: string, lang: string) => {
    // 不做完整高亮, 用 <pre> 即可, 简单标记关键字
    const keywords: Record<string, string[]> = {
      typescript: ['const', 'let', 'var', 'function', 'class', 'interface', 'type', 'import', 'export', 'from', 'return', 'if', 'else', 'for', 'while', 'async', 'await', 'new', 'this', 'true', 'false', 'null', 'undefined'],
      python: ['def', 'class', 'import', 'from', 'return', 'if', 'else', 'elif', 'for', 'while', 'async', 'await', 'with', 'as', 'try', 'except', 'finally', 'lambda', 'True', 'False', 'None', 'self'],
      javascript: ['const', 'let', 'var', 'function', 'class', 'import', 'export', 'from', 'return', 'if', 'else', 'for', 'while', 'async', 'await', 'new', 'this', 'true', 'false', 'null', 'undefined'],
    };
    const kws = keywords[lang] || [];
    let html = code
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    kws.forEach(kw => {
      const re = new RegExp(`\\b${kw}\\b`, 'g');
      html = html.replace(re, `<span style="color:#c586c0">${kw}</span>`);
    });
    // 字符串
    html = html.replace(/(['"`])((?:\\.|(?!\1)[^\\])*?)\1/g, '<span style="color:#ce9178">$1$2$1</span>');
    // 注释
    if (lang === 'python') {
      html = html.replace(/(#[^\n]*)/g, '<span style="color:#6a9955">$1</span>');
    } else {
      html = html.replace(/(\/\/[^\n]*)/g, '<span style="color:#6a9955">$1</span>');
      html = html.replace(/(\/\*[\s\S]*?\*\/)/g, '<span style="color:#6a9955">$1</span>');
    }
    // 数字
    html = html.replace(/\b(\d+)\b/g, '<span style="color:#b5cea8">$1</span>');
    return html;
  };

  // 文件树渲染
  const renderTree = (nodes: FileNode[]): any[] => {
    return nodes
      .filter(n => {
        if (!searchQ) return true;
        return n.name.toLowerCase().includes(searchQ.toLowerCase());
      })
      .map(n => ({
        title: (
          <Space size={4}>
            {n.type === 'directory' ? <FolderOutlined style={{ color: '#facc15' }} /> : <FileOutlined style={{ color: '#93c5fd' }} />}
            <span style={{ color: '#ddd' }}>{n.name}</span>
            {n.type === 'file' && n.size > 0 && (
              <span style={{ color: '#666', fontSize: 11 }}>{n.size < 1024 ? `${n.size}B` : `${(n.size / 1024).toFixed(1)}K`}</span>
            )}
          </Space>
        ),
        key: n.path,
        children: n.children ? renderTree(n.children) : undefined,
        isLeaf: n.type === 'file',
        onClick: () => {
          if (n.type === 'file') openFile(n.path);
        },
      }));
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0f0f0f' }}>
      {/* 顶栏 */}
      <div style={{ padding: 8, background: '#1a1a1a', borderBottom: '1px solid #333', display: 'flex', gap: 8, alignItems: 'center' }}>
        <Button size="small" icon={<FolderOpenOutlined />} onClick={() => setWorkspaceModal(true)}>
          工作区
        </Button>
        <Select
          size="small"
          value={workspace}
          onChange={setWorkspace}
          style={{ width: 280 }}
          options={RECENT_WORKSPACES}
        />
        <Button size="small" icon={<ReloadOutlined />} onClick={loadTree}>刷新</Button>
        <Input
          size="small"
          prefix={<SearchOutlined />}
          placeholder="搜索文件名..."
          value={searchQ}
          onChange={e => setSearchQ(e.target.value)}
          style={{ width: 200 }}
        />
        <div style={{ flex: 1 }} />
        <span style={{ color: '#666', fontSize: 11 }}>
          {tree.length} 项 · 5 层深 · {openFiles.length} tab
        </span>
      </div>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* 文件树 */}
        <div style={{ width: 280, background: '#0a0a0a', borderRight: '1px solid #333', overflow: 'auto', padding: 8 }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 20 }}><Spin /></div>
          ) : tree.length > 0 ? (
            <Tree
              showLine={{ showLeafIcon: false }}
              blockNode
              treeData={renderTree(tree)}
              defaultExpandAll={false}
            />
          ) : (
            <Empty description={<span style={{ color: '#666' }}>空工作区</span>} />
          )}
        </div>

        {/* 编辑器 */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Tab 栏 */}
          <div style={{ display: 'flex', background: '#0a0a0a', borderBottom: '1px solid #333', overflowX: 'auto' }}>
            {openFiles.map((f, idx) => (
              <div
                key={f.path}
                onClick={() => setActiveIdx(idx)}
                style={{
                  padding: '6px 12px',
                  cursor: 'pointer',
                  background: activeIdx === idx ? '#1a1a1a' : 'transparent',
                  borderRight: '1px solid #333',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  minWidth: 100,
                  maxWidth: 200,
                }}
              >
                <FileOutlined style={{ color: '#93c5fd' }} />
                <span style={{ color: f.dirty ? '#facc15' : '#ddd', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {f.dirty ? '● ' : ''}{f.name}
                </span>
                <span
                  onClick={(e) => closeTab(idx, e)}
                  style={{ color: '#666', cursor: 'pointer', padding: '0 4px' }}
                >×</span>
              </div>
            ))}
          </div>

          {/* 工具栏 */}
          {activeIdx >= 0 && (
            <div style={{ padding: 6, background: '#141414', borderBottom: '1px solid #333', display: 'flex', gap: 6, alignItems: 'center' }}>
              <Button size="small" icon={<SaveOutlined />} type="primary" onClick={saveActive} disabled={!openFiles[activeIdx]?.dirty}>
                保存 (Ctrl+S)
              </Button>
              <div style={{ flex: 1 }} />
              <Input
                size="small"
                placeholder="AI 改写指令, 例: 加错误处理"
                value={aiPrompt}
                onChange={e => setAiPrompt(e.target.value)}
                onPressEnter={() => aiEdit(aiPrompt)}
                style={{ width: 280 }}
                disabled={aiBusy}
              />
              <Button size="small" icon={<RobotOutlined />} loading={aiBusy} onClick={() => aiEdit(aiPrompt)}>
                AI 改写
              </Button>
            </div>
          )}

          {/* 编辑区 */}
          {activeIdx >= 0 ? (
            <div style={{ flex: 1, position: 'relative', overflow: 'hidden', display: 'flex' }}>
              <textarea
                ref={textareaRef}
                value={openFiles[activeIdx]?.content || ''}
                onChange={e => editContent(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                    e.preventDefault();
                    saveActive();
                  }
                  // Tab 缩进
                  if (e.key === 'Tab') {
                    e.preventDefault();
                    const target = e.currentTarget;
                    const start = target.selectionStart;
                    const end = target.selectionEnd;
                    const newVal = target.value.substring(0, start) + '  ' + target.value.substring(end);
                    editContent(newVal);
                    setTimeout(() => { target.selectionStart = target.selectionEnd = start + 2; }, 0);
                  }
                }}
                spellCheck={false}
                style={{
                  flex: 1,
                  background: '#1e1e1e',
                  color: '#d4d4d4',
                  border: 'none',
                  outline: 'none',
                  padding: 12,
                  fontFamily: 'Consolas, "Courier New", monospace',
                  fontSize: 13,
                  lineHeight: 1.6,
                  resize: 'none',
                }}
              />
            </div>
          ) : (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', color: '#666' }}>
              <EditOutlined style={{ fontSize: 48, color: '#444' }} />
              <div style={{ marginTop: 16, fontSize: 16 }}>富哥, 从左边选个文件开始</div>
              <div style={{ marginTop: 8, color: '#555', fontSize: 12 }}>支持 TypeScript / Python / Markdown / JSON, 50+ 文件可看</div>
              <div style={{ marginTop: 16, color: '#facc15' }}>↑ 搜文件名 ↑ AI 改写 ↑ 保存</div>
            </div>
          )}
        </div>
      </div>

      {/* 工作区选择 */}
      <Modal
        title="选择工作区"
        open={workspaceModal}
        onCancel={() => setWorkspaceModal(false)}
        onOk={() => { setWorkspaceModal(false); loadTree(); }}
        okText="打开"
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          {RECENT_WORKSPACES.map(ws => (
            <Button key={ws.value} block onClick={() => { setWorkspace(ws.value); setWorkspaceModal(false); }}>
              {ws.label}
            </Button>
          ))}
        </Space>
      </Modal>
    </div>
  );
};
