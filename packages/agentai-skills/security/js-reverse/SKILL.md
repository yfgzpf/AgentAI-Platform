---
name: js-reverse
version: 1.0.0
description: 前端 JS 加密参数逆向 — 当授权接口要求客户端计算 sign/token/签名时，定位 JS 里的签名函数、证据驱动补环境、用 Node 复现签名并回放。配合 pentest-workflow 挖洞链使用, 命中"接口带 sign/加密参数/客户端签名"时自动调用
category: security
tags: [js逆向, 逆向, 前端加密, 签名, sign, token, 加密参数, 客户端参数, 补环境, 复现签名, 赏金, bug bounty, reverse]
triggers:
  - js逆向
  - 逆向
  - 前端加密
  - 加密参数
  - 客户端签名
  - 签名参数
  - 复现签名
  - 补环境
  - 参数被加密
  - 这个接口有sign
  - 这个接口带token
  - sign算法
  - token算法
description_zh: 前端 JS 加密参数逆向 — 当授权接口要求客户端计算 sign/token/签名时, 定位 JS 里的签名函数、证据驱动补环境、用 Node 复现签名并回放。配合 pentest-workflow 挖洞链使用
description_en: Frontend JS encrypted-parameter reverse-engineering — when an authorized endpoint requires a client-computed sign/token/signature, locate the signing function in the JS, rebuild the environment evidence-driven, replay the signature with Node, and verify against the endpoint. Pairs with pentest-workflow
riskLevel: high
parallelSafe: false
author: AgentAI
testCommand: echo "js-reverse skill loaded"
---

# JS Reverse — 前端加密参数逆向

赏金挖洞走到「接口要客户端算一个 sign/token 才返回数据」这一步，纯 curl 就卡死了。`pentest-workflow` 能帮你**发现**这个端点（靠 `extract_js_endpoints` 从 SPA JS 里刨出隐藏接口），但**复现签名**这步它没覆盖 —— 本技能补上。

核心纪律：**证据驱动、一次只补一个最小补丁**。不要凭猜把整段 JS 抄进 Node 跑，先确认签名算法到底是什么，再补它缺的那一个环境，否则会在 `window`/`document`/`navigator` 上无限踩坑。

## 触发条件

- 用户说"复现这个签名 / 这个接口带 sign / 前端参数被加密 / 客户端 token 怎么算 / 逆向这个 JS"
- `pentest-workflow` 侦察阶段发现某接口 401/403 是因为缺一个客户端算的 `sign`/`token`/`signature`/`x-` 头
- 接口返回"签名错误 / invalid signature / token expired"且你已确认不是服务端会话问题

⚠️ 前置：**目标必须在授权 scope 内**（走 `pentest-workflow` 的 `grant_scope` + `scope_guard`）。逆向未授权目标的客户端逻辑 = 越界，本技能只在已授权挖洞链里用。

## 与赏金链的关系

```
bounty-target-picker (挑目标)
      │ grant_scope 授权
      ▼
pentest-workflow (挖洞: extract_js_endpoints 刨出隐藏接口 → 发现接口要算 sign)
      │ 命中"接口带 sign/token" → 切本技能
      ▼
js-reverse (定位签名函数 → 补环境 → Node 复现 → http_replay 回放验证)
      │ 复现成功拿到真数据
      ▼
bounty-report (把"越权/未授权+签名绕过"整理成能过审的报告)
```

## 五阶段工作流

### 1. 定位签名入口（先找"谁在发请求"）

- 用 `extract_js_endpoints({url|content})` 把目标 SPA 的全部 JS 端点 + 参数名扒出来，圈出带 `sign`/`token`/`signature`/`nonce`/`timestamp`/`appKey` 的接口。
- 在已抓的 JS 源里搜签名关键词：`sign`、`encrypt`、`aes`、`rsa`、`md5`、`hmac`、`crypto`、`btoa`、`JSON.stringify` 紧跟 `fetch`/`axios`/`XMLHttpRequest`。
- 优先看**请求拦截器**（axios `interceptors.request.use` / 统一封装的 `request()` 函数）—— 90% 的签名在拦截器里统一加，不用逐接口找。
- 用 `browser-use` / `browser_navigate` 打开页面 + DevTools Network 抓一条**真实成功请求**，记下完整的 请求头/参数/body，**这是后面复现的基准对照**。

### 2. 抽签名算法（只读，不跑）

