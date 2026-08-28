/**
 * ProfileBadge — 对话页行业徽章（可点击切换）
 */
import React from 'react';
import { Dropdown, Badge } from 'antd';
import { DownOutlined } from '@ant-design/icons';
import { useProfileStore } from '../store';
import { INDUSTRY_TEMPLATES } from '../services/IndustryTemplates';

interface Props {
  onIndustryChange?: (industryId: string, industryLabel: string) => void;
}

export const ProfileBadge: React.FC<Props> = ({ onIndustryChange }) => {
  const { profile, setProfile } = useProfileStore();
  const currentIndustry = INDUSTRY_TEMPLATES.find(t => t.id === profile?.industry) || INDUSTRY_TEMPLATES[0];

  const handleIndustryChange = (industryId: string) => {
    const newIndustry = INDUSTRY_TEMPLATES.find(t => t.id === industryId);
    if (!newIndustry || newIndustry.id === profile?.industry) return;

    const updatedProfile = {
      ...profile!,
      industry: industryId,
      industrySkills: newIndustry.requiredSkills,
    };
    setProfile(updatedProfile);
    localStorage.setItem('agentai.profile', JSON.stringify(updatedProfile));
    localStorage.setItem('agentai-industry', industryId);

    // 通知父组件（ChatView 会发送系统消息）
    onIndustryChange?.(industryId, newIndustry.label);
  };

  const menuItems = INDUSTRY_TEMPLATES.map(t => ({
    key: t.id,
    label: (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
        <span style={{ fontSize: 18 }}>{t.icon}</span>
        <span>{t.label}</span>
        {profile?.industry === t.id && <span style={{ marginLeft: 'auto', color: '#10b981' }}>✓</span>}
      </div>
    ),
  }));

  if (!profile?.name) return null;

  return (
    <Dropdown menu={{ items: menuItems }} trigger={['click']}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '4px 10px',
        background: 'rgba(255,255,255,0.05)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 20, cursor: 'pointer',
        transition: 'all 0.2s ease',
        userSelect: 'none',
      }}
        onMouseEnter={e => {
          (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.1)';
          (e.currentTarget as HTMLElement).style.borderColor = 'rgba(99,102,241,0.5)';
        }}
        onMouseLeave={e => {
          (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)';
          (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.1)';
        }}
      >
        <span style={{ fontSize: 16 }}>{profile.avatar || '👤'}</span>
        <span style={{ color: 'var(--fg-2)', fontSize: 12, maxWidth: 60, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {profile.name}
        </span>
        <span style={{ fontSize: 14 }}>{currentIndustry.icon}</span>
        <span style={{ color: 'var(--muted)', fontSize: 11 }}>{currentIndustry.label}</span>
        <DownOutlined style={{ fontSize: 10, color: 'var(--muted)' }} />
      </div>
    </Dropdown>
  );
};

export default ProfileBadge;
