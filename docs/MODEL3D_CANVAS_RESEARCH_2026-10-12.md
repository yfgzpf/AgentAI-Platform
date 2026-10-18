# 3D 建模「画布旋转查看及修改」调研报告

> 调研日期：2026-10-12 | 状态：**待拍板，未动一行代码**
> 结论先说：**旋转查看——做得了，且零新依赖；「修改」——现有 provider 能力下只能是"重新生成"**

---

## 一、现状（三个事实）

**1. Model3DGen 生成完，页面上看不到模型**

`Model3DGen.tsx:228-232` 对产物只做了一件事：`<Button href={task.fileUrl}>下载</Button>`。
用户点生成 → 等 1-3 分钟 → 拿到一个文件。模型长什么样，页面上无从得知。

**2. 项目里已有一套 3D 渲染能力，但和建模页零关联**

`Scene3DViewer.tsx`（128 行）渲染 AI 工具 `generate_3d_scene` 生成的 Three.js HTML 字符串
（iframe `srcDoc` + sandbox，L51-65），自带刷新/下载/全屏。它被 `ChatView.tsx:29` 和
`EditorChatPanel.tsx:26` 使用——**Model3DGen 从未接入**。

**3. 项目没有装 three，且装不上**

gui/gateway 的 package.json 均无 three，node_modules 无，全仓零 `from 'three'` import。
pnpm monorepo 单包 add 撞 `ERR_PNPM_VIRTUAL_STORE_DIR_MAX_LENGTH_DIFF`（本次会话已踩过两次）。

---

## 二、技术路线：推荐 iframe + 自包含 HTML（零新依赖）

### 为什么不是装 three

| 路线 | 结论 |
|---|---|
| **A 装 three + GLTFLoader + OrbitControls** | ❌ pnpm 装不上；走 CDN 动态 import 无先例（vite.config.ts 无 optimizeDeps/external 配置），需 `@vite-ignore` 硬跳构建，~600KB 进主包 |
| **B iframe + 自包含 HTML 模板** | ✅ **推荐**。Scene3DViewer 已接收 `Scene3DData{title, html, params}`，Model3DGen 只需构造这个对象，iframe/刷新/下载/全屏**全部现成** |
| **C model-viewer Web Component** | ❌ 仅支持 GLB/USDZ（我们另外 3 种格式全废），项目无 web component 先例，同样有 CDN+CORS 问题 |

### 路线 B 的三个关键优势

1. **Tauri CSP 已白名单 jsdelivr**（`tauri.conf.json:30` 的 `script-src` 含 `https://cdn.jsdelivr.net`）
2. **AI 生成的 3D 场景已自带旋转**——`tools.ts:763` 的工具描述明确约定 CDN + OrbitControls，
   即这套 iframe 方案的交互能力已被验证可用
3. **Scene3DViewer 一行不用改**（或只改模板与高度），Model3DGen 侧增量约 60 行

### 两个必须处理的坑

**坑 1：模板只能用 jsdelivr，不能用 cdnjs**

`tauri.conf.json` 的 CSP 白名单有 jsdelivr，**没有 cdnjs**。而 `tools.ts:763` 给 AI 的约定用的是
cdnjs r128——所以 AI 生成的 HTML 在桌面壳里可能被 CSP 拦（Web 端无事）。
**自建模板必须走 jsdelivr**，这条要在代码注释里锁死。

**坑 2：GLB 外链的 CORS**

两个 provider 返回的 `fileUrl` 都是**厂商外链**（火山 TOS / 腾讯 COS，`3d-generate.ts:149/210`），
且 gateway 没有"下载到本地再 served"的逻辑。预签名 URL 默认不带 CORS 头，
前端 iframe 里 fetch 它会失败。

两个选择：
- **B-1 稳**：gateway 加一个 `/v1/3d-file?url=...` 代理端点，同源 served（顺带解决密钥/鉴权一致性）
- **B-2 轻**：先用着，CORS 挂了就在 UI 上明确提示"该模型需下载后本地查看"

