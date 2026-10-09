/**
 * WelcomePanel — 空对话欢迎页
 * =================================================================
 * 展示行业专属欢迎语、能力统计、快捷入口、背景粒子动画
 * 提取自 ChatView.tsx，保持逻辑和样式完全一致
 */

import React from 'react';
import { useProfileStore } from '../store';

interface WelcomePanelProps {
  handleSend: (prompt: string) => void;
  composerRef: React.RefObject<any>;
  systemInfo: string;
}

export const WelcomePanel: React.FC<WelcomePanelProps> = ({
  handleSend,
  composerRef,
  systemInfo,
}) => {
  const zustandProfile = useProfileStore(state => state.profile);

  let extraProfile: any = null;
  try { const raw = localStorage.getItem('agentai.profile'); if (raw) extraProfile = JSON.parse(raw); } catch { /* ignore */ }
  const currentIndustry = zustandProfile?.industry || extraProfile?.industry || 'general';

  // 行业徽章主题色 (与后端 industry-engine.ts 同步)
  const INDUSTRY_BADGE_THEME: Record<string, { color: string; icon: string; bgColor: string; label: string }> = {
    decoration: { color: '#e67e22', icon: '🔨', bgColor: 'rgba(230,126,34,0.12)', label: '装修建材' },
    real_estate: { color: '#2ecc71', icon: '🏠', bgColor: 'rgba(46,204,113,0.12)', label: '房地产' },
    ecommerce: { color: '#e74c3c', icon: '🛒', bgColor: 'rgba(231,76,60,0.12)', label: '电商营销' },
    education: { color: '#3498db', icon: '📚', bgColor: 'rgba(52,152,219,0.12)', label: '教育' },
    developer: { color: '#9b59b6', icon: '💻', bgColor: 'rgba(155,89,182,0.12)', label: '开发者' },
    comic: { color: '#f39c12', icon: '🎬', bgColor: 'rgba(243,156,18,0.12)', label: '漫剧创作' },
    medical: { color: '#1abc9c', icon: '🏥', bgColor: 'rgba(26,188,156,0.12)', label: '中医问诊' },
    legal: { color: '#34495e', icon: '⚖️', bgColor: 'rgba(52,73,94,0.12)', label: '法律' },
    manufacturing: { color: '#e67e22', icon: '🏭', bgColor: 'rgba(230,126,34,0.12)', label: '制造业' },
    general: { color: 'var(--muted)', icon: '💬', bgColor: 'transparent', label: '通用' },
  };

  // 行业专属欢迎语
  const INDUSTRY_WELCOME: Record<string, { title: string; subtitle: string }> = {
    decoration: { title: '装修建材智能助手', subtitle: '快速报价 · 材料算量 · 效果图生成 · 施工排期' },
    real_estate: { title: '房地产智能助手', subtitle: '楼盘分析 · 客户管理 · 营销方案 · 市场洞察' },
    ecommerce: { title: '电商营销智能助手', subtitle: '数据分析 · 商品文案 · 营销推广 · 库存管理' },
    education: { title: '教育智能助手', subtitle: '教案生成 · 试卷出题 · 成绩分析 · 课程大纲' },
    developer: { title: '开发者智能助手', subtitle: '代码审查 · 架构分析 · Bug 修复 · 性能优化' },
    comic: { title: '漫剧创作智能助手', subtitle: '角色设计 · 分镜脚本 · 场景插画 · 剧情编排' },
    medical: { title: '中医问诊智能助手', subtitle: '舌诊辨证 · 经方检索 · 养生方案 · 医案参考' },
    legal: { title: '法律智能助手', subtitle: '合同审查 · 案例检索 · 法条解读 · 风险评估' },
    manufacturing: { title: '制造业智能助手', subtitle: '生产排程 · 质量管控 · 供应链优化 · 设备维护' },
    general: { title: '有什么可以帮你的？', subtitle: (systemInfo || 'PulseFlow · 岐黄') + ' · 10+ 免费模型 · 越用越懂你' },
  };

  // 行业快捷指令: 根据用户选择的行业返回对应的快捷操作
  const getIndustryQuickActions = (industry: string) => {
    const INDUSTRY_ACTIONS: Record<string, Array<{ label: string; prompt: string }>> = {
      decoration: [
        { label: '📋 快速报价', prompt: '帮我做一份装修报价单，我告诉你户型和面积' },
        { label: '📐 材料算量', prompt: '帮我计算装修材料用量' },
        { label: '🎨 效果图参考', prompt: '帮我生成一张装修效果图' },
        { label: '📅 施工排期', prompt: '帮我制定一份施工进度计划表' },
        { label: '📄 方案书', prompt: '帮我生成一份客户装修方案书' },
        { label: '🏗️ 施工规范', prompt: '查询装修施工验收标准' },
      ],
      ecommerce: [
        { label: '📊 数据分析', prompt: '帮我分析店铺数据表现' },
        { label: '📝 商品文案', prompt: '帮我写一段商品详情文案' },
        { label: '🎯 营销方案', prompt: '帮我制定一个营销推广方案' },
        { label: '📦 库存管理', prompt: '帮我做一份库存盘点表' },
      ],
      education: [
        { label: '📚 教案生成', prompt: '帮我写一份教学教案' },
        { label: '📝 试卷出题', prompt: '帮我出一套考试试卷' },
        { label: '📊 成绩分析', prompt: '帮我分析学生成绩数据' },
        { label: '📋 课程大纲', prompt: '帮我制定一份课程大纲' },
      ],
      developer: [
        { label: '🔍 审查代码', prompt: '审查当前项目代码质量' },
        { label: '🏗️ 项目架构', prompt: '帮我分析这个项目的架构' },
        { label: '🐛 修复 Bug', prompt: '帮我排查和修复这个问题' },
        { label: '⚡ 性能优化', prompt: '帮我分析和优化性能瓶颈' },
      ],
      medical: [
        { label: '👅 舌诊拍照', prompt: '我想做中医舌诊，请帮我分析舌象 (请先拍摄或上传舌象照片)' },
        { label: '🔍 开始辨证', prompt: '我最近感觉不舒服，想做个中医辨证问诊' },
        { label: '🌿 查药材', prompt: '查询一味中药材的性味归经和功效' },
        { label: '📋 经方检索', prompt: '检索《伤寒论》中关于这个症状的经典条文和方剂' },
        { label: '🧘 养生方案', prompt: '根据我的体质制定一个中医养生调理方案' },
        { label: '📖 医案参考', prompt: '查找类似症状的历史名医医案作为参考' },
      ],
      comic: [
        { label: '🎨 角色设计', prompt: '帮我设计一个漫画角色' },
        { label: '📝 分镜脚本', prompt: '帮我写一页漫画分镜脚本' },
        { label: '🏙️ 场景插画', prompt: '帮我描述一张场景插画的构图和光影' },
        { label: '📖 剧情编排', prompt: '帮我构思一章漫画剧情大纲' },
      ],
      legal: [
        { label: '📄 合同审查', prompt: '帮我审查这份合同条款，指出风险点' },
        { label: '🔍 案例检索', prompt: '查找类似法律案例的判决要点' },
        { label: '📚 法条解读', prompt: '帮我解读这条法律条文' },
        { label: '⚠️ 风险评估', prompt: '评估这个法律问题的风险等级' },
      ],
      manufacturing: [
        { label: '📅 生产排程', prompt: '帮我做一份生产排程计划表' },
        { label: '📊 质量管控', prompt: '帮我分析这个质量问题产生原因' },
        { label: '🚚 供应链优化', prompt: '帮我优化供应链库存和配送' },
        { label: '🔧 设备维护', prompt: '制定一份设备定期维护保养计划' },
      ],
      general: [],
    };
    return INDUSTRY_ACTIONS[industry] || [];
  };

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', height: '100%', padding: '60px 40px 40px',
      textAlign: 'center', position: 'relative',
      overflowY: 'auto',
    }}>
      {/* ★ 动态背景粒子 (2026-08-10 增强) */}
      <div className="welcome-bg-particles">
        {[...Array(12)].map((_, i) => (
          <div
            key={i}
            className="welcome-particle"
            style={{
              left: `${8 + (i * 7.5) % 85}%`,
              bottom: `${10 + (i * 13) % 60}%`,
              animationDelay: `${i * 0.6}s`,
              animationDuration: `${6 + (i % 4)}s`,
              width: `${3 + (i % 3) * 2}px`,
              height: `${3 + (i % 3) * 2}px`,
              background: i % 3 === 0 ? 'var(--accent)' : i % 3 === 1 ? '#E89055' : '#1abc9c',
            }}
          />
        ))}
      </div>

      {/* ★ Logo — 带浮动呼吸光晕动画 */}
      <div className="welcome-logo" style={{ marginBottom: 20, position: 'relative', zIndex: 'var(--z-base)' }}>
        <div className="welcome-logo-glow">
          <svg width="72" height="72" viewBox="0 0 64 64">
            <defs>
              <linearGradient id="chat-logo" x1="0%" y1="100%" x2="0%" y2="0%">
                <stop offset="0%" stopColor="#CD7A3A" stopOpacity="0.4"/>
                <stop offset="50%" stopColor="#CD7A3A" stopOpacity="0.7"/>
                <stop offset="100%" stopColor="#E89055"/>
              </linearGradient>
              <filter id="logoGlowFilter">
                <feGaussianBlur stdDeviation="2" result="blur"/>
                <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
              </filter>
            </defs>
            <rect width="64" height="64" rx="14" fill="#232328"/>
            <path d="M32 10 L50 46 L42 46 L32 26 L22 46 L14 46 Z" fill="url(#chat-logo)" filter="url(#logoGlowFilter)"/>
            <path d="M32 24 L40 44 L32 38 L24 44 Z" fill="#CD7A3A"/>
            <circle cx="32" cy="14" r="3" fill="#E89055"/>
          </svg>
        </div>
      </div>

      {/* 行业徽章 — 带脉冲动画 */}
      {currentIndustry && currentIndustry !== 'general' && (
        <div className="industry-badge-pulse" style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '4px 14px', borderRadius: 20,
          fontSize: 'var(--ui-font-size)', fontWeight: 600, marginBottom: 16,
          background: INDUSTRY_BADGE_THEME[currentIndustry]?.bgColor || 'rgba(255,255,255,0.06)',
          color: INDUSTRY_BADGE_THEME[currentIndustry]?.color || 'var(--fg-2)',
          border: `1px solid ${INDUSTRY_BADGE_THEME[currentIndustry]?.color || 'var(--border)'}60`,
          position: 'relative', zIndex: 'var(--z-base)',
        }}>
          <span style={{ fontSize: 16 }}>{INDUSTRY_BADGE_THEME[currentIndustry]?.icon || '🔧'}</span>
          <span>{INDUSTRY_BADGE_THEME[currentIndustry]?.label || currentIndustry}</span>
        </div>
      )}

      {/* ★ 标题 — 行业专属欢迎语 */}
      <div className="welcome-title" style={{
        fontSize: 24, fontWeight: 800, marginBottom: 6, lineHeight: 1.3,
        position: 'relative', zIndex: 'var(--z-base)',
      }}>
        {INDUSTRY_WELCOME[currentIndustry]?.title || '有什么可以帮你的？'}
      </div>

      {/* ★ 次标题 — 行业专属能力描述 */}
      <div className="welcome-subtitle" style={{
        fontSize: 12, color: 'var(--muted-2)', marginBottom: 20,
        position: 'relative', zIndex: 'var(--z-base)',
      }}>
        {INDUSTRY_WELCOME[currentIndustry]?.subtitle || (systemInfo || 'PulseFlow · 岐黄') + ' · 10+ 免费模型 · 越用越懂你'}
      </div>

      {/* ★ 能力数据展示区 — 震撼数字 (2026-08-10 新增) */}
      <div className="welcome-stats" style={{ position: 'relative', zIndex: 'var(--z-base)' }}>
        {[
          { num: '141+', label: 'AI 工具' },
          { num: '8', label: '模型 Provider' },
          { num: '1M', label: '上下文窗口' },
          { num: '9', label: '行业模板' },
        ].map(stat => (
          <div key={stat.label} className="welcome-stat-item">
            <div className="welcome-stat-number">{stat.num}</div>
            <div className="welcome-stat-label">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* ★ Demo 卡片 — 通用快捷入口 (非行业模式时显示) */}
      {currentIndustry === 'general' && (
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10, maxWidth: 460, width: '100%',
          position: 'relative', zIndex: 'var(--z-base)',
        }}>
          {[
            { icon: '📖', label: '读懂项目', prompt: '帮我读一下当前项目的 README，总结这个项目是做什么的', color: '#3B82F6' },
            { icon: '🎨', label: '画一张图', prompt: '画一张赛博朋克风格的猫，霓虹灯光，高质量', color: '#EC4899' },
            { icon: '🔍', label: '搜索最新', prompt: '搜索最新的 AI Agent 开源框架，对比它们的优缺点', color: '#10B981' },
            { icon: '🤖', label: '智能体协作', prompt: '启动一个子智能体帮我分析代码质量并生成优化建议', color: '#8B5CF6' },
          ].map(demo => (
            <button
              key={demo.label}
              onClick={() => handleSend(demo.prompt)}
              className="demo-card"
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 5,
                padding: '12px 16px', borderRadius: 10, fontSize: 12,
                background: 'var(--panel)', border: '1px solid var(--border)',
                color: 'var(--fg-2)', cursor: 'pointer', textAlign: 'left',
                transition: 'all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)',
                ['--demo-color' as any]: demo.color,
              }}
            >
              <span className="demo-icon" style={{ fontSize: 22 }}>{demo.icon}</span>
              <span style={{ fontWeight: 700, color: 'var(--fg)', fontSize: 13 }}>{demo.label}</span>
              <span style={{ fontSize: 'var(--tool-font-size)', color: 'var(--muted-2)', lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                {demo.prompt}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* 行业快捷指令 — 增强胶囊样式 */}
      {getIndustryQuickActions(currentIndustry).length > 0 && (
        <div style={{ marginTop: 18, display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', maxWidth: 520, position: 'relative', zIndex: 'var(--z-base)' }}>
          {getIndustryQuickActions(currentIndustry).slice(0, 6).map(action => (
            <button
              key={action.label}
              onClick={() => handleSend(action.prompt)}
              className="welcome-action-chip"
              style={{
                padding: '5px 14px',
                background: 'transparent', border: '1px solid var(--border)',
                color: 'var(--muted-2)', cursor: 'pointer', fontSize: 12,
                borderRadius: 20,
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default WelcomePanel;