- 把命中签名函数的那段源码单独存盘（赏金工作区 `output/<target>/` 下，如 `F:\挖洞赏金\output\jxnu\`），只读分析：
  - 入参：哪些字段进签名（`method+url+body+timestamp+appKey`？）
  - 算法：`md5`/`sha256`/`hmac`/`aes`？盐/密钥是硬编码常量还是从某处读（`localStorage`/`config`/`window.__xxx`）
  - 顺序：拼接顺序、是否排序、是否 URL-encode
- 这一步**不要**急着在 Node 里跑，先用人读把算法写成伪代码，确认"输入→输出"的映射。

### 3. 证据驱动补环境（最关键，避免无限踩坑）

把第 2 步的算法用 Node 实现，**只补它真正缺的那个环境**，补一个验证一个：

| 缺失 | 最小补丁（不要整段抄浏览器全局） |
|------|------|
| `window`/`document` 不存在 | 只 stub 它实际读的那个属性，如 `const window = { __appKey: '...' }` |
| `navigator.userAgent` | `const navigator = { userAgent: 'Mozilla/5.0...' }` |
| 时间戳 `Date.now()` | 直接传抓到的真实 `timestamp`，别用 `Date.now()`（和服务端对不上） |
| 随机 `nonce`/`uuid` | 固定成抓到的真实值先跑通，再改成可复现生成 |
| 需要某 `localStorage` 值 | 用 `browser-use` 在页面里 `localStorage.getItem(...)` 读出真实值填进去 |

⚠️ **铁律**：每补一个 stub 就跑一次对照第 1 步抓的真实请求。对上了就停，不对再补下一个。**绝不一上来把整个 `jsdom` + 整段前端代码搬进 Node** —— 那会引入几十个无关依赖报错，反而找不到真问题。

### 4. Node 复现 + 回放验证

- 用 `wsl_exec` / `run_command` 跑 Node 脚本生成签名：
  ```bash
  node -e "const sign=require('./sign_repro.js'); console.log(sign({method:'GET',path:'/api/x',ts:'<真实timestamp>',body:''}))"
  ```
- 用 `http_replay({method,url,headers,body})` 带上复现出的 sign/token **回放那条真实请求**（内部强制授权闸门 + 限频，比裸 curl 可控）。
- **对照**：回放响应 == 第 1 步抓的真实成功响应结构 → 复现成功。否则回到第 3 步，看是盐错了还是拼接顺序错了（最常见两个点）。
- 复现成功后，`save_evidence` 把「签名脚本 + 一条成功回放」落盘，供 `bounty-report` 引用。

### 5. 坐实危害（接回 pentest-workflow）

签名复现只是"能发请求"，**赏金价值在危害**。复现后立刻问：
- 这个签名能不能**伪造其他用户的请求**（IDOR/BOLA）？→ 改路径/body 里的 id 用 `http_replay` 重放看能否读到他人数据
- 能不能**绕过未授权校验**（没登录也能算 sign 直接调）？→ 用匿名 session 复现 sign 调"本该登录才能看"的接口
- 密钥是不是**硬编码在前端**（可批量伪造任意请求）？

任何一条成立 → 走 `pentest-workflow` 的"影响证明"纪律（自己的两个测试账号交叉验证、PII 脱敏、只取 1-3 条样本），再 `report_vulnerability` 落盘 → `bounty-report` 出报告。

## 工具映射（到 PulseFlow 现有链）

| 原 reverse-skill 工具 | PulseFlow 对应 | 用途 |
|---|---|---|
| `extract_js_endpoints` | `extract_js_endpoints` | 刨 SPA JS 隐藏端点（已在 pentest-workflow） |
| `jshookmcp` / CDP hook | `browser-use` / `browser_navigate` + DevTools | 抓真实请求、读 `localStorage` 真实值 |
| Node 复现 | `wsl_exec` / `run_command` | 跑签名脚本 |
| `httpx` / `ffuf` | `wsl_scan({tool:"ffuf"})` | 对真实端点前缀爆破（两形态 `/api/X` 与 `/X`） |
| `http_replay` 回放 | `http_replay` | 带 sign 回放验证 + 越权重放 |
| `jwt_tool` | git clone + `wsl_exec` 跑（Kali 已有） | JWT 类签名 |
| 落盘 | `save_evidence` / `report_vulnerability` | 证据 + 漏洞落盘 |

## 赏金工作区约定

- 所有产物写 Windows 侧 `F:\挖洞赏金\output\<target>\`（跨会话不丢，绕过 WSL 侧 ENOENT）。
- 长任务用 `wsl_exec` 的 job 机制异步跑，主循环同步等结果或主动轮询，**不要切走等** —— 切走会断 SSE 丢上下文（见跨会话记忆 `bounty-memory`）。
- 已确认的发现/已犯的错误会被 `bounty-memory` 跨会话注入，**复用、别重踩**。

## 红线（与 pentest-workflow 同源）

- 只在 `grant_scope` 授权的目标上做 JS 逆向；未授权目标 = 拒绝
- 复现签名只用于**证明漏洞**，不用于批量伪造请求打目标（最小强度、无破坏）
- 前端硬编码密钥是漏洞证据，**不要**拿去对真实用户做坏事
- 脱敏：报告里的 PII 一律 `138****1234` 这类脱敏

## 不适用

- 接口没签名、纯未授权就能调 → 直接 `pentest-workflow` + `http_replay`，不用本技能
- 要脱壳/反编译原生 APP → 超出 web 赏金范围（reverse-skill 的 APK/二进制模块，暂未接入）
- 纯代码 review 不看运行系统 → `code-reviewer`
