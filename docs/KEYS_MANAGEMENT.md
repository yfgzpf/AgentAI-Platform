# AgentAI Platform — 密钥与配置管理规范 v1.0

> 最后更新: 2026-06-08
> 富哥指令: "密钥还是要用户自主填入, 只是我们的会有教程"

---

## 〇、核心原则

1. **零硬编码**: 项目代码、Git 历史、镜像中**绝对不含**任何真实 API Key
2. **用户自主**: 所有密钥由用户在首次启动时填入, 项目只提供 `.env.example` 模板
3. **加密存储**: 填入的密钥 AES-256-GCM 加密后存到 `~/.agentai/keys.enc`
4. **双轨 UX**: GUI 引导向导（小白友好）+ `.env` 编辑（高级用户）
5. **教程驱动**: 配套 `docs/TUTORIAL.md` 五分钟跑通

---

## 一、密钥清单 (Key Manifest)

AgentAI Platform 涉及的密钥/Token:

| 密钥名 | 用途 | 必填 | 获取地址 | 等级 |
|--------|------|------|----------|------|
| `AGNES_API_KEY` | AgentAI 多模态 (生图/生视频/对话) | ⭐ 主选 | https://apihub.agnes-ai.com | 关键 |
| `DEEPSEEK_API_KEY` | DeepSeek 对话 (AgentAI 备用) | ⭐ 备选 | https://platform.deepseek.com | 关键 |
| `SEEDANCE_API_KEY` | 字节 Seedance 2.0 视频生成 | 可选 | https://www.volcengine.com | 多模态 |
| `WANT_TEXT_API_KEY` | 字节 Wan2.6 视频生成 | 可选 | https://www.volcengine.com | 多模态 |
| `JIMENG_API_KEY` | 即梦 (Dreamina) 生图 | 可选 | https://jimeng.jianying.com | 多模态 |
| `STABLE_DIFFUSION_API_KEY` | SD API 备选 | 可选 | https://stability.ai | 多模态 |
| `VOLCENGINE_ACCESS_KEY` | 火山 TTS/STT | 可选 | https://www.volcengine.com | 语音 |
| `QQ_BOT_ACCOUNT` | QQ 机器人账号 | 可选 | 自己的 QQ | 渠道 |
| `QQ_BOT_PASSWORD` | QQ 机器人密码 (oicq) | 可选 | - | 渠道 |
| `TELEGRAM_BOT_TOKEN` | Telegram 机器人 | 可选 | @BotFather | 渠道 |
| `WECHAT_CORP_ID` | 企业微信 | 可选 | 企业微信后台 | 渠道 |
| `WECHAT_AGENT_ID` | 企业微信应用 ID | 可选 | 企业微信后台 | 渠道 |
| `WECHAT_SECRET` | 企业微信 Secret | 可选 | 企业微信后台 | 渠道 |
| `ALIYUN_ACCESS_KEY` | 阿里云 OSS/SMS | 可选 | 阿里云控制台 | 存储 |
| `ALIYUN_ACCESS_SECRET` | 阿里云 Secret | 可选 | 阿里云控制台 | 存储 |
| `SMTP_USER` / `SMTP_PASS` | 邮件发送 | 可选 | 邮箱设置 | 通信 |
| `GITHUB_TOKEN` | GitHub 技能市场 | 可选 | GitHub Settings | 市场 |

**最小运行要求**:
- 必填: `AGNES_API_KEY` **或** `DEEPSEEK_API_KEY` (二选一)
- 其余: 按需配置, 缺啥 skill 自动降级

---

## 二、配置文件三层结构

```
~/.agentai/                           ← 用户主目录 (C:\Users\<user>\.agentai\)
├── config.yaml                        ← 主配置 (LLM 默认 / 渠道开关 / 端口)
├── keys.enc                           ← 加密密钥库 (AES-256-GCM, 用户密码派生密钥)
├── .salt                              ← 加密盐值 (首次启动生成)
├── workspace-magic/                   ← 记忆目录
│   ├── MEMORY.md
│   └── memory/
├── logs/
├── skills/                            ← 用户安装的 skill
└── cache/                             ← 模型/数据缓存
```

