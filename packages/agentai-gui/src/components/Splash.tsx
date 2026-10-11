/**
 * Splash — 启动欢迎页 v3 (PulseFlow) (2026-08-10 视觉增强版)
 * 
 * 设计: 多阶段动画 + 品牌核心能力展示 + 震撼视觉冲击
 *   Stage 1 (0-0.8s): LOGO 心跳脉冲 + 粒子爆发
 *   Stage 2 (0.8-1.6s): 品牌名 + 副标题淡入
 *   Stage 3 (1.6-2.4s): 能力标签浮动弹出
 *   Stage 4 (2.4-3.2s): Slogan + 定位语
 *   Stage 5 (3.2-4.0s): 整体淡出
 *
 * v3 增强:
 *   - 动态网格背景 + 流动光线
 *   - 粒子系统 (多色浮动)
 *   - 更大的 Logo 区域 + 光晕脉冲
 *   - 更新数据 (8 Provider / 141+ 工具)
 *   - 一句话品牌定位
 *   - 可点击跳过 (提升交互感)
 */
import React, { useEffect, useState, useCallback } from 'react';
import { BrandLogo } from './BrandLogo';

interface Props {
  onFinish?: () => void;
  duration?: number;          // 总停留时间 (默认 4000ms)
  minDuration?: number;       // 最少停留 (避免太快消失)
}

const CAPABILITY_TAGS = [
  { label: '8 模型 Provider', color: '#CD7A3A' },
  { label: '141+ AI 工具', color: '#43e97b' },
  { label: '多 Agent 协作', color: '#4facfe' },
  { label: '自进化引擎', color: '#f5576c' },
  { label: '9 行业模板', color: '#f093fb' },
  { label: '1M 上下文', color: '#E89055' },
  { label: '中医辨证', color: '#1abc9c' },
  { label: 'RAG 知识库', color: '#a78bfa' },
];

