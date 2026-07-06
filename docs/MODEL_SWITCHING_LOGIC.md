# 模型切换逻辑完整梳理

> 梳理日期：2026-07-05
> 问题：NVIDIA/商汤模型切换时出错

---

## 一、当前模型切换流程

### 1.1 前端选择模型

```
用户点击 Settings → 选择模型（如 nvidia-deepseek-v4-flash）
    ↓
前端发送请求：POST /v1/chat
    body: { model: 'nvidia-deepseek-v4-flash', message: '...', ... }
```

### 1.2 后端模型映射（chat.ts）

```typescript
// 第436-480行：MODEL_MAP 定义
const MODEL_MAP: Record<string, { 
  provider: string; 
  subModel?: string; 
  label: string; 
  baseURL?: string 
}> = {
  // ... 其他模型
  'nvidia-deepseek-v4-flash': { 
    provider: 'nvidia', 
    subModel: 'deepseek-ai/deepseek-v4-flash', 
    label: 'DeepSeek V4 Flash (NVIDIA)' 
  },
  'sensenova-deepseek-v4-flash': { 
    provider: 'sensenova', 
    subModel: 'deepseek-v4-flash', 
    label: 'DeepSeek V4 Flash (SenseNova)' 
  },
  // ...
};
```

### 1.3 模型切换逻辑（chat.ts 第586-600行）

```typescript
if (requestModel && requestModel in MODEL_MAP) {
  const mapped = MODEL_MAP[requestModel];
  if (mapped) {
    const providerChanged = mapped.provider !== loop.opts?.model;
    const subModelChanged = (mapped.subModel || '') !== (loop.opts?.modelName || '');
    if (providerChanged || subModelChanged) {
      console.log(`[chat] model switch: ...`);
      loop.opts.model = mapped.provider;
      loop.opts.modelName = mapped.subModel || '';
      loop.opts.displayModelLabel = mapped.label;
      loop.opts.modelConfig = mapped.baseURL ? { ... } : undefined;
    }
  }
}
```

### 1.4 Loop 执行（agentai-loop.ts）

```
loop.run() 
    ↓
调用 llm-router.chat({
  model: 'nvidia',  // provider ID
  subModel: 'deepseek-ai/deepseek-v4-flash',
  ...
})
```

### 1.5 Router 处理（llm-router.ts）

```typescript
async chat(req: ChatRequest) {
  // 1. 检查是否指定了 model
  if (req.model) {
    const target = this.providers.get(req.model);
    // 尝试调用指定 provider
    return await this.tryOne(target, req, req.subModel);
  }
  
  // 2. 否则走评分排序
  const ranked = routeByScore(input);
  for (const model of ranked) {
    return await this.tryOne(provider, req, model.subModel);
  }
}
```

### 1.6 Provider 执行（llm-router.ts executeProvider）

```typescript
private async executeProvider(id: ProviderId, req: ChatRequest, subModel?: string) {
  // 获取配置
  const cfg = PROVIDER_DEFAULTS[id];
  const apiKey = process.env[cfg.keyEnv];
  const baseUrl = process.env[cfg.baseEnv] || cfg.defaultBase;
  const modelName = subModel || process.env[cfg.modelEnv] || cfg.defaultModel;
  
  // 构建请求体
  const bodyObj = {
    model: modelName,
    messages: req.messages,
    ...
  };
  
  // 发送请求
  const r = await fetch(`${baseUrl}/chat/completions`, {...});
}
```

---

## 二、发现的问题

### 问题1：MODEL_MAP 中的 provider 与 llm-router 中的 provider ID 不一致

**chat.ts MODEL_MAP**：
```typescript
'nvidia-deepseek-v4-flash': { provider: 'nvidia', ... }
```

**llm-router.ts providers**：
```typescript
this.providers.set('nvidia', {...});  // ✅ 一致
```

**结论**：provider ID 一致，不是这个问题。

---

### 问题2：subModel 传递可能丢失

**chat.ts 中**：
```typescript
loop.opts.modelName = mapped.subModel || '';
```

**agentai-loop.ts 中**：
```typescript
// loop 调用 router.chat() 时
const response = await router.chat({
  model: this.opts.model,      // 'nvidia'
  subModel: this.opts.modelName, // 'deepseek-ai/deepseek-v4-flash'
  ...
});
```

