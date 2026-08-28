/**
 * DecorAI Canvas — 建筑装饰视频预设库
 * 
 * 专为装饰行业设计的视频生成提示词:
 *   - 漫游动画 (walkthrough)
 *   - 生长动画 (growth/construction)
 *   - 日夜交替 (day-night cycle)
 *   - 俯瞰全景 (aerial)
 *   - 细节展示 (detail focus)
 */

export interface VideoPreset {
  key: string;
  label: string;
  icon: string;
  desc: string;
  /** 完整的英文 prompt, 直接传给 /v1/video */
  prompt: string;
  /** 推荐视频模型 */
  model: string;
  /** 推荐时长 */
  duration: string;
  /** 首帧图片是否必需 */
  needsFirstFrame: boolean;
}

export const VIDEO_PRESETS: VideoPreset[] = [
  {
    key: 'walkthrough',
    label: '漫游动画',
    icon: '🚶',
    desc: '第一人称视角漫游整个空间, 展示空间动线',
    prompt: `First-person architectural walkthrough animation of a beautifully designed modern apartment interior. Camera moves smoothly from the entrance foyer → through the open living room with large sofa and TV wall → into the gourmet kitchen with island → down the hallway to the master bedroom with en-suite bathroom → finally to the balcony with city view. Steady cam motion, natural lighting transitions between rooms, photorealistic quality, smooth dolly movement at eye level (1.6m height), showing spatial flow and room proportions. Cinematic architectural visualization style.`,
    model: 'cogvideo',
    duration: '8s',
    needsFirstFrame: false,
  },
  {
    key: 'growth',
    label: '生长动画',
    icon: '🌱',
    desc: '从毛坯到完工的渐进展示, 适合方案汇报',
    prompt: `Time-lapse architectural growth animation showing interior renovation construction process in a single continuous shot. Stage 1: Raw concrete empty room with exposed walls and floor. Stage 2: Workers installing drywall partitions and ceiling framework. Stage 3: Flooring being laid (tiles in living areas, wood in bedrooms). Stage 4: Painters applying final coat of paint on walls. Stage 5: Electricians installing light fixtures and switches. Stage 6: Furniture delivery and arrangement (sofa, bed, dining table). Stage 7: Final styling with decor items, curtains, plants. Smooth morphing transition between each stage, 10 seconds total, architectural visualization, professional presentation quality, satisfying transformation reveal at end.`,
    model: 'cogvideo',
    duration: '10s',
    needsFirstFrame: false,
  },
  {
    key: 'day-night',
    label: '日夜交替',
    icon: '🌙',
    desc: '同一空间的白天→黄昏→夜晚光影变化',
    prompt: `Day to night time-lapse transition of the same modern luxury living room interior. Starting frame: Bright mid-morning sunlight streaming through floor-to-ceiling windows, casting sharp shadows, cool white daylight. Transition through golden hour (warm orange sunset light through windows, long dramatic shadows, cozy atmosphere) → twilight (deep blue outside, interior lights starting to turn on, warm lamps glowing) → full night (dark exterior with city lights visible through windows, all interior lighting on - warm ambient + accent lights + decorative strips, cozy intimate mood). Furniture remains completely static throughout. Only lighting and window view change. 8 seconds, photorealistic, architectural visualization, cinematic color grading.`,
    model: 'cogvideo',
    duration: '8s',
    needsFirstFrame: true,
  },
  {
    key: 'aerial',
    label: '俯瞰全景',
    icon: '🦅',
    desc: '从上空俯瞰整个户型布局, 再逐个推入房间',
    prompt: `Aerial top-down bird's-eye view of a complete apartment floor plan in 3D rendered form. Camera starts high above looking straight down at the furnished layout showing all rooms (living room, kitchen, bedrooms, bathrooms, balcony) with furniture clearly visible from above like an architectural drawing come to life. Then camera slowly descends and tilles forward while rotating, transitioning smoothly from top-down 2D-like view into a 3D perspective walkthrough that glides over each room showing spatial relationships. Finally settles into a comfortable eye-level view of the main living area. Smooth elegant camera choreography, 8 seconds, 3D architectural visualization, clean modern aesthetic, professional real estate presentation quality.`,
    model: 'cogvideo',
    duration: '8s',
    needsFirstFrame: false,
  },
  {
    key: 'detail-focus',
    label: '细节展示',
    icon: '🔍',
    desc: '聚焦材质/软装细节的特写动画, 体现品质感',
    prompt: `Cinematic macro detail showcase video of luxury interior design materials and furnishings. Slow deliberate camera pan across: 1) Calacatta gold marble countertop showing natural veining texture and polished reflection → 2) Velvet emerald green sofa fabric showing soft pile texture and light interaction → 3) Brushed brass metal light fixture showing fine grain and warm glow → 4) Wide plank European oak flooring showing wood grain and matte finish → 5) Framed abstract art piece on wall with gallery-style lighting → 6) Decorative ceramic vase handcrafted texture. Macro photography aesthetic, shallow depth of field (bokeh), smooth dolly/slider movement between each detail, 5 seconds, luxurious high-end interior magazine quality, warm sophisticated lighting throughout.`,
    model: 'cogvideo',
    duration: '5s',
    needsFirstFrame: true,
  },
  {
    key: 'room-reveal',
    label: '空间揭秘',
    icon: '🎬',
    desc: '从模糊到清晰的戏剧性空间揭示效果',
    prompt: `Dramatic room reveal animation. Start with a blurry out-of-focus dark frame. As camera slowly pushes forward (dolly in), the image gradually comes into sharp focus revealing a stunning modern luxury living room. Simultaneously, lighting fades up from dim to fully lit - first ambient base lighting, then accent lights, then decorative fixtures one by one, culminating in a bright beautiful fully-revealed space. The reveal should feel cinematic and emotional, like a movie scene reveal or a magic transformation. Final frame is a gorgeous wide shot of the complete room. 6 seconds, photorealistic, architectural visualization, dramatic lighting design showcase, professional real estate marketing quality.`,
    model: 'cogvideo',
    duration: '6s',
    needsFirstFrame: false,
  },
];

/** 按需过滤 */
export function getVideoPresets(options?: { needsFirstFrame?: boolean }): VideoPreset[] {
  if (!options?.needsFirstFrame) return VIDEO_PRESETS;
  return VIDEO_PRESETS.filter(p => p.needsFirstFrame === options.needsFirstFrame);
}
