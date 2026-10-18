# CVE 情报管线 + 定时监控 — 实施方案 (2026-10-16, 待富哥确认后实施)

> 背景: 富哥批准"挖洞赚钱基础上"的第一优先级动作 — CVE 情报管线 (新 CVE → 匹配存量授权资产 → 告警/验证)。
> 本文档只做规划, **不动代码**; 富哥确认后再实施 (对应 AGENTS.md 规矩 1: 先思考再动手)。

---

## 一、目标与价值

**一句话: 让平台从"人想起来才扫"变成"新漏洞一曝光就自动找到你名下受影响的授权资产"** — 赏金平台上头洞奖金是烂洞的几十倍, 这条管线就是"时间的钱"。

数据流:
```
[NVD API 新CVE + CISA KEV 在野利用清单]
        │  cve-feed.mjs (拉取/过滤/去重/缓存)
        ▼
   cve-cache.json ────┐
                      │  matcher (CPE + 关键词双模匹配)
[scope.json 授权资产] ─┤        │
        │  fingerprint.mjs      ▼
        ▼  (httpx/nuclei指纹)  cve-alerts.jsonl (资产×CVE 命中, 分级)
   assets.json ────────┘        │
                               ▼
              automation(每6h) 跑 --once → 有命中 → AI 验证 (wsl_scan nuclei CVE模板)
              → 真命中 report_vulnerability + save_evidence → 通知富哥
```

## 二、侦查结论 (2026-10-16 实测)

| 项 | 结论 |
|---|---|
| NVD API 2.0 | ✅ 可达, **无需 key** (`pubStartDate/pubEndDate` 时间窗查询正常); 无 key 限频 5req/30s, 本管线每周期 1-2 请求, 够用 |
| CVE 量级 | ⚠️ 近 48h 新发布 **2907 条** — 必须过滤, 否则噪音爆炸 |
| CISA KEV | ✅ 免费 JSON feed (`known_exploited_vulnerabilities.json`), KEV = 已被在野利用, 赏金/企业双料金矿, **作为高优先级源** |
| scope.json | ⚠️ 当前不存在 (富哥未加授权目标) — MVP 必须处理"空资产"优雅降级 |
| WSL kali/nuclei | 沙箱内不可探 (wsl.exe 被拦), 按"富哥本机已装 kali"设计, **无 kali 降级为纯告警** |
| 并行会话冲突 | tools.ts 正被另一窗口改 — 本管线**以新文件为主** (scripts/ + .agentai/ 数据), 不碰 tools.ts 热点 |

## 三、设计决策

### D1 匹配算法: CPE 精确 + 关键词兜底 (双模)
- **CPE 精确匹配 (高置信)**: NVD CVE 带 `cpe[]` (vendor/product/version 范围), assets.json 的指纹含 `product:version` → CPE 对撞
- **关键词兜底 (低置信)**: CPE 缺失或指纹不全时, 用 CVE 描述/CPE 里的产品名 (log4j/thinkphp/nginx/wordpress...) 对资产指纹文本做包含匹配。误报可接受 (告警是给人看的), **漏报要少** — 所以关键词集取 vendor+product+常见别名
- **告警分级**: `kev+cpe` = 🔴 高置信 (优先验证); `kev+关键词` = 🟡; `仅cpe` = 🟡; `仅关键词` = ⚪ 低置信

### D2 过滤策略 (2907 → 可管)
保留满足任一: ① 在 CISA KEV 清单; ② CVSS ≥ 7.0; ③ 描述含 "remote code execution"/"pre-auth"/"unauthenticated" 等高可利用词。预估 48h 窗口剩 50-200 条, 全量进 cache 但只对**匹配资产的**告警。

### D3 任务形态: 脚本为主, AI 只在命中时被唤起
- `scripts/cve-watch.mjs --once` — **纯 Node, 不烧 token**: 拉源+匹配+告警落盘+打印摘要
- 指纹采集在脚本内直调 `wsl -d kali-linux -- httpx -l ... -json` (child_process, 域名源自 scope.json 人类控制, 参数安全)
- automation (每 6h) 的 prompt 模板: "跑 cve-watch --once; 若有 🔴/🟡 告警: 对命中资产 wsl_scan({tool:'nuclei', args:['-t','cves/...','-u',url]}) 验证 → 真命中 report_vulnerability + save_evidence → 汇总通知"

