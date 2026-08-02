/**
 * Splash — 启动欢迎页 v2 (PulseFlow)
 * 设计: 多阶段动画 + 品牌核心能力展示
 *   Stage 1 (0-0.8s): LOGO 心跳脉冲
 *   Stage 2 (0.8-1.6s): 品牌名 + 副标题淡入
 *   Stage 3 (1.6-2.4s): 能力标签浮动
 *   Stage 4 (2.4-3.2s): Slogan + 状态
 *   Stage 5 (3.2-3.6s): 整体淡出
 *
 * 品牌: 岐枢智能体平台 | PulseFlow
 *   - 岐枢: 岐黄之术 + 枢纽核心，中医智慧 × AI 智能体
 *   - PulseFlow: Pulse (脉动/状态感知) + Flow (流动/智能演进)
 * 理念: 望闻问切 · 因证施治 · 越用越懂你的 AI 智能体
 */
import React, { useEffect, useState } from 'react';

interface Props {
  onFinish?: () => void;
  duration?: number;          // 总停留时间 (默认 3600ms)
  minDuration?: number;       // 最少停留 (避免太快消失)
}

const CAPABILITY_TAGS = [
  { label: '5+ 模型', color: '#CD7A3A' },
  { label: '146+ 工具', color: '#43e97b' },
  { label: '多 Agent', color: '#4facfe' },
  { label: '自进化', color: '#f5576c' },
  { label: '医案传承', color: '#f093fb' },  // 品牌：任务快照 → 医案传承
  { label: '辨证施治', color: '#E89055' },  // 品牌：中医辨证 → 辨证施治
];