export const Splash: React.FC<Props> = ({ onFinish, duration = 4000, minDuration = 2800 }) => {
  const [visible, setVisible] = useState(true);
  const [fadeOut, setFadeOut] = useState(false);
  const [skipped, setSkipped] = useState(false);

  const handleSkip = useCallback(() => {
    if (skipped) return;
    setSkipped(true);
    setFadeOut(true);
    setTimeout(() => {
      setVisible(false);
      onFinish?.();
    }, 300);
  }, [skipped, onFinish]);

  useEffect(() => {
    if (skipped) return;
    const finalDuration = Math.max(duration, minDuration);
    const fadeTimer = setTimeout(() => setFadeOut(true), finalDuration - 500);
    const hideTimer = setTimeout(() => {
      setVisible(false);
      onFinish?.();
    }, finalDuration);
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(hideTimer);
    };
  }, [duration, minDuration, onFinish, skipped]);

  if (!visible) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'radial-gradient(ellipse at center, #1a1a24 0%, #12121a 60%, #08080c 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 'var(--z-dragging)',
        opacity: fadeOut ? 0 : 1,
        transition: 'opacity 0.5s cubic-bezier(0.4, 0, 0.2, 1)',
        overflow: 'hidden',
        cursor: skipped ? 'wait' : 'pointer',
      }}
      onClick={handleSkip}
    >
      {/* ★ 背景 1: 深色渐变基底 */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'linear-gradient(180deg, #16161e 0%, #0e0e14 50%, #09090c 100%)',
        pointerEvents: 'none',
      }} />

      {/* ★ 背景 2: 动态网格 */}
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage: `
          linear-gradient(rgba(205,122,58,0.03) 1px, transparent 1px),
          linear-gradient(90deg, rgba(205,122,58,0.03) 1px, transparent 1px)
        `,
        backgroundSize: '60px 60px',
        pointerEvents: 'none',
        animation: 'splash-grid-drift 20s linear infinite',
      }} />

      {/* ★ 背景 3: 流动光线 (对角线) */}
      <div style={{
        position: 'absolute', inset: 0,
        overflow: 'hidden', pointerEvents: 'none',
      }}>
        <div style={{
          position: 'absolute', width: '200%', height: '200%',
          top: '-50%', left: '-50%',
          background: 'conic-gradient(from 0deg at 50% 50%, transparent 0deg, rgba(205,122,58,0.04) 60deg, transparent 120deg, rgba(139,92,246,0.03) 180deg, transparent 240deg, rgba(16,185,129,0.03) 300deg, transparent 360deg)',
          animation: 'splash-rotate 30s linear infinite',
        }} />
      </div>

      {/* ★ 背景 4: 浮动光斑 (增强到 4 个) */}
      <div style={{
        position: 'absolute', top: '15%', left: '10%', width: 350, height: 350,
        background: 'radial-gradient(circle, rgba(205,122,58,0.2) 0%, transparent 70%)',
        borderRadius: '50%', animation: 'splash-float-a 10s ease-in-out infinite', pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute', bottom: '10%', right: '5%', width: 300, height: 300,
        background: 'radial-gradient(circle, rgba(139,92,246,0.15) 0%, transparent 70%)',
        borderRadius: '50%', animation: 'splash-float-b 12s ease-in-out infinite reverse', pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute', top: '50%', right: '25%', width: 200, height: 200,
        background: 'radial-gradient(circle, rgba(16,185,129,0.1) 0%, transparent 70%)',
        borderRadius: '50%', animation: 'splash-float-c 8s ease-in-out infinite', pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute', bottom: '35%', left: '25%', width: 160, height: 160,
        background: 'radial-gradient(circle, rgba(232,144,85,0.12) 0%, transparent 70%)',
        borderRadius: '50%', animation: 'splash-float-d 14s ease-in-out infinite reverse', pointerEvents: 'none',
      }} />

      {/* ★ 粒子系统 (20 个多彩粒子) */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
        {[...Array(20)].map((_, i) => (
          <div key={i} style={{
            position: 'absolute',
            width: `${2 + (i % 4)}px`, height: `${2 + (i % 4)}px`,
            borderRadius: '50%',
            background: ['#CD7A3A', '#8b5cf6', '#43e97b', '#E89055', '#1abc9c'][i % 5],
            left: `${(i * 17 + 3) % 100}%`,
            top: `${(i * 23 + 7) % 100}%`,
            opacity: 0,
            animation: `splash-particle ${4 + (i % 5)}s ease-in-out ${(i * 0.4) % 5}s infinite`,
            boxShadow: `0 0 ${4 + (i % 3)}px currentColor`,
          }} />
        ))}
      </div>

      {/* 主容器 */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative', zIndex: 'var(--z-base)' }} onClick={e => e.stopPropagation()}>
        
        {/* ─── Stage 1: LOGO 心跳脉冲 (增强版) ─── */}
        <div
          style={{
            position: 'relative',
            width: 160, height: 160,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            animation: 'splash-fade-in 0.6s ease-out both',
          }}
        >
          {/* 外层光晕环 */}
          <div style={{
            position: 'absolute', inset: -20,
            borderRadius: '50%',
            border: '1px solid rgba(205,122,58,0.2)',
            animation: 'splash-halo-outer 4s ease-in-out infinite',
          }} />
          {/* 心跳声波环 1 */}
          <div style={{
            position: 'absolute', inset: 0,
            border: '2px solid #CD7A3A',
            borderRadius: '50%',
            animation: 'splash-heartbeat 2.2s ease-out infinite',
          }} />
          {/* 心跳声波环 2 */}
          <div style={{
            position: 'absolute', inset: 0,
            border: '1.5px solid rgba(205,122,58,0.7)',
            borderRadius: '50%',
            animation: 'splash-heartbeat 2.2s ease-out infinite',
            animationDelay: '0.45s',
          }} />
          {/* 心跳声波环 3 */}
          <div style={{
            position: 'absolute', inset: 0,
            border: '1px solid rgba(205,122,58,0.4)',
            borderRadius: '50%',
            animation: 'splash-heartbeat 2.2s ease-out infinite',
            animationDelay: '0.9s',
          }} />
          {/* LOGO — BrandLogo 组件 */}
          <div style={{
            width: 92, height: 92,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            animation: 'splash-pulse 2.2s ease-in-out infinite',
            zIndex: 'var(--z-base)',
          }}>
            <BrandLogo size={92} glow />
          </div>
        </div>

        {/* ─── Stage 2: 品牌名 + 副标题 (增强层次) ─── */}
        <div
          style={{
            marginTop: 44, textAlign: 'center',
            animation: 'splash-rise 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0.5s both',
          }}
        >
          {/* 中文品牌名 */}
          <div style={{
            fontSize: 46, fontWeight: 800,
            letterSpacing: 14, color: '#f0f0f4',
            textShadow: '0 2px 32px rgba(205, 122, 58, 0.3), 0 0 80px rgba(205, 122, 58, 0.15)',
            fontFamily: '"Ma Shan Zheng", "ZCOOL XiaoWei", "Noto Serif SC", "Microsoft YaHei", "PingFang SC", cursive',
            fontStyle: 'italic',
            transform: 'skewX(-5deg)',
            WebkitFontSmoothing: 'antialiased',
          }}>
            岐枢智能体
          </div>
          {/* 英文副品牌名 */}
          <div style={{
            fontSize: 'var(--fs-md)', fontWeight: 700,
            letterSpacing: 10, color: '#CD7A3A',
            marginTop: 10,
            fontFamily: '"Orbitron", "Exo 2", "Syncopate", "Segoe UI", sans-serif',
            textTransform: 'uppercase',
            opacity: 0.95,
          }}>
            PulseFlow Studio
          </div>
          {/* 分隔装饰线 */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            gap: 12, margin: '16px 0',
          }}>
            <div style={{ width: 60, height: 1, background: 'linear-gradient(90deg, transparent, #CD7A3A)' }} />
            <div style={{
              width: 6, height: 6, borderRadius: '50%',
              background: '#CD7A3A',
              boxShadow: '0 0 16px #CD7A3A, 0 0 32px rgba(205,122,58,0.3)',
              animation: 'splash-dot-pulse 2s ease-in-out infinite',
            }} />
            <div style={{ width: 60, height: 1, background: 'linear-gradient(90deg, #CD7A3A, transparent)' }} />
          </div>
          {/* ★ 一句话品牌定位 (新增) */}
          <div style={{
            fontSize: 'var(--fs-md)', color: 'rgba(240,240,248,0.6)',
            letterSpacing: 2, marginTop: 4,
            fontWeight: 400,
          }}>
            越用越懂你的 AI 智能体平台 · 中医智慧 × 自进化引擎
          </div>
        </div>

        {/* ─── Stage 3: 能力标签 (更新数据 + 增强动画) ─── */}
        <div
          style={{
            display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center',
            maxWidth: 560, marginTop: 8,
            animation: 'splash-rise 0.8s cubic-bezier(0.16, 1, 0.3, 1) 1.0s both',
          }}
        >
          {CAPABILITY_TAGS.map((t, i) => (
            <div
              key={t.label}
              style={{
                fontSize: 'var(--fs-micro)', color: t.color,
                background: `${t.color}15`,
                border: `1px solid ${t.color}40`,
                padding: '5px 12px', borderRadius: 100,
                fontWeight: 600, letterSpacing: 0.5,
                animation: `splash-tag-pop 0.45s cubic-bezier(0.34, 1.56, 0.64, 1) ${1.2 + i * 0.07}s both`,
                transition: 'all 0.2s ease',
              }}
            >
              {t.label}
            </div>
          ))}
        </div>

        {/* ─── Stage 4: Slogan ─── */}
        <div
          style={{
            marginTop: 36, textAlign: 'center',
            animation: 'splash-rise 0.8s cubic-bezier(0.16, 1, 0.3, 1) 1.5s both',
          }}
        >
          <div style={{
            fontSize: 'var(--fs-lg)', color: '#CD7A3A',
            fontFamily: '"ZCOOL XiaoWei", "Ma Shan Zheng", "Noto Serif SC", "Microsoft YaHei", "PingFang SC", cursive',
            letterSpacing: 10, fontWeight: 600,
            opacity: 0.95,
          }}>
            望闻问切 · 因证施治
          </div>
          <div style={{
            fontSize: 'var(--fs-micro)', color: '#666670',
            letterSpacing: 5, marginTop: 10,
            fontFamily: '"Orbitron", "Segoe UI", monospace',
            textTransform: 'lowercase',
            opacity: 0.6,
          }}>
            evolving with you · self-improving AI agent platform
          </div>
        </div>

        {/* ─── Stage 5: 加载状态 (增强) ─── */}
        <div
          style={{
            marginTop: 44, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
            animation: 'splash-rise 0.8s cubic-bezier(0.16, 1, 0.3, 1) 1.9s both',
          }}
        >
          {/* 进度条 (渐变流动) */}
          <div style={{
            width: 220, height: 2.5,
            background: 'rgba(205, 122, 58, 0.12)',
            borderRadius: 2, overflow: 'hidden',
          }}>
            <div style={{
              width: '100%', height: '100%',
              background: 'linear-gradient(90deg, transparent 0%, #CD7A3A 40%, #8b5cf6 60%, #43e97b 80%, transparent 100%)',
              backgroundSize: '200% 100%',
              animation: 'splash-progress-flow 2s ease-out forwards',
            }} />
          </div>
          {/* 状态文字轮播 */}
          <div style={{
            fontSize: 'var(--fs-micro)', color: '#777780',
            fontFamily: 'monospace', letterSpacing: 2,
            display: 'inline-flex', alignItems: 'center', gap: 8,
          }}>
            <span style={{
              width: 7, height: 7, borderRadius: '50%',
              background: '#43e97b',
              boxShadow: '0 0 8px #43e97b',
              animation: 'splash-blink 1.2s ease-in-out infinite',
            }} />
            <SplashStatusText />
          </div>
          
          {/* ★ 跳过提示 (新增) */}
          {!skipped && (
            <div style={{
              fontSize: 'var(--fs-micro)', color: 'rgba(255,255,255,0.2)',
              marginTop: 16, letterSpacing: 1,
              animation: 'splash-fade-in 1s ease-out 2.5s both',
            }}>
              点击任意位置跳过 →
            </div>
          )}
        </div>
      </div>

      {/* ═══════════ 动画关键帧 ═══════════ */}
      <style>{`
        @keyframes splash-pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.06); }
        }
        @keyframes splash-heartbeat {
          0% { transform: scale(0.65); opacity: 0.9; }
          100% { transform: scale(2.8); opacity: 0; }
        }
        @keyframes splash-fade-in {
          from { opacity: 0; transform: scale(0.85); }
          to { opacity: 1; transform: scale(1); }
        }
        @keyframes splash-rise {
          from { opacity: 0; transform: translateY(22px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes splash-tag-pop {
          0% { opacity: 0; transform: scale(0.5) translateY(12px); }
          60% { transform: scale(1.06) translateY(-2px); }
          100% { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes splash-progress-flow {
          0% { transform: translateX(-100%); background-position: 0% 0%; }
          100% { transform: translateX(100%); background-position: 200% 0%; }
        }
        @keyframes splash-blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.25; }
        }
        @keyframes splash-float-a {
          0%, 100% { transform: translate(0, 0) scale(1); }
          33% { transform: translate(30px, -20px) scale(1.05); }
          66% { transform: translate(-15px, 15px) scale(0.95); }
        }
        @keyframes splash-float-b {
          0%, 100% { transform: translate(0, 0) scale(1); }
          33% { transform: translate(-25px, 15px) scale(1.04); }
          66% { transform: translate(20px, -10px) scale(0.97); }
        }
        @keyframes splash-float-c {
          0%, 100% { transform: translate(0, 0); }
          50% { transform: translate(15px, -25px); }
        }
        @keyframes splash-float-d {
          0%, 100% { transform: translate(0, 0); }
          50% { transform: translate(-20px, 20px); }
        }
        @keyframes splash-particle {
          0%, 100% { opacity: 0; transform: translateY(20px) scale(0); }
          15% { opacity: 0.8; }
          50% { opacity: 0.4; transform: translateY(-40px) scale(1); }
          85% { opacity: 0.2; transform: translateY(-70px) scale(0.6); }
        }
        @keyframes splash-grid-drift {
          0% { transform: translate(0, 0); }
          100% { transform: translate(60px, 60px); }
        }
        @keyframes splash-rotate {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        @keyframes splash-halo-outer {
          0%, 100% { opacity: 0.3; transform: scale(1); }
          50% { opacity: 0.6; transform: scale(1.05); }
        }
        @keyframes splash-dot-pulse {
          0%, 100% { box-shadow: 0 0 16px #CD7A3A, 0 0 32px rgba(205,122,58,0.3); }
          50% { box-shadow: 0 0 24px #CD7A3A, 0 0 48px rgba(205,122,58,0.5); }
        }
      `}</style>
    </div>
  );
};

/* 状态文字轮播: 更新为实际数据 */
const STATUS_LABELS = [
  '正在唤醒智能体核心...',
  '连接 8 个模型 Provider',
  '加载 141+ 工具生态',
  '初始化行业知识库',
  '同步工作记忆与进化规则',
  '准备就绪 · 就绪',
];

const SplashStatusText: React.FC = () => {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setIdx(i => (i + 1) % STATUS_LABELS.length), 550);
    return () => clearInterval(t);
  }, []);
  return (
    <span style={{
      animation: 'splash-status-swap 0.3s ease-out',
      display: 'inline-block', minWidth: 180, textAlign: 'left',
    }} key={idx}>
      {STATUS_LABELS[idx]}
    </span>
  );
};

export default Splash;