### D4 数据落点 (全部 .agentai/ 下, gitignore 已覆盖)
- `.agentai/cve/cve-cache.json` — 全量 CVE 缓存 (按 cveId 去重, 带 firstSeen)
- `.agentai/assets/assets.json` — 授权资产指纹库 (域名→httpx/nuclei 探测的技术栈/标题/状态码)
- `.agentai/cve/alerts.jsonl` — 命中记录 (资产×CVE×置信度×验证状态)

### D5 空资产/无 kali 降级
- scope.json 空 → 脚本明确提示"先授权目标", 退出码 0 (不算故障)
- 无 WSL → 指纹采集跳过, 资产只有域名文本; 匹配退化为"域名文本 vs CVE 关键词" (弱), 输出里明确标注 `fingerprint: none, 置信度降级`

## 四、分期与工作量

### P0 核心管线 (约 1 天, 500 行)
| 文件 | 内容 |
|---|---|
| `scripts/cve-watch.mjs` | CLI 入口: `--once` 跑全链路; `--feed-only` 只拉 CVE; `--match-only` 只匹配 |
| `scripts/lib/cve-feed.mjs` | NVD + KEV 拉取, 过滤 (D2), 去重缓存 |
| `scripts/lib/cve-matcher.mjs` | CPE + 关键词双模匹配, 告警分级 (D1) |
| `scripts/lib/asset-fingerprint.mjs` | httpx/nuclei 指纹采集 (WSL 直调, 无 WSL 降级), 写 assets.json |
| `scripts/lib/cve-watch.test.mjs` (或 gateway 侧 vitest) | mock NVD/KEV 响应 + mock scope → 命中/不命中/去重/降级用例 |
| `docs/CVE_WATCH.md` | 使用说明 + automation 配置指南 (富哥 UI 建定时任务的 prompt 模板) |

### P1 自动验证 (约半天)
- 命中 → `wsl_scan`/nuclei CVE 模板自动验证 (复用现有 handler 逻辑, CLI 直调) → 真命中写 vulns.jsonl (report_vulnerability 同格式) + evidence 落盘
- 告警状态机: `new → verified → reported`

### P2 增值 (按需)
- 授权审计日志 (企业服务合规底座): scope.json 每次变更记 who/when/what
- QQ bot 告警推送 (富哥已有 qqbot 包): 🔴 命中直接 QQ 通知
- 资产库按子域展开 (enum_subdomains 逻辑 CLI 化, 授权根域自动铺开)

## 五、验收标准

```bash
# P0 验收 (富哥本机, 有 kali 时全链路, 无 kali 时降级链路)
node scripts/cve-watch.mjs --once
# 期望: 拉取近 48h CVE+KEV → 写 cve-cache.json → 对 scope.json 每个授权域名产指纹 →
#       输出匹配报告 (无命中时明确 "no alerts", 有命中按 🔴🟡⚪ 分级列出)
```
- 单测: NVD/KEV mock 响应解析; CPE 命中/不命中; 关键词命中; 去重 (二次跑不重复告警); 空 scope 降级; 无 WSL 降级
- gateway 侧: `npx tsc --noEmit` 不受影响 (脚本独立于 gateway 构建)

## 六、风险与对策

| 风险 | 对策 |
|---|---|
| NVD 限频 (无 key 5req/30s) | 每周期 ≤2 请求; 失败重试 1 次 + 指数退避; 连续失败用缓存旧数据并标注 stale |
| CVE 洪流 2907/48h | D2 过滤; cache 全量但告警只出匹配资产的 |
| 误报扰民 | 四级置信度 + 告警去重 (同 资产×CVE 只报一次) |
| WSL/kali 不在 | D5 降级 + 输出明确标注 |
| 误伤未授权资产 | 匹配只读 scope.json (人类授权边界), 脚本本身不打资产 (httpx 指纹探测是轻读, 且仅对授权域名) |
| 与并行会话冲突 | 全部新文件 (scripts/lib/cve-*, .agentai/cve|assets/), 不碰 tools.ts/subagent.ts 热点 |

## 七、待富哥确认的三个点

1. **CVE 源范围**: NVD 全量 + CISA KEV (推荐) — 还是只 KEV (更安静, 只跟在野利用)?
2. **告警推送渠道**: MVP 只落盘 + 定时任务对话汇总; 要不要 P2 直接接 QQ bot 推送 (你本机 QQ 登录状态)?
3. **范围边界**: P0 只做管线+告警 (推荐, 一天见效); P1 自动验证一起做还是等 P0 跑稳?
