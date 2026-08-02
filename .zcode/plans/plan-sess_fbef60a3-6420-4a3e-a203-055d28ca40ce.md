
# 全面优化计划 — 对齐ZCode/Agnes框架体验

## 一、对话显示优化 (Thread.tsx)

### 1.1 子智能体调用增强
**文件**: `packages/agentai-gui/src/components/Thread.tsx`  
**问题**: 子智能体调用只显示类型，不显示提示词和参数  
**方案**: 
- 在ActivityTimeline中解析spawn_subagent的args，提取task/prompt信息
- 显示为可折叠卡片："子智能体 [类型]: 执行任务 - {prompt摘要}"
- 展开后显示完整提示词、并行状态、结果

### 1.2 文件操作折叠优化
**文件**: `packages/agentai-gui/src/components/FileCard.tsx`  
**问题**: read_file全量显示内容  
**方案**: 
- 保持FileCard的只读卡片形式（已实现）
- 增加"查看内容"按钮，点击后展开预览前10行
- 添加语法高亮和行号

### 1.3 编辑操作高亮
**文件**: `packages/agentai-gui/src/components/DiffViewer.tsx`  
**问题**: 编辑操作缺少视觉反馈  
**方案**: 
- 在DiffViewer中添加"已编辑N行"的统计信息
- 使用颜色标记新增(绿)/删除(红)/修改(黄)
- 添加"查看完整diff"折叠按钮

## 二、任务规划实时化 (TaskPlanPanel + ChatView)

### 2.1 SSE事件桥接完善
**文件**: `packages/agentai-gui/src/components/ChatView.tsx`  
**问题**: 任务状态更新延迟  
**方案**:
- 在onPlanStage handler中立即更新taskOrchestratorStore
- 添加stage状态的视觉反馈（running/success/failed）
- 实现进度条的实时动画

### 2.2 任务完成状态显示
**文件**: `packages/agentai-gui/src/components/TaskChainCard.tsx`  
**方案**:
- 当所有stages完成时，显示绿色"✅ 任务完成"横幅
- 添加总耗时、工具调用次数统计
- 支持一键复制任务报告

## 三、左侧会话历史重构 (PulseFlowSidebar)

### 3.1 文件夹式结构
**文件**: `packages/agentai-gui/src/components/PulseFlowSidebar.tsx`  
**目标**: 实现类似ZCode的任务分组  
**方案**:
- 按日期分组（今天/昨天/本周/更早）
- 支持自定义文件夹命名
- 拖拽会话到文件夹
- 右键菜单管理文件夹

### 3.2 会话元数据展示
**文件**: `packages/agentai-gui/src/store/sessionStore.ts`  
**方案**:
- 为Session添加folderId字段
- 显示会话的最后一条消息摘要（而非完整内容）
- 添加缩略图生成（可选）

## 四、AGNES模型限制移除

### 4.1 agentai-loop.ts清理
**文件**: `packages/agentai-gateway/src/agentai-loop.ts`  
**问题**: 大量"弱模型"相关逻辑影响AGNES发挥  
**方案**:
- 移除supervised层的循环检测和轻推机制
- 将AGNES从guided tier提升到autonomous tier
- 删除"弱模型反复read_file"等检测逻辑
- 保持与商用模型的一致性

### 4.2 model-classifier.ts调整
**文件**: `packages/agentai-gateway/src/model-classifier.ts`  
**方案**:
- 提升agnes-2.0-flash的reasoningLevel评分
- 确保supportsTools=true被正确识别
- 移除free模型的额外限制

## 五、打包界面一致性

### 5.1 CSS变量统一
**文件**: `packages/agentai-gui/src/styles/agentai-theme.css`  
**问题**: 部分组件使用硬编码颜色  
**方案**:
- 全局搜索硬编码颜色值
- 替换为CSS变量引用
- 确保dark/light主题切换一致

### 5.2 按钮生成逻辑修复
**文件**: `packages/agentai-gui/src/components/ChatView.tsx`  
**问题**: 打包后出现多余按钮  
**方案**:
- 检查条件渲染逻辑
- 确保dev/prod环境使用相同组件树
- 验证Vite打包配置

## 实施顺序

1. **Phase 1** (P0): AGNES模型限制移除 + 任务规划实时化
2. **Phase 2** (P1): 对话显示优化 + 左侧会话历史重构  
3. **Phase 3** (P2): 打包界面一致性 + 沙箱显示优化

预计工作量: 3-4天开发 + 1天测试