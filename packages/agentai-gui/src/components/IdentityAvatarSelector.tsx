/**
 * IdentityAvatarSelector — 头像选择器 (2026-08-10 增强版)
 */
import React, { useState } from 'react';
import { Button } from 'antd';

interface Props {
  selected: string;
  onSelect: (avatar: string) => void;
  onNext: () => void;
}

const AVATARS = ['🧑‍💻', '👩‍🎨', '👨‍⚕️', '👩‍🏫', '🧑‍🔬', '👨‍💼', '👩‍💻', '🧑‍🎤', '🦸', '🥷', '🧙', '🧝', '🤖', '👻', '🎭', '🌟'];

export const IdentityAvatarSelector: React.FC<Props> = ({ selected, onSelect, onNext }) => {
  const [hovered, setHovered] = useState<string | null>(null);

  return (
    <div style={{ textAlign: 'center', animation: 'fadeIn 0.4s ease' }}>
      <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.5)', marginBottom: 8 }}>
        选择你的形象
      </div>
      <div style={{
        fontSize: 12, color: 'rgba(255,255,255,0.3)', marginBottom: 24,
      }}>
        这将作为你在 AI 世界中的身份标识
      </div>
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 12, marginBottom: 32,
      }}>
        {AVATARS.map(a => (
          <button
            key={a}
            onMouseEnter={() => setHovered(a)}
            onMouseLeave={() => setHovered(null)}
            onClick={() => onSelect(a)}
            style={{
              fontSize: selected === a ? 38 : (hovered === a ? 36 : 32),
              padding: selected === a ? 14 : (hovered === a ? 12 : 10),
              background: selected === a
                ? 'linear-gradient(135deg, rgba(99,102,241,0.35), rgba(139,92,246,0.25))'
                : hovered === a
                  ? 'rgba(99,102,241,0.15)'
                  : 'rgba(255,255,255,0.05)',
              border: `2px solid ${selected === a ? '#6366f1' : hovered === a ? 'rgba(99,102,241,0.5)' : 'rgba(255,255,255,0.1)'}`,
              borderRadius: 16, cursor: 'pointer',
              transition: 'all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)',
              transform: selected === a ? 'scale(1.08)' : hovered === a ? 'scale(1.04)' : 'scale(1)',
              boxShadow: selected === a
                ? '0 0 20px rgba(99,102,241,0.4), 0 4px 16px rgba(0,0,0,0.3)'
                : hovered === a
                  ? '0 4px 12px rgba(0,0,0,0.2)'
                  : 'none',
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            {/* 选中态光环 */}
            {selected === a && (
              <div style={{
                position: 'absolute', inset: -2,
                borderRadius: 17,
                border: '2px solid transparent',
                background: 'linear-gradient(135deg, #6366f1, #8b5cf6, #a78bfa) border-box',
                WebkitMask: 'linear-gradient(#fff 0 0) padding-box, linear-gradient(#fff 0 0)',
                WebkitMaskComposite: 'xor',
                maskComposite: 'exclude',
                animation: 'avatarGlow 2s ease-in-out infinite alternate',
              }} />
            )}
            <span style={{ position: 'relative', zIndex: 1 }}>{a}</span>
          </button>
        ))}
      </div>

      {/* 已选提示 */}
      {selected && (
        <div style={{
          fontSize: 13, color: 'rgba(255,255,255,0.7)', marginBottom: 20,
          padding: '8px 16px', borderRadius: 20,
          background: 'rgba(99,102,241,0.12)',
          border: '1px solid rgba(99,102,241,0.25)',
          display: 'inline-block',
          animation: 'fadeUp 0.3s ease-out',
        }}>
          ✨ 你选择了 <b>{selected}</b> 作为你的 AI 形象
        </div>
      )}

      <Button
        type="primary" size="large"
        onClick={onNext}
        style={{
          background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
          border: 'none', borderRadius: 12, padding: '0 48px', fontSize: 16,
          boxShadow: '0 4px 16px rgba(99,102,241,0.4)',
          transition: 'all 0.25s ease',
        }}
        onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-2px)'}
        onMouseLeave={e => e.currentTarget.style.transform = 'translateY(0)'}
      >
        继续 →
      </Button>

      <style>{`
        @keyframes avatarGlow {
          0% { opacity: 0.6; }
          100% { opacity: 1; }
        }
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>
    </div>
  );
};

export default IdentityAvatarSelector;
