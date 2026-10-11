/**
 * IdentityInjectionAnimation — 身份注入动画
 */
import React, { useState, useEffect } from 'react';
import { INDUSTRY_TEMPLATES, type IndustryTemplate } from '../services/IndustryTemplates';

interface Props {
  avatar: string;
  name: string;
  industry: IndustryTemplate;
  onComplete: () => void;
}

const CHECK_ITEMS = [
  '行业知识已加载',
  '专业术语已配置',
  '快捷指令已就绪',
  '对话风格已优化',
  '知识库已激活',
];

export const IdentityInjectionAnimation: React.FC<Props> = ({ avatar, name, industry, onComplete }) => {
  const [checked, setChecked] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setChecked(c => {
        if (c >= CHECK_ITEMS.length - 1) {
          clearInterval(timer);
          setTimeout(onComplete, 600);
          return c;
        }
        return c + 1;
      });
    }, 400);
    return () => clearInterval(timer);
  }, [onComplete]);

  return (
    <div style={{ textAlign: 'center', animation: 'fadeIn 0.5s ease' }}>
      {/* 头像光晕 */}
      <div style={{
        position: 'relative', display: 'inline-block', marginBottom: 24,
      }}>
        <div style={{
          width: 80, height: 80, borderRadius: '50%',
          background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 40,
          animation: 'glowPulse 2s ease-in-out infinite',
        }}>
          {avatar}
        </div>
        <div style={{
          position: 'absolute', inset: -8, borderRadius: '50%',
          border: '2px solid rgba(99,102,241,0.5)',
          animation: 'ringExpand 2s ease-out infinite',
        }} />
      </div>

      <h2 style={{ color: 'var(--fg)', margin: '0 0 8px', fontSize: 'var(--fs-xl)', fontWeight: 700 }}>
        身份已激活！
      </h2>
      <div style={{ color: 'rgba(255,255,255,0.6)', marginBottom: 32, fontSize: 'var(--fs-md)' }}>
        <b style={{ color: 'var(--fg)' }}>{name}</b> · {industry.icon} {industry.label}
      </div>

      {/* 注入进度 */}
      <div style={{
        maxWidth: 280, margin: '0 auto 32px',
        background: 'rgba(255,255,255,0.05)',
        borderRadius: 12, padding: '16px 20px',
        border: '1px solid rgba(255,255,255,0.1)',
        textAlign: 'left',
      }}>
        {CHECK_ITEMS.map((item, i) => (
          <div
            key={item}
            style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '8px 0',
              borderBottom: i < CHECK_ITEMS.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none',
              color: i <= checked ? '#10b981' : 'rgba(255,255,255,0.3)',
              transition: 'all 0.3s ease',
              animation: i <= checked ? 'checkPop 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)' : 'none',
            }}
          >
            <span style={{ fontSize: 'var(--fs-lg)' }}>{i <= checked ? '✓' : '○'}</span>
            <span style={{ fontSize: 'var(--fs-md)' }}>{item}</span>
          </div>
        ))}
      </div>

      <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 'var(--fs-sm)' }}>
        正在同步到 AI 系统...
      </div>

      <style>{`
        @keyframes glowPulse {
          0%, 100% { box-shadow: 0 0 20px rgba(99,102,241,0.5); }
          50% { box-shadow: 0 0 40px rgba(99,102,241,0.8), 0 0 60px rgba(139,92,246,0.4); }
        }
        @keyframes ringExpand {
          0% { transform: scale(1); opacity: 0.8; }
          100% { transform: scale(1.5); opacity: 0; }
        }
        @keyframes checkPop {
          0% { transform: scale(0.9); opacity: 0; }
          100% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
};

export default IdentityInjectionAnimation;
