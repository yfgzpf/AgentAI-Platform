---
name: api-security
description: API/Web 赏金主战技能。端点发现 + BOLA/IDOR/未授权/越权验证 + 输入验证 + 数据过度暴露。映射到 PulseFlow 现有链（extract_js_endpoints / wsl_scan(ffuf) / http_replay / wsl_exec 双会话对比）。
description_zh: API 安全测试技能。覆盖端点发现、BOLA/IDOR 越权、未授权直访问、水平/垂直越权、输入验证与数据暴露，直击 web/API 类赏金的越权挖掘主战场。
category: security
tags: [api-security, bola, idor, 越权, 未授权, 端点发现, ffuf, 赏金, pentest, owasp-api, 签名绕过]
triggers:
  - 越权
  - 未授权
  - BOLA
  - IDOR
  - 垂直越权
  - 水平越权
  - 绕过授权
  - 接口未授权
  - 端点爆破
  - 枚举接口
  - 探测 api
  - 未授权访问
  - 权限校验
riskLevel: critical
version: "1.0.0"
parallelSafe: false
---

# API 安全测试技能（api-security）

> 浓缩自 `zhaoxuya520/reverse-skill` 的 `skills/api-security` 模块（37k stars，领域 playbook 质量高）。
> 已剥离原 repo 的 MCP 专有工具名，映射到 PulseFlow 现有链。路由框架对 PulseFlow 冗余，未接入。
> 本技能与 `js-reverse` 互补：js-reverse 解决「接口要算 sign/token 怎么复现」，本技能解决「复现出请求后怎么打越权/未授权」。

## 核心纪律（最重要）

1. **evidence before claim**：任何"疑似越权"必须用**自己的两个测试账号**交叉验证、PIE 脱敏、只取 1-3 条样本。**未复现的不写 `report_vulnerability`。**
2. **scope gate before ACT**：只测已 `grant_scope` 授权的目标。非授权目标直接拒绝。
3. **SPA catch-all 误报**：根路径全返回 `text/html` size 5714 那是前端路由兜底的**假 200**，不是真端点。判据真端点：**有差异化 JSON 响应 / 真实 API 路径 / 非 SPA 外壳**。
4. **两形态前缀**：web/mobile 两 bundle 并存，爆破未文档化端点必须对 `/api/X` 与 `/X` **两种前缀都打**，否则漏半边。

## Phase 1 · 发现与侦察（你已在做）

- 端点枚举：`extract_js_endpoints` 刨 SPA JS + `wsl_scan({tool:"ffuf"})` 对真实前缀两形态爆破 + 查 `/api-docs` `/swagger` `/openapi.json` `/v2/api-docs` `/graphql`。
- 参数枚举：ffuf 跑 `?id=`/`?uid=`/`?file=`/`?path=` 类参数，看哪些返回区别于 404。
- GraphQL 内省三级：标准 → 精简（绕 WAF）→ 仅 `__schema{types{name}}`。
- 从 `robots.txt` + JS 文件提取端点（asprobe.sh 类脚本）。

## Phase 3 · 授权（BOLA/IDOR/BFLA）—— 赏金主战场

| 手法 | 操作 | 工具 |
|------|------|------|
| **BOLA（对象级越权）** | 账号 A 拿到资源 id/uuid，换成账号 B 的会话请求同一接口，看能否读 B 的数据 | `http_replay`（换 session/token 重放） |
| **IDOR（参数可遍历）** | `?id=1001` 改成 `1002`/`1000`，看是否返回他人数据（整数序 + UUID 两种都试） | `http_replay` |
| **未授权直访问** | 去掉 `Authorization`/`Cookie`/复现出的 `sign`，看接口是否仍返回数据 | `http_replay`（匿名重放） |
| **水平越权** | 普通用户 token 请求他人资源（`/user/{otherId}`） | `http_replay` |
| **垂直越权** | 普通用户 token 加 `X-Original-User: admin` / 改 `role` 字段，看能否到管理功能 | `http_replay` |
| **BFLA（功能级）** | 普通用户直接打管理员 API；HTTP 方法切换 GET→PUT→PATCH→DELETE；版本降级 `/v2/admin→/v1/admin`；批量注入 `{"users":[1,2,3,admin_id]}` | `http_replay` |
| **响应差异比对** | 同一接口"有 sign / 无 sign""登录 / 匿名"两形态响应 diff，坐实越权再下结论 | `wsl_exec` 跑 diff / 人工比对 |

## Phase 5 · 输入验证

- 方法切换、Content-Type 篡改（JSON→XML→multipart）、NoSQL 注入 `{"username":{"$gt":""}}`、SSRF（webhook/头像/导入 URL）、XXE、参数污染 `?role=user&role=admin`、批量赋值 `is_admin:true`。

## Phase 9 · 数据暴露

- 对比 API 返回 vs UI 展示（响应过度暴露）；分页枚举 `?page=1&limit=10000`；错误信息泄漏（堆栈/内部路径/SQL）。

## 工具映射（reverse-skill api-security → PulseFlow）

| 原工具 | PulseFlow |
|--------|-----------|
| `ffuf` / kiterunner | `wsl_scan({tool:"ffuf", args:[...]})` |
| `httpx` | `wsl_scan({tool:"httpx"})` |
| `nuclei -tags owasp` | `wsl_scan({tool:"nuclei", args:["-tags","owasp-top10","-etags","dos"]})` |
| `Burp Repeater` | `http_replay` |
| `Burp Autorize / AuthMatrix` | `wsl_exec` 双会话 curl 对比重放 |
| `jwt_tool` | git clone + `wsl_exec` 跑（Kali 已有） |
| 双会话对比 curl | 两个 `http_replay` 调用 + diff |

## 触发词 → 调哪块

| 场景 | 调 |
|------|----|
| 从 SPA JS 提端点、找未文档化 API、查 /api-docs、GraphQL 内省 | 本技能 Phase 1 |
| 验证某接口是否真未授权（IDOR/BOLA/越权） | 本技能 Phase 3 |
| 接口要求 sign/token 且疑似客户端计算 | 切 `js-reverse` 五阶段复现签名 |
| 拿到签名后想打越权/未授权 | 回本技能 Phase 3 |
| 从零挖一个授权目标的 API | `bounty-target-picker` → `pentest-workflow`（Phase 1 发现）→ 本技能 |

## 不适用

- 只 review 代码不跑系统 → 用 `code-reviewer`
- 要攻击**未授权**目标 → 拒绝，先 `grant_scope` 授权
- 接口要算客户端签名才能发请求 → 本技能 Phase 1/3 的前提不满足，先切 `js-reverse`

## 来源

- 浓缩自 `zhaoxuya520/reverse-skill` 的 `skills/api-security/` SKILL.md（37k stars，领域 playbook 质量高；其路由框架对 PulseFlow 冗余，未接入）。
- 已剥离原 repo 的 MCP 专有工具名，映射到 PulseFlow 现有链。
- 越权打法的浓缩交叉参考见 `js-reverse` 技能的 `references/api-security-crossref.md`；完整版见赏金工作区 `F:\挖洞赏金\output\jxnu\bounty-playbook-reverse-skill.md`。
