/**
 * WelcomePanel — 欢迎页 (2026-10-10 v3 全面优化)
 * ----------------------------------------------------------------
 * 设计参考: ChatGPT / Claude / Linear — 大量留白, 只保留核心元素
 *
 * 结构: Logo → 标题 → 副标题 → 4 个快捷入口 → 脚注
 * 布局: 占满父容器剩余空间并垂直居中 (父容器负责 flex, 本组件不写 height:100%)
 * 文案: 去掉"AI/智能体"式表达, 用具体任务动词, 标题跟随行业
 */
import React from 'react';
import { BrandLogo } from './BrandLogo';
import { useProfileStore } from '../store';

interface WelcomePanelProps {
  handleSend: (prompt: string) => void;
}

/** 行业标题 */
const INDUSTRY_TITLE: Record<string, string> = {
  decoration: '装修建材助手',
  real_estate: '房地产助手',
  ecommerce: '电商营销助手',
  education: '教育助手',
  developer: '开发者助手',
  comic: '漫剧创作助手',
  medical: '中医问诊助手',
  legal: '法律助手',
  manufacturing: '制造业助手',
  general: '有什么可以帮你？',
};

/** 行业副标题 — 一句话说清能做什么 */
const INDUSTRY_SUBTITLE: Record<string, string> = {
  decoration: '报价 · 算量 · 效果图 · 施工排期',
  real_estate: '房源分析 · 估价 · 话术 · 方案',
  ecommerce: '数据分析 · 商品文案 · 营销 · 库存',
  education: '教案 · 出题 · 成绩分析 · 课程大纲',
  developer: '读代码 · 查问题 · 改 Bug · 做优化',
  comic: '角色 · 分镜 · 场景 · 剧情编排',
  medical: '舌诊 · 辨证 · 经方 · 调理方案',
  legal: '合同审查 · 案例检索 · 法条解读',
  manufacturing: '排程 · 质量 · 供应链 · 设备维护',
  general: '直接说需求，或从下面选一个开始',
};

/** 行业快捷入口 (4 个) — 文案用"动词 + 对象", 控制在 14 字内 */
const INDUSTRY_ACTIONS: Record<string, Array<{ label: string; prompt: string; icon: string }>> = {
  decoration: [
    { label: '快速报价', prompt: '帮我做一份装修报价单', icon: '📋' },
    { label: '材料算量', prompt: '帮我计算装修材料用量', icon: '📐' },
    { label: '效果图', prompt: '帮我生成一张装修效果图', icon: '🎨' },
    { label: '施工排期', prompt: '帮我制定施工进度计划表', icon: '📅' },
  ],
  real_estate: [
    { label: '房源分析', prompt: '帮我分析这个房源的优劣势', icon: '🏠' },
    { label: '房屋估价', prompt: '帮我估算这套房子的市场价', icon: '💰' },
    { label: '带看话术', prompt: '帮我写一段带看房的介绍话术', icon: '💬' },
    { label: '推广方案', prompt: '帮我制定一份房源推广方案', icon: '📣' },
  ],
  developer: [
    { label: '读懂项目', prompt: '帮我读一下当前项目，总结它是做什么的', icon: '📖' },
    { label: '审查代码', prompt: '审查当前项目代码质量，指出问题', icon: '🔍' },
    { label: '排查 Bug', prompt: '帮我定位并修复这个问题', icon: '🐛' },
    { label: '性能优化', prompt: '帮我分析性能瓶颈并给出优化建议', icon: '⚡' },
  ],
  medical: [
    { label: '舌诊辨证', prompt: '我想做中医舌诊，请帮我分析舌象', icon: '👅' },
    { label: '辨证问诊', prompt: '我最近不舒服，想做个中医辨证问诊', icon: '🔍' },
    { label: '经方检索', prompt: '检索《伤寒论》中相关的经典方剂', icon: '📋' },
    { label: '养生方案', prompt: '根据我的体质制定调理方案', icon: '🧘' },
  ],
  comic: [
    { label: '角色设计', prompt: '帮我设计一个漫画角色', icon: '🎨' },
    { label: '分镜脚本', prompt: '帮我写一页漫画分镜脚本', icon: '📝' },
    { label: '场景插画', prompt: '帮我描述一张场景插画的构图和光影', icon: '🏙️' },
    { label: '剧情编排', prompt: '帮我构思一章漫画剧情大纲', icon: '📖' },
  ],
  ecommerce: [
    { label: '数据分析', prompt: '帮我分析店铺数据表现', icon: '📊' },
    { label: '商品文案', prompt: '帮我写一段商品详情文案', icon: '📝' },
    { label: '营销方案', prompt: '帮我制定一个营销推广方案', icon: '🎯' },
    { label: '库存管理', prompt: '帮我做一份库存盘点表', icon: '📦' },
  ],
  education: [
    { label: '教案生成', prompt: '帮我写一份教学教案', icon: '📚' },
    { label: '试卷出题', prompt: '帮我出一套考试试卷', icon: '📝' },
    { label: '成绩分析', prompt: '帮我分析学生成绩数据', icon: '📊' },
    { label: '课程大纲', prompt: '帮我制定一份课程大纲', icon: '📋' },
  ],
  legal: [
    { label: '合同审查', prompt: '帮我审查这份合同条款，指出风险点', icon: '📄' },
    { label: '案例检索', prompt: '查找类似法律案例的判决要点', icon: '🔍' },
    { label: '法条解读', prompt: '帮我解读这条法律条文', icon: '📚' },
    { label: '风险评估', prompt: '评估这个法律问题的风险等级', icon: '⚠️' },
  ],
  manufacturing: [
    { label: '生产排程', prompt: '帮我做一份生产排程计划表', icon: '📅' },
    { label: '质量管控', prompt: '帮我分析这个质量问题产生原因', icon: '📊' },
    { label: '供应链优化', prompt: '帮我优化供应链库存和配送', icon: '🚚' },
    { label: '设备维护', prompt: '制定一份设备定期维护保养计划', icon: '🔧' },
  ],
  general: [
    { label: '读懂项目', prompt: '帮我读一下当前项目，总结它是做什么的', icon: '📖' },
    { label: '画一张图', prompt: '画一张赛博朋克风格的猫，霓虹灯光，高质量', icon: '🎨' },
    { label: '搜索最新', prompt: '搜索最新的 AI Agent 开源框架，对比优缺点', icon: '🔍' },
    { label: '代码体检', prompt: '分析当前项目的代码质量，并给出优化建议', icon: '🧪' },
  ],
};

