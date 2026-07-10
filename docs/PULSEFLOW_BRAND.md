# PulseFlow 品牌规范文档

> 版本：v1.0  
> 生效日期：2024年  
> 状态：逐步迁移中

---

## 一、品牌定位

### 1.1 一句话定位
**PulseFlow - 让智能体理解系统的生命状态**

### 1.2 品牌含义
- **Pulse**（脉动）：系统的生命节律、状态感知
- **Flow**（流动）：智能体的认知流动、持续演进
- **PulseFlow**：脉动之流，让AI像中医感知脉象一样理解系统

### 1.3 品类定义
状态感知型智能体框架（State-Aware Agent Framework）

---

## 二、命名规范

### 2.1 对外统一使用

| 场景 | 使用名称 | 示例 |
|------|---------|------|
| 产品名称 | PulseFlow | "欢迎使用 PulseFlow" |
| 系统身份 | PulseFlow AI | "我是 PulseFlow AI" |
| 文档标题 | PulseFlow | "PulseFlow 使用指南" |
| 界面显示 | PulseFlow | 标题栏、Logo、关于页面 |

### 2.2 内部代码命名（过渡期）

| 层级 | 旧命名 | 新命名 | 状态 |
|------|--------|--------|------|
| 项目根 | agentai-platform | pulseflow | 暂不更改 |
| 前端包 | @agentai/gui | @pulseflow/studio | 暂不更改 |
| 后端包 | @agentai/gateway | @pulseflow/engine | 暂不更改 |
| 核心模块 | xuanji | pulseflow/core | 已创建，逐步迁移 |
| 系统身份 | ALTES \| 岐黄 | PulseFlow | 前端已更新 |

---

## 三、术语对照表

### 3.1 中医概念 → 技术术语

| 中医术语 | 英文术语 | 使用场景 |
|---------|---------|---------|
| 四诊 | Quad-Diagnosis | 代码、API |
| 望闻问切 | Inspection/Auscultation/Inquiry/Palpation | 代码、注释 |
| 辨证 | Pattern Differentiation | 代码、文档 |
| 证候 | Syndrome Pattern | 代码、类型定义 |
| 方剂 | Prescription/Formula | 代码、API |
| 君臣佐使 | Jun-Chen-Zuo-Shi | 代码、注释 |
| 医案 | Medical Case | 代码、API |
| 治未病 | Preventive Care | 文档、注释 |

### 3.2 对外沟通用语

**推荐说法：**
- ✅ "PulseFlow 融合中医辨证思维"
- ✅ "状态感知与辨证推理"
- ✅ "四诊合参，辨证论治"

**避免说法：**
- ❌ "用中医技术优化AI"（过于笼统）
- ❌ "AI医生"（医疗敏感）
- ❌ "诊断系统"（医疗敏感）

---

## 四、视觉规范

### 4.1 主色调
- **墨玉绿**：#1A5C4A（主色、Logo）
- **暖玉白**：#F5F0E8（背景色）
- **朱砂红**：#C44B3C（强调、警示）

### 4.2 Logo使用
- 主Logo：脉动之眼图形 + PulseFlow 字标
- 简化版：仅脉动之眼图形（favicon、小尺寸）

---

## 五、迁移状态

### 5.1 已完成 ✅
- [x] 创建品牌文档
- [x] Xuanji核心模块创建
- [x] 医案系统实现
- [x] 方剂编排引擎实现

### 5.2 进行中 🔄
- [ ] 前端界面显示更新
- [ ] 系统提示词更新
- [ ] README文档更新

### 5.3 待执行 ⏸️（高风险）
- [ ] 包名更改 (@agentai → @pulseflow)
- [ ] 目录重命名
- [ ] 数据库集合名更新

---

## 六、使用示例

### 6.1 界面显示
```html
<!-- 标题栏 -->
<title>PulseFlow Studio</title>

<!-- 欢迎语 -->
<h1>欢迎使用 PulseFlow</h1>
<p>让智能体理解系统的生命状态</p>

<!-- 关于页面 -->
<h2>关于 PulseFlow</h2>
<p>融合中医辨证思维的状态感知型智能体框架</p>
```

### 6.2 系统提示词
```markdown
You are PulseFlow - AI Task & Logic Agent System

PulseFlow 以中医"望闻问切"为理念，具备自主决策能力。
使命是**先诊断，后治疗**——先理解真实需求，再交付精准结果。
```

### 6.3 代码注释
```typescript
/**
 * 四诊合参 - Quad-Diagnosis
 * 
 * 融合中医"望闻问切"理念的系统状态感知
 * - 望诊(Inspection): 观察系统表象
 * - 闻诊(Auscultation): 识别异常信号
 * - 问诊(Inquiry): 澄清信息缺口
 * - 切诊(Palpation): 深度诊断分析
 */
```

---

## 七、联系方式

- 官网：https://pulseflow.ai（待注册）
- GitHub：https://github.com/pulseflow（待创建）
- 文档：https://docs.pulseflow.ai（待搭建）

---

**文档维护：** 品牌迁移完成后更新  
**最后更新：** 2024年
