/**
 * IdentityIndustryGrid — 行业卡片网格 (2026-08-10 增强版)
 */
import React, { useState } from 'react';
import { INDUSTRY_TEMPLATES, type IndustryTemplate } from '../services/IndustryTemplates';

interface Props {
  selected: string;
  onSelect: (id: string) => void;
}

export const IdentityIndustryGrid: React.FC<Props> = ({ selected, onSelect }) => {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  return (
    <div style={{ animation: 'fadeIn 0.4s ease' }}>
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <h2 style={{ color: '#fff', margin: '0 0 8px', fontSize: 22, fontWeight: 700 }}>
          选择你的行业身份
        </h2>
        <p style={{ color: 'rgba(255,255,255,0.5)', margin: 0, fontSize: 14 }}>
          AI 将针对你的行业优化回复风格和技能
        </p>
      </div>
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 12, marginBottom: 20,
      }}>
        {INDUSTRY_TEMPLATES.map((t, idx) => (
          <button
            key={t.id}
            onMouseEnter={() => setHoveredId(t.id)}
            onMouseLeave={() => setHoveredId(null)}
            onClick={() => onSelect(t.id)}
            style={{
              padding: '18px 14px',
              background: selected === t.id
                ? 'linear-gradient(135deg, rgba(99,102,241,0.35), rgba(139,92,246,0.25))'
                : hoveredId === t.id
                  ? 'linear-gradient(135deg, rgba(255,255,255,0.08), rgba(255,255,255,0.03))'
                  : 'rgba(255,255,255,0.05)',
              border: "2px solid " + (selected === t.id ? "#6366f1" : hoveredId === t.id ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.1)"),
              borderRadius: 18,
              cursor: 'pointer',
              transition: 'all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
              transform: selected === t.id ? 'scale(1.03) translateY(-3px)' : hoveredId === t.id ? 'scale(1.02) translateY(-2px)' : 'scale(1)',
              boxShadow: selected === t.id
                ? '0 8px 28px rgba(99,102,241,0.35), 0 0 0 1px rgba(99,102,241,0.15)'
                : hoveredId === t.id
                  ? '0 6px 20px rgba(0,0,0,0.25)'
                  : 'none',
              animation: "cardSlideIn 0.4s ease-out " + (idx * 0.05) + "s both",
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            {/* 顶部装饰线 */}
            {selected === t.id && (
              <div style={{
                position: 'absolute', top: 0, left: '20%', right: '20%', height: 2,
                background: "linear-gradient(90deg, transparent, #6366f1, #8b5cf6, #6366f1, transparent)",
                borderRadius: 1,
              }} />
            )}
            {/* 图标 — 带 hover 动画 */}
            <div style={{
              fontSize: selected === t.id ? 32 : (hoveredId === t.id ? 30 : 28),
              marginBottom: 10,
              transition: 'all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
              transform: hoveredId === t.id && !selected ? 'rotate(-8deg) scale(1.1)' : 'none',
              display: 'inline-block',
            }}>
              {t.icon}
            </div>
            <div style={{ color: '#fff', fontSize: 14, fontWeight: 600 }}>{t.label}</div>
            <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, marginTop: 4, lineHeight: 1.4 }}>
              {t.description.length > 22 ? t.description.slice(0, 22) + '...' : t.description}
            </div>
            {/* 技能数量标签 */}
            {t.requiredSkills?.length > 0 && (
              <div style={{
                marginTop: 8, padding: '2px 8px', borderRadius: 8,
                background: selected === t.id ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.06)',
                color: selected === t.id ? '#10b981' : 'rgba(255,255,255,0.4)',
                fontSize: 10, display: 'inline-block',
              }}>
                {t.requiredSkills.length} 个专业技能
              </div>
            )}
          </button>
        ))}
      </div>

      {/* 选择提示 */}
      {selected !== 'general' && (
        <div style={{
          padding: '14px 20px',
          background: 'linear-gradient(135deg, rgba(99,102,241,0.15), rgba(139,92,246,0.1))',
          borderRadius: 14, border: '1px solid rgba(99,102,241,0.3)',
          color: 'rgba(255,255,255,0.85)', fontSize: 13, textAlign: 'center',
          animation: 'fadeUp 0.35s ease-out',
        }}>
          ✅ 已选择 <b style={{ color: '#a78bfa' }}>{INDUSTRY_TEMPLATES.find(t => t.id === selected)?.label}</b>
          ，将激活 <b style={{ color: '#10b981' }}>{INDUSTRY_TEMPLATES.find(t => t.id === selected)?.requiredSkills.length || 0}</b> 个专业技能
        </div>
      )}

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes cardSlideIn {
          from { opacity: 0; transform: translateY(12px) scale(0.96); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
};

export default IdentityIndustryGrid;