export const Splash: React.FC<Props> = ({ onFinish, duration = 3600, minDuration = 2400 }) => {
  const [visible, setVisible] = useState(true);
  const [fadeOut, setFadeOut] = useState(false);

  useEffect(() => {
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
  }, [duration, minDuration, onFinish]);

  if (!visible) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'radial-gradient(ellipse at center, #1f1f28 0%, #131318 70%, #0a0a0e 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        opacity: fadeOut ? 0 : 1,
        transition: 'opacity 0.5s cubic-bezier(0.4, 0, 0.2, 1)',
        overflow: 'hidden',
      }}
    >
      {/* 背景: 纯深色渐变 */}
      <div style={{
        position: 'absolute',
        inset: 0,
        background: 'linear-gradient(180deg, #1a1a20 0%, #131318 50%, #0d0d12 100%)',
        pointerEvents: 'none',
      }} />

      {/* 背景: 浮动光斑 */}
      <div style={{
        position: 'absolute',
        top: '20%', left: '15%', width: 300, height: 300,
        background: 'radial-gradient(circle, rgba(205,122,58,0.18) 0%, transparent 70%)',
        borderRadius: '50%',
        animation: 'pulseflow-float 8s ease-in-out infinite',
        pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute',
        bottom: '15%', right: '10%', width: 260, height: 260,
        background: 'radial-gradient(circle, rgba(232,144,85,0.14) 0%, transparent 70%)',
        borderRadius: '50%',
        animation: 'pulseflow-float 10s ease-in-out infinite reverse',
        pointerEvents: 'none',
      }} />

      {/* 主容器 */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative', zIndex: 2 }}>
        {/* ─── Stage 1: LOGO 心跳脉冲 ─── */}
        <div
          style={{
            position: 'relative',
            width: 140, height: 140,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            animation: 'pulseflow-fade-in 0.5s ease-out both',
          }}
        >
          {/* 心跳声波环 1 */}
          <div style={{
            position: 'absolute', inset: 0,
            border: '2px solid #CD7A3A',
            borderRadius: '50%',
            animation: 'pulseflow-heartbeat 2s ease-out infinite',
          }} />
          {/* 心跳声波环 2 */}
          <div style={{
            position: 'absolute', inset: 0,
            border: '1.5px solid #CD7A3A',
            borderRadius: '50%',
            animation: 'pulseflow-heartbeat 2s ease-out infinite',
            animationDelay: '0.4s',
          }} />
          {/* 心跳声波环 3 */}
          <div style={{
            position: 'absolute', inset: 0,
            border: '1px solid #CD7A3A',
            borderRadius: '50%',
            animation: 'pulseflow-heartbeat 2s ease-out infinite',
            animationDelay: '0.8s',
          }} />
          {/* LOGO 图标 - 使用品牌 logo.jpg */}
          <img
            src="./logo.jpg"
            alt="PulseFlow"
            style={{
              width: 84,
              height: 84,
              animation: 'pulseflow-pulse 2s ease-in-out infinite',
              zIndex: 2,
              borderRadius: 16,
              objectFit: 'cover',
              boxShadow: '0 6px 24px rgba(205, 122, 58, 0.5)',
            }}
          />
        </div>

        {/* ─── Stage 2: 品牌名 + 副标题 ─── */}
        <div
          style={{
            marginTop: 40, textAlign: 'center',
            animation: 'pulseflow-rise 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0.5s both',
          }}
        >
          {/* 中文品牌名 (大字) - 草书风格 */}
          <div style={{
            fontSize: 42, fontWeight: 700,
            letterSpacing: 12, color: '#f0f0f4',
            textShadow: '0 2px 24px rgba(205, 122, 58, 0.25), 0 0 60px rgba(205, 122, 58, 0.15)',
            fontFamily: '"Ma Shan Zheng", "ZCOOL XiaoWei", "Noto Serif SC", cursive',
            fontStyle: 'italic',
            transform: 'skewX(-5deg)',
            WebkitFontSmoothing: 'antialiased',
          }}>
            岐枢智能体
          </div>
          {/* 英文副品牌名 - 艺术字体 */}
          <div style={{
            fontSize: 13, fontWeight: 600,
            letterSpacing: 8, color: '#CD7A3A',
            marginTop: 8,
            fontFamily: '"Orbitron", "Exo 2", "Syncopate", sans-serif',
            textTransform: 'uppercase',
            opacity: 0.9,
          }}>
            PulseFlow
          </div>
          {/* 分隔符 + 装饰点 */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            gap: 14, margin: '14px 0',
          }}>
            <div style={{ width: 50, height: 1, background: 'linear-gradient(90deg, transparent, #CD7A3A)' }} />
            <div style={{
              width: 5, height: 5, borderRadius: '50%',
              background: '#CD7A3A',
              boxShadow: '0 0 12px #CD7A3A',
            }} />
            <div style={{ width: 50, height: 1, background: 'linear-gradient(90deg, #CD7A3A, transparent)' }} />
          </div>
        </div>

        {/* ─── Stage 3: 能力标签 ─── */}
        <div
          style={{
            display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center',
            maxWidth: 520, marginTop: 4,
            animation: 'pulseflow-rise 0.8s cubic-bezier(0.16, 1, 0.3, 1) 1.0s both',
          }}
        >
          {CAPABILITY_TAGS.map((t, i) => (
            <div
              key={t.label}
              style={{
                fontSize: 11, color: t.color,
                background: `${t.color}18`,
                border: `1px solid ${t.color}44`,
                padding: '4px 10px', borderRadius: 100,
                fontWeight: 500, letterSpacing: 0.5,
                animation: `pulseflow-tag-pop 0.4s ease-out ${1.2 + i * 0.08}s both`,
              }}
            >
              {t.label}
            </div>
          ))}
        </div>

        {/* ─── Stage 4: Slogan ─── */}
        <div
          style={{
            marginTop: 32, textAlign: 'center',
            animation: 'pulseflow-rise 0.8s cubic-bezier(0.16, 1, 0.3, 1) 1.4s both',
          }}
        >
          <div style={{
            fontSize: 16, color: '#CD7A3A',
            fontFamily: '"ZCOOL XiaoWei", "Ma Shan Zheng", "Noto Serif SC", cursive',
            letterSpacing: 8, fontWeight: 500,
            opacity: 0.95,
          }}>
            望闻问切 · 因证施治
          </div>
          <div style={{
            fontSize: 11, color: '#888892',
            letterSpacing: 4, marginTop: 8,
            fontFamily: '"Orbitron", sans-serif',
            textTransform: 'lowercase',
            opacity: 0.7,
          }}>
            evolving with you
          </div>
        </div>

        {/* ─── Stage 5: 加载状态 ─── */}
        <div
          style={{
            marginTop: 40, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
            animation: 'pulseflow-rise 0.8s cubic-bezier(0.16, 1, 0.3, 1) 1.8s both',
          }}
        >
          {/* 进度条 (呼吸效果) */}
          <div style={{
            width: 200, height: 2,
            background: 'rgba(205, 122, 58, 0.18)',
            borderRadius: 1, overflow: 'hidden',
          }}>
            <div style={{
              width: '100%', height: '100%',
              background: 'linear-gradient(90deg, transparent, #CD7A3A, transparent)',
              animation: 'pulseflow-progress 2.4s ease-out forwards',
            }} />
          </div>
          {/* 状态文字 (3 个状态轮播) */}
          <div style={{
            fontSize: 11, color: '#888892',
            fontFamily: 'monospace', letterSpacing: 1.5,
            display: 'inline-flex', alignItems: 'center', gap: 6,
          }}>
            <span style={{
              width: 6, height: 6, borderRadius: '50%',
              background: '#43e97b',
              animation: 'pulseflow-blink 1.2s ease-in-out infinite',
            }} />
            <SplashStatusText />
          </div>
        </div>
      </div>

      {/* 动画关键帧 */}
      <style>{`
        @keyframes pulseflow-pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.06); }
        }
        @keyframes pulseflow-heartbeat {
          0% { transform: scale(0.7); opacity: 0.9; }
          100% { transform: scale(2.6); opacity: 0; }
        }
        @keyframes pulseflow-fade-in {
          from { opacity: 0; transform: scale(0.7); }
          to { opacity: 1; transform: scale(1); }
        }
        @keyframes pulseflow-rise {
          from { opacity: 0; transform: translateY(18px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes pulseflow-tag-pop {
          0% { opacity: 0; transform: scale(0.6) translateY(8px); }
          60% { transform: scale(1.05) translateY(0); }
          100% { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes pulseflow-progress {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        @keyframes pulseflow-blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
        @keyframes pulseflow-float {
          0%, 100% { transform: translate(0, 0); }
          50% { transform: translate(20px, -20px); }
        }
      `}</style>
    </div>
  );
};

/* 状态文字轮播: 5 个状态, 每 600ms 切换 */
const STATUS_LABELS = [
  '正在唤醒智能体',
  '加载 5+ 模型路由',
  '同步 146+ 工具生态',
  '回放上次任务快照',
  '准备就绪 · 就绪',
];

const SplashStatusText: React.FC = () => {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setIdx(i => (i + 1) % STATUS_LABELS.length), 600);
    return () => clearInterval(t);
  }, []);
  return (
    <span style={{
      animation: 'pulseflow-status-swap 0.3s ease-out',
      display: 'inline-block', minWidth: 160, textAlign: 'left',
    }} key={idx}>
      {STATUS_LABELS[idx]}
    </span>
  );
};

export default Splash;
