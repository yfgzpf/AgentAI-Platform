/**
 * WorkspaceStore — 统一工作区状态管理 (Zustand)
 * ----------------------------------------------------
 * 管理三种模式（editor/browser/preview）的状态切换、文件标签页、浏览器历史
 *
 * 设计原则：
 *   - 与现有 modeStore（App 级别页面切换）不冲突，workspaceStore 是工作区内部模式
 *   - 支持 persist 中间件，刷新后恢复上次模式
 *   - 提供 openBrowser/openEditor/openPreview 便捷方法
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { WorkspaceState, WorkspaceMode, FileNode } from '../types/workspace';
import { isPreviewable } from '../types/workspace';

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      // ===== 默认状态 =====
      mode: 'auto' as WorkspaceMode,
      currentFile: null,
      currentUrl: '',
      browserHistory: [],
      browserHistoryIndex: -1,
      loading: false,
      transitioning: false,
      openFiles: [],
      activeFilePath: null,

      // ===== 模式控制 =====
      setMode: (mode: WorkspaceMode) => {
        set({ mode, transitioning: true });
        setTimeout(() => set({ transitioning: false }), 300);
        if (mode !== 'auto') {
          try {
            localStorage.setItem('agentai.workspace.lastMode', mode);
          } catch { /* ignore */ }
        }
      },

      setCurrentFile: (file: FileNode | null) => {
        set({ currentFile: file });
        if (get().mode === 'auto') {
          get().inferMode();
        }
      },

      setCurrentUrl: (url: string) => {
        set({ currentUrl: url });
        if (get().mode === 'auto' && url) {
          set({ mode: 'browser', transitioning: true });
          setTimeout(() => set({ transitioning: false }), 300);
        }
      },

      // ===== 浏览器历史 =====
      pushBrowserHistory: (url: string) => {
        const { browserHistory, browserHistoryIndex } = get();
        const newHistory = browserHistory.slice(0, browserHistoryIndex + 1);
        newHistory.push(url);
        set({
          browserHistory: newHistory,
          browserHistoryIndex: newHistory.length - 1,
          currentUrl: url,
        });
      },

      navigateBrowserHistory: (direction: 'back' | 'forward') => {
        const { browserHistory, browserHistoryIndex } = get();
        let newIndex = browserHistoryIndex;
        if (direction === 'back' && browserHistoryIndex > 0) {
          newIndex = browserHistoryIndex - 1;
        } else if (direction === 'forward' && browserHistoryIndex < browserHistory.length - 1) {
          newIndex = browserHistoryIndex + 1;
        } else {
          return;
        }
        set({
          browserHistoryIndex: newIndex,
          currentUrl: browserHistory[newIndex],
        });
      },

      // ===== 加载状态 =====
      setLoading: (loading: boolean) => set({ loading }),
      setTransitioning: (transitioning: boolean) => set({ transitioning }),

      // ===== 文件标签页管理 =====
      addOpenFile: (file: FileNode) => {
        const { openFiles } = get();
        if (!openFiles.find(f => f.path === file.path)) {
          set({ openFiles: [...openFiles, file] });
        }
        set({ activeFilePath: file.path, currentFile: file });
      },

      removeOpenFile: (path: string) => {
        const { openFiles, activeFilePath } = get();
        const newFiles = openFiles.filter(f => f.path !== path);
        let newActive = activeFilePath;
        if (activeFilePath === path) {
          const removedIdx = openFiles.findIndex(f => f.path === path);
          if (newFiles.length > 0) {
            newActive = newFiles[Math.min(removedIdx, newFiles.length - 1)].path;
          } else {
            newActive = null;
          }
        }
        set({
          openFiles: newFiles,
          activeFilePath: newActive,
          currentFile: newFiles.find(f => f.path === newActive) || null,
        });
      },

      setActiveFile: (path: string | null) => {
        const { openFiles } = get();
        if (!path) {
          set({ activeFilePath: null, currentFile: null });
          return;
        }
        const file = openFiles.find(f => f.path === path);
        set({
          activeFilePath: path,
          currentFile: file || null,
        });
      },

      // ===== 自动模式推断（优先级链）=====
      inferMode: () => {
        const state = get();
        if (state.mode && state.mode !== 'auto') return state.mode;
        if (state.currentUrl) return 'browser';
        if (state.currentFile) {
          if (isPreviewable(state.currentFile)) return 'preview';
          return 'editor';
        }
        return 'editor';
      },

      // ===== 便捷方法 =====
      openBrowser: (url: string) => {
        get().pushBrowserHistory(url);
        set({ mode: 'browser', transitioning: true, loading: true });
        setTimeout(() => set({ transitioning: false, loading: false }), 300);
      },

      openEditor: (file: FileNode) => {
        get().addOpenFile(file);
        set({ mode: 'editor', transitioning: true });
        setTimeout(() => set({ transitioning: false }), 300);
      },

      openPreview: (file: FileNode) => {
        get().addOpenFile(file);
        set({ mode: 'preview', transitioning: true, currentFile: file });
        setTimeout(() => set({ transitioning: false }), 300);
      },
    }),
    {
      name: 'agentai-workspace',
      partialize: (state): Partial<WorkspaceState> => ({
        mode: state.mode,
        currentUrl: state.currentUrl,
        browserHistory: state.browserHistory.slice(-10),
        browserHistoryIndex: Math.min(state.browserHistoryIndex, 9),
        openFiles: state.openFiles.slice(0, 10).map(f => ({ path: f.path, name: f.name, type: f.type, ext: f.ext })),
        activeFilePath: state.activeFilePath,
      }),
      version: 1,
      // 防止 localStorage 配额超限 (Edge/低配设备常见问题)
      storage: createJSONStorage(() => localStorage),
    },
  ),
);

/** Hook: 获取当前应渲染的实际模式（解析 auto） */
export function useResolvedWorkspaceMode(): WorkspaceMode {
  const mode = useWorkspaceStore(s => s.mode);
  const currentUrl = useWorkspaceStore(s => s.currentUrl);
  const currentFile = useWorkspaceStore(s => s.currentFile);

  if (mode !== 'auto') return mode;

  if (currentUrl) return 'browser';
  if (currentFile) {
    if (isPreviewable(currentFile)) return 'preview';
    return 'editor';
  }
  return 'editor';
}
