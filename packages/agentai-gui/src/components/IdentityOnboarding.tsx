/**
 * IdentityOnboarding — 新颖身份设置入口
 * ----------------------------------------------------
 * 首次进入时展示，二次进入自动跳过
 * 单页流程：头像选择 → 名字输入 → 行业选择 → 完成
 */
import React, { useState, useEffect } from 'react';
import { Button, Input, Progress } from 'antd';
import { useProfileStore, type UserProfile } from '../store';
import { INDUSTRY_TEMPLATES, type IndustryTemplate } from '../services/IndustryTemplates';
import IdentityAvatarSelector from './IdentityAvatarSelector';
import IdentityIndustryGrid from './IdentityIndustryGrid';
import IdentitySkillHologram from './IdentitySkillHologram';
import IdentityInjectionAnimation from './IdentityInjectionAnimation';

const AVATARS = ['🧑‍💻', '👩‍🎨', '👨‍⚕️', '👩‍🏫', '🧑‍🔬', '👨‍💼', '👩‍💻', '🧑‍🎤', '🦸', '🥷'];
const STEPS = ['avatar', 'name', 'industry', 'hologram', 'inject', 'done'] as const;
type Step = typeof STEPS[number];

export const IdentityOnboarding: React.FC<{ onDone?: () => void }> = ({ onDone }) => {
  const { setProfile } = useProfileStore();
  const [step, setStep] = useState<Step>('avatar');
  const [avatar, setAvatar] = useState('🧑‍💻');
  const [name, setName] = useState('');
  const [industry, setIndustry] = useState<string>('general');
  const [progress, setProgress] = useState(0);

  // 进度条动画
  useEffect(() => {
    const timer = setInterval(() => {
      setProgress(p => Math.min(p + 2, 100));
    }, 50);
    return () => clearInterval(timer);
  }, [step]);

  const getCurrentIndustry = () => INDUSTRY_TEMPLATES.find(t => t.id === industry) || INDUSTRY_TEMPLATES[0];

  const handleIndustrySelect = (id: string) => {
    setIndustry(id);
    setTimeout(() => setStep('hologram'), 300);
  };

  const handleInjectComplete = () => {
    const profile: UserProfile = {
      name: name.trim() || '用户',
      industry,
      avatar,
      onboardedAt: Date.now(),
      language: 'zh',
      industrySkills: getCurrentIndustry().requiredSkills,
    };
    setProfile(profile);
    localStorage.setItem('agentai.profile', JSON.stringify(profile));
    localStorage.setItem('agentai-industry', industry);
    localStorage.setItem('agentai.user.' + profile.name, JSON.stringify(profile));
    sessionStorage.setItem('agentai.onboarded', '1');
    setTimeout(() => onDone?.(), 500);
  };

  const skipOnboarding = () => {
    const profile: UserProfile = {
      name: '用户',
      industry: 'general',
      avatar: '👤',
      onboardedAt: Date.now(),
      language: 'zh',
      industrySkills: [],
    };
    setProfile(profile);
    localStorage.setItem('agentai.profile', JSON.stringify(profile));
    sessionStorage.setItem('agentai.onboarded', '1');
    onDone?.();
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 'var(--z-dragging)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(135deg, #0f0f1a 0%, #1a1a2e 50%, #16213e 100%)',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    }}>
      {/* 背景光晕 */}
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
        {[...Array(6)].map((_, i) => (
          <div key={i} style={{
            position: 'absolute',
            width: 300 + i * 100, height: 300 + i * 100,
            borderRadius: '50%',
            background: `radial-gradient(circle, rgba(99,102,241,${0.05 - i * 0.005}) 0%, transparent 70%)`,
            top: '50%', left: '50%',
            transform: 'translate(-50%, -50%)',
            animation: `pulse ${3 + i * 0.5}s ease-in-out infinite`,
          }} />
        ))}
      </div>

      {/* 主卡片 */}
      <div style={{
        position: 'relative', width: 480, maxWidth: '90vw',
        background: 'rgba(255,255,255,0.03)',
        backdropFilter: 'blur(20px)',
        borderRadius: 24, border: '1px solid rgba(255,255,255,0.1)',
        boxShadow: '0 25px 50px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05) inset',
        padding: '40px',
        animation: 'cardSlideIn 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)',
      }}>
        {/* 进度条 */}
        {step !== 'done' && step !== 'inject' && (
          <div style={{ marginBottom: 24 }}>
            <Progress
              percent={((STEP_ORDER.indexOf(step) + 1) / STEP_ORDER.length) * 100}
              showInfo={false}
              strokeColor={{ '0%': '#6366f1', '100%': '#8b5cf6' }}
              trailColor='rgba(255,255,255,0.1)'
              size={['100%', 4]}
            />
          </div>
        )}

        {/* 步骤内容 */}
        <div style={{ minHeight: 320 }}>
          {step === 'avatar' && (
            <IdentityAvatarSelector
              selected={avatar}
              onSelect={setAvatar}
              onNext={() => setStep('name')}
            />
          )}
          {step === 'name' && (
            <div style={{ textAlign: 'center', animation: 'fadeIn 0.4s ease' }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>{avatar}</div>
              <h2 style={{ color: '#fff', margin: '0 0 8px', fontSize: 'var(--fs-xl)', fontWeight: 700 }}>
                你好！给我起个名字吧
              </h2>
              <p style={{ color: 'rgba(255,255,255,0.5)', margin: '0 0 32px', fontSize: 'var(--fs-md)' }}>
                这是你与 AI 对话的身份标识
              </p>
              <Input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="输入你的名字..."
                size="large"
                autoFocus
                style={{
                  maxWidth: 280, margin: '0 auto 24px', display: 'block',
                  background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)',
                  color: '#fff', fontSize: 'var(--fs-lg)',
                }}
                onPressEnter={() => name.trim() && setStep('industry')}
              />
              <Button
                type="primary" size="large"
                onClick={() => name.trim() && setStep('industry')}
                disabled={!name.trim()}
                style={{
                  background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                  border: 'none', borderRadius: 12, padding: '0 40px', fontSize: 'var(--fs-lg)',
                }}
              >
                继续
              </Button>
            </div>
          )}
          {step === 'industry' && (
            <IdentityIndustryGrid
              selected={industry}
              onSelect={handleIndustrySelect}
            />
          )}
          {step === 'hologram' && (
            <IdentitySkillHologram
              industry={getCurrentIndustry()}
              onContinue={handleInjectComplete}
            />
          )}
          {step === 'inject' && (
            <IdentityInjectionAnimation
              avatar={avatar}
              name={name.trim() || '用户'}
              industry={getCurrentIndustry()}
              onComplete={handleInjectComplete}
            />
          )}
          {step === 'done' && (
            <div style={{ textAlign: 'center', animation: 'fadeIn 0.5s ease' }}>
              <div style={{ fontSize: 64, marginBottom: 16 }}>{avatar}</div>
              <h2 style={{ color: 'var(--fg)', margin: '0 0 12px', fontSize: 'var(--fs-hero)', fontWeight: 700 }}>
                欢迎回来，{name.trim() || '用户'}！
              </h2>
              <p style={{ color: 'rgba(255,255,255,0.6)', margin: '0 0 32px', fontSize: 'var(--fs-md)' }}>
                我是你的 AI 伙伴，已准备好为你服务
              </p>
              <Button
                type="primary" size="large"
                onClick={() => setStep('done')}
                style={{
                  background: 'linear-gradient(135deg, #10b981, #06b6d4)',
                  border: 'none', borderRadius: 12, padding: '0 48px', fontSize: 'var(--fs-lg)',
                }}
              >
                开始对话 →
              </Button>
            </div>
          )}
        </div>

        {/* 跳过按钮 */}
        {step !== 'done' && step !== 'inject' && (
          <button
            onClick={skipOnboarding}
            style={{
              position: 'absolute', top: 16, right: 16,
              background: 'none', border: 'none',
              color: 'rgba(255,255,255,0.4)', cursor: 'pointer',
              fontSize: 'var(--fs-sm)', padding: '4px 8px', borderRadius: 6,
            }}
          >
            跳过设置
          </button>
        )}
      </div>

      <style>{`
        @keyframes cardSlideIn {
          from { opacity: 0; transform: translateY(30px) scale(0.95); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes pulse {
          0%, 100% { transform: translate(-50%, -50%) scale(1); opacity: 0.5; }
          50% { transform: translate(-50%, -50%) scale(1.1); opacity: 0.8; }
        }
      `}</style>
    </div>
  );
};

const STEP_ORDER = ['avatar', 'name', 'industry', 'hologram', 'inject', 'done'];
