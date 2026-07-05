# 模型轮询问题诊断报告

> 问题：NVIDIA 和商汤(SenseNova)模型在轮询时出错
> 诊断时间：2026-07-05

---

## 一、问题现象

用户反馈：
- NVIDIA 模型轮询时出错
- 商汤(SenseNova)模型轮询时出错
- 其他模型(agentai/deepseek/zhipu)正常

---

## 二、代码审查发现

### 2.1 配置对比

| Provider | API Key 环境变量 | Base URL | 默认模型 |
|----------|-----------------|----------|---------|
| agentai | AGENTAI_API_KEY | apihub.agnes-ai.com/v1 | agnes-2.0-flash |
| deepseek | DEEPSEEK_API_KEY | api.deepseek.com/v1 | deepseek-v4-flash |
| zhipu | ZHIPU_API_KEY | open.bigmodel.cn/api/paas/v4 | glm-4.7-flash |
| **sensenova** | **SENSENOVA_API_KEY** | **token.sensenova.cn/v1** | **sensenova-6.7-flash-lite** |
| **nvidia** | **NVIDIA_API_KEY** | **integrate.api.nvidia.com/v1** | **deepseek-ai/deepseek-v4-flash** |

### 2.2 潜在问题点

#### 问题1：模型名称格式差异

```typescript
// NVIDIA 使用斜杠格式
nvidia: { ..., defaultModel: 'deepseek-ai/deepseek-v4-flash' }

// 其他模型使用简单名称
agentai: { ..., defaultModel: 'agnes-2.0-flash' }
zhipu: { ..., defaultModel: 'glm-4.7-flash' }
```

**风险**：某些 provider 可能不支持斜杠格式的模型名。

#### 问题2：Base URL 路径差异

```typescript
// 商汤：/v1 结尾
sensenova: 'https://token.sensenova.cn/v1'

// NVIDIA：/v1 结尾
nvidia: 'https://integrate.api.nvidia.com/v1'

// 智谱：/api/paas/v4 结尾（非标准OpenAI路径）
zhipu: 'https://open.bigmodel.cn/api/paas/v4'
```

**风险**：路径拼接可能出错。

#### 问题3：免费模型池包含问题模型

```typescript
// 第361行
const FREE_POOL = new Set(['agentai', 'zhipu', 'dxnt', 'sensenova', 'longcat', 'nvidia']);
```

**风险**：如果 sensenova/nvidia 实际上不可用，会被错误地加入免费池，导致轮询时尝试失败。

#### 问题4：错误处理可能不够细致

```typescript
// 第1106-1116行：API Key 检查
if (!apiKey) {
  return {
    content: `[${id} no-key] ...`,
    model: id,
    finishReason: 'stop',
    noKey: true,  // 标记无key
  };
}
```

**问题**：返回的 `noKey: true` 标记在调用方可能没有正确处理，导致继续尝试该 provider。

---

## 三、可能的原因

### 原因A：API Key 未配置（最可能）

```bash
# 检查环境变量
echo $NVIDIA_API_KEY
echo $SENSENOVA_API_KEY

# 预期输出：空或未设置
```

**验证方法**：查看启动日志中的 `recheckApiKeys()` 输出。

### 原因B：模型名称格式错误

NVIDIA 的模型名 `deepseek-ai/deepseek-v4-flash` 可能需要调整为 `deepseek-v4-flash`。

### 原因C：Base URL 路径问题

某些 provider 可能需要不同的路径格式。

### 原因D：网络/区域限制

NVIDIA/商汤的 API 可能有区域限制或需要特殊网络配置。

---

## 四、诊断建议

### 步骤1：检查日志

```bash
# 启动 gateway，观察日志
grep -E "(nvidia|sensenova|recheckApiKeys)" logs.txt
```

预期看到：
```
[router] recheckApiKeys() called
[router] recheck nvidia: hasKey=false, tripped=true
[router] recheck sensenova: hasKey=false, tripped=true
```

### 步骤2：验证 API Key

```bash
# 测试 NVIDIA
curl https://integrate.api.nvidia.com/v1/models \
  -H "Authorization: Bearer $NVIDIA_API_KEY"

# 测试商汤
curl https://token.sensenova.cn/v1/models \
  -H "Authorization: Bearer $SENSENOVA_API_KEY"
```

### 步骤3：临时禁用问题模型

如果确认无法使用，可以临时从免费池移除：

```typescript
// llm-router.ts 第361行
const FREE_POOL = new Set(['agentai', 'zhipu', 'dxnt']); // 移除 sensenova, nvidia
```

---

## 五、修复方案

### 方案1：添加更细致的错误处理

```typescript
// 在 executeProvider 中增加特定错误识别
if (id === 'nvidia' || id === 'sensenova') {
  // 检查特定错误码
  if (r.status === 401) {
    console.error(`[router] ${id} API Key 无效或已过期`);
    // 标记为不可用，不再尝试
    this.providers.get(id)!.tripped = true;
  }
}
```

### 方案2：动态检测模型可用性

```typescript
// 启动时检测各 provider 可用性
async function checkProviderHealth(id: ProviderId): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/models`, {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    return response.ok;
  } catch {
    return false;
  }
}
```

### 方案3：优雅降级

```typescript
// 如果指定模型失败，自动降级到下一个可用模型
const ranked = routeByScore(input);
for (const model of ranked) {
  try {
    return await this.tryOne(provider, req, model.subModel);
  } catch (err) {
    console.warn(`[router] ${model.provider} failed, trying next...`);
    continue; // 尝试下一个
  }
}
```

---

## 六、立即行动

1. **检查日志**确认具体问题
2. **验证 API Key**是否配置正确
3. **临时禁用**不可用的模型（如果需要）
4. **实施修复**方案

---

## 七、需要用户确认的信息

1. NVIDIA_API_KEY 和 SENSENOVA_API_KEY 是否已配置？
2. 错误日志的具体内容是什么？
3. 是否可以接受临时禁用这两个模型？
