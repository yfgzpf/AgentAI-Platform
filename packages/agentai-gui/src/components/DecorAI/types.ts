/**
 * DecorAI Canvas 共享类型定义
 */

/** 画布中的图片节点数据 */
export interface CanvasImage {
  id: string;
  url: string;
  prompt: string;
  mode: 'text2img' | 'img2img' | 'edit' | 'style_transfer';
  model: string;
  size: string;
  timestamp: number;
  selected?: boolean;
}

/** 对话消息 */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  images?: string[];
  timestamp: number;
}

/** 遮罩编辑状态 */
export interface MaskState {
  /** 遮罩数据 (base64 PNG) */
  maskDataUrl: string | null;
  /** 遮罩区域边界框 (相对于图片) */
  bounds: { x: number; y: number; width: number; height: number } | null;
  /** 当前工具: brush / rect / eraser */
  tool: 'brush' | 'rect' | 'eraser' | 'none';
  /** 画笔大小 */
  brushSize: number;
  /** 历史记录 (用于撤销) */
  history: ImageData[];
  /** 历史指针 */
  historyIndex: number;
}

/** 连线/边的类型 */
export type EdgeType = 'generate' | 'edit' | 'styleTransfer' | 'reference';

/** 装饰风格预设 */
export interface DecorStyle {
  key: string;
  label: string;
  icon: string;
  prompt: string;
  desc: string;
  colors: string;
  materials: string;
}
