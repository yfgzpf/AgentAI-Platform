# AgentAI Platform — 5 分钟跑通教程 v1.0

> 最后更新: 2026-06-08
> 富哥指令: "我们的会有教程"

---

## 🎯 三段式教程

| 段 | 标题 | 时长 | 适用 |
|---|------|------|------|
| **A** | 5 分钟跑通 (Hello World) | 5 min | 小白 / 快速体验 |
| **B** | 15 分钟接入多模态 (生图生视频) | 15 min | 创作者 / 设计师 |
| **C** | 30 分钟接入 QQ + VSCode | 30 min | 高级用户 / 团队 |

---

## A 段: 5 分钟跑通 (Hello World)

### A.1 前置要求

| 工具 | 最低版本 | 检查命令 |
|------|----------|----------|
| Node.js | 22+ | `node -v` |
| pnpm | 9+ | `pnpm -v` (没装: `npm i -g pnpm`) |
| Rust | 1.75+ (仅 Tauri 编译) | `rustc --version` |
| Python | 3.13+ (多模态技能) | `python --version` |
| Docker | 20.10+ (沙箱, 可选) | `docker --version` |

> 💡 **跳过 Rust**: 阶段 1-3 可以只跑 Node Gateway, 不编译 Tauri 桌面端

### A.2 一行命令安装

```bash
# 全自动安装 (推荐)
curl -fsSL https://raw.githubusercontent.com/agentai-platform/agentai-platform/main/install.sh | bash

# 或手动
git clone https://github.com/agentai-platform/agentai-platform.git
cd agentai-platform
pnpm install
```

### A.3 首次启动 wizard

```bash
pnpm dev
```

弹出 Tauri 桌面窗口 → 看到 `🚀 欢迎使用 AgentAI Platform` → 开始 5 步引导:

