/**
 * promptLibrary — 提示词收藏夹服务
 *
 * 功能:
 * 1. 保存/加载/删除提示词模板
 * 2. 内置常用模板
 * 3. localStorage 持久化
 * 4. 按标签分类
 */

export interface PromptTemplate {
  id: string;
  label: string;
  prompt: string;
  category: string;
  icon?: string;
  isBuiltIn?: boolean;
  ts: number;
}

const STORAGE_KEY = 'agentai-prompt-library';

// 内置模板
const BUILT_IN: PromptTemplate[] = [
  // 生图
  { id: 'bi-1', label: '超写实人像', prompt: 'cinematic portrait photo, 85mm lens, shallow depth of field, soft natural lighting, skin texture detail, 8k, photorealistic', category: '生图', icon: '📷', isBuiltIn: true, ts: 0 },
  { id: 'bi-2', label: '动漫美少女', prompt: 'anime girl, long flowing hair, big sparkling eyes, school uniform, cherry blossoms, soft pastel colors, studio ghibli style, detailed background', category: '生图', icon: '🎴', isBuiltIn: true, ts: 0 },
  { id: 'bi-3', label: '电影感风景', prompt: 'breathtaking landscape, golden hour, dramatic clouds, mountain valley, cinematic wide shot, 8k, highly detailed, volumetric lighting', category: '生图', icon: '🏔️', isBuiltIn: true, ts: 0 },
  { id: 'bi-4', label: '产品白底图', prompt: 'product photography, clean white background, studio lighting, sharp focus, high detail, commercial quality, centered composition', category: '生图', icon: '📦', isBuiltIn: true, ts: 0 },
  { id: 'bi-5', label: '室内设计', prompt: 'modern interior design, minimalist living room, natural daylight, wooden floor, plants, scandinavian style, 8k render, architectural digest', category: '生图', icon: '🏠', isBuiltIn: true, ts: 0 },
  // 生视频
  { id: 'bi-6', label: '电影级运镜', prompt: 'cinematic camera movement, slow dolly forward, dramatic lighting, atmospheric fog, film grain, anamorphic lens flare, 24fps', category: '生视频', icon: '🎬', isBuiltIn: true, ts: 0 },
  { id: 'bi-7', label: '延时摄影', prompt: 'time-lapse photography, clouds moving fast, sunset to night transition, city lights turning on, stars appearing, ultra smooth motion', category: '生视频', icon: '⏱️', isBuiltIn: true, ts: 0 },
  { id: 'bi-8', label: '水下世界', prompt: 'underwater scene, sunlight rays through water, schools of tropical fish, coral reef, bubbles rising, crystal clear water, documentary style', category: '生视频', icon: '🐠', isBuiltIn: true, ts: 0 },
  { id: 'bi-9', label: '城市航拍', prompt: 'aerial drone shot, flying over modern city skyline, sunset golden light, skyscrapers, traffic lights, smooth forward motion, 4k', category: '生视频', icon: '🌃', isBuiltIn: true, ts: 0 },
  // 改图指令
  { id: 'bi-10', label: '换背景', prompt: 'Change the background to a beach sunset scene, keep the subject unchanged', category: '改图指令', icon: '🔄', isBuiltIn: true, ts: 0 },
  { id: 'bi-11', label: '加光影', prompt: 'Add dramatic rim lighting and cinematic color grading, enhance contrast and shadows', category: '改图指令', icon: '💡', isBuiltIn: true, ts: 0 },
  { id: 'bi-12', label: '变风格', prompt: 'Transform into watercolor painting style while preserving the composition', category: '改图指令', icon: '🎨', isBuiltIn: true, ts: 0 },
  { id: 'bi-13', label: '加细节', prompt: 'Enhance details, increase sharpness, add fine texture, improve overall quality', category: '改图指令', icon: '🔍', isBuiltIn: true, ts: 0 },
];

class PromptLibrary {
  private templates: PromptTemplate[] = [];
  private listeners: Set<(t: PromptTemplate[]) => void> = new Set();

  constructor() {
    this.load();
  }

  private load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const user: PromptTemplate[] = raw ? JSON.parse(raw) : [];
      this.templates = [...BUILT_IN, ...user];
    } catch {
      this.templates = [...BUILT_IN];
    }
  }

  private save() {
    try {
      const user = this.templates.filter(t => !t.isBuiltIn);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    } catch {}
  }

  private notify() {
    for (const l of this.listeners) l(this.getAll());
  }

  getAll(): PromptTemplate[] {
    return [...this.templates];
  }

  getByCategory(category: string): PromptTemplate[] {
    return this.templates.filter(t => t.category === category);
  }

  getCategories(): string[] {
    return [...new Set(this.templates.map(t => t.category))];
  }

  add(label: string, prompt: string, category: string, icon?: string) {
    const t: PromptTemplate = {
      id: `user-${Date.now()}`,
      label, prompt, category,
      icon: icon || '📌',
      isBuiltIn: false,
      ts: Date.now(),
    };
    this.templates = [t, ...this.templates];
    this.save();
    this.notify();
    return t;
  }

  remove(id: string) {
    this.templates = this.templates.filter(t => t.id !== id || t.isBuiltIn);
    this.save();
    this.notify();
  }

  subscribe(listener: (t: PromptTemplate[]) => void): () => void {
    this.listeners.add(listener);
    listener(this.getAll());
    return () => this.listeners.delete(listener);
  }
}

export const promptLibrary = new PromptLibrary();
