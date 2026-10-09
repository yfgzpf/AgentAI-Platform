# 实机问题修复报告 —— 2026-10-07

> 触发：用户一次反馈 5 个缺陷 + 1 个功能调研。
> 全部有实测复现，全部有回归测试。

---

## 一览

| # | 问题 | 根因位置 | 状态 |
|---|---|---|---|
| 1 | 选 2.5 Flash 但生成区显示智谱，导致失败 | `video.ts` 按 key 存在分发，忽略 `reqModel` | ✅ |
| 2 | 续集失败，提示"请手动截图最后一帧" | **ffmpeg 未安装** + 错误提示笼统 | ✅（需装 ffmpeg） |
| 3 | 提示词润色重复叠加 | `setPrompt(enhanced)` 无幂等保护 | ✅ |
| 4 | AI 报"read_file 工具异常" | 工具没坏，是**内容被毁**（GBK 乱码 / 二进制乱码） | ✅ |
| 5 | 计划中断后不续接 | `_active_plan` 模块级单例 + 从不注入 prompt | ✅ |
| 6 | 图片编辑（框选/套索/涂鸦/多区域着色/贴图） | — | 📋 调研完成 |

---

## 问题 1：视频模型分发错配

### 根因

`routes/video.ts` 的 `POST /v1/video` 旧逻辑是**「按 key 是否存在依次尝试」**：

```ts
if (AGNES_VIDEO_API_KEY) return submitAgnesVideo25(...);   // ← 完全忽略 reqModel
if (reqModel?.startsWith('seedance')) { ... }
if (AGENTAI_API_KEY) return submitAgnesFlash(...);          // ← 同样忽略
if (ZHIPU_API_KEY) { ... 智谱 }
```

**用户选 Flash，若 `AGNES_VIDEO_API_KEY` 未配、`AGENTAI_API_KEY` 也缺 → 一路落到引擎 4 智谱。**

而前端展示的 provider 来自后端**实际返回**的 `provider` 字段 —— 所以用户看到"智谱"才知道出错了，
但已经无法判断是自己选错还是系统改的。

### 还有一处更隐蔽的

轮询侧 `GET /v1/video/:taskId`：

```ts
if (provider.includes('agnes') || provider.includes('flash')) return queryAgnesFlash(...);
```

**`cogvideox-flash`（智谱的 provider 名）包含 "flash"** → 智谱的任务被送到 Agnes 的查询接口 → 必然失败。

### 改法

严格按 `reqModel` 分发，四个独立分支：

```ts
if (requested === 'agnes-video-2.5') { ...缺 key → 400 + requiredEnv + 模型名 }
if (requested === 'agnes')          { ... }
if (requested === 'cogvideo')       { ... }
if (requested.startsWith('seedance')) { ... }
// 未指定 model：仅当唯一可用引擎时自动选；多个可用 → 400 并列出
// 未知 model → 400，不随便挑一个引擎
```

轮询侧：
```ts
if (!provider.startsWith('cogvideo') &&
    (provider.startsWith('agnes') || provider === 'flash' || provider === 'agnes-flash'))
```

顺带把 `submitCogVideo` / `submitSeedance` 抽成独立函数（原来内联在 handler 里），
并给 `submitCogVideo` 补 `endFrame` 参数（原版不支持首尾帧）。

---

## 问题 2：续集失败 —— ffmpeg 根本没装

### 实测

```
$ which ffmpeg → 1
bash: ffmpeg: command not found
```

`extract-tail` 用 `execSync('ffmpeg ...')` → catch 里统一返回
`"ffmpeg 提取尾帧失败, 请确保 ffmpeg 已安装"` → 前端翻译成
`"续集生成失败, 请手动截图视频最后一帧上传"`

**用户被要求手动操作，却完全不知道真正原因是环境缺依赖。**

### 附带发现：命令注入面

```ts
execSync(`ffmpeg -y -sseof -0.1 -i "${videoPath}" ...`)
```

`videoPath` 直接插进 shell 字符串。Windows `cmd.exe` 下 `&` `|` `%VAR%` 都是分隔符，
**双引号挡不住** —— 与 B1 批次修掉的 git 命令注入同源。

### 改法：新增 `ffmpeg.ts`

| 函数 | 作用 |
|---|---|
| `hasFfmpeg()` | 带缓存探测，含 winget/choco/homebrew 等常见安装路径兜底扫描 |
| `runFfmpeg(args[])` | `execFile` 参数数组 —— 不经 shell，无注入面 |
| `explainFfmpegError()` | 把错误翻译成可操作提示 |

`video.ts` **6 处 execSync → `runFfmpeg([...])`**，`execSync` 归零。

