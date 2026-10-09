/**
 * useIdeState — 编辑器上下文感知 Hook
 * ====================================
 * 对标 Cursor: 实时推送用户打开的编辑器状态到 Gateway，
 * 让 AI 知道"用户在干什么"
 *
 * 用法: 在 App.tsx 中调用 useIdeState()
 * 自动监听 VSCode 暴露的编辑器状态 API 或手动轮询
 */

import { useEffect, useRef, useCallback } from 'react';

interface OpenFileState {
  path: string;
  language: string;
  cursorLine: number;
  cursorColumn: number;
  selectedText?: string;
}

interface IdeStatePayload {
  openFiles: OpenFileState[];
  activeFile?: string;
  diagnostics?: Array<{
    file: string;
    line: number;
    severity: 'error' | 'warning' | 'info';
    message: string;
  }>;
  isEditing: boolean;
}

/** 去抖间隔 — 避免频繁推送 */
const DEBOUNCE_MS = 2000;
/** Gateway 基础 URL */
const GATEWAY_URL = '/v1';

/**
 * 尝试从编辑器实际状态获取上下文
 * ================================================
 * 串味修复: 原实现的路径2 从 URL query 读`?file=`，但全项目无人写这个参数
 * —— 是条死路径。结果 getEditorState() 恒返回 null，一个文件都不推，
 * Gateway 侧却一直保留历史推送的旧状态注入（表现为 AI 说"当前文件是 xxx"，
 * 而 xxx 属于上一个任务）。
 *
 * 现在补上真实数据源: Editor.tsx 在切换文件时把路径写入
 * localStorage['agentai.editor.activeFile']，这里直接读它。
 */
function getEditorState(): IdeStatePayload | null {
  // P0 修复: 只有在编辑器页面才推送 IDE 状态
  // 之前: 用户离开编辑器到对话页后, localStorage 中的 activeFile 仍存在
  //       → getEditorState 每次返回旧文件路径 + isEditing: true
  //       → 后端注入"当前文件: xxx" → AI 串味
  // 之后: 检查当前页面是否为 editor, 不是则返回 null
  const currentPage = localStorage.getItem('agentai.lastPage') || 'chat';
  if (currentPage !== 'editor') {
    return null;
  }

  // 路径 1: VSCode WebView API（仅在 VSCode 扩展宿主内可用）
  try {
    const vs = (window as any).acquireVsCodeApi?.();
    if (vs) {
      const state = vs.getState?.();
      if (state?.openFiles) return state as IdeStatePayload;
    }
  } catch {
    /* 非 VSCode 环境 */
  }

  // 路径 2: Editor 组件写入的真实当前文件（Web / Tauri 桌面端均适用）
  try {
    const activeFile = localStorage.getItem('agentai.editor.activeFile');
    if (activeFile) {
      const lang = activeFile.split('.').pop() || '';
      return {
        openFiles: [{
          path: activeFile,
          language: lang,
          cursorLine: 1,
          cursorColumn: 1,
        }],
        activeFile,
        isEditing: true,
      };
    }
  } catch {
    /* localStorage 不可用 */
  }

  // 路径 3: URL query（外部工具链可能传入，保留兼容）
  try {
    const params = new URLSearchParams(window.location.search);
    const currentFile = params.get('file');
    if (currentFile) {
      const lang = currentFile.split('.').pop() || '';
      return {
        openFiles: [{
          path: currentFile,
          language: lang,
          cursorLine: parseInt(params.get('line') || '1'),
          cursorColumn: 1,
        }],
        activeFile: currentFile,
        isEditing: true,
      };
    }
  } catch {
    /* ignore */
  }

  return null;
}

/**
 * 推送 IDE 状态到 Gateway
 * P0 修复: 附带当前 workspace, 让后端能区分不同工作区
 */
async function pushIdeState(state: IdeStatePayload): Promise<void> {
  try {
    // P0 修复: 从 localStorage 获取当前 workspace, 随请求一起推送
    const workspace = localStorage.getItem('agentai.workspace') || localStorage.getItem('currentWorkspace') || '';
    await fetch(`${GATEWAY_URL}/ide-state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-workspace': workspace },
      body: JSON.stringify({ ...state, workspace }),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // 静默失败 — Gateway 可能未启动
  }
}

/**
 * Hook: 自动推送 IDE 状态到 Gateway
 * @param pollInterval — 轮询间隔 (ms)，默认 5000
 */
export function useIdeState(pollInterval = 5000) {
  const lastStateRef = useRef<string>('');

  const pushState = useCallback(async () => {
    const state = getEditorState();
    if (!state) {
      // P0 修复: 用户不在编辑器页面 → 推送空状态清除后端缓存
      // 之前: return 跳过 → 后端保留旧 IDE 状态 → 串味
      const key = 'null';
      if (key !== lastStateRef.current) {
        lastStateRef.current = key;
        await pushIdeState({ openFiles: [], isEditing: false });
      }
      return;
    }

    // 去重: 只有状态变化时才推送
    const key = JSON.stringify(state);
    if (key === lastStateRef.current) return;
    lastStateRef.current = key;

    await pushIdeState(state);
  }, []);

  useEffect(() => {
    // 首次立即推送
    pushState();

    // 定期轮询
    const timer = setInterval(pushState, pollInterval);
    return () => clearInterval(timer);
  }, [pushState, pollInterval]);

  // ★ 串味修复: workspace 变化时必须重置去重缓存并立即重推
  //   否则切工作区后状态 key 未变会被去重跳过，Gateway 保留旧工作区的 IDE 状态。
  //
  //   注意: 不能只靠 window 'storage' 事件 —— 它只在**其他 tab** 修改时触发，
  //   同 tab 内 App.tsx / Editor.tsx / WorkspaceSelector.tsx 调 setItem 不触发。
  //   所以改为轮询比对（1s 一次，开销可忽略）。
  useEffect(() => {
    const readWs = () =>
      localStorage.getItem('agentai.workspace') || localStorage.getItem('currentWorkspace') || '';

    let lastWs = readWs();
    const timer = setInterval(() => {
      const now = readWs();
      if (now === lastWs) return;
      lastWs = now;
      lastStateRef.current = '';   // 强制下次轮询重新推送
      void pushState();
    }, 1000);
    return () => clearInterval(timer);
  }, [pushState]);

  return { pushState };
}

/**
 * 手动推送: 当检测到用户切换文件或编辑时调用
 * 用于事件驱动的推送，比轮询更高效
 */
export function useIdeStateEventDriven() {
  const { pushState } = useIdeState(15000); // 长间隔作为 fallback

  const onFileOpen = useCallback((filePath: string, language: string) => {
    pushIdeState({
      openFiles: [{ path: filePath, language, cursorLine: 1, cursorColumn: 1 }],
      activeFile: filePath,
      isEditing: true,
    });
  }, [pushState]);

  const onCursorMove = useCallback((filePath: string, line: number, column: number) => {
    pushIdeState({
      openFiles: [{ path: filePath, language: filePath.split('.').pop() || '', cursorLine: line, cursorColumn: column }],
      activeFile: filePath,
      isEditing: true,
    });
  }, [pushState]);

  return { onFileOpen, onCursorMove, pushState };
}
