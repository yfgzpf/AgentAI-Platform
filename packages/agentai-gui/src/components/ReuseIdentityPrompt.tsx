/**
 * ReuseIdentityPrompt — 沿用身份确认弹窗
 * 品牌: PulseFlow
 * 设计: 卡片式身份选择 + 一键沿用, 避免每次重新输入
 *
 * 触发场景: 用户已 onboarding 过, 下次启动时
 *   - 默认沿用最近一个身份 (静默)
 *   - 显示此弹窗可切换/新增/重置
 *
 * 数据源:
 *   - agentai-user-profile (zustand persist 当前用户)
 *   - agentai.user.{name} (历史用户, 多个)
 *   - 由 getAllUserProfiles() 合并去重
 */
import React, { useMemo, useState } from 'react';
import { Modal, Button, Avatar, Tag, Space, Tooltip, Input, message } from 'antd';
import {
  UserOutlined, PlusOutlined, ReloadOutlined,
  CheckCircleFilled, ClockCircleOutlined,
  CrownOutlined, CodeOutlined, PictureOutlined,
  MessageOutlined, RocketOutlined, ShopOutlined,
  ReadOutlined, HomeOutlined, MedicineBoxOutlined,
  BankOutlined, AppstoreOutlined,
} from '@ant-design/icons';
import { INDUSTRY_TEMPLATES } from '../services/IndustryTemplates';
import type { UserProfile } from '../store';

interface ReuseIdentityPromptProps {
  open: boolean;
  profile: UserProfile | null;                          // 当前 profile
  allProfiles?: Array<UserProfile & { userId: string }>; // 所有历史 profile (可选, 默认从 localStorage 读)
  onReuse: (userName?: string) => void;                 // 沿用某个身份 (无参=沿用当前)
  onReset: () => void;                                  // 重新 onboarding
  onClose?: () => void;                                 // 关闭弹窗 (本场景一般不允许)
}

// 行业 ID → 中文名 + 配色
const INDUSTRY_META: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  general:      { label: '通用',   color: '#8b8b95', icon: <AppstoreOutlined /> },
  decoration:   { label: '装修',   color: '#CD7A3A', icon: <HomeOutlined /> },
  comic:        { label: '动漫',   color: '#f5576c', icon: <PictureOutlined /> },
  ecommerce:    { label: '电商',   color: '#43e97b', icon: <ShopOutlined /> },
  education:    { label: '教育',   color: '#4facfe', icon: <ReadOutlined /> },
  realestate:   { label: '房产',   color: '#fa709a', icon: <HomeOutlined /> },
  medical:      { label: '医疗',   color: '#f093fb', icon: <MedicineBoxOutlined /> },
  legal:        { label: '法律',   color: '#667eea', icon: <BankOutlined /> },
  developer:    { label: '开发者', color: '#00f2fe', icon: <CodeOutlined /> },
};

const USECASE_META: Record<string, { label: string; icon: React.ReactNode }> = {
  chat:  { label: '聊天', icon: <MessageOutlined /> },
  image: { label: '生图', icon: <PictureOutlined /> },
  code:  { label: '写代码', icon: <CodeOutlined /> },
  auto:  { label: '全自动', icon: <RocketOutlined /> },
};

// 从 localStorage 读取所有已知 profile
function getAllKnownProfiles(): Array<UserProfile & { userId: string }> {
  const profiles: Array<UserProfile & { userId: string }> = [];
  const seen = new Set<string>();
  try {
    // 1. zustand 持久化的当前用户
    const currentRaw = localStorage.getItem('agentai-user-profile');
    if (currentRaw) {
      const parsed = JSON.parse(currentRaw);
      const p = parsed?.state?.profile || parsed?.profile;
      if (p?.name) {
        profiles.push({ ...p, userId: p.name });
        seen.add(p.name);
      }
    }
    // 2. 历史用户 (agentai.user.{name})
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('agentai.user.')) {
        try {
          const raw = localStorage.getItem(key);
          if (raw) {
            const p = JSON.parse(raw);
            if (p?.name && !seen.has(p.name)) {
              profiles.push({ ...p, userId: p.name });
              seen.add(p.name);
            }
          }
        } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }
  // 按 onboardedAt 降序 (最新在前)
  return profiles.sort((a, b) => (b.onboardedAt || 0) - (a.onboardedAt || 0));
}