缺失提示现在长这样：
```
服务器未安装 ffmpeg，无法自动提取视频帧。
这是「智能续集」功能的硬依赖（需要它从视频末尾抽一帧作为下一集的首帧）。

解决办法（任选其一）：
  1. 安装 ffmpeg 并加入 PATH（推荐）：
     - Windows: winget install Gyan.FFmpeg  或  choco install ffmpeg
       然后重启 gateway（让它重新探测 PATH）
  2. 临时方案：在视频下方点击「上传尾帧」，手动截取最后一帧上传
  3. 若已安装但仍报错，确认它在本终端可见：ffmpeg -version
```

### ⚠️ 需要你做一件事

**装 ffmpeg**，否则「智能续集」永远无法自动提取尾帧：

```bash
winget install Gyan.FFmpeg
# 然后重启 gateway
```

---

## 问题 3：提示词润色重复叠加

### 根因

```ts
setPrompt(data.enhanced);   // 整体替换，重复点击就层层叠加
```

### 双侧修

**后端**（`/v1/prompt/optimize` 的 instruction）新增禁止项：

> ★ 不要复述用户原文
> 只输出优化后的那一版。不要先把原文复述一遍再给优化版，
> 也不要在结尾用「原始描述: xxx」「用户需求: xxx」等标签把原文再说一次。
> 视频模型收到这种提示词会困惑（到底该照哪段拍），长度也白白翻倍。

**前端**幂等保护：
```ts
const merelyEchoes = after.includes(before) && grew < before.length * 0.3;
if (merelyEchoes) { message.info('提示词已经比较完整, 未做改动（避免重复叠加润色）'); return; }
```

本地降级增强也改成幂等（先剥离已追加的英文片段再重新加）。

---

## 问题 4：read_file「工具异常」—— 工具没坏，是内容被毁

### 实测复现

```js
// D1 非 UTF-8 文本
fs.readFileSync(gbkFile, 'utf-8')
// → "���,����"     ← 不抛错，只把非法字节替换成 U+FFFD

// D2 二进制文件
fs.readFileSync(pngFile, 'utf-8')
// → "�PNG\r\n\u001a\n\u0000��"
```

AI 拿到 GBK 乱码后无法解析任何内容 → **它并不知道发生了什么** → 判定"工具坏了" → 进 auto_fix / 重试循环。

### 改法：新增 `read-file-decoder.ts`

```
扩展名快速判定（40 种二进制扩展名）
  ↓ 不是二进制
编码探测：严格 UTF-8 校验 → GBK → windows-1252 逐级回退
  ↓
sniffBinary：魔数魔棒（PNG/JPEG/GIF/ZIP/PDF/ELF/PE/ftyp...）+ 启发式（控制字符 > 30%）
  ↓
大文件截断（默认 512KB / read_file 传 1MB）
```

**关键细节**：二进制返回 `success: true` 而非 `false`。

理由 —— 它不是"工具坏了"，只是不是文本文件。返回 `false` 会被 AI 判成工具异常，
**这正是原症状**。改成 `true` + 给出可操作建议（二进制文件用 run_code + pdfplumber 解析等）。

18 个测试。

---

## 问题 5：计划中断后不续接 ★三重根因★

### 根因

`tools.ts:303` 一行代码：

```ts
let _active_plan: any = null;      // ← 模块级单例
```

| # | 缺陷 | 用户可见症状 |
|---|---|---|
| D1 | **不持久化** | gateway 重启即丢（Tauri 关窗口重开 / dev server 自动重启都丢） |
| D2 | **不 per-workspace** | 进程只有一个变量，两个会话的计划互相覆盖 |
| D3 | ★ **从不注入 prompt** | 就算计划还在，模型也不知道自己有计划 → 按新任务重新规划 |

D3 是最关键的：前两个是"存不住"，第三个是"**存住了也没人告诉 AI**"。

### 改法

**1. 存储层**：`Map<workspace, plan>` + 落盘 `.agentai/active-plan.json`
（每次 `update_plan` 与阶段推进都写盘）

**2. 每轮注入**（`agentai-loop.ts:2875`，紧跟任务台账之后）：

```
# 📋 当前任务计划（中断后请从这里继续）
目标: 给 VideoGen 加尾帧提取
进度: 1/3 已完成，1 进行中

1. [✅] 分析现有 extract-tail 实现
2. [🔄] 封装 ffmpeg 模块
3. [⬜] 接前端续集按钮

⏳ 当前卡在: 封装 ffmpeg 模块
▶️ 下一步: 封装 ffmpeg 模块
   （必须从下一步继续，不要重新规划、不要从头开始）
```

**3. 全部完成时清盘** + 停止注入（避免"还有活没干完"的错觉）

**4. 外部 3 处引用全改**：loop 的阶段追踪 / loop 的全部完成 / `app.ts` 的 `GET /v1/plan`（后者现在支持按 workspace 查）

16 个测试，含端到端「执行到第 2 步崩溃 → 重启 → 新会话拿到计划继续」。

---

## 期间发现的既存问题

**`READ_ONLY_TOOLS` 白名单让两个测试失效**（并行改动引入，不是我这轮改的）：

