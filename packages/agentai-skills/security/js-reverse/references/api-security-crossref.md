# API Security 交叉参考 — 接回 api-security 技能

> 本文件是 `js-reverse` 技能的补充参考。**越权/未授权/BOLA/IDOR 的完整打法清单以 `api-security` 技能为权威来源**（同目录 `../api-security/SKILL.md`），不要在此重复维护，避免漂移。

## 为什么需要这本参考

`js-reverse` 解决「接口要算 sign/token 怎么复现」，复现出能发请求之后，**赏金价值在越权/未授权**——这部分交给 `api-security` 技能。本文件只保留「JS 复现 → 转 API 越权测试」的桥接逻辑。

## 桥接流程

1. **js-reverse 五阶段**产出可复现的签名算法 + 一个能跑通的 `http_replay` 请求样本。
2. 把样本交给 `api-security` 技能执行：
   - 端点枚举不足 → `api-security` Phase 1（ffuf 两形态前缀 + `/api-docs`）。
   - 验证越权/未授权 → `api-security` Phase 3（BOLA/IDOR/未授权/双会话对比，evidence before claim）。
   - 输入验证 / 数据暴露 → `api-security` Phase 5 / Phase 9。
3. 所有「已测/已排除/已确认发现」写入 `save_target_state`（赏金跨会话记忆已无条件注入，勿重复踩坑）。

## 工具映射速查（详见 api-security 技能）

| 原工具 | PulseFlow |
|--------|-----------|
| `ffuf` / kiterunner | `wsl_scan({tool:"ffuf", args:[...]})` |
| `Burp Repeater` | `http_replay` |
| 双会话对比 curl | 两个 `http_replay` 调用 + diff |
| `jwt_tool` | git clone + `wsl_exec` 跑（Kali 已有） |

## 来源

- 越权打法浓缩自 `zhaoxuya520/reverse-skill` 的 `skills/api-security/` SKILL.md；已剥离其 MCP 专有工具名映射到 PulseFlow 现有链。
- 完整版见赏金工作区：`F:\挖洞赏金\output\jxnu\bounty-playbook-reverse-skill.md`。
