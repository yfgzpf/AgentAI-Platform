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
 * 尝试从 VSCode API 或 localStorage session 获取编辑器状态
 */
function getEditorState(): IdeStatePayload | null {
  try {
    // 路径1: VSCode WebView API
    const vs = (window as any).acquireVsCodeApi?.();
    if (vs) {
      const state = vs.getState?.();
      if (state?.openFiles) return state;
    }

    // 路径2: 从 URL query 参数获取当前文件
    const params = new URLSearchParams(window.location.search);
    const currentFile = params.get('file');
    const cursorLine = parseInt(params.get('line') || '1');

    if (currentFile) {
      const lang = currentFile.split('.').pop() || '';
      return {
        openFiles: [{
          path: currentFile,
          language: lang,
          cursorLine,
          cursorColumn: 1,
        }],
        activeFile: currentFile,
        isEditing: true,
      };
    }
  } catch {}

  return null;
}

/**
 * 推送 IDE 状态到 Gateway
 */
async function pushIdeState(state: IdeStatePayload): Promise<void> {
  try {
    await fetch(`${GATEWAY_URL}/ide-state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // 静默失败 — Gateway 可能未启动
  }
}

/**
 * Hook: 自动推送 IDE 状态到 Gateway
 * @param pollInterval — 轮询间隔 (ms), 默认 5000
 */
export function useIdeState(pollInterval = 5000) {
  const lastStateRef = useRef<string>('');

  const pushState = useCallback(async () => {
    const state = getEditorState();
    if (!state) return;

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