**项目仓库结构** (供开发者参考, 不含真实数据):
```
agentai-platform/
├── .env.example                       ← 密钥模板 (提交到 Git, 真实值留空)
├── .env.example.full                  ← 完整版 (含所有可选)
├── .gitignore                         ← 强制拦截 .env / keys.enc / .salt
├── docs/
│   ├── TUTORIAL.md                    ← 5 分钟教程
│   ├── KEYS_MANAGEMENT.md             ← 密钥管理 (本文件)
│   └── ...
└── packages/
    ├── agentai-gateway/
    │   └── src/
    │       └── config/
    │           ├── KeyManager.ts      ← 密钥加解密
    │           └── setup-wizard.ts    ← 首次启动引导
    └── ...
```

---

## 三、`.env.example` 模板（提交到 Git）

```dotenv
# =====================================================
# AgentAI Platform — 密钥模板
# =====================================================
# 使用方法:
#   1. cp .env.example .env
#   2. 填入你的真实密钥 (从对应平台控制台获取)
#   3. 启动 agentai wizard 或 agentai serve
#
# ⚠️ 警告:
#   - .env 文件已加入 .gitignore, 永远不要提交
#   - 密钥仅在本机使用, 不要分享给他人
#   - 定期到各平台 rotate 密钥 (推荐 90 天)
# =====================================================

# ===== 必填 (二选一) =====
# AgentAI (主选) - https://apihub.agnes-ai.com
AGNES_API_KEY=

# DeepSeek (备选) - https://platform.deepseek.com
DEEPSEEK_API_KEY=

# ===== 多模态 (按需) =====
# 字节 Seedance 2.0 视频 - https://www.volcengine.com
SEEDANCE_API_KEY=
# 字节 Wan2.6 视频
WANT_TEXT_API_KEY=
# 即梦 (Dreamina) 生图
JIMENG_API_KEY=
# Stable Diffusion
STABLE_DIFFUSION_API_KEY=

# ===== 语音 (按需) =====
# 火山 TTS/STT
VOLCENGINE_ACCESS_KEY=
VOLCENGINE_ACCESS_SECRET=

# ===== QQ 机器人 (按需) =====
# 自己的 QQ 账号 + 密码 (oicq 协议)
QQ_BOT_ACCOUNT=
QQ_BOT_PASSWORD=

# ===== Telegram 机器人 (按需) =====
# @BotFather 创建机器人后获得
TELEGRAM_BOT_TOKEN=

# ===== 企业微信 (按需) =====
WECHAT_CORP_ID=
WECHAT_AGENT_ID=
WECHAT_SECRET=

# ===== 阿里云 OSS / SMS (按需) =====
ALIYUN_ACCESS_KEY=
ALIYUN_ACCESS_SECRET=

# ===== 邮件 (按需) =====
SMTP_SERVER=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=

# ===== GitHub (技能市场, 按需) =====
GITHUB_TOKEN=

# ===== 高级配置 (一般不用改) =====
# 智能路由策略: cost-first | speed-first | quality-first
LLM_ROUTING_STRATEGY=cost-first
# 单次最大成本 (USD, 超过熔断)
LLM_MAX_COST_PER_RUN=0.05
# 熔断阈值 (连续失败次数)
LLM_CIRCUIT_BREAKER_THRESHOLD=3
# 加密算法
KEY_ENCRYPTION_ALGO=aes-256-gcm
# 启动端口
GATEWAY_PORT=18789
# 调试模式
DEBUG=false
```

---

## 四、`.gitignore` 强制拦截

