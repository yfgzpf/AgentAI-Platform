# AgentAI Platform — 模型调用地址配置文档
> 最后更新: 2026-06-11

## 一、当前已配置的 Provider（4 个）

### 1. Agnes AI（主模型）

| 配置项 | 值 |
|--------|-----|
| **API 地址** | `https://apihub.agnes-ai.com/v1/chat/completions` |
| **默认模型** | `agnes-2.0-flash` |
| **环境变量 Key** | `AGENTAI_API_KEY` |
| **环境变量 Base URL** | `AGENTAI_BASE_URL` |
| **环境变量 模型名** | `AGENTAI_MODEL` |
| **支持能力** | 工具调用(thinking)、图片输入(image_url)、流式 tool_calls delta |
| **上下文窗口** | 1M tokens |
| **费用** | 自有 API Key |

**请求示例:**
```json
POST https://apihub.agnes-ai.com/v1/chat/completions
Authorization: Bearer <AGENTAI_API_KEY>
Content-Type: application/json

{
  "model": "agnes-2.0-flash",
  "messages": [{"role": "user", "content": "你好"}],
  "max_tokens": 2048,
  "stream": false
}
```

---

### 2. DeepSeek（辅助模型）

| 配置项 | 值 |
|--------|-----|
| **API 地址** | `https://api.deepseek.com/v1/chat/completions` |
| **默认模型** | `deepseek-chat` |
| **环境变量 Key** | `DEEPSEEK_API_KEY` |
| **环境变量 Base URL** | `DEEPSEEK_BASE_URL` |
| **环境变量 模型名** | `DEEPSEEK_MODEL` |
| **支持能力** | 工具调用、reasoning_content、流式 |
| **上下文窗口** | 128K tokens |
| **费用** | 按量付费 |

**请求示例:**
```json
POST https://api.deepseek.com/v1/chat/completions
Authorization: Bearer <DEEPSEEK_API_KEY>
Content-Type: application/json

{
  "model": "deepseek-chat",
  "messages": [{"role": "user", "content": "你好"}],
  "max_tokens": 2048,
  "stream": false
}
```

---

### 3. OpenAI（备用模型）

| 配置项 | 值 |
|--------|-----|
| **API 地址** | `https://api.openai.com/v1/chat/completions` |
| **默认模型** | `gpt-4o-mini` |
| **环境变量 Key** | `OPENAI_API_KEY` |
| **环境变量 Base URL** | `OPENAI_BASE_URL` |
| **环境变量 模型名** | `OPENAI_MODEL` |
| **支持能力** | 工具调用、图片输入、流式 tool_calls delta |
| **上下文窗口** | 128K tokens |
| **费用** | 按量付费 |

**请求示例:**
```json
POST https://api.openai.com/v1/chat/completions
Authorization: Bearer <OPENAI_API_KEY>
Content-Type: application/json

{
  "model": "gpt-4o-mini",
  "messages": [{"role": "user", "content": "你好"}],
  "max_tokens": 2048,
  "stream": false
}
```

---

### 4. Cline.bot（免费模型聚合平台）

| 配置项 | 值 |
|--------|-----|
| **API 地址** | `https://api.cline.bot/api/v1/chat/completions` |
| **默认模型** | `deepseek/deepseek-v4-flash` |
| **环境变量 Key** | `CLINE_API_KEY` |
| **环境变量 Base URL** | `CLINE_BASE_URL` |
| **环境变量 模型名** | `CLINE_MODEL` |
| **支持能力** | 工具调用、reasoning、流式 |
| **上下文窗口** | **1M tokens** |
| **费用** | **免费** |

**⚠️ 特殊响应格式**: Cline.bot 的响应数据嵌套在 `data` 字段中，Gateway 已自动处理解包。

**请求示例:**
```json
POST https://api.cline.bot/api/v1/chat/completions
Authorization: Bearer <CLINE_API_KEY>
Content-Type: application/json

{
  "model": "deepseek/deepseek-v4-flash",
  "messages": [{"role": "user", "content": "你好"}],
  "max_tokens": 2048,
  "stream": false
}
```

**响应格式（注意 data 嵌套）:**
```json
{
  "success": true,
  "data": {
    "choices": [{
      "message": {
        "content": "Hello!",
        "reasoning": "推理过程...",
        "reasoning_details": [{"type": "reasoning.text", "text": "..."}]
      }
    }],
    "model": "deepseek/deepseek-v4-flash",
    "usage": {
      "prompt_tokens": 10,
      "completion_tokens": 29,
      "total_tokens": 39
    }
  }
}
```

