# Cleaner Treemap Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 CleanerPanel 加 SpaceSniffer 风格 Treemap, 一眼看出磁盘占用

**Architecture:** 后端 treemap.ts(squarified 算法) + 1 个新端点 / 前端 CleanerTreemap.tsx(SVG) + CleanerPanel Tab

**Tech Stack:** TypeScript ESM + 0 额外依赖(手写算法) + React 18 + SVG

---

## File Structure

| 文件 | 类型 | 行数估 |
|---|---|---:|
| `cleaner/treemap.ts` | 新建 | 150 |
| `cleaner/treemap.test.ts` | 新建 | 100 |
| `cleaner/router.ts` | 修改 | +20 |
| `cleaner/router.test.ts` | 修改 | +30 |
| `components/CleanerTreemap.tsx` | 新建 | 250 |
| `components/CleanerTreemap.test.ts` | 新建 | 80 |
| `components/CleanerPanel.tsx` | 修改 | +30 |

**预计总改动**: ~660 行, 7 个文件

---

## Task 1: 后端 treemap builder

- [ ] 1.1 创建 `cleaner/treemap.ts`:
  - `buildTreemap(root: string, depth: number, scanRoots: string[]): TreemapNode`
  - 复用 `scanner.ts` 的目录遍历逻辑(抽公共函数 `walkFs()`)
  - 对每个文件, 用 `rule-engine.ts` 匹配规则, 标 ruleId + risk
  - 限制: 总节点 ≤ 5000, 单层 ≤ 500, 大小为 0 子节点不返回
- [ ] 1.2 写 `treemap.test.ts`:
  - mock fs: 3 文件 + 2 目录
  - depth=2 应返 5 节点
  - 文件大小累加正确
  - 规则匹配正确(log/cache 标)

## Task 2: 路由端点

- [ ] 2.1 修改 `cleaner/router.ts`, 加 `GET /treemap`:
  - query: `root` (默认 cwd), `depth` (默认 3, 上限 6)
  - 调 `daemon.buildTreemap(root, depth)` 或新增 daemon 方法
  - 加 audit log("user requested treemap root=...")
- [ ] 2.2 修改 `cleaner/index.ts`, 加 public 方法 `buildTreemap(root, depth)`
- [ ] 2.3 修改 `router.test.ts`: mock daemon, 验证端点返 200 + TreemapNode

## Task 3: 前端 treemap 组件

- [ ] 3.1 创建 `CleanerTreemap.tsx`:
  - props: `scanResult: TreemapNode`, `onNodeClick: (n) => void`
  - state: `currentPath: string`(默认 root), `hovered: TreemapNode | null`
  - 调 `GET /v1/cleaner/treemap?root={currentPath}&depth=3`
  - 拉数据后用 `squarify()` 算矩形 + `<rect>` SVG 渲染
  - 配色按 rule 类别(查 mapping 表)
  - hover 显 tooltip
  - 顶部: 返回按钮 + 面包屑
- [ ] 3.2 手写 `squarify(items, w, h)` 函数:
  - 简化版 squarified treemap(参考 Bruls 2000)
  - 输入: `[{size, ...}]`, 容器 w/h
  - 输出: `[{x, y, w, h, item}]`
- [ ] 3.3 写 `CleanerTreemap.test.ts`:
  - mock 5 节点 treemap, 渲染出 5 个 `<rect>`
  - 颜色按 rule 类别
  - click 触发 onNodeClick

## Task 4: 集成到 CleanerPanel

- [ ] 4.1 修改 `CleanerPanel.tsx`:
  - Tabs 加 "Treemap"(icon 用 `LayoutGrid` from lucide-react)
  - content: `<CleanerTreemap scanResult={null} />`(组件内自拉)
  - 现有 4 个 Tab(Status/Rules/Confirm)不变
- [ ] 4.2 验证: 启动 GUI + 启 gateway + 切到 Treemap Tab, 能看到色块

## Task 5: 验证

- [ ] 5.1 `pnpm typecheck` 0 错误
- [ ] 5.2 `pnpm test` 全过(老 + 新 ≥ 7 测试)
- [ ] 5.3 `pnpm -r build` 0 错误
- [ ] 5.4 E2E: GUI 切到 Treemap, 看到至少 1 个色块(用 `cwd`)

## 风险与备选

- **风险 1**: 手写 squarify 边界 case 多 → 备选: 用 `d3-hierarchy` (npm 50KB)
- **风险 2**: 大目录遍历慢 → 备选: 用 worker thread(本期不做)
- **风险 3**: GUI 端 SVG 渲染 1000+ 节点卡 → 备选: 限 depth=3 + 节点 ≤ 500
- **风险 4**: 用户点文件删除走 cleaner confirm, 但没走 RISKY 流程 → 备选: 任何文件删除都弹确认框(走 confirm 端点)

## 不做(明确)

- ❌ d3-hierarchy 依赖(避免 bundle 增大)
- ❌ 3D 效果
- ❌ 跨 disk 对比
- ❌ Web Worker layout(v2)
- ❌ context menu(右键, v2)