**Step 1: 选择 LLM**
- 选 `AgentAI` → 粘贴 API Key (去 https://apihub.agnes-ai.com 注册, 免费额度)
- 选 `DeepSeek` → 粘贴 API Key (去 https://platform.deepseek.com)

**Step 2: 多模态** (跳过, 下次再开)
- 不勾选, 直接下一步

**Step 3: 渠道** (跳过)
- 直接下一步

**Step 4: 设置加密密码**
- 输入 8+ 位密码 (例如 `MyAgent2026!`)
- ⚠️ 务必记住, 忘记需要重填所有密钥

**Step 5: 完成 → 启动主界面**

### A.4 第一个对话

主界面输入框打:
```
你好, 你是谁?
```

按 Enter, 看到 AgentAI 智能体回复 → 成功 🎉

### A.5 验证安装

```bash
# CLI 验证
agentai --version
# → AgentAI Platform v0.1.0

agentai status
# → Gateway: ✅ 运行 (127.0.0.1:18789)
# → LLM: ✅ AgentAI (sk-***...xxxx)
# → Skills: 0 已加载
# → Memory: ~/.agentai/workspace-magic/

agentai chat "你好"
# → 终端里直接对话
```

---

## B 段: 15 分钟接入多模态 (生图生视频)

> 假设你已经完成 A 段

### B.1 安装多模态技能 (一键)

```bash
# 安装所有多模态技能
agentai skill install office  # doc/excel/ppt 生成
agentai skill install image   # Agnes Image 2.1
agentai skill install video   # Agnes Video
agentai skill install voice   # TTS/STT
```

或 GUI 路径:
主界面 → 侧边栏「技能市场」→ 搜索 `image` → 点击「安装」

### B.2 生图测试

主界面输入:
```
画一只可爱的猫咪在草地上追蝴蝶, 写实风格
```

几秒后右侧出现生成的图片 → 点击「保存」→ 完成 ✅

### B.3 生视频测试

```
生成一段 5 秒的延时摄影, 展示城市从日落到夜晚
```

30 秒后生成视频 → 预览播放 ✅

### B.4 进阶: 多模态技能市场

访问 https://market.agentai-platform.com 浏览 100+ 技能:
- 风格滤镜 (油画/水彩/赛博朋克)
- 视频模板 (漫剧/广告/产品)
- 语音克隆
- 文档模板 (合同/报告/PPT)

---

## C 段: 30 分钟接入 QQ + VSCode

### C.1 QQ 机器人接入

#### C.1.1 申请机器人

1. 注册一个**专用** QQ 账号 (不要用主账号)
2. 登录 https://apihub.agnes-ai.com → 「技能市场」→ 搜索 `qq-bot`
3. 安装 `agentai-qq-bot` skill

#### C.1.2 配置账号

主界面 → 「设置」→ 「渠道」→ 「QQ 机器人」→ 填入:
- 账号: `123456789`
- 密码: `your_password`
- 启用: ✅

#### C.1.3 启动

```bash
agentai channels start qq
# → ✅ 机器人登录成功: 123456789
# → ✅ 监听私聊 / 群消息
```

#### C.1.4 测试

用另一个 QQ 给机器人发:
```
/help
```

机器人回复:
```
🤖 AgentAI QQ 机器人 v0.1.0

可用命令:
/ask <问题>     - 问智能体
/gen <描述>     - 生图
/video <描述>   - 生视频
/skills         - 列出技能
/clear          - 清空对话
```

发送 `/ask 你好` → 机器人调智能体回复 ✅

### C.2 VSCode 扩展接入

#### C.2.1 安装扩展

打开 VSCode → 扩展面板 (Ctrl+Shift+X) → 搜索 `AgentAI` → 点击「安装」

或命令行:
```bash
code --install-extension agentai.agentai-vscode
```

#### C.2.2 配置连接

VSCode → 设置 (Ctrl+,) → 搜索 `agentai.gateway` → 填入:
- `AgentAI: Gateway Url`: `ws://127.0.0.1:18789`
- `AgentAI: Auto Start Gateway`: ✅ (VSCode 启动时自动拉起 Node Gateway)

#### C.2.3 用法 1: 选中文本问智能体

VSCode 中选中一段代码 → 右键 → `AgentAI: Ask` → 在侧边栏弹出对话 → 智能体分析代码

#### C.2.4 用法 2: 命令面板

Ctrl+Shift+P → 输入 `AgentAI` → 选择命令:
- `AgentAI: Ask Question` - 问任意问题
- `AgentAI: Generate Code` - 从描述生成代码
- `AgentAI: Refactor Selected` - 重构选中的代码
- `AgentAI: Write Tests` - 给选中的函数写测试
- `AgentAI: Explain Code` - 解释代码

#### C.2.5 用法 3: 内联对话

Ctrl+I (Windows) / Cmd+I (Mac) → 在编辑器内直接对话, 智能体直接修改代码

---

## 🎓 进阶教程 (可选)

- **D 段**: 自定义 Skill 开发 (2 小时) → `docs/SKILL_DEVELOPMENT.md`
- **E 段**: 部署到服务器 (1 小时) → `docs/DEPLOYMENT.md`
- **F 段**: 接入企业微信 (30 分钟) → `docs/CHANNEL_INTEGRATION.md`
- **G 段**: 多 LLM 智能路由 (高级) → `docs/LLM_ROUTING.md`

---

## ❓ 常见问题 (FAQ)

### Q1: 启动时报 "端口 18789 被占用"
**A**: 
```bash
# Windows
netstat -ano | findstr :18789
taskkill /PID <pid> /F

# Mac/Linux
lsof -i :18789
kill -9 <pid>
```

或修改端口: 编辑 `~/.agentai/config.yaml` → `gateway.port: 18790`

### Q2: AgentAI API Key 在哪获取?
**A**: 访问 https://apihub.agnes-ai.com → 注册 → 控制台 → API Keys → 创建新 Key

免费额度: 每月 1000 次对话 + 100 张生图 + 10 次生视频 (2026 年政策, 可能调整)

### Q3: Tauri 桌面端编译失败?
**A**: Rust 工具链没装 → 参考 https://tauri.app/v2/guides/prerequisites

或临时跳过 Tauri, 只跑 Web:
```bash
pnpm dev:web  # 只启动 Web 工作区, 不开桌面端
```

### Q4: QQ 机器人登录失败?
**A**: 可能原因:
- 账号被风控 (用小号, 不要用主号)
- 密码错误
- oicq 协议失效 (看 https://github.com/takayama-lily/oicq 是否有更新)

### Q5: 怎么切换 LLM (AgentAI ↔ DeepSeek)?
**A**: 编辑 `~/.agentai/config.yaml`:
```yaml
llm:
  default: deepseek
  providers:
    agentai:
      enabled: true
    deepseek:
      enabled: true
```

或 GUI: 设置 → LLM → 默认提供商

### Q6: 怎么完全卸载?
**A**: 
```bash
agentai uninstall
# → 删除 ~/.agentai/
# → 删除注册表 (Windows) / launchd (Mac)
```

或手动:
- Windows: 删除 `C:\Users\<user>\.agentai\` + 卸载程序
- Mac: `rm -rf ~/.agentai/`

### Q7: 数据/记忆会同步到云吗?
**A**: **不会**。所有数据 (记忆/技能/配置) 都在本地, 密钥加密存储。AgentAI 只在你调用 API 时收到你的请求内容, 不存储你的对话历史 (除非你明确开启云端备份)。

---

## 📞 获取帮助

- **GitHub Issues**: https://github.com/agentai-platform/agentai-platform/issues
- **Discord 社区**: https://discord.gg/agentai
- **官方文档**: https://docs.agentai-platform.com
- **邮件**: support@agentai-platform.com

---

**v1.0 完, 富哥验收后再扩 E/F/G 段**