---

## 二、Cline.bot 三个免费模型详细

### 模型 1: deepseek/deepseek-v4-flash

| 属性 | 值 |
|------|-----|
| **完整模型名** | `deepseek/deepseek-v4-flash` |
| **厂商** | DeepSeek |
| **特点** | 速度快，有 reasoning 推理能力 |
| **实测响应** | `"Hello!"` (29 tokens, 含 26 reasoning tokens) |
| **费用** | 免费 |
| **切换方式** | `CLINE_MODEL=deepseek/deepseek-v4-flash` |

### 模型 2: minimax/minimax-m3

| 属性 | 值 |
|------|-----|
| **完整模型名** | `minimax/minimax-m3` |
| **厂商** | MiniMax |
| **特点** | 综合能力不错，零 cost |
| **实测响应** | `"Hello! It's wonderful to connect with you."` (9 tokens) |
| **费用** | 免费 (cost=0) |
| **切换方式** | `CLINE_MODEL=minimax/minimax-m3` |

### 模型 3: xiaomi/mimo-v2.5

| 属性 | 值 |
|------|-----|
| **完整模型名** | `xiaomi/mimo-v2.5` |
| **厂商** | 小米 |
| **特点** | 推理能力突出，有 reasoning |
| **实测响应** | `"Hello! I'm MiMo-v2.5, developed by the Xiaomi LLM..."` |
| **费用** | 免费 |
| **注意** | max_tokens 较小时会被截断 (finish_reason=length) |
| **切换方式** | `CLINE_MODEL=xiaomi/mimo-v2.5` |

---

## 三、模型切换方式

### 方式 1: 修改 .env 文件（推荐）

编辑 `F:\agentai-platform\.env`，修改对应的环境变量：

```env
# 切换 Cline 模型（三选一）
CLINE_MODEL=deepseek/deepseek-v4-flash
# CLINE_MODEL=minimax/minimax-m3
# CLINE_MODEL=xiaomi/mimo-v2.5

# 切换 Agnes 模型
AGENTAI_MODEL=agnes-2.0-flash

# 切换 DeepSeek 模型
DEEPSEEK_MODEL=deepseek-chat
```

### 方式 2: 运行时指定（API 调用时）

在请求体中指定 `model` 字段，覆盖默认配置：

```json
{
  "model": "cline",
  "messages": [{"role": "user", "content": "你好"}]
}
```

Gateway 的 `AgentAIRouter` 会根据 `model` 字段智能路由到对应 provider。

---

## 四、智能路由优先级

当用户不指定模型时，Gateway 按以下优先级选择：

1. **agentai** (主模型) → `agnes-2.0-flash`
2. **deepseek** (辅助) → `deepseek-chat`
3. **cline** (免费备选) → `deepseek/deepseek-v4-flash`
4. **openai** (备用) → `gpt-4o-mini`

**熔断机制**: 当某个 provider 失败率 > 30% 时，自动熔断并降级到下一 provider。

---

## 五、Cline.bot 平台信息

| 属性 | 值 |
|------|-----|
| **平台地址** | https://app.cline.bot |
| **注册方式** | Google / Microsoft / GitHub 登录 |
| **API Key 获取** | Account → API Keys → Create API Key |
| **初始额度** | $0.5（免费模型不扣额度） |
| **API 格式** | OpenAI 兼容 |
| **上下文窗口** | 1M tokens |
| **当前免费模型** | 3 个（deepseek-v4-flash, minimax-m3, mimo-v2.5） |

---

## 六、测试验证记录

### 测试时间: 2026-06-11

| 模型 | 测试命令 | 结果 | 响应内容 |
|------|---------|------|---------|
| deepseek-v4-flash | `curl -X POST https://api.cline.bot/api/v1/chat/completions -H "Authorization: Bearer <key>" -d '{"model":"deepseek/deepseek-v4-flash","messages":[{"role":"user","content":"Say hello in one sentence."}],"max_tokens":100}'` | ✅ 成功 | "Hello!" |
| minimax-m3 | 同上，model 改为 `minimax/minimax-m3` | ✅ 成功 | "Hello! It's wonderful to connect with you." |
| mimo-v2.5 | 同上，model 改为 `xiaomi/mimo-v2.5` | ✅ 成功 | "Hello! I'm MiMo-v2.5, developed by the Xiaomi LLM..." |

**所有三个模型均通过 Gateway 的 TypeScript 编译验证和 API 调用测试。**