```gitignore
# ===== AgentAI Platform 密钥保护 (绝不允许提交) =====

# 用户填入的密钥文件
.env
.env.local
.env.*.local
keys.enc
.salt

# 加密盐值/密钥派生材料
*.key
*.pem
*.p12

# 桌面端/IDE 缓存
.vscode/
.idea/
*.swp
.DS_Store
Thumbs.db

# 运行时数据
node_modules/
dist/
build/
*.log
logs/
.cache/
.turbo/
.next/
.tauri/

# Python 技能
__pycache__/
*.pyc
*.pyo
.venv/
venv/

# Docker 沙箱产物
.sandbox/
*.tar
*.tar.gz

# 测试覆盖率
coverage/
.nyc_output/

# OS 临时
$TEMP/
$RECYCLE.BIN/
System Volume Information/

# 用户工作空间 (绝对不提交)
~/.agentai/
```

---

## 五、首启动引导 Wizard (方案 C — GUI + .env 双轨)

### 5.1 GUI 引导流程 (推荐, 小白友好)

```
┌─────────────────────────────────────────────┐
│  AgentAI Platform — 首次启动引导            │
│                                             │
│  👋 欢迎使用 AgentAI Platform!              │
│  我是你的 Reasonix 助手, 我会帮你完成初始化  │
│                                             │
│  我们需要你填入一些 API 密钥来启用各种功能   │
│  你可以随时在「设置 → 密钥管理」里修改       │
│                                             │
│  [🚀 开始引导]  [⏭️ 跳过(仅命令行)]         │
└─────────────────────────────────────────────┘

[Step 1/5] LLM 主选
  请选择你的 LLM 提供商:
  ◉ AgentAI (主推, 免费额度)
  ◯ DeepSeek
  ◯ Ollama 本地 (无需密钥)
  
  请粘贴 API Key:
  [_________________________________]
  [🔗 去 AgentAI 控制台获取](https://apihub.agnes-ai.com)
  [👁️ 显示/隐藏]  [✅ 测试连接]

[Step 2/5] 多模态 (可选)
  ☑ 启用生图 (Agnes Image 2.1 — 复用上方 AGNES_API_KEY)
  ☑ 启用生视频 (Agnes Video — 复用上方 API_KEY)
  ☐ 字节 Seedance 2.0 视频 (需额外申请)

[Step 3/5] 渠道 (可选)
  ☐ QQ 机器人 (输入账号密码)
  ☐ Telegram (粘贴 Bot Token)
  ☐ 企业微信

[Step 4/5] 安全设置
  请设置你的密钥加密密码 (>= 8 位):
  [_________________________________]
  [👁️ 显示]
  ⚠️ 这个密码会用来加密你的所有 API Key, 务必记住
  忘记密码需要重新填入所有密钥

[Step 5/5] 完成
  ✅ 初始化完成!
  📁 工作目录: C:\Users\<user>\.agentai\
  🔐 加密文件: keys.enc (AES-256-GCM)
  📊 启用的功能: LLM对话 / 生图 / 生视频
  
  [🎉 启动 AgentAI 主界面]
```

### 5.2 `.env` 编辑流程 (高级用户)

```bash
# 1. 复制模板
cp .env.example .env

# 2. 编辑 (用你喜欢的编辑器)
code .env
# 或
notepad .env

# 3. 填入密钥 (最少 AGNES_API_KEY 或 DEEPSEEK_API_KEY)

# 4. 启动
agentai serve
# 首次启动会检测到 .env, 询问是否加密导入到 keys.enc
```

### 5.3 命令行 (无 GUI 环境)

```bash
# 交互式填写
agentai init
# 或一行命令导入
agentai keys set AGNES_API_KEY=sk-xxxxx
agentai keys set DEEPSEEK_API_KEY=sk-xxxxx
agentai keys list  # 查看已设置
agentai keys test  # 测试所有连接
```

---

## 六、加密存储 (KeyManager)

### 6.1 加密流程