建议 **B-1**，因为代理端点以后还能复用（其他外链产物同样受益）。

---

## 三、「修改」的边界——这条需要富哥拍板

**现有两个 provider 的 API 都不支持"基于已有模型继续改"**：

- 豆包 Seed3D：请求体只有图片 + `--fileformat`（`3d-generate.ts:41-44`），提交即新任务
- 混元 3D：payload 固定 `GenerateType: 'Normal'`（`3d-generate.ts:62-70`），同样是新任务

**所以「修改」在现有能力下只有三种含义**：

| 含义 | 能不能做 |
|---|---|
| 真正的 3D 编辑器（拖顶点/改网格/贴图） | ❌ provider 不支持，且是另一个量级的工程（需要完整的 3D 编辑栈） |
| 调参数重新生成（换参考图/换格式/换描述） | ✅ 本来就是 Model3DGen 的核心流程 |
| 基于生成结果做**变体**（同一张图微调 prompt 再出一版对比） | ✅ 可做，画布上并排展示多版本 |

**我的建议**：把"修改"重新定义为**「查看 + 对比 + 一键带参重生成」**——
画布上能旋转缩放看模型，能并排对比历史版本，能一键把某个版本的参数填回表单重新生成。
这不是编辑器，但对"生成 3D"这个场景，用户真正需要的恰恰是这三件事。

如果富哥要的是真编辑器，那要单独立项，且得先确认 provider 侧能力。

---

## 四、实施方案（路线 B + B-1 代理）

### 阶段 1 · 画布查看（约半天）

1. **新建 `components/chat/GltbViewer.tsx`**——GLB 专用查看组件
   - 输入 `fileUrl` + `title`，内部构造自包含 HTML（three + GLTFLoader + OrbitControls，**jsdelivr**）
   - 复用 Scene3DViewer 的 iframe/sandbox/全屏/下载外壳（把公共部分抽成 `SceneFrame` 或直接复制其结构）
   - 交互：左键旋转 / 滚轮缩放 / 右键平移（OrbitControls 默认就有）
   - 工具栏：重置视角 / 线框切换 / 全屏 / 下载 GLB
2. **Model3DGen 接入**：任务完成后，`fileUrl` 非空即渲染查看器（下载按钮保留）
3. **theme.css 补画布容器样式**（背景/圆角/高度）

### 阶段 2 · 多版本对比 + 带参重生成（约半天）

4. 任务列表改成卡片网格，成功项显示缩略画布
5. 每张卡「用此参数重生成」→ 把 prompt/provider/format 填回表单

### 阶段 3 · gateway 代理（约 1 小时，按需）

6. 若 GLB 外链 CORS 实测失败 → 加 `/v1/3d-file?url=` 代理端点
   （`gui → HTTP → gateway` 符合 AGENTS.md 层间约束）

---

## 五、红线与已知风险

- **不得**因这个功能引入 three npm 依赖（pnpm 装不上，且违反零新依赖原则）
- **不得**在 HTML 模板里用 cdnjs（Tauri CSP 会拦）——代码注释锁死
- **离线场景**：CDN 挂则白屏。这是 Scene3DViewer 已接受的风险（AI HTML 同样靠 CDN），
  不因本功能恶化；但 UI 上要有"加载失败可下载后本地查看"的兜底文案
- 测试：`media-contract.test.ts` 补一条契约断言——**模板 URL 必须是 jsdelivr 而非 cdnjs**
  （这是 CSP 约束，值得用测试锁住）
- 层间依赖：proxy 端点走 gateway，gui 不直连厂商外链

---

## 六、待富哥拍板

1. **「修改」的定义**：接受「查看 + 对比 + 带参重生成」这个边界，还是另立项做真编辑器？
2. **阶段 3 的代理端点**：现在就加，还是等实测 CORS 失败再说？