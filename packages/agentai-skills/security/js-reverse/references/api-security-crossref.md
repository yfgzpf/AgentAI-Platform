# API Security 交叉参考 — 接回 pentest-workflow 的越权打法

本文件是 `js-reverse` 技能的补充参考。当你用本技能复现出签名、能发请求之后，**赏金价值在越权/未授权**，这部分与 `pentest-workflow` 同源，这里把 reverse-skill 的 `api-security` 模块浓缩成可直接照做的清单。

## 关键 Phase（映射到 PulseFlow 工具）

### Phase 1 — 发现（你已在做）

- 端点枚举：`extract_js_endpoints` 刨 SPA JS + `wsl_scan({tool:"ffuf"})` 对真实前缀两形态爆破（`/api/X` 与 `/X`）+ 查 `/api-docs`、`/swagger`、`/v2/api-docs`。
- 参数枚举：ffuf 跑 `?id=`/`?uid=`/`?file=`/`?path=` 类参数，看哪些返回区别于 404。
- ⚠️ SPA catch-all 误报：根路径全返回 `text/html` size 5714 那是前端路由兜底的**假 200**，不是真端点。判据真端点：**有差异化 JSON 响应 / 真实 API 路径 / 非 SPA 外壳**。

### Phase 3 — BOLA / IDOR / 未授权（赏金主战场）

| 手法 | 操作 | 工具 |
|------|------|------|
| **BOLA（对象级越权）** | 用账号 A 拿到的资源 id/uuid，换成账号 B 的会话去请求同一接口，看能否读到 B 的数据 | `http_replay`（换 session/token 重放） |
| **IDOR（参数可遍历）** | 把 `?id=1001` 改成 `1002`/`1000`，看是否返回他人数据（整数序 + UUID 两种都试） | `http_replay` |
| **未授权直访问** | 去掉 `Authorization`/`Cookie`/复现出的 `sign`，看接口是否仍返回数据 | `http_replay`（匿名重放） |
| **水平/垂直越权** | 普通用户 token 加 `X-Original-User: admin` / 改 `role` 字段，看能否到管理功能 | `http_replay` |
| **响应差异比对** | 同一接口"有 sign / 无 sign""登录 / 匿名"两形态响应 diff，坐实越权再下结论 | `run_command` 跑 diff / 人工比对 |

⚠️ **坐实再下结论**：reverse-skill 原 repo 的核心纪律是「evidence before claim」。任何"疑似越权"都要按 pentest-workflow 的"影响证明"纪律用**自己的两个测试账号**交叉验证、PII 脱敏、只取 1-3 条样本，**未复现的不写 `report_vulnerability`**。

## 触发词 → 调哪块

| 场景 | 调 |
|------|----|
| 接口要算 sign/token、参数被加密 | 本技能 `js-reverse`（五阶段） |
| 拿到签名后想打越权/未授权 | 回 `pentest-workflow` + 本文件 Phase 3 |
| 从零挖一个授权目标的 API | `bounty-target-picker` → `pentest-workflow`（Phase 1 发现） |

## 工具映射（reverse-skill api-security → PulseFlow）

| 原工具 | PulseFlow |
|--------|-----------|
| `ffuf` | `wsl_scan({tool:"ffuf", args:[...]})` |
| `httpx` | `wsl_scan({tool:"httpx"})` |
| `nuclei -tags owasp` | `wsl_scan({tool:"nuclei", args:["-tags","owasp-top10","-etags","dos"]})` |
| `Burp Repeater` | `http_replay` |
| `jwt_tool` | git clone + `wsl_exec` 跑（Kali 已有） |
| 双会话对比 curl | 两个 `http_replay` 调用 + diff |

## 来源

- 浓缩自 `zhaoxuya520/reverse-skill` 的 `skills/js-reverse/` 与 `skills/api-security/` SKILL.md（37k stars，领域 playbook 质量高；其路由框架对 PulseFlow 冗余，未接入）。
- 已剥离原 repo 的 MCP 专有工具名（js-reverse-mcp/jshookmcp 等），映射到 PulseFlow 现有链。
- 完整版见赏金工作区：`F:\挖洞赏金\output\jxnu\bounty-playbook-reverse-skill.md`。
