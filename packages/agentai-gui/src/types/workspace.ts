/**
 * UnifiedWorkspace 类型定义
 * ----------------------------------------------------
 * 统一工作区的核心类型：模式、文件节点、工作区上下文
 *
 * 模式优先级链：
 *   userSelected > aiSpecified > auto-infer > default(editor)
 */

/** 工作区内三种显示模式 */
export type WorkspaceMode = 'editor' | 'browser' | 'preview' | 'auto';

/** 文件节点（用于文件树和预览判断） */
export interface FileNode {
  path: string;
  name: string;
  type: 'file' | 'directory';
  size?: number;
  content?: string;
  language?: string;
  /** 扩展名，用于预览类型判断 */
  ext?: string;
}

/** 可预览的文件类型分类 */
export type PreviewType = 'image' | 'pdf' | 'video' | 'audio' | 'text' | 'markdown' | 'none';

/** 工作区上下文（用于自动模式推断） */
export interface WorkspaceContext {
  /** 用户显式选择的模式 */
  userSelectedMode?: WorkspaceMode;
  /** AI 指定的模式 */
  aiSpecifiedMode?: WorkspaceMode;
  /** 当前打开的文件 */
  currentFile?: FileNode | null;
  /** 当前浏览器 URL */
  currentUrl?: string;
  /** 上一次使用的模式（用于恢复） */
  lastUsedMode?: WorkspaceMode;
}

/** 工作区 Store 状态接口 */
export interface WorkspaceState {
  /** 当前激活的模式 */
  mode: WorkspaceMode;
  /** 当前打开的文件 */
  currentFile: FileNode | null;
  /** 当前浏览器 URL */
  currentUrl: string;
  /** 浏览器历史记录 */
  browserHistory: string[];
  /** 浏览器历史索引 */
  browserHistoryIndex: number;
  /** 是否正在加载 */
  loading: boolean;
  /** 模式切换动画是否活跃 */
  transitioning: boolean;
  /** 打开的文件列表（标签页） */
  openFiles: FileNode[];
  /** 活跃文件路径 */
  activeFilePath: string | null;

  // --- Actions ---
  setMode: (mode: WorkspaceMode) => void;
  setCurrentFile: (file: FileNode | null) => void;
  setCurrentUrl: (url: string) => void;
  pushBrowserHistory: (url: string) => void;
  navigateBrowserHistory: (direction: 'back' | 'forward') => void;
  setLoading: (loading: boolean) => void;
  setTransitioning: (transitioning: boolean) => void;
  addOpenFile: (file: FileNode) => void;
  removeOpenFile: (path: string) => void;
  setActiveFile: (path: string | null) => void;

  /** 根据上下文推断最佳模式 */
  inferMode: () => WorkspaceMode;

  /** 切换到浏览器模式并导航 */
  openBrowser: (url: string) => void;

  /** 切换到编辑器模式并打开文件 */
  openEditor: (file: FileNode) => void;

  /** 切换到预览模式 */
  openPreview: (file: FileNode) => void;
}

/** 预览类型判断工具函数 */
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.svg', '.webp', '.ico', '.avif']);
const PDF_EXTS = new Set(['.pdf']);
const VIDEO_EXTS = new Set(['.mp4', '.webm', '.ogg', '.mov', '.avi', '.mkv', '.flv']);
const AUDIO_EXTS = new Set(['.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a']);
const MARKDOWN_EXTS = new Set(['.md', '.markdown']);

export function getPreviewType(file: FileNode): PreviewType {
  const ext = file.ext || extractExt(file.path);
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (PDF_EXTS.has(ext)) return 'pdf';
  if (VIDEO_EXTS.has(ext)) return 'video';
  if (AUDIO_EXTS.has(ext)) return 'audio';
  if (MARKDOWN_EXTS.has(ext)) return 'markdown';
  if (ext) return 'text'; // 有扩展名的其他文件当文本处理
  return 'none';
}

/** 文件是否可预览（非代码编辑） */
export function isPreviewable(file: FileNode): boolean {
  const type = getPreviewType(file);
  return type !== 'none' && type !== 'text';
}

/** 从路径提取扩展名 */
function extractExt(path: string): string {
  const dotIdx = path.lastIndexOf('.');
  if (dotIdx === -1 || dotIdx === path.length - 1) return '';
  return path.slice(dotIdx).toLowerCase();
}
