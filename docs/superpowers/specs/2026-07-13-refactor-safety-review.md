# 改造方案安全性审查报告

> 审查日期：2026-07-13
> 目标：评估 Phase 0-3 改造是否会破坏现有系统能力
> 结论：**大部分是增量改造，但有 3 个风险点需要防范**

---

## 一、改造方案分类

### 1.1 纯增量改造（安全）

| 改动 | 类型 | 风险 |
|------|------|------|
| 新增 `diagnosis/` 目录 | 新文件 | 无风险 |
| 新增 `diagnosis/types.ts` | 新文件 | 无风险 |
| 新增 `pendingAsk` 属性 | 新属性 | 无风险（不覆盖现有属性） |
| 新增 `pendingAsks` Map | 新属性 | 无风险 |
| 新增 `waitForAskResponse()` 方法 | 新方法 | 无风险（不修改现有方法） |
| 新增 `resolveAskResponse()` 方法 | 新方法 | 无风险 |
| 新增 `ask_response` 分支检查 | 新分支 | 无风险（不影响原有流程） |

### 1.2 修改现有代码（需谨慎）

| 改动 | 风险等级 | 影响 |
|------|---------|------|
| `onAskUser` 增加 `askId` 参数 | **medium** | 可能影响其他调用者 |
| `handleSend` 增加 `meta` 参数 | **medium** | 函数签名变化 |
| 调用 `runDiagnosticLayer()` | **low** | 新增调用点，不影响原有流程 |

### 1.3 删除/覆盖代码（高危）

| 改动 | 风险等级 | 建议 |
|------|---------|------|
| 无删除操作 | **无** | ✅ 安全 |

---

## 二、关键路径分析

### 2.1 现有系统的关键路径

```
用户输入 → routes/chat.ts → 创建/恢复 loop → 
agentai-loop.ts 主循环 → LLM 调用 → 工具分派 → 结果返回 → SSE 推送
```

**关键节点**：
1. `routes/chat.ts` 第 584-620 行：会话创建/恢复
2. `agentai-loop.ts` 第 1400-1405 行：`intent-clarifier` 澄清
3. `agentai-loop.ts` 第 2824-2831 行：`meta-cognitive-loop` 追问

### 2.2 改造后的路径

```
用户输入 → routes/chat.ts → 
  ↓
  [新分支] 如果是 ask_response → resolveAskResponse() → 恢复 loop → return
  ↓
  [原有分支] 创建/恢复 loop → runDiagnosticLayer() → 
    ↓
    [新分支] 如果需要追问 → waitForAskResponse() → emit('ask_user') → 暂停
    ↓
    [原有分支] 主循环 → LLM 调用 → 工具分派 → 结果返回
```

**安全性分析**：
- 新分支 `ask_response` 在原流程之前检查，**不影响原流程**
- 新方法 `runDiagnosticLayer()` 在主循环开始前调用，**不干扰主循环内部逻辑**
- `waitForAskResponse()` 是异步等待，**不阻塞原有调用栈**

---

## 三、风险点识别

### 3.1 风险点 #1：`onAskUser` 签名变化

**现状**：
```typescript
// ChatView.tsx 当前签名
onAskUser: (info: { question: string; options: any[] }) => { ... }
```

**改造后**：
```typescript
onAskUser: (info: { askId: string; question: string; options: any[] }) => { ... }
```

**风险**：
- 其他地方调用 `onAskUser` 可能不传 `askId`
- 前端组件 `AskUserCard` 需同步修改

**防范措施**：
- 保持向后兼容：`askId` 可选，默认生成 UUID
- 不强制要求传 `askId`

### 3.2 风险点 #2：`handleSend` 签名变化

**现状**：
```typescript
handleSend(message: string): void
```

**改造后**：
```typescript
handleSend(message: string, meta?: { askId?: string; type?: string }): void
```

**风险**：
- 其他地方调用 `handleSend` 可能不传 `meta`
- 函数内部逻辑变化

**防范措施**：
- `meta` 完全可选，不传时行为不变
- 内部判断：只有 `meta?.type === 'ask_response'` 时才走新逻辑

### 3.3 风险点 #3：追问超时处理

**现状**：
- 无追问阻塞机制，`meta-cognitive-loop` 直接 `break`

**改造后**：
- 新增 `waitForAskResponse()` 阻塞等待
- 超时后继续执行

**风险**：
- 超时时间设置不当，可能长时间阻塞主循环
- 多个追问并发时可能资源耗尽

