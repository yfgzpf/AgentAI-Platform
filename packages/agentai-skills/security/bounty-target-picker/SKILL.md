---
name: bounty-target-picker
version: 1.0.0
description: 从赏金平台项目页自动抓取并解析 in-scope 域名/资产清单, 生成 grant_scope 待授权列表, 帮"挑授权目标"那步半自动化。配合 pentest-workflow 挖洞 + bounty-report 出报告
category: security
tags: [bounty, 赏金, 挑目标, in-scope, 授权列表, grant_scope, 补天, 漏洞盒子, HackerOne, SRC]
triggers:
  - 挑目标
  - 选赏金目标
  - 这个平台有哪些能测
  - 解析 scope
  - 生成授权清单
  - 赏金大厅
description_zh: 从赏金平台项目页自动抓取并解析 in-scope 域名/资产清单, 生成 grant_scope 待授权列表, 帮"挑授权目标"那步半自动化
description_en: Scrape a bounty-platform project page, parse its in-scope asset list, and emit a grant_scope pending-authorization list — semi-automates the "pick authorized target" step
riskLevel: low
author: AgentAI
testCommand: echo "bounty-target-picker skill loaded"
---

# Bounty Target Picker — 把"挑授权目标"这步半自动化

赏金大厅里挑目标要人工读每个项目的 scope 页、抄域名 —— 这一步 AI 能帮上忙。给定一个平台项目页 URL，本技能抓下来、解析出 in-scope 资产，**直接生成 `grant_scope` 调用序列**（不自动执行，让你确认后再授权），把"挑目标"从抄清单变一键。

## 触发条件

- 用户给一个赏金平台项目页/公告页 URL，说"看看这个能测哪些 / 解析 scope / 挑目标 / 生成授权清单"
- 用户说"补天/漏洞盒子/HackerOne 上有哪些目标可以测"（此时先 `web_search` 找项目页，再抓）

## 工作流

### 1. 拿项目页内容

```
web_fetch({ url: "<平台项目页 URL>" })
```

- 直接给 URL → `web_fetch` 抓正文
- 只说平台名没说项目 → `web_search` 搜 "平台名 赏金 scope 公告" 拿链接，再 `web_fetch`
- 页面是动态渲染（`web_fetch` 拿到的 scope 清单是空的）→ 换 `browser_navigate` + `browser_scan` 抓可交互元素里的资产列表

### 2. 解析 in-scope 资产 (核心)

从抓到的文本里抽**域名/子域/URL/APP 包名/小程序**，按下面规则分两桶：

| 桶 | 判据 | 处理 |
|---|---|---|
| **in-scope (可测)** | 明确写"以下资产授权测试 / in-scope / 授权范围 / 可报资产" | 收进待授权清单 |
| **out-of-scope (禁碰)** | "以下资产**不可**测试 / out-of-scope / 第三方 / 云服务商通用资产 / 合作伙伴" | 收进**黑名单**（绝不授权，提醒用户别碰） |
| **限定条件** | "仅 XX 功能 / 仅 XX 时间段 / 仅限 XX 国家用户" | 标注在对应资产旁，挖洞时受此约束 |

抽取正则思路（给子智能体/AI 参考，不写死进代码）：
- 域名：`[a-z0-9-]+(\.[a-z0-9-]+)+` (含 www. 子域展开)
- URL 路径：`https?://\S+` 抽 host
- APP：`com\.\w+\.\w+` (Android 包名) / `com.\w+.app` (iOS)
- 小程序：`\d+` (阿数字 appId) 附近带"小程序"字样

⚠️ **关键原则**：解析是**给人确认的草稿**，不是自动授权。把抽到的清单 + 命中关键词**原样回显**，让用户逐条核对再 `grant_scope`。平台 scope 经常写得有歧义（"及其子域名"到底含不含 `*.dev`？），AI 不能替你做这个合规判断。

### 3. 生成 grant_scope 待授权序列

把 in-scope 清单转成可直接执行的调用（**不自动跑**，列出来给你确认）：

```
# 解析出的 in-scope 资产 (请逐条确认, 再执行):
grant_scope({ target: "api.example.com",   max_rps: 5 })
grant_scope({ target: "admin.example.com",  max_rps: 2 })   ← admin 类降速
grant_scope({ target: "m.example.com",      max_rps: 5 })

# ⚠️ 以下 out-of-scope, 已加黑名单, 千万别授权/别碰:
- cloud.example-cdn.com (第三方 CDN)
- pay.example.com (支付, 越权红线)
```

确认后用这些 `grant_scope` 授权，再进 `pentest-workflow` 挖洞。

### 3b. 资产展开 (授权后)

平台只给根域 (如 `*.example.com`) 时，授权后可用 **`enum_subdomains({domain})`** 查 crt.sh 证书透明日志把资产清单展开成真实子域列表，并按授权状态分组 (in_scope 可直接测 / 未授权需补提案) —— 赏金 80% 的洞在没人管的子域上，这步是"挑目标"的延伸。子域里的 admin/dev/test 类优先看，支付/生产类照黑名单排除。

### 4. 平台特化提示

| 平台 | scope 页位置 | 注意 |
|------|-------------|------|
| **HackerOne** | 项目页 "Testing Scope" 区 | 有 in-scope / out-of-scope / excluded 三段，全要抓；有些要登录才看全 |
| **补天** | 项目详情 "授权范围" | 有时要"先报备再测"，scope 里会注明 |
| **漏洞盒子** | 项目 "可测资产" | 重复提交合并给先报的人，挑竞争少的 |
| **各厂 SRC** | 公告页/先知平台 | 自家资产，out-of-scope 经常含"合作伙伴/CDN/云通用组件" |

## 红线 (与全家桶同源)

- **out-of-scope 资产一个字不进 `grant_scope`** —— 解析出来只进黑名单提醒
- **支付/生产/第三方云 类资产** (pay/checkout/cdn/第三方 SaaS) 默认 out-of-scope，除非平台明确写了可测
- 本技能**只产出待确认清单，不自动授权、不自动开扫** —— 授权和挖洞都等你点头，合规判断始终在人
- 平台页抓不到/全空 → 如实说"这个页 scope 没解析出来，可能要登录或动态渲染"，别硬猜

## 与全家桶的关系

```
bounty-target-picker (挑目标: 抓 scope → 待授权清单)
        │ 你确认
        ▼
   grant_scope (授权 in-scope 域名)
        │
        ▼
pentest-workflow (挖洞: 浏览器 + kali 扫描器 + 注入探针)
        │
        ▼
   report_vulnerability (真洞落盘 .agentai/vulns/)
        │
        ▼
   bounty-report (出能过审的赏金报告)
        │
        ▼
   提交平台 → 过审领赏金 (人工, 工具到此为止)
```

## 工具清单

| 工具 | 用途 | 风险级 |
|------|------|--------|
| `web_fetch` | 抓项目页正文 | low |
| `web_search` | 没给 URL 时搜项目页 | low |
| `browser_navigate` / `browser_scan` | 动态渲染页抓资产列表 | low |
| `grant_scope` | 把确认后的 in-scope 资产授权 | medium |
| `list_scope` | 回显当前已授权 | low |

## 不适用

- 目标页**没有公开 scope**（要登录/付费才看）→ 手动登录后再喂给本技能，或直接 `grant_scope` 单条授权
- 已明确知道要测哪个域名（不用挑）→ 直接 `grant_scope` + `pentest-workflow`，不必走本技能