export const WelcomePanel: React.FC<WelcomePanelProps> = ({ handleSend }) => {
  const zustandProfile = useProfileStore(state => state.profile);
  let extraProfile: any = null;
  try { const raw = localStorage.getItem('agentai.profile'); if (raw) extraProfile = JSON.parse(raw); } catch { /* ignore */ }
  const currentIndustry = zustandProfile?.industry || extraProfile?.industry || 'general';

  const title = INDUSTRY_TITLE[currentIndustry] || INDUSTRY_TITLE.general;
  const subtitle = INDUSTRY_SUBTITLE[currentIndustry] || INDUSTRY_SUBTITLE.general;
  const actions = INDUSTRY_ACTIONS[currentIndustry] || INDUSTRY_ACTIONS.general;

  return (
    <div style={{
      flex: 1,
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', width: '100%', minHeight: 0,
      padding: '32px 24px', boxSizing: 'border-box', textAlign: 'center',
    }}>
      {/* Logo — 静态, 无动画 */}
      <BrandLogo size={68} glow />

      {/* 品牌名 — 小字, 弱化存在感 */}
      <div style={{
        fontSize: 12, fontWeight: 600, letterSpacing: 3, textTransform: 'uppercase',
        color: 'var(--muted-2)', marginTop: 16,
      }}>
        PulseFlow
      </div>

      {/* 标题 + 副标题 */}
      <div style={{ fontSize: 24, fontWeight: 700, marginTop: 10, color: 'var(--fg)', letterSpacing: 0.3 }}>
        {title}
      </div>
      <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 8, marginBottom: 32 }}>
        {subtitle}
      </div>

      {/* 快捷入口 — 最多 4 个, 两列自适应 */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
        gap: 12, maxWidth: 'var(--chat-welcome-grid-max)', width: '100%',
      }}>
        {actions.map(action => (
          <button
            key={action.label}
            type="button"
            aria-label={action.label}
            onClick={() => handleSend(action.prompt)}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '14px 16px', borderRadius: 12,
              background: 'var(--panel)', border: '1px solid var(--border)',
              color: 'var(--fg-2)', cursor: 'pointer', textAlign: 'left',
              fontSize: 13, fontWeight: 500, fontFamily: 'inherit',
              transition: 'border-color 0.2s ease, transform 0.2s ease',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = 'var(--accent)';
              e.currentTarget.style.transform = 'translateY(-1px)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = 'var(--border)';
              e.currentTarget.style.transform = 'none';
            }}
          >
            <span style={{ fontSize: 18 }}>{action.icon}</span>
            <span>{action.label}</span>
          </button>
        ))}
      </div>

      {/* 脚注提示 */}
      <div style={{ fontSize: 11, color: 'var(--muted-2)', marginTop: 28 }}>
        Enter 发送 · Shift + Enter 换行
      </div>
    </div>
  );
};

export default WelcomePanel;