```typescript
// packages/agentai-gateway/src/config/KeyManager.ts
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const ALGO = 'aes-256-gcm';
const SALT_FILE = path.join(os.homedir(), '.agentai', '.salt');
const KEYS_FILE = path.join(os.homedir(), '.agentai', 'keys.enc');

export class KeyManager {
  private masterKey: Buffer;

  /**
   * 用户密码 → 派生 AES-256 密钥 (PBKDF2)
   */
  static deriveKey(password: string, salt: Buffer): Buffer {
    return crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
  }

  /**
   * 加密单条密钥
   */
  static encrypt(plaintext: string, masterKey: Buffer): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGO, masterKey, iv);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    // 格式: iv (16) + authTag (16) + ciphertext
    return Buffer.concat([iv, authTag, encrypted]).toString('base64');
  }

  static decrypt(ciphertextB64: string, masterKey: Buffer): string {
    const buffer = Buffer.from(ciphertextB64, 'base64');
    const iv = buffer.subarray(0, 16);
    const authTag = buffer.subarray(16, 32);
    const ciphertext = buffer.subarray(32);
    const decipher = crypto.createDecipheriv(ALGO, masterKey, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8');
  }

  /**
   * 完整 keys.enc 格式 (JSON)
   * {
   *   "version": "1.0",
   *   "createdAt": "2026-06-08T10:00:00Z",
   *   "keys": {
   *     "AGNES_API_KEY": "<encrypted_base64>",
   *     "DEEPSEEK_API_KEY": "<encrypted_base64>",
   *     ...
   *   }
   * }
   */
}
```

### 6.2 安全保证

- ✅ **AES-256-GCM**: 业界标准, 提供认证加密 (防篡改)
- ✅ **PBKDF2 100k 迭代**: 抗暴力破解
- ✅ **随机 IV**: 每条密钥独立 IV
- ✅ **Auth Tag 验证**: GCM 自带完整性检查
- ✅ **本地存储**: 密钥永不上传到云端
- ✅ **零明文落盘**: `.env` 仅作临时配置, 启动后转加密存储
- ✅ **定期 rotate 提醒**: 系统检测到密钥 > 90 天未更新, 弹窗提醒

---

## 七、测试与验证 (富哥验收)

### 7.1 自动测试 (单元)
- `tests/keys/encryption.test.ts`: 加解密正确性
- `tests/keys/derive.test.ts`: PBKDF2 派生稳定性
- `tests/keys/storage.test.ts`: 文件读写 + 错误恢复

### 7.2 手动测试 (富哥验收)
1. **首次启动** → wizard 弹出 → 填密钥 → 加密入库
2. **重启应用** → 自动解密 → 调用 LLM 成功
3. **错误密码** → 解密失败 → 提示"密码错误"
4. **篡改 keys.enc** → GCM 认证失败 → 拒绝解密
5. **Git 检查** → `git log -p | grep -i "key"` → 无任何 key 痕迹

### 7.3 验收清单 (Definition of Done)
- [ ] `.env.example` 提交到 Git, 真实值留空
- [ ] `.gitignore` 拦截 `.env`, `keys.enc`, `.salt`
- [ ] wizard GUI 跑通 (Tauri 桌面)
- [ ] 命令行 `agentai init` 跑通
- [ ] 加密/解密单元测试 100% 通过
- [ ] `keys.enc` 文件权限 600 (仅用户可读写)
- [ ] README 段落明确说明"密钥由用户填入, 项目不存储"
- [ ] 富哥亲自跑一次 wizard, 验收 OK

---

## 八、与 Reasonix 思维的对齐

虽然这是智能体平台项目, **不带入任何澳彩业务代码**, 但 Reasonix 8 步对冲用于项目决策:
- 密钥管理方案选 (8 候选 → 收敛到方案 C)
- 加密算法对比 (AES-256-GCM vs ChaCha20-Poly1305)
- 离线 vs 在线密钥库 (1Password / LastPass / 自建)

**安全铁律** (Reasonix 反思模式):
1. **任何时候密钥绝不明文落盘** (除临时 .env)
2. **任何时候密钥绝不上传** (除加密前用户输入)
3. **任何时候密钥绝不进 Git** (强制 .gitignore + pre-commit hook)
4. **任何时候密钥绝不打印日志** (logger 自动 redact)

---

**v1.0 完, 等富哥拍板启动阶段 1**
