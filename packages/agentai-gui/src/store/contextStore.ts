/**
 * contextStore — 管理注入到 AI 上下文的文件
 * 
 * 功能:
 *   1. 存储用户手动注入的文件列表
 *   2. 支持添加/移除/清空注入的文件
 *   3. 持久化到 localStorage
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface InjectedFile {
  path: string;
  name: string;
  content?: string;
  injectedAt: number;
}

interface ContextState {
  /** 已注入的文件列表 */
  injectedFiles: InjectedFile[];
  /** 添加文件到上下文 */
  addInjectedFile: (file: Omit<InjectedFile, 'injectedAt'>) => void;
  /** 从上下文中移除文件 */
  removeInjectedFile: (path: string) => void;
  /** 清空所有注入的文件 */
  clearInjectedFiles: () => void;
  /** 检查文件是否已注入 */
  isFileInjected: (path: string) => boolean;
  /** 获取所有注入文件的内容（用于发送到后端） */
  getInjectedFilesContent: () => { path: string; name: string; content: string }[];
}

export const useContextStore = create<ContextState>()(
  persist(
    (set, get) => ({
      injectedFiles: [],

      addInjectedFile: (file) => {
        const { injectedFiles } = get();
        // 避免重复添加
        if (injectedFiles.some(f => f.path === file.path)) {
          return;
        }
        set({
          injectedFiles: [...injectedFiles, { ...file, injectedAt: Date.now() }],
        });
      },

      removeInjectedFile: (path) => {
        const { injectedFiles } = get();
        set({
          injectedFiles: injectedFiles.filter(f => f.path !== path),
        });
      },

      clearInjectedFiles: () => {
        set({ injectedFiles: [] });
      },

      isFileInjected: (path) => {
        return get().injectedFiles.some(f => f.path === path);
      },

      getInjectedFilesContent: () => {
        return get().injectedFiles
          .filter(f => f.content)
          .map(f => ({
            path: f.path,
            name: f.name,
            content: f.content!,
          }));
      },
    }),
    {
      name: 'agentai-context-store',
      partialize: (state) => ({ injectedFiles: state.injectedFiles }),
    }
  )
);
