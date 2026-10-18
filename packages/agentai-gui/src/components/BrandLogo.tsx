/**
 * BrandLogo — 岐枢 / PulseFlow 品牌标识 (2026-10-10, 2026-10-12 唯一化)
 * ----------------------------------------------------------------
 * 设计理念: 两个交叠流线 = Pulse (脉动) + Flow (流动)
 * 极简几何, 可缩放, 单色自适应主题
 *
 * 大品牌参考: Linear(几何), Vercel(三角形), Stripe(渐变线)
 *
 * ⚠️ 本组件是**全站唯一品牌标出口** (2026-10-12 统一):
 *   此前标题栏用栅格 /favicon-32.png (塔尖"A" mark), 启动页/侧聊用本组件 (交错流线 mark)
 *   —— 同一产品两套图形。现在标题栏也走本组件, public/favicon.svg 的几何与本文件保持一致
 *   (改这里必须同步改 favicon.svg, 由 src/brand.test.ts 锁定)。
 */
import React, { useId } from 'react';

interface BrandLogoProps {
  size?: number;
  /** 是否带光晕动画 (欢迎页用) */
  glow?: boolean;
  /**
   * 是否播放「描边画出」入场动画 (2026-10-12)
   * ----------------------------------------------------
   * 两条流线从无到有被"画"出来, 再交点脉冲亮起 —— 呼应 Pulse/Flow 语义。
   * 仅欢迎页/启动页开启: 标题栏那枚 20px 小标每次都播会变成闪烁噪音。
   * 实现走 CSS class (agentai-theme.css 的 .pf-logo-draw),
   * **不碰路径数据与渐变 id** —— brand.test.ts 对二者有逐字断言。
   */
  animate?: boolean;
}

export const BrandLogo: React.FC<BrandLogoProps> = ({ size = 56, glow = false, animate = false }) => {
  // 渐变 id 必须**逐实例唯一**: 本组件同时出现在标题栏 / 启动页 / 编辑器侧聊 (同一 DOM 多实例),
  // 固定 id 会让所有 url(#pf-grad) 都解析到文档里第一个 <defs>, 该实例一旦卸载/隐藏引用即失效。
  // useId() 返回值含 ':' (React 内部格式), 用在 url(#...) 里需先剥掉。
  const uid = useId().replace(/:/g, '');
  const gradId = `pf-grad-${uid}`;
  const gradId2 = `pf-grad-2-${uid}`;
  return (
    <div className={animate ? 'pf-logo-draw' : undefined} style={{
      width: size, height: size,
      position: 'relative',
      filter: glow ? 'drop-shadow(0 4px 20px rgba(205,122,58,0.35))' : 'none',
      transition: 'filter 0.3s ease',
    }}>
      <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
        <defs>
          <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#E89055" />
            <stop offset="100%" stopColor="#CD7A3A" />
          </linearGradient>
          <linearGradient id={gradId2} x1="100%" y1="100%" x2="0%" y2="0%">
            <stop offset="0%" stopColor="#CD7A3A" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#E89055" stopOpacity="0.3" />
          </linearGradient>
        </defs>

        {/* 外圆角方 — 品牌容器 */}
        <rect width="64" height="64" rx="16" fill="#1a1a22" />

        {/* 左侧流线 (Pulse) — 从下到上的弧线 */}
        <path
          d="M18 48 C 18 36, 24 28, 24 16"
          stroke={`url(#${gradId})`}
          strokeWidth="4.5"
          strokeLinecap="round"
          fill="none"
        />

        {/* 右侧流线 (Flow) — 从上到下的弧线, 与左侧交叠 */}
        <path
          d="M46 16 C 46 28, 40 36, 40 48"
          stroke={`url(#${gradId2})`}
          strokeWidth="4.5"
          strokeLinecap="round"
          fill="none"
        />

        {/* 交叠点 — 脉冲圆点 (animate 时随流线画完后亮起) */}
        <circle className="pf-logo-dot" cx="32" cy="32" r="4" fill="#E89055" />
        <circle className="pf-logo-dot" cx="32" cy="32" r="2" fill="#fff" opacity="0.9" />
      </svg>
    </div>
  );
};

export default BrandLogo;
