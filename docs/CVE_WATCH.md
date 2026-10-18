# CVE Watch — 自动盯哨使用说明 (2026-10-16)

> 配套规划: `docs/CVE_WATCH_PLAN.md`。本文件是**使用手册** — 管线已落地, 照着做即可。

## 一句话

** gateway 一启动就自动盯**，每隔几小时自己问一遍"最近有啥新漏洞 / 哪些黑客已经在用"，拿你**授权过的网站资产**对一遍，中招了分级报警。你不需要敲任何命令、不需要建任何定时任务。

## ⚠️ 先讲清楚: 它是"盯哨"不是"攻击" (被动 vs 主动的边界)

这是设计上写死的边界，不是设置：

| 行为 | 是否自动 | 说明 |
|---|---|---|
| 拉公开漏洞情报 (NVD/CISA) | ✅ 每 6h 自动 | 读的是公开数据源，跟刷新闻一样 |
| 拿情报 × 你的授权资产比对 | ✅ 每 6h 自动 | **纯本地计算，零请求打到任何目标** |
| httpx 采指纹 / nuclei 验证 | ❌ **永不自动** | 这些是真会碰到目标的动作 — 授权是你给的，"无人值守自动打靶"超出授权语义，也容易被赏金平台判恶意扫描。要跑只能你点头（手动命令或后续 GUI 按钮） |

所以答案是：**它不定时攻击任何目标**。自动的部分只是"看新闻 + 对名单"，碰目标的每一步都要你确认。

## 快速开始 (2 步, 之后全自动)

```bash
# 1. 授权目标 (GUI 左侧「渗透测试授权」页, 支持批量粘贴平台清单) — 只此一次
#    或在对话里说: "授权测 example.com"

# 2. 什么都不用做了 — gateway 启动即自动每 6h 盯哨 (首轮 90 秒后)
#    想看当前告警: GET http://127.0.0.1:18789/v1/pentest/cve/alerts
```

想手动补一刀 (主动验证, 需本机 kali):
```bash
cd packages/agentai-gateway
node scripts/cve-watch.mjs --once --verify   # 纯 node 直跑, 不需要 tsx
```

开关: 环境变量 `CVE_WATCH_ENABLED=false` 关掉调度器; `CVE_WATCH_INTERVAL_HOURS=12` 改频率 (默认 6)。

## 输出都存哪 (workspace 的 .agentai/ 下, gitignore 已覆盖)

| 文件 | 内容 |
|---|---|
| `cve/cve-cache.json` | CVE 缓存 (过滤后: KEV ∪ CVSS≥7 ∪ 高可利用词; 按 CVE 编号去重) |
| `assets/assets.json` | 授权资产指纹 (域名 → 技术栈/标题/状态码; httpx 采集, 无 kali 降级) |
| `cve/alerts.jsonl` | 命中告警 (资产 × CVE, 四级置信, 去重, 带 status) |
| `cve/last-run.json` | 调度器每轮摘要 (时间/新告警数, GUI/API 读它) |
| `vulns/vulns.jsonl` | 真命中漏洞 (手动 --verify 后, 与 report_vulnerability 同格式, status:verified) |
| `evidence/<host>-<cve>/` | nuclei 原始响应证据 (提交平台作附件) |

## 告警四级置信 (看到 🔴 先动手)

| 标记 | 含义 | 动作 |
|---|---|---|
| 🔴 kev+cpe | 在野利用 + 指纹精确命中 | 最优先, 大概率真中招 |
| 🟡 kev+kw | 在野利用 + 关键词命中 | 尽快验证 |
| 🟡 cpe | 指纹精确命中 (未进 KEV) | 验证 |
| ⚪ kw | 仅关键词 (可能误报) | 有空再看 |

## 挂定时 (每 6 小时)

**不用挂 — gateway 内置调度器已经自动跑了** (2026-10-16 富哥反馈"还要用户去激活不科学"后的修正):
- server 启动 → 90 秒后首轮 → 之后每 6h 一轮 (被动盯哨, 零请求打目标)
- 想改频率/关掉: 环境变量 `CVE_WATCH_INTERVAL_HOURS` / `CVE_WATCH_ENABLED=false`
- 想主动验证 (nuclei, 会真发请求到目标): 只有手动 `node scripts/cve-watch.mjs --once --verify` 一条路

## 环境前提与降级

| 条件 | 缺了会怎样 |
|---|---|
| WSL kali (`wsl -l` 有 kali-linux) | 无 → 不采指纹, 匹配退化成域名关键词 (⚪ 为主), 明确标注 |
| kali 里装 httpx | 无 → 退化 curl -sI 取 Server 头 (指纹变弱) |
| kali 里装 nuclei | 无 → `--verify` 跳过, 告警保持 new (人工验证) |
| scope.json 有授权目标 | 空 → 提示先去授权面板加目标 (退出码 0, 不算故障) |
| 网络可达 NVD/CISA | 不通 → 用旧缓存继续匹配并标注 stale; 缓存也空则退出码 1 |

## 常见问题

- **Q: 告警太多?** 把 `--hours` 调小 (如 24), 或只关注 🔴/🟡 (⚪ 是关键词兜底, 误报主力)。
- **Q: 通配符授权 (`*.example.com`) 的子域采不到指纹?** 对 — 管线只探裸域。先用 `enum_subdomains` 展开子域, 把要测的子域也加进授权, 下一轮指纹采集覆盖。
- **Q: 误报怎么减少?** 看 matchedOn: `cpe:` 开头的是精确命中 (可信), `kw:` 开头是关键词 (存疑)。
- **Q: 验证通过的洞怎么交平台?** `--verify` 落的 vulns.jsonl + evidence 目录就是材料, 交给 `bounty-report` 技能出各平台格式报告。
- **Q: 和 wsl_scan 的限频冲突吗?** 不冲突 — 管线是 CLI 直调 wsl, 不走 AI 工具链; httpx 一次采一批, nuclei 一次一个目标, 频率由定时任务控。

## 自检命令

```bash
# 授权入口端到端 (输入框→API→scope.json→AI侧认得, 23 项断言)
npx tsx scripts/pentest-scope-e2e.mjs

# CVE 管线单测 (7 项: 解析/过滤/去重/匹配/告警去重/httpx解析)
node --test scripts/lib/cve-watch.test.mjs
```
