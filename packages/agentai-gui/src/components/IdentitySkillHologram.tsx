/**
 * IdentitySkillHologram — 技能全息展示
 */
import React, { useState, useEffect } from 'react';
import { Button } from 'antd';
import { INDUSTRY_TEMPLATES, type IndustryTemplate } from '../services/IndustryTemplates';

interface Props {
  industry: IndustryTemplate;
  onContinue: () => void;
}

export const IdentitySkillHologram: React.FC<Props> = ({ industry, onContinue }) => {
  const [visibleSkills, setVisibleSkills] = useState<string[]>([]);
  const [scanning, setScanning] = useState(true);

  useEffect(() => {
    const skills = industry.requiredSkills;
    skills.forEach((skill, i) => {
      setTimeout(() => setVisibleSkills(prev => [...prev, skill]), i * 200);
    });
    setTimeout(() => setScanning(false), skills.length * 200 + 800);
  }, [industry]);

  return (
    <div style={{ animation: 'fadeIn 0.5s ease', textAlign: 'center' }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>{industry.icon}</div>
      <h2 style={{ color: 'var(--fg)', margin: '0 0 8px', fontSize: 'var(--fs-xl)', fontWeight: 700 }}>
        {industry.label} 身份激活中
      </h2>
      <p style={{ color: 'rgba(255,255,255,0.5)', margin: '0 0 32px', fontSize: 'var(--fs-md)' }}>
        正在加载行业专业技能和知识库...
      </p>

      {/* 全息扫描效果 */}
      <div style={{
        position: 'relative', padding: '24px 32px',
        background: 'rgba(99,102,241,0.1)',
        borderRadius: 'var(--radius-lg)', border: '1px solid rgba(99,102,241,0.3)',
        marginBottom: 32, overflow: 'hidden',
      }}>
        {/* 扫描线 */}
        {scanning && (
          <div style={{
            position: 'absolute', left: 0, right: 0, top: 0, height: 2,
            background: 'linear-gradient(90deg, transparent, #6366f1, transparent)',
            animation: 'holoScan 1.5s linear infinite',
          }} />
        )}
        <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 'var(--fs-sm)', marginBottom: 16, fontFamily: 'monospace' }}>
          {`> Loading industry skills for ${industry.label}...`}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
          {industry.requiredSkills.map((skill, i) => (
            <div
              key={skill}
              style={{
                padding: '6px 12px',
                background: visibleSkills.includes(skill)
                  ? 'rgba(16,185,129,0.2)'
                  : 'rgba(255,255,255,0.05)',
                border: `1px solid ${visibleSkills.includes(skill) ? 'var(--success)' : 'rgba(255,255,255,0.1)'}`,
                borderRadius: 'var(--radius-md)', color: visibleSkills.includes(skill) ? 'var(--success)' : 'rgba(255,255,255,0.4)',
                fontSize: 'var(--fs-md)', transition: 'all 0.3s ease',
                animation: visibleSkills.includes(skill) ? 'skillPop 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)' : 'none',
              }}
            >
              {visibleSkills.includes(skill) ? '✓' : '○'} {skill}
            </div>
          ))}
        </div>
      </div>

      {scanning ? (
        <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 'var(--fs-md)' }}>
          正在初始化行业引擎...
        </div>
      ) : (
        <Button
          type="primary" size="large"
          onClick={onContinue}
          style={{
            background: 'linear-gradient(135deg, #10b981, #06b6d4)',
            border: 'none', borderRadius: 'var(--radius-lg)', padding: '0 48px', fontSize: 'var(--fs-lg)',
          }}
        >
          激活身份 →
        </Button>
      )}

      <style>{`
        @keyframes holoScan {
          0% { top: 0; }
          100% { top: 100%; }
        }
        @keyframes skillPop {
          0% { transform: scale(0.8); opacity: 0; }
          100% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
};

export default IdentitySkillHologram;