**llm-router.ts 中**：
```typescript
// 第1103行
modelName = subModel || process.env[cfg.modelEnv] || cfg.defaultModel;
```

**问题**：如果 `subModel` 正确传递，应该使用 `deepseek-ai/deepseek-v4-flash`。

**但**：如果 `subModel` 为 undefined，会使用 `cfg.defaultModel`：
```typescript
// 第1094行
nvidia: { ..., defaultModel: 'deepseek-ai/deepseek-v4-flash' }
```

**结论**：即使 subModel 丢失，也会使用正确的默认模型。

---

### 问题3：关键问题 - 模型名称格式

**NVIDIA NIM 的模型名称格式**：

```typescript
// MODEL_MAP 中
subModel: 'deepseek-ai/deepseek-v4-flash'

// PROVIDER_DEFAULTS 中
defaultModel: 'deepseek-ai/deepseek-v4-flash'
```

**但 NVIDIA NIM 可能期望的格式**：
- `deepseek-ai/deepseek-v4-flash`（带命名空间）
- 或 `deepseek-v4-flash`（不带命名空间）

**验证方法**：需要查看 NVIDIA API 文档或实际测试。

---

### 问题4：Base URL 可能不正确

```typescript
nvidia: {
  defaultBase: 'https://integrate.api.nvidia.com/v1'
}
```

**可能的问题**：
- 路径应该是 `/v1` 还是 `/v1/chat/completions`？
- 是否需要特定的 region endpoint？

---

### 问题5：API Key 格式

**NVIDIA API Key 格式**：
```
nvapi-xxxxxxxxxxxxxxxx...
```

**可能的问题**：
- Key 是否包含多余空格？
- Key 是否已过期？
- Key 是否有调用额度限制？

---

## 三、诊断建议

### 步骤1：验证模型名称格式

```bash
# 测试 NVIDIA API
curl https://integrate.api.nvidia.com/v1/models \
  -H "Authorization: Bearer $NVIDIA_API_KEY"

# 查看返回的模型列表，确认正确的模型名称格式
```

### 步骤2：直接测试 API 调用

```bash
# 测试带命名空间的模型名
curl https://integrate.api.nvidia.com/v1/chat/completions \
  -H "Authorization: Bearer $NVIDIA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-ai/deepseek-v4-flash",
    "messages": [{"role": "user", "content": "hello"}]
  }'

# 测试不带命名空间的模型名
curl https://integrate.api.nvidia.com/v1/chat/completions \
  -H "Authorization: Bearer $NVIDIA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-v4-flash",
    "messages": [{"role": "user", "content": "hello"}]
  }'
```

### 步骤3：检查日志输出

重启 gateway，查看新添加的调试日志：
```
[router] 🔍 nvidia 配置详情:
  - keyEnv: NVIDIA_API_KEY
  - hasKey: true
  - keyPrefix: nvapi-Nh4U...
  - baseUrl: https://integrate.api.nvidia.com/v1
  - modelName: deepseek-ai/deepseek-v4-flash

[router] ❌ nvidia 请求失败:
  - HTTP状态: 401/400/404
  - 错误详情: {...}
```

---

## 四、可能的修复方案

### 方案A：修正模型名称格式

如果 NVIDIA 期望的格式是 `deepseek-v4-flash`（不带命名空间）：

```typescript
// MODEL_MAP 修改
'nvidia-deepseek-v4-flash': { 
  provider: 'nvidia', 
  subModel: 'deepseek-v4-flash',  // 去掉 deepseek-ai/ 前缀
  label: 'DeepSeek V4 Flash (NVIDIA)' 
},
```

### 方案B：修正 Base URL

如果需要不同的 endpoint：

```typescript
nvidia: {
  defaultBase: 'https://api.nvidia.com/v1'  // 或其他地址
}
```

### 方案C：添加请求头

某些 provider 需要特定的请求头：

```typescript
const r = await fetch(`${baseUrl}/chat/completions`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'NV-Organization': '...',  // 可能需要
  },
  ...
});
```

---

## 五、立即行动

1. **查看详细日志**（已添加）
2. **用 curl 直接测试** NVIDIA/商汤 API
3. **根据错误信息**确定修复方案

---

*需要用户执行步骤1和2，提供错误日志和curl测试结果。*
