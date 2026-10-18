/**
 * PulseLine — 脉象波形 (2026-10-12 审美升级 · 岐黄叙事视觉化)
 * ----------------------------------------------------
 * 叙事: 望闻问切之「切」—— AI 工作时, 界面底部浮现一条如脉搏起伏的细波,
 *       波幅与频率随工作状态变化。呼应处方笺/经络的中医视觉语言。
 *
 * 行为: 仅 active(AI 生成中) 时出现并起伏; 静止态淡出, 不常驻占位。
 * 位置: 消息流末尾 (Bottom padding 处) —— AI 正在输出处, 最需要状态感的位置。
 *
 * 技术: 纯 SVG + CSS keyframes, 零依赖零 JS 定时器。
 *       横向拉伸用 preserveAspectRatio="none" + vector-effect="non-scaling-stroke"
 *       (后者保证横向缩放时线宽不被拉粗)。
 *
 * ⚠️ 本文件在 components/chat/ — eslint 禁内联 style, 全部走 class。
 */
import React from 'react';

export interface PulseLineProps {
  /** AI 是否正在生成 —— false 时不渲染 */
  active: boolean;
}

export const PulseLine: React.FC<PulseLineProps> = ({ active }) => {
  if (!active) return null;
  return (
    <div className="pulse-line" aria-hidden="true">
      <svg className="pulse-line-svg" viewBox="0 0 240 12" preserveAspectRatio="none">
        {/* 双波叠加: 主波 + 错相副波, 避免机械的单周期感 */}
        <path
          className="pulse-line-path pulse-line-path-a"
          d="M0 6 Q 15 6 22 3 T 44 6 Q 52 6 58 8 T 80 6 Q 90 6 96 4 T 118 6 Q 128 6 134 9 T 156 6 Q 166 6 172 3 T 194 6 Q 204 6 210 8 T 232 6 Q 236 6 240 6"
          fill="none"
          vectorEffect="non-scaling-stroke"
        />
        <path
          className="pulse-line-path pulse-line-path-b"
          d="M0 6 Q 18 6 26 8 T 52 6 Q 60 6 66 4 T 92 6 Q 100 6 106 7 T 132 6 Q 142 6 148 8 T 174 6 Q 182 6 188 3 T 214 6 Q 222 6 228 7 T 240 6"
          fill="none"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
};

export default PulseLine;