**防范措施**：
- 超时时间默认 60 秒，可配置
- `pendingAsks` Map 限制最大并发数（如 5 个）
- 超时后自动清理并继续

---

## 四、安全改造策略

### 4.1 增量改造原则

| 原则 | 说明 |
|------|------|
| **不删除现有代码** | 旧逻辑保留，新逻辑并行 |
| **新分支优先检查** | 新逻辑不影响原有流程 |
| **参数向后兼容** | 新参数可选，不强制 |
| **灰度切换** | 新功能可通过配置开关启用/禁用 |

### 4.2 具体改造策略

#### 策略 A：`onAskUser` 向后兼容

```typescript
// 改造后
onAskUser: (info: { askId?: string; question: string; options: any[] }) => {
  const finalAskId = info.askId ?? uuid(); // 不传时自动生成
  setAskUserCard({ askId: finalAskId, question: info.question, options: info.options });
},
```

#### 策略 B：`handleSend` 向后兼容

```typescript
// 改造后
handleSend(message: string, meta?: { askId?: string; type?: string }): void {
  if (meta?.type === 'ask_response') {
    // 新逻辑：追问回答
    sendAskResponse(meta.askId!, message);
  } else {
    // 原有逻辑不变
    doSend(message);
  }
}
```

#### 策略 C：灰度开关

```typescript
// 新增配置
const FEATURE_FLAGS = {
  DIAGNOSIS_LAYER_ENABLED: false,  // 默认关闭，逐步开启
  ASK_WAIT_ENABLED: false,         // 默认关闭
};

// 主循环中判断
if (FEATURE_FLAGS.DIAGNOSIS_LAYER_ENABLED) {
  await this.runDiagnosticLayer(message);
} else {
  // 原有逻辑不变
}
```

### 4.3 回滚方案

| 改动 | 回滚方式 |
|------|---------|
| 新增文件 | 直接删除 |
| 新增属性/方法 | 直接删除 |
| 新增分支 | 删除分支代码 |
| 参数兼容改动 | 删除兼容逻辑，恢复原签名 |

---

## 五、测试策略

### 5.1 改造前测试

| 测试项 | 说明 |
|------|------|
| 现有功能完整性测试 | 确保改造前所有功能正常 |
| 性能基准测试 | 记录改造前性能指标 |
| 会话恢复测试 | 确保现有会话机制正常 |

### 5.2 改造中测试

| 测试项 | 说明 |
|------|------|
| 新功能单元测试 | 每个新方法独立测试 |
| 向后兼容测试 | 不传新参数时行为不变 |
| 灰度切换测试 | 开关开启/关闭行为一致 |

### 5.3 改造后测试

| 测试项 | 说明 |
|------|------|
| 端到端测试 | 追问→回答→恢复完整链路 |
| 性能对比测试 | 对比改造前后性能 |
| 回滚测试 | 确认回滚后恢复正常 |

---

## 六、总结

### 6.1 安全性评估

| 维度 | 评估 |
|------|------|
| **破坏性** | 低（大部分增量改造，无删除） |
| **可回滚性** | 高（新增文件/方法/分支，删除即回滚） |
| **兼容性** | 中（2 个签名变化，需兼容处理） |
| **风险可控性** | 高（灰度开关 + 超时保护） |

### 6.2 最终结论

**改造方案整体安全**：
- 80% 是增量改造，不破坏现有代码
- 20% 是修改现有代码，但有兼容策略
- 灰度开关确保可控切换
- 回滚方案简单直接

**建议**：
1. 先实现增量部分（新文件/新方法），不修改现有代码
2. 开启灰度开关，小范围测试
3. 验证无问题后逐步开启
4. 保留旧逻辑代码，不删除

---

## 七、改造顺序建议

| 步骤 | 内容 | 风险 |
|------|------|------|
| 1 | 创建 `diagnosis/types.ts` | 无风险 |
| 2 | 新增 `pendingAsk` 属性 | 无风险 |
| 3 | 新增 `waitForAskResponse()` 方法 | 无风险 |
| 4 | 新增 `resolveAskResponse()` 方法 | 无风险 |
| 5 | 新增 `routes/chat.ts` 分支 | 无风险 |
| 6 | 灰度开关配置 | 无风险 |
| 7 | 修改 `onAskUser`（兼容改造） | medium |
| 8 | 修改 `handleSend`（兼容改造） | medium |
| 9 | 开启灰度测试 | 无风险 |

**先完成 1-6（纯增量），再处理 7-8（兼容改造），最后灰度验证。**