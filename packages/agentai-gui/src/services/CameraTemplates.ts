/**
 * CameraTemplates — 运镜模版库
 * 学自: 漫剧系统 镜头语言模块
 */
export interface CameraTemplate {
  id: string;
  label: string;
  icon: string;
  description: string;
  promptSuffix: string;
  speed: string;
  category: 'basic' | 'advanced' | 'cinematic';
}

export const CAMERA_TEMPLATES: CameraTemplate[] = [
  // === 基础运镜 ===
  { id: 'push', label: '推镜头', icon: '🔍', description: '镜头向前推进，强调主体', promptSuffix: 'camera slowly pushing in, focusing on the subject', speed: 'slow', category: 'basic' },
  { id: 'pull', label: '拉镜头', icon: '🔙', description: '镜头向后拉远，展现环境', promptSuffix: 'camera slowly pulling back, revealing the surroundings', speed: 'slow', category: 'basic' },
  { id: 'pan_left', label: '左摇', icon: '⬅️', description: '镜头水平向左转动', promptSuffix: 'camera panning left smoothly', speed: 'medium', category: 'basic' },
  { id: 'pan_right', label: '右摇', icon: '➡️', description: '镜头水平向右转动', promptSuffix: 'camera panning right smoothly', speed: 'medium', category: 'basic' },
  { id: 'tilt_up', label: '上摇', icon: '⬆️', description: '镜头垂直向上转动', promptSuffix: 'camera tilting up, revealing the sky', speed: 'medium', category: 'basic' },
  { id: 'tilt_down', label: '下摇', icon: '⬇️', description: '镜头垂直向下转动', promptSuffix: 'camera tilting down, showing the ground', speed: 'medium', category: 'basic' },

  // === 进阶运镜 ===
  { id: 'zoom_in', label: '快速缩放', icon: '🔎', description: '快速拉近，制造紧张感', promptSuffix: 'fast zoom in, dolly zoom effect, vertigo effect', speed: 'fast', category: 'advanced' },
  { id: 'zoom_out', label: '慢速缩放', icon: '🔭', description: '缓慢拉远，烘托氛围', promptSuffix: 'slow zoom out, gradual reveal, cinematic', speed: 'slow', category: 'advanced' },
  { id: 'follow', label: '跟镜头', icon: '🏃', description: '镜头跟随主体移动', promptSuffix: 'tracking shot following the subject, steady camera movement', speed: 'medium', category: 'advanced' },
  { id: 'crane_up', label: '升镜头', icon: '🏗️', description: '镜头从下向上抬起', promptSuffix: 'crane shot moving upward, aerial perspective reveal', speed: 'slow', category: 'advanced' },
  { id: 'crane_down', label: '降镜头', icon: '📐', description: '镜头从上向下降低', promptSuffix: 'crane shot descending, bird eye to ground level', speed: 'slow', category: 'advanced' },
  { id: 'orbit', label: '环绕', icon: '🔄', description: '镜头围绕主体旋转', promptSuffix: 'orbital camera movement, 360 degree rotation around subject', speed: 'medium', category: 'advanced' },
  { id: 'dutch', label: '倾斜', icon: '📐', description: '斜角镜头，制造不安', promptSuffix: 'dutch angle, tilted camera, unsettling atmosphere', speed: 'static', category: 'advanced' },

  // === 电影级运镜 ===
  { id: 'aerial', label: '航拍', icon: '🚁', description: '高空俯瞰，大场面', promptSuffix: 'aerial drone shot, sweeping landscape, high altitude, cinematic', speed: 'slow', category: 'cinematic' },
  { id: 'tracking', label: '横移跟拍', icon: '🎬', description: '平行移动跟随主体', promptSuffix: 'side tracking shot, parallel movement, cinematic dolly', speed: 'medium', category: 'cinematic' },
  { id: 'overhead', label: '俯拍', icon: '📷', description: '正上方俯视拍摄', promptSuffix: 'top-down overhead shot, flat lay style, precise composition', speed: 'static', category: 'cinematic' },
  { id: 'handheld', label: '手持晃动', icon: '🎥', description: '模拟手持拍摄，增加真实感', promptSuffix: 'handheld camera, slight natural shake, documentary style, found footage', speed: 'fast', category: 'cinematic' },
  { id: 'whip_pan', label: '甩镜头', icon: '💨', description: '快速甩动转场', promptSuffix: 'whip pan transition, fast blur motion, energetic camera move', speed: 'fast', category: 'cinematic' },
  { id: 'dolly_zoom', label: '希区柯克变焦', icon: '🌀', description: '前景不变，背景压缩/扩展', promptSuffix: 'dolly zoom, Hitchcock effect, vertigo shot, foreground stable background changes', speed: 'slow', category: 'cinematic' },
  { id: 'time_lapse', label: '延时摄影', icon: '⏱️', description: '时间快速流逝', promptSuffix: 'time-lapse, clouds moving fast, sun tracking across sky, hyperlapse', speed: 'fast', category: 'cinematic' },
  { id: 'slow_motion', label: '慢动作', icon: '🐌', description: '时间减速，细节展现', promptSuffix: 'slow motion, dramatic slow-mo, every detail visible, cinematic 120fps', speed: 'slow', category: 'cinematic' },
];

/** 按分类获取运镜列表 */
export function getTemplatesByCategory(): Record<string, CameraTemplate[]> {
  const groups: Record<string, CameraTemplate[]> = {};
  for (const t of CAMERA_TEMPLATES) {
    if (!groups[t.category]) groups[t.category] = [];
    groups[t.category]!.push(t);
  }
  return groups;
}
