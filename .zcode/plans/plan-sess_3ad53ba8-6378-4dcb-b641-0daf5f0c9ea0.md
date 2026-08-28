# 新颖身份设置页面设计方案

## 设计理念
**"身份卡片翻转" + "全息投影" 风格**
- 首次进入：展示个人身份卡片，包含头像、姓名、行业徽章
- 行业选择：3D 翻转卡片网格，选中后展示行业技能全息图
- 完成效果：身份卡片飞入系统，显示注入动画
- 二次进入：直接跳过，显示"欢迎回来"
- 对话页：右上角行业徽章可点击切换

---

## 页面结构（单页流程）

### 阶段 1：身份初始化（3秒入场动画）
```
┌─────────────────────────────────────────┐
│                                         │
│         🔮 脉冲光晕背景动画              │
│                                         │
│    ┌───────────────────────────┐        │
│    │  🎭 认识一下，成为 AI 伙伴  │        │
│    │                           │        │
│    │  [头像选择器: 🧑‍💻👩‍🎨👨‍⚕️...]│        │
│    │                           │        │
│    │  [输入你的名字...]          │        │
│    │                           │        │
│    │  💡 你的身份将帮助 AI 更懂你  │        │
│    └───────────────────────────┘        │
│                                         │
└─────────────────────────────────────────┘
```

### 阶段 2：行业选择（3D 卡片网格）
```
┌─────────────────────────────────────────┐
│    选择你的行业身份，AI 将针对性优化      │
├─────────────────────────────────────────┤
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐      │
│  │💻 dev│ │🏠 装 │ │🎬 漫│ │🛒 电│      │
│  │选✓  │ │修   │ │剧   │ │商   │      │
│  └─────┘ └─────┘ └─────┘ └─────┘      │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐      │
│  │📚教│ │🏘️房│ │🏥医│ │⚖️法│      │
│  │育   │ │产   │ │疗   │ │律   │      │
│  └─────┘ └─────┘ └─────┘ └─────┘      │
├─────────────────────────────────────────┤
│  已选行业: 💻 开发者                    │
│  激活技能: 代码生成 · 架构设计 · 调试分析 │
└─────────────────────────────────────────┘
```

### 阶段 3：身份注入（动画演示）
```
┌─────────────────────────────────────────┐
│                                         │
│         ✨ 身份已激活 ✨                  │
│                                         │
│    ┌───────────────────────────┐        │
│    │  🧑‍💻 开发者                │        │
│    │  ━━━━━━━━━━━━━━━━━━━      │        │
│    │  ✓ 行业知识已加载           │        │
│    │  ✓ 专业术语已配置           │        │
│    │  ✓ 快捷指令已就绪           │        │
│    │  ✓ 对话风格已优化           │        │
│    └───────────────────────────┘        │
│                                         │
│         开始对话 →                        │
│                                         │
└─────────────────────────────────────────┘
```

---

## 技术实现

### 1. 组件结构
```
src/components/
├── IdentityOnboarding.tsx    # 主入口（检测是否首次）
├── IdentityAvatarSelector.tsx  # 头像选择器
├── IdentityIndustryGrid.tsx    # 行业卡片网格
├── IdentitySkillHologram.tsx   # 技能全息展示
├── IdentityInjectionAnimation.tsx  # 注入动画
└── ProfileBadge.tsx          # 对话页行业徽章（可切换）
```

### 2. 状态管理
```typescript
// store.ts 扩展 UserProfile
interface UserProfile {
  name: string;
  industry: string;
  avatar?: string;
  onboardedAt: number;
  industrySkills: string[];
  questionnaire?: Record<string, string>;
}

// 检查是否首次进入
function isFirstTime(): boolean {
  const profile = localStorage.getItem('agentai-user-profile');
  return !profile || !JSON.parse(profile)?.name;
}
```