function formatTimestamp(ts?: number): string {
  if (!ts) return '从未';
  const diff = Date.now() - ts;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return new Date(ts).toLocaleDateString('zh-CN');
}

export const ReuseIdentityPrompt: React.FC<ReuseIdentityPromptProps> = ({
  open,
  profile,
  allProfiles: propAllProfiles,
  onReuse,
  onReset,
  onClose,
}) => {
  // 合并传入的 profile + 自动检测的历史 profile
  const allProfiles = useMemo(() => {
    if (propAllProfiles && propAllProfiles.length > 0) return propAllProfiles;
    const detected = getAllKnownProfiles();
    // 确保当前 profile 在最前
    if (profile?.name) {
      const idx = detected.findIndex(p => p.name === profile.name);
      if (idx > 0) {
        const [current] = detected.splice(idx, 1);
        detected.unshift(current);
      } else if (idx < 0) {
        detected.unshift({ ...profile, userId: profile.name });
      }
    }
    return detected;
  }, [propAllProfiles, profile]);

  const [selectedName, setSelectedName] = useState<string | null>(profile?.name || null);
  const [showNewInput, setShowNewInput] = useState(false);
  const [newName, setNewName] = useState('');

  const handleConfirm = () => {
    if (showNewInput) {
      // 新身份: 跳到 Onboarding (onReset 会显示)
      onReset();
      return;
    }
    if (!selectedName) {
      message.warning('请选择一个身份');
      return;
    }
    onReuse(selectedName === profile?.name ? undefined : selectedName);
  };

  return (
    <Modal
      open={open}
      footer={null}
      closable={!!onClose}
      onCancel={onClose}
      width={620}
      centered
      destroyOnClose
      maskStyle={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(8px)' }}
      styles={{
        body: { padding: 0 },
        content: {
          background: 'linear-gradient(135deg, #1a1a22 0%, #23232c 100%)',
          border: '1px solid #2a2a38',
          borderRadius: 16,
          overflow: 'hidden',
        },
      }}
      title={null}
    >
      {/* 头部: 品牌色渐变 + 欢迎语 */}
      <div style={{
        background: 'linear-gradient(135deg, rgba(205,122,58,0.18) 0%, rgba(232,144,85,0.08) 100%)',
        padding: '28px 32px 20px',
        borderBottom: '1px solid #2a2a38',
        position: 'relative',
        overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', top: -40, right: -40, width: 160, height: 160,
          background: 'radial-gradient(circle, rgba(205,122,58,0.25) 0%, transparent 70%)',
          borderRadius: '50%',
          pointerEvents: 'none',
        }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <CrownOutlined style={{ fontSize: 20, color: '#CD7A3A' }} />
          <span style={{ fontSize: 12, color: '#CD7A3A', letterSpacing: 2, fontWeight: 600 }}>
            PULSEFLOW
          </span>
        </div>
        <h2 style={{ margin: 0, color: '#f0f0f4', fontSize: 22, fontWeight: 700 }}>
          欢迎回来
        </h2>
        <p style={{ margin: '6px 0 0', color: '#888892', fontSize: 13 }}>
          {allProfiles.length > 1
            ? `我们记住了 ${allProfiles.length} 个身份, 选一个继续工作吧`
            : '选择沿用此身份, 或重新开始'}
        </p>
      </div>

      {/* 中部: 身份卡片列表 */}
      <div style={{ padding: '20px 32px', maxHeight: 380, overflowY: 'auto' }}>
        {!showNewInput ? (
          <Space direction="vertical" size={10} style={{ width: '100%' }}>
            {allProfiles.map((p) => {
              const industryMeta = INDUSTRY_META[p.industry || 'general']
                || { label: p.industry || '通用', color: '#888', icon: <AppstoreOutlined /> };
              const usecaseMeta = USECASE_META[p.useCase || 'chat']
                || { label: p.useCase, icon: <MessageOutlined /> };
              const isSelected = selectedName === p.name;
              const isCurrent = p.name === profile?.name;
              return (
                <div
                  key={p.userId}
                  onClick={() => setSelectedName(p.name)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 14,
                    padding: '12px 16px', borderRadius: 10,
                    background: isSelected ? 'rgba(205,122,58,0.10)' : '#16161c',
                    border: isSelected ? '1.5px solid #CD7A3A' : '1px solid #2a2a38',
                    cursor: 'pointer', transition: 'all 0.18s',
                    position: 'relative',
                  }}
                >
                  {/* 头像 */}
                  <Avatar
                    size={44}
                    style={{
                      background: `linear-gradient(135deg, ${industryMeta.color} 0%, ${industryMeta.color}88 100%)`,
                      color: '#fff', fontSize: 18, fontWeight: 700,
                      flexShrink: 0,
                    }}
                  >
                    {p.name.charAt(0).toUpperCase()}
                  </Avatar>
                  {/* 名称 + meta */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ color: '#f0f0f4', fontSize: 15, fontWeight: 600 }}>
                        {p.name}
                      </span>
                      {isCurrent && (
                        <Tag color="processing" style={{ margin: 0, fontSize: 10, padding: '0 6px' }}>
                          上次使用
                        </Tag>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <Tag
                        icon={industryMeta.icon}
                        style={{
                          margin: 0, fontSize: 11,
                          background: `${industryMeta.color}22`,
                          borderColor: `${industryMeta.color}44`,
                          color: industryMeta.color,
                        }}
                      >
                        {industryMeta.label}
                      </Tag>
                      <Tag
                        icon={usecaseMeta.icon}
                        style={{ margin: 0, fontSize: 11, background: 'transparent', borderColor: '#444', color: '#aaa' }}
                      >
                        {usecaseMeta.label}
                      </Tag>
                      <Tooltip title={p.onboardedAt ? new Date(p.onboardedAt).toLocaleString('zh-CN') : ''}>
                        <span style={{ color: '#666', fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                          <ClockCircleOutlined /> {formatTimestamp(p.onboardedAt)}
                        </span>
                      </Tooltip>
                    </div>
                  </div>
                  {/* 选中标记 */}
                  {isSelected && (
                    <CheckCircleFilled style={{ color: '#CD7A3A', fontSize: 20, flexShrink: 0 }} />
                  )}
                </div>
              );
            })}

            {/* 新建身份按钮 */}
            <div
              onClick={() => { setShowNewInput(true); setSelectedName(null); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 14,
                padding: '12px 16px', borderRadius: 10,
                background: 'transparent',
                border: '1px dashed #444',
                cursor: 'pointer', transition: 'all 0.18s',
                marginTop: 4,
              }}
            >
              <Avatar
                size={44}
                style={{ background: 'transparent', border: '1.5px dashed #666', color: '#888' }}
                icon={<PlusOutlined />}
              />
              <div style={{ flex: 1 }}>
                <div style={{ color: '#ccc', fontSize: 14, fontWeight: 500 }}>新建身份</div>
                <div style={{ color: '#666', fontSize: 11 }}>为其他人或场景配置</div>
              </div>
            </div>
          </Space>
        ) : (
          // 新建身份: 输入名称预览
          <div style={{ padding: '8px 0' }}>
            <div style={{ marginBottom: 12, color: '#ccc', fontSize: 13 }}>
              为新身份起个名字
            </div>
            <Input
              size="large"
              prefix={<UserOutlined />}
              placeholder="如: 张工 / Lisa / 老王"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onPressEnter={handleConfirm}
              autoFocus
              style={{ marginBottom: 16 }}
            />
            <div style={{ color: '#888', fontSize: 12, lineHeight: 1.6 }}>
              接下来会引导你选择: <strong style={{ color: '#CD7A3A' }}>行业 / 用例 / 技能</strong> 等
              <br />
              完成的所有选择都会被记忆, 下次可一键沿用
            </div>
          </div>
        )}
      </div>

      {/* 底部: 操作按钮 */}
      <div style={{
        padding: '16px 32px 24px',
        borderTop: '1px solid #2a2a38',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
      }}>
        <Button
          icon={<ReloadOutlined />}
          onClick={() => {
            if (showNewInput) {
              setShowNewInput(false);
              setNewName('');
            } else {
              // 强制重置当前 profile (不走 Onboarding)
              onReuse(undefined);
            }
          }}
          style={{ background: 'transparent', borderColor: '#444', color: '#aaa' }}
        >
          {showNewInput ? '取消' : '刷新当前身份'}
        </Button>
        <Button
          type="primary"
          size="large"
          onClick={handleConfirm}
          style={{
            background: 'linear-gradient(135deg, #CD7A3A 0%, #E89055 100%)',
            borderColor: 'transparent',
            minWidth: 160,
            fontWeight: 600,
          }}
        >
          {showNewInput ? '开始配置' : '沿用身份 →'}
        </Button>
      </div>
    </Modal>
  );
};

export default ReuseIdentityPrompt;