```ts
// agentai-loop.ts:3576
const READ_ONLY_TOOLS = new Set([
  'list_directory', 'read_file', 'glob', 'grep', 'search_codebase', ...
]);
```

理由是「AI 每轮可能需要重新探索目录，硬去重会导致 AI 卡死」——**这个设计是对的**。

但我的两个测试用 `read_file` 测跨轮去重，因此失效。处理：
- 测去重改用 `run_command`（非只读）
- **把测试语义改成反映新设计**：只读工具不去重是刻意的，防重复读的责任交给**任务台账**
  （台账每轮告诉 AI「这个文件你读过 N 次」，第 2 次起还会显式提醒）

---

## 两条踩坑记录

### 1. vitest 的 cwd 是包目录

跨包读源码写测试时：
```ts
// ❌ ENOENT: packages/agentai-gui/packages/agentai-gui/src/...
const src = (p) => readFileSync(join('packages/agentai-gui', 'src', p), 'utf-8');

// ✅
const ROOT = resolve(__dirname, '..', '..', '..');
```

`gateway/src/video-pipeline.test.ts` 和 `gui/src/layout-regression.test.ts` 都踩过。

### 2. 测试匹配到了注释

`video-pipeline.test.ts` 首轮 2 个失败是**假红** —— 正则匹配到注释里
"旧实现 `if (agnesVideoKey)` 长什么样"的说明文字。

加 `codeOnly()` 剥注释层解决。**假红比没有测试更糟**：它会让人以为修复没生效，
从而把正确的修复改回去。

---

## 验收

```
pnpm -r test    EXIT=0
  ├─ gateway  61 files / 698 passed | 1 skipped   ← 从 58/638 增到 61/698
  ├─ gui      4 files / 48 passed                  ← 从 20 增到 48
  ├─ qqbot    1 file  / 3 passed
  └─ skills   无 pytest 测试
pnpm run typecheck EXIT=0   （5 包全查）
pnpm run lint      EXIT=0   （5897 warnings / 0 errors）
```

新增测试 **60 个**：
`video-pipeline.test.ts`(25) + `plan-resume.test.ts`(16) +
`read-file-decoder.test.ts`(18) + `layout-regression.test.ts`(28)

---

## 图片编辑功能调研

见 `docs/IMAGE_EDITOR_RESEARCH.md`（459 行）。三个最关键发现：

**1. 后端根本没有 mask 能力 —— 阻塞项**
`routes/image.ts:65` 的 `/v1/image` 无 `mask` 字段；所谓 `mode:'edit'`（`:87-90`）
只是给 Agnes 的 `extra_body.tags` 加字符串 `'edit'`，走**整图重绘**。
全平台 grep 到的 `mask` 全是 `maskCredentials`/`maskKey`（脱敏打码），与图像无关。
ALRC 分支（`:110-114`）**连图都不传**。
→ 局部重绘不是增强功能，是**从零新建**。

**2. `react-konva` 会直接 peer 冲突**
```
react-konva@19.3.0  peer: react "^19.3.0"
项目实测:            react "^18.3.1"     ← 装不上
```
最后兼容版 `react-konva@18.2.16` 已停更半年。
→ 推荐 `konva@10.7.1` **本体**（零依赖、框架无关）。

**3.「红区改/蓝区保留」的实证依据**
Qwen 官方社区方案：**mask 烘焙成红色高亮叠到参考图 + prompt 追加「红色区域是唯一改动处」**。
Gemini 3 Pro Image 明确记载「masked editing 有时产生不自然结果」，**无 mask 通道**。
→ 推荐**方案④组合**（1 张彩色叠加图 765 token + JSON ~150 token），
比「N 张黑白 mask」省 76%（3,825 → 915）。

**顺带发现两个既存 bug**：
- `imageTaskManager.ts:94` 的 `t.imageUrl || t.status !== 'failed'` 是**恒真式**
- `imageTaskManager.ts:22-30` 的 `ImageTask.params` 无 `mask`/`regions` → 接标注后「重新生成」会静默丢标注

**工期**：MVP 8.5 人日 / 完整版 15.5 人日，关键路径全在后端。

**现在就该定的架构约束**：交互层与渲染层分离 —— 拖拽期用 0.5x 预览 + 简化描边，
`pointerup` 才渲高保真。晚做会导致完整版重构成本极高。

### 待你拍板

| # | 决策 | 建议 |
|---|---|---|
| D1 | 画布库 | Konva 本体（规避 React 冲突 + 体积最小） |
| D2 | MVP 是否做套索 | 不做（1.5 人日，交互最难；框选+涂鸦已能验证全链路） |
| D3 | 意图传递主通道 | 方案④组合，同时给 `alrc-gpt-image-2` 保留硬 mask 通道 |
| D4 | 颜色语义归属 | 前端固定色板 + 用户文字定义，**必须带编号徽章**（8% 男性红绿色盲） |
| D5 | 是否升 React 19 | 暂不（牵动 AntD / monorepo 全量回归） |