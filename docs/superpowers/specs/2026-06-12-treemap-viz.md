# Spec: Cleaner Treemap 可视化 (SpaceSniffer 风格)

**日期**: 2026-06-12
**作者**: AgentAI Builder
**关联 plan**: `docs/superpowers/plans/2026-06-12-treemap-viz.md`
**前置依赖**:
- `2026-06-10-cleaner.md` 已完成(CleanerDaemon 完整)
- `2026-06-11-cleaner-schedule-display.md` 已完成(状态卡)
- `2026-06-11-cleaner-api-routes.md` 待完成(5 端点)

---

## 1. 目标

在 `CleanerPanel` 加 Treemap 可视化, 让用户**一眼看出**磁盘/目录占用:
- 按规则分类的彩色色块(大块=大头)
- 点击进入子目录
- hover 显示完整路径 + 大小
- 与现有"扫描/确认/清理"操作无缝衔接

对标: **SpaceSniffer**(treemap 开源)/ **WinDirStat**(经典 treemap)/ **WizTree**(快但非 treemap)

## 2. 非目标

- ❌ 不做 3D 可视化(无价值, 徒增 CPU)
- ❌ 不做实时监控(扫描是手动/定时触发)
- ❌ 不做 cross-disk 对比(只单 disk/单 root)
- ❌ 不替换现有 CleanerPanel 列表(并列展示, 互补)

## 3. 架构

```
┌──────────────────────────────────────────────────┐
│  CleanerPanel.tsx (现有, 增加新 Tab)             │
│  ┌──────────────────────────────────────────┐    │
│  │ Tabs: [Status] [Rules] [Treemap ⭐NEW]   │    │
│  │       [Confirm]                          │    │
│  └──────────────────────────────────────────┘    │
│                                                  │
│  ┌─ Treemap Tab ─────────────────────────────┐   │
│  │  <CleanerTreemap scanResult={...} />     │   │
│  │  ┌────────────────────────────────────┐  │   │
│  │  │ [large] [med]                      │  │   │
│  │  │ [med]   [tiny]                     │  │   │
│  │  │ [tiny] [tiny]  [tiny]              │  │   │
│  │  └────────────────────────────────────┘  │   │
│  │  Legend: 🟢 cache  🔵 log  🟡 temp       │   │
│  │  Hover: /path/to/file (123 MB)            │   │
│  └──────────────────────────────────────────┘   │
└──────────────────────────────────────────────────┘
```

## 4. 数据模型

### 4.1 后端扩展

```typescript
// packages/agentai-gateway/src/cleaner/types.ts
export interface TreemapNode {
    path: string;              // 完整路径
    name: string;              // 文件/目录名
    size: number;              // bytes
    type: 'file' | 'dir';
    ruleId?: string;           // 匹配的规则 ID
    risk: 'safe' | 'risky' | 'alert';
    children?: TreemapNode[];  // dir 才有
}
```

### 4.2 新增 API 端点

- `GET /v1/cleaner/treemap?root=path&depth=N` → `TreemapNode`
  - 默认 root=`process.cwd()`, depth=4
  - depth 限 ≤ 6(性能)
  - 大小为 0 的子节点不返回
  - 复用 scanner 现有 `os.homedir() + cwd` 规则

## 5. 文件改动

| 文件 | 类型 | 职责 |
|---|---|---|
| `packages/agentai-gateway/src/cleaner/treemap.ts` | **新建** | `buildTreemap(root, depth): TreemapNode` 递归遍历 |
| `packages/agentai-gateway/src/cleaner/treemap.test.ts` | **新建** | mock fs 跑 3 层 |
| `packages/agentai-gateway/src/cleaner/router.ts` | **修改** | 加 GET /treemap 端点 |
| `packages/agentai-gateway/src/cleaner/router.test.ts` | **修改** | 测新端点 |
| `packages/agentai-gui/src/components/CleanerTreemap.tsx` | **新建** | SVG treemap 渲染 + hover + click |
| `packages/agentai-gui/src/components/CleanerTreemap.test.ts` | **新建** | props + 颜色规则 |
| `packages/agentai-gui/src/components/CleanerPanel.tsx` | **修改** | 加 Treemap Tab + 拉数据 |

## 6. Treemap 布局算法

**选择**: `squarified treemap` (Bruls et al. 2000)
- 不用 d3-hierarchy(额外 30KB), 手写一个简化版
- 输入: TreemapNode[] + 容器宽高
- 输出: 矩形列表 `{x, y, w, h, node}`
- 时间 O(n log n), 1000 节点 < 50ms

## 7. 配色规则

| 类型 | 颜色 | 理由 |
|---|---|---|
| `cache` (rule 匹配) | 🟢 #10B981 | 绿色=安全可清 |
| `log` | 🔵 #3B82F6 | 蓝色=信息 |
| `temp` | 🟡 #F59E0B | 黄色=临时 |
| `risky` | 🔴 #EF4444 | 红色=高危, 需确认 |
| `normal` | ⚪ #6B7280 | 灰色=普通文件 |
| hover/selected | 🟣 #8B5CF6 | 紫色=高亮 |

## 8. 交互

- **hover**: tooltip 显示 `path`, `size`(KB/MB/GB 自适应), `ruleId`
- **click dir**: 缩放进入(只显示该 dir 的 treemap, 返回按钮)
- **click file**: 弹确认框"删除此文件?"(走 cleaner confirm 流程)
- **right-click**: context menu "Open in Explorer" / "Copy path" / "Skip rule"

## 9. 性能

- 节点 > 5000 时自动降级: depth 限 3 + 合并小节点(< 1MB) 为 "other"
- 渲染用 `requestAnimationFrame` 分批(每帧 200 节点)
- Web Worker 计算 layout(可选, v2)

## 10. 测试

- 单元: 5 node tree 跑 squarified, 验证 4 矩形不重叠 + 面积比 ≈ 大小比
- 单元: 配色规则映射
- 集成: 启 gateway, `curl /v1/cleaner/treemap?root=./test` 返 JSON
- E2E: GUI 切到 Treemap Tab, 看到至少 1 个色块
