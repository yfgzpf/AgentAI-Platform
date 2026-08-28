/**
 * 装饰风格预设 — 12 种主流装修风格
 *
 * 每个风格包含:
 *   - key: 唯一标识
 *   - label: 显示名称
 *   - icon: emoji 图标
 *   - prompt: 优化后的 AI 生图提示词 (中英文混合)
 *   - desc: 风格简述
 *   - colors: 主色调
 *   - materials: 典型材质
 */

import type { DecorStyle } from './types';
export type { DecorStyle };

export const DECOR_STYLES: DecorStyle[] = [
  {
    key: 'modern',
    label: '现代简约',
    icon: '⬜',
    prompt: 'Modern minimalist interior design, clean lines, open floor plan, neutral color palette with white and light gray walls, large floor-to-ceiling windows flooding natural light, concealed lighting with recessed LED strips, minimalist furniture with geometric shapes, polished concrete or light oak flooring, integrated smart home system, uncluttered surfaces, monochromatic accent pieces. 现代简约风格，开放式布局，无主灯设计，大面积留白.',
    desc: '少即是多 · 功能优先',
    colors: '#FFFFFF / #F5F5F5 / #333333',
    materials: '微水泥 / 浅橡木 / 拉丝不锈钢 / 钢化玻璃',
  },
  {
    key: 'nordic',
    label: '北欧风',
    icon: '🌲',
    prompt: 'Scandinavian Nordic interior, warm white walls, natural pine and birch wood flooring, cozy hygge atmosphere, soft wool textiles in cream and beige tones, large potted green plants, simple functional furniture from IKEA aesthetic, pendant lights with warm 2700K glow, sheer white curtains diffusing daylight, faux fur throws on sofa, woven jute rug. 北欧风格，原木色调，温馨舒适，自然采光.',
    desc: '自然温暖 · 功能主义',
    colors: '#FEF9E7 / #E8DCC4 / #8B7355',
    materials: '白蜡木 / 棉麻织物 / 羊毛地毯 / 编藤',
  },
  {
    key: 'new-chinese',
    label: '新中式',
    icon: '🏮',
    prompt: 'New Chinese style interior, harmonious blend of traditional Eastern aesthetics with modern minimalism, dark walnut wood lattice screens (花格屏风), ink-wash painting inspired wall art, ceramic vases with bamboo branches, low-profile Ming-style furniture in rosewood tone, subtle gold accents, silk cushions in deep red or navy blue, paper lantern style pendant lights, zen garden elements. 新中式风格，东方美学与现代融合，木质格栅，水墨意境.',
    desc: '东方禅意 · 文化传承',
    colors: '#2C1810 / #8B4513 / #C41E3A / #1A1A2E',
    materials: '胡桃木 / 实木花格 / 丝绸 / 青瓷 / 金箔',
  },
  {
    key: 'japanese',
    label: '日式和风',
    icon: '🎐',
    prompt: 'Japanese Zen interior design, tatami mat flooring areas with shoji sliding doors (障子), natural cypress wood (桧木) beams exposed, low wooden platform seating (床の間), ikebana flower arrangement on tokonoma alcove, washi paper lanterns, natural stone garden view through large glass panels, minimal furniture in dark teak, neutral earth tones throughout. 日式和风，榻榻米空间，障子门，枯山水庭院景观.',
    desc: '侘寂之美 · 极简禅意',
    colors: '#D4C4A8 / #8B7D6B / #2F4F4F / #F5F5DC',
    materials: '桧木 / 榻榻米 / 和纸 / 自然石 / 竹',
  },
  {
    key: 'industrial',
    label: '工业风',
    icon: '🏭',
    prompt: 'Industrial loft style interior, exposed red brick walls with original texture, black steel I-beam columns, corrugated metal ceiling with visible ductwork and Edison bulb string lights, polished concrete flooring with epoxy finish, vintage leather Chesterfield sofa, reclaimed wood dining table, metal mesh room dividers, factory window frames repurposed as decor. 工业风loft，裸露红砖墙，黑色钢结构，爱迪生灯泡.',
    desc: '粗犷原始 · 复古机械美学',
    colors: '#8B0000 / #2F2F2F / #CD853F / #696969',
    materials: '红砖 / 黑钢 / 水泥地面 / 复古皮革 / 回收木材',
  },
  {
    key: 'french',
    label: '法式轻奢',
    icon: '🗼',
    prompt: 'French Parisian chic interior, ornate crown molding (石膏线) with intricate floral patterns, herringbone parquet flooring in aged oak, crystal chandelier as focal point, velvet tufted sofa in dusty rose or sage green, gilded gold-framed mirrors, marble-topped console table, soft lavender walls with white wainscoting, curated art gallery wall. 法式轻奢，精致石膏线条，人字拼地板，水晶吊灯，丝绒家具.',
    desc: '浪漫优雅 · 精致细节',
    colors: '#E6E6FA / #D2B48C / #FFD700 / #DDA0DD',
    materials: '大理石 / 丝绒 / 实木拼花 / 黄铜 / 水晶',
  },
  {
    key: 'mashup',
    label: '混搭风',
    icon: '🎨',
    prompt: 'Eclectic maximalist interior mixing multiple styles, bold color blocking with emerald green and burnt orange accent walls, gallery wall of mismatched framed artworks, vintage mid-century modern armchair next to contemporary sculptural piece, patterned Persian rug over hardwood floors, mix of metallic finishes (brass + chrome + copper), layered textures with velvet + linen + leather. 混搭风格，大胆撞色，多元素融合，个性表达.',
    desc: '大胆混搭 · 个性表达',
    colors: '#50C878 / #FF4500 / #4169E1 / #FFD700',
    materials: '波斯地毯 / 多金属混搭 / 丝绒+亚麻 / 复古单品',
  },
  {
    key: 'cyberpunk',
    label: '赛博朋克',
    icon: '💜',
    prompt: 'Cyberpunk futuristic interior, neon purple and cyan LED strip lighting along ceiling edges, holographic display panels on walls, iridescent surfaces with rainbow sheen, angular geometric furniture in matte black, backlit translucent acrylic partitions, fiber optic starfield ceiling effect, metallic silver and gunmetal gray base palette. 赛博朋克风格，霓虹紫青灯光，全息显示面板，未来感几何造型.',
    desc: '未来科技 · 霓虹美学',
    colors: '#9400D3 / #00FFFF / #1A1A2E / #C0C0C0',
    materials: '亚克力 / 光纤 / 金属漆面 / LED灯带 / 全息膜',
  },
  {
    key: 'mori',
    label: '日式森系',
    icon: '🌿',
    prompt: 'Japanese Mori girl (森系) natural interior, abundant indoor plants creating urban jungle feel, raw unfinished wood surfaces showing grain texture, macrame plant hangers, linen and cotton textiles in oatmeal and sage tones, wicker and rattan furniture pieces, dried flower arrangements, large round jute area rug, filtered natural light through bamboo blinds. 森系自然风格，城市丛林感，大量绿植，原木纹理，棉麻质地.',
    desc: '回归自然 · 治愈系',
    colors: '#556B2F / #DEB887 / #F5F5DC / #8FBC8F',
    materials: '原木 / 棉麻 / 藤编 / 干花 / 绿植',
  },
  {
    key: 'wabi-sabi',
    label: '侘寂风',
    icon: '🪨',
    prompt: 'Wabi-Sabi Japanese aesthetic interior embracing imperfection, hand-applied textured plaster walls (艺术涂料) in warm earthy tones, irregular shaped pottery vessels, weathered reclaimed timber beams, rough-hewn stone surfaces, dim ambient lighting from paper and clay lamps, asymmetrical arrangements, muted color palette of browns grays and off-whites. 侘寂风格，不完美之美，手工质感墙面，做旧木材，不对称构图.',
    desc: '不完美之美 · 时间痕迹',
    colors: '#8B7355 / #A0522D / #D2B48C / #696969',
    materials: '微水泥 / 艺术涂料 / 老木头 / 粗陶 / 亚麻',
  },
  {
    key: 'art-deco',
    label: 'Art Deco',
    icon: '✨',
    prompt: 'Art Deco luxury interior with bold geometric patterns, sunburst mirror as centerpiece, brass and black lacquer furniture with streamlined forms, chevron parquet flooring in contrasting woods, stepped architectural details, fan and zigzag motifs in decor, rich jewel tones of emerald sapphire and amber, metallic gold accents throughout. Art Deco奢华风格，放射状几何图案，黄铜黑漆家具，宝石色调.',
    desc: '华丽几何 · 复古奢华',
    colors: '#006400 / #4169E1 / #FF8C00 / #FFD700',
    materials: '黄铜 / 黑色亮漆 / 宝石色调面料 / 几何图案',
  },
  {
    key: 'minimalist-luxury',
    label: '极简轻奢',
    icon: '💎',
    prompt: 'Minimalist luxury interior, monochromatic palette of white gray and black with strategic gold accents, handle-less cabinetry with push-to-open mechanism, bookmatched marble feature wall, frameless glass shower enclosure, hidden LED strip lighting in ceiling coves, premium Italian leather sofa in charcoal, floating vanity with under-lighting. 极简轻奢风格，黑白灰主调配金色点缀，隐形收纳，意大利真皮.',
    desc: '低调奢华 · 品质生活',
    colors: '#FFFFFF / #808080 / #1C1C1C / #D4AF37',
    materials: '大理石 / 意大利皮革 / 隐形五金 / 钢化玻璃 / 黄铜',
  },
];

/** 根据风格 key 获取完整配置 */
export function getStyleByKey(key: string): DecorStyle | undefined {
  return DECOR_STYLES.find(s => s.key === key);
}

/** 视频动画类型 */
export const VIDEO_ANIMATIONS = [
  { key: 'growth', label: '生长动画', icon: '🌱', desc: '从空房间逐步填充家具' },
  { key: 'walkthrough', label: '漫游动画', icon: '🚶', desc: '第一人称视角空间漫游' },
  { key: 'day-night', label: '昼夜变化', icon: '🌙', desc: '展示不同时间段的光影效果' },
  { key: 'seasonal', label: '四季变换', icon: '🍂', desc: '春夏秋冬场景切换' },
  { key: 'before-after', label: '前后对比', icon: '↔️', desc: '毛坯→精装渐变过渡' },
  { key: '360-spin', label: '360°旋转', icon: '🔄', desc: '全景视角旋转展示' },
];