### 3. 动画设计（纯 CSS）
```css
/* 卡片翻转效果 */
@keyframes cardFlip {
  0% { transform: rotateY(0deg) scale(0.8); opacity: 0; }
  50% { transform: rotateY(10deg) scale(1.05); }
  100% { transform: rotateY(0deg) scale(1); opacity: 1; }
}

/* 身份注入效果 */
@keyframes injectGlow {
  0% { box-shadow: 0 0 0 0 rgba(99, 102, 241, 0.6); }
  70% { box-shadow: 0 0 0 20px rgba(99, 102, 241, 0); }
  100% { box-shadow: 0 0 0 0 rgba(99, 102, 241, 0); }
}

/* 全息扫描效果 */
@keyframes holoScan {
  0% { background-position: 0% 0%; }
  100% { background-position: 0% 100%; }
}
```

### 4. 行业切换（对话页）
```tsx
// ProfileBadge 组件 - 对话页右上角
const ProfileBadge = () => {
  const { profile, setProfile } = useProfileStore();
  
  return (
    <Dropdown menu={{ items: industryOptions }}>
      <div className="profile-badge">
        <span className="avatar">{profile.avatar || '👤'}</span>
        <span className="industry-icon">{getIndustryIcon(profile.industry)}</span>
        <span className="industry-name">{getIndustryLabel(profile.industry)}</span>
        <DownOutlined />
      </div>
    </Dropdown>
  );
};
```

---

## 文件变更清单

### 新增文件（5个）
1. `src/components/IdentityOnboarding.tsx` - 主入口
2. `src/components/IdentityAvatarSelector.tsx` - 头像选择器
3. `src/components/IdentityIndustryGrid.tsx` - 行业卡片网格
4. `src/components/IdentitySkillHologram.tsx` - 技能全息展示
5. `src/components/ProfileBadge.tsx` - 对话页行业徽章

### 修改文件（3个）
1. `src/store.ts` - 扩展 UserProfile 接口
2. `src/components/ChatView.tsx` - 集成 ProfileBadge
3. `src/App.tsx` - 首次进入检测

---

## 交互流程

### 首次进入
1. 检测 localStorage 无 profile → 显示 IdentityOnboarding
2. 选择头像 + 输入名字 → 下一步
3. 选择行业卡片 → 展示技能全息图 → 下一步
4. 身份注入动画 → 显示完成卡片 → 进入主界面

### 二次进入
1. 检测 localStorage 有 profile → 显示"欢迎回来，{name}"
2. 直接进入主界面
3. 可通过 ProfileBadge 切换行业

### 行业切换
1. 点击对话页右上角行业徽章
2. 弹出行业选择菜单
3. 点击新行业 → 更新 profile + localStorage + 后端 API
4. 发送系统消息通知 AI 切换行业

---

## 视觉风格

### 配色方案
- 背景：深色渐变（#0f0f1a → #1a1a2e）
- 卡片：半透明毛玻璃（backdrop-filter: blur）
- 选中态：霓虹光晕（box-shadow + glow）
- 文字：主色 var(--fg)，次色 var(--muted)

### 动效节奏
- 入场：0.5s ease-out
- 卡片翻转：0.6s cubic-bezier(0.34, 1.56, 0.64, 1)
- 注入动画：1.2s 分阶段
- 技能高亮：0.3s stagger

---

## 实现优先级

**Phase 1（核心）**：
1. 创建 IdentityOnboarding 主组件
2. 实现头像 + 行业选择流程
3. 集成到 App.tsx 入口检测

**Phase 2（视觉）**：
4. 添加 CSS 动画效果
5. 实现技能全息展示
6. 优化卡片交互

**Phase 3（对话页）**：
7. 创建 ProfileBadge 组件
8. 集成到 ChatView 顶部
9. 实现行业切换逻辑

---

## 关键创新点

1. **单页整合**：不再有 4 步骤割裂，一次完成所有设置
2. **3D 卡片翻转**：行业选择像翻牌游戏
3. **技能全息图**：选中行业后展示"激活的技能"
4. **身份注入动画**：完成时展示身份被系统接收的效果
5. **行业徽章常驻**：对话页可随时切换，无需回到设置
6. **记忆保留**：行业切换不丢失历史记忆