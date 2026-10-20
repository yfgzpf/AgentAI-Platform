/**
 * 渗透任务工作流 Playbook (2026-10-19)
 *
 * 背景 (富哥实锤): 渗透赏金任务里 AI "只用了普通工具" —— web_search / run_code /
 *   write_file / run_command 轮番上阵, 连写 probe8.js → getcaptcha.js → probe_pay10.js,
 *   而 wsl_scan (nmap/nuclei/sqlmap) / http_replay / enum_subdomains 一个不碰。
 *
 * 排查结论 (逐层证伪, 不是拍脑袋):
 *   1. 工具管道 ✅ 已修 (commit 3c4710f): security_ops 组 + TASK_TYPE_TOOL_MAP.security
 *      + PRIORITY_TOOLS 含 10 个渗透工具 + autonomous 档 security 例外收敛, 日志可见
 *      "security task → 收敛到 N 个工具"。
 *   2. taskType 判定 ✅ 有 security 单向棘轮 (1288/2600 两处), "继续"类短句不掉档。
 *   3. 工具描述 ✅ wsl_scan 描述已含触发场景/参数/示例, 质量不差。
 *   4. 🔴 **行为层为零**: batch_pentest 的子智能体 task 里有完整方法论
 *      ("全工具重扫 wsl_scan nmap 指纹 + nuclei owasp-top10 + sqlmap risk1 + http_replay ..."),
 *      但**主对话的 system prompt 一个字都没有** —— AI 在主对话里挖洞时,
 *      没有任何"阶段流程 + 工具组合"指导, 只能按训练直觉走: 最熟的路是写脚本。
 *   5. 🟡 wsl_scan 在 Kali 未安装时返回的是底层 execFile 错误, 不带可执行指引
 *      → AI 试一次失败就绕道, 且再也不用 (失败不可行动 = 永久绕路)。
 *
 * 本模块补 4 (主对话 Playbook) 与 5 (失败分类见 tools.ts wsl_scan catch)。
 *
 * ⚠️ 长度纪律: 本片段每轮都进 immutablePrefix, 控制在 ~1200 字符。
 *   架构师最高优先担忧就是"决策层注入膨胀"——所以只写"阶段+工具组合+铁律",
 *   不写漏洞原理教科书 (那是模型自己的知识, 不用我们教)。
 */

/** 五阶段渗透工作流 — 主对话注入用 (静态, 不含 Kali 探测状态) */
export const SECURITY_PLAYBOOK = `# 🔒 渗透任务工作流 (按阶段推进, 禁止跳级手搓)

当前是【安全测试】任务。授权范围与专用工具已就绪, 按 5 个阶段走。
每个阶段都给了"工具组合", **优先用专用工具**。

## 阶段 0 · 开工先查历史 (别重复劳动, 这一步最省钱)
search_pentest_experience (按根域/漏洞类型/技术栈) + search_vulns (同类资产历史漏洞)。
它们已经固化了这个工作区和全局的历史打法 —— 别人踩过的坑、你上次踩过的坑都在里面。
查完再决定打哪里、走哪条路。没查到就直接进阶段 1。

## 阶段 1 · 授权确认 (每个新目标只做一次)
list_scope 看授权范围 → 目标不在内就 grant_scope({target}) → scope_guard 复核。
未授权目标一律不扫, 这是安全底线。

## 阶段 2 · 资产侦察 (先搞清楚打什么)
组合: enum_subdomains (子域枚举) → wsl_scan(subfinder/httpx 存活探测) → extract_js_endpoints (JS 端点提取)
出口: 一份"存活主机 + 开放端口 + JS 端点"清单。

## 阶段 3 · 漏洞扫描 (用现成火力, 不要自己造)
组合: wsl_scan(nmap -sV 指纹) → wsl_scan(nuclei -tags cve,misconfig) → wsl_scan(sqlmap, 只对可疑参数)
出口: nuclei/sqlmap 有产出, 或明确记录"无命中"。

## 阶段 4 · 验证与深挖 (真复现才算洞)
组合: http_replay (改 header/参数重放, 对比登录/未登录响应差异) → browser_navigate (需 JS 渲染时)
出口: 每个疑似洞都 save_evidence 落盘 (截图或请求响应)。
复现成功拿到完整请求/响应原文后, **再调 save_and_hash_evidence 打防篡改证据包** (SHA-256) —
提交赏金平台时引用该哈希, 平台方 verify 即可证明证据未被改动。截图类证据仍用 save_evidence。

## 阶段 5 · 报告 + 固化经验
report_vulnerability (evidencePaths 至少一项; 报告里写 "证据包 SHA-256: <hash>") → record_pentest_experience (成功/失败都记!)
未复现的洞不要写进报告。**收尾必须记经验** —— 下一轮任务才能复用这次的教训。

## 深度挖洞: 用串链编排, 别手工 spawn 四次
pentest_pipeline({ target }) 一键跑 规划→侦察→执行→验证 四角色串链, 每阶段自动继承
上一阶段的发现。适合"目标明确、要挖得深"的场景。
小目标/单点验证仍按上面 5 阶段自己走, 更省 token。

## 工具选择铁律 (违反=跑偏)
- 要"真扫端口/目录/指纹" → **wsl_scan**, 不要 run_command 手拼 nmap/curl
- 要"改一个 header/参数看响应差异" → **http_replay**, 不要 run_code 写 fetch 脚本
- 要"枚举子域/端点" → **enum_subdomains / extract_js_endpoints**, 不要 web_search 猜
- 要"复用历史打法" → **search_pentest_experience / search_vulns**, 不要凭记忆硬打
- 要"确认越权/未授权" → **diff_replay** (两身份对比, 机械判定 auth-bypass/permission-diff/data-leak), 不要肉眼读两段 body
- 要"知道这个框架该试什么" → **fingerprint_target** (技术栈→定向攻击面, 带停线), 不要泛泛扫 OWASP
- 要"把挖到的洞出成可提交报告" → **bounty_report** (聚合 vulns.jsonl + 证据, 直接贴 SRC 平台过审), 不要手工拼 markdown
- 要"平台审核争议时证明证据没被改过" → **save_and_hash_evidence** (完整请求/响应原文 + SHA-256 防篡改证据包; 复现成功后就地固化, 报告里引用哈希), 不要只贴对话截图
- 要"盲测不确定是否真中" → **oob_register + oob_check** (盲 XSS/SSRF/异步 RCE/DNS 外带, 网关自带回连监听, 不依赖第三方 OAST)。别凭"可能触发了"主观判断
- 要"多天 engagement 不重复劳动" → **save_target_state / load_target_state** (记录目标已扫资产/已测端点/已排除项/待打攻击面/WAF遭遇, 跨会话继承进度)。pentest_pipeline 开工自动注入, 阶段收尾随手 save
- 要"判断响应是否被 WAF 拦/限流/验证码" → **classify_response** (http_replay 已自动附加分析; 也可手动分析 browser/手工 fetch 的响应)。被拦时按建议退避/换 UA/加 XFF/走 browser, 别硬刚
- 要"把'能下载'变成'能定级'" → **impact_proof**: plan=证明链+停线, check=查红线, evaluate=打分 (C 级不许出报告)
- ⛔ **发现特征不许停**: 走完证明链, 答全"谁受影响/前置条件/最坏后果"。但不许为证明而真造成损害
  (批量拿 PII/取云 AK/接管账号/真实扣款) — 违法且 SRC 拒收。**定级看"能影响"不是"已损害"**。
- ⛔ **业务逻辑篡改有代码级闸门** (场景 D): price/amount/quantity 改成 0 或负值、redirect_uri/callback
  指向外部 host 的请求, dispatch 层直接拦 — auto 模式拒绝, planning/review 需人类审批 (超时=拒)。
  拆参数/编码/换工具都绕不过 (闸门看载荷形态)。只评估不建议真打; 项目书面允许也不行, 必须人类审批那一步。
- 定向打击链 (发现对应资产时): 云 Key 泄露 → 单次请求验有效性即停 + 量化盗刷危害; IDOR → 遍历 ≤50 个 ID
  (间隔 ≥1s), 出现 3 类敏感数据 (身份证/手机号/姓名/银行卡/内部配置/DB 串) 立刻停止并脱敏;
  OSS/S3 → 单次 list, 只下载一个样本即停。云服务商 API host 不在目标授权内, 先取得用户同意再打。
- 要"在 Kali/WSL 里装工具或跑命令" → **wsl_exec** (数组化, 不经 cmd.exe)。
  ⛔ **绝对不要用 run_command 跑 wsl ... bash -lc "长脚本"** —— cmd.exe 会剥掉外层引号,
  wsl.exe 再拆一次词, 内层 bash 的参数被截断成只剩第一个词 (报 syntax error near unexpected token)。
  这是结构性破坏, 换参数救不回来, 别重试。
- 只有上述工具都试过且明确不适用的场景, 才允许 run_command 补位
- 手搓脚本连续失败 2 次 → 立刻换回专用工具, 不要换文件名重试 (probe8.js → probe_pay10.js 这种)

## 节奏
每个阶段结束先汇报进展再进下一阶段; 单目标工具调用控制在 12 次内收尾, 别空耗。`;

/**
 * 偏离纠正指令 — security 任务下 AI 连续用通用工具时注入 (复用 tool-breaker 模式)。
 * 阈值与纯函数见 agentai-loop.ts shouldTripToolDeviation。
 */
export const TOOL_DEVIATION_DIRECTIVE = `⚠️ 偏离纠正: 你已经连续多轮只用通用工具 (run_command / run_code / web_fetch / write_file),
而当前是【安全测试】任务。手搓脚本火力弱、易死循环、烧额度 —— 这是实锤过的坑
(连写 probe8.js → getcaptcha.js → probe_pay10.js 被熔断)。
立刻换回专用工具: wsl_scan (nmap/nuclei/sqlmap 真实扫描) / http_replay (请求重放看差异) /
enum_subdomains (子域) / extract_js_endpoints (端点)。先看上面的渗透工作流走到哪个阶段了。`;

/** security_ops 组工具名 — 用于"是否用了专用工具"判定 (与 tool-groups.ts 同源, 复制避免循环依赖) */
export const SECURITY_OPS_TOOLS: ReadonlySet<string> = new Set([
  'wsl_scan', 'enum_subdomains', 'extract_js_endpoints', 'http_replay', 'diff_replay',
  'fingerprint_target', 'identity_manage', 'request_mutator', 'recheck_finding',
  'historical_assets', 'js_deep_scan', 'duplicate_check', 'batch_pentest',
  'scope_guard', 'grant_scope', 'list_scope', 'report_vulnerability', 'save_evidence',
  // 2026-10-20 ②: 防篡改证据包 — 赏金平台提交的硬通货, 同样算"用了专用工具"
  'save_and_hash_evidence',
  // 2026-10-19: 经验/漏洞库 + 串链编排也算"用了专用工具" ——
  //   否则 AI 开工先查一下历史经验, 却被判成"偏离"而被纠正, 荒谬。
  'search_pentest_experience', 'search_vulns', 'record_pentest_experience', 'pentest_pipeline',
  'wsl_exec', 'bounty_report', 'oob_register', 'oob_check', 'save_target_state', 'load_target_state', 'classify_response',
  'impact_proof',
]);

/**
 * 纯函数: 是否该触发偏离纠正 (生产 + 测试共用, 不在测试里复写逻辑)
 *
 * @param consecutiveGeneric security 任务下连续使用通用工具的轮数 (用了专用工具即清零)
 * @param threshold 触发阈值, 默认 6 (给 AI 足够试错空间, 但不容忍 51 次那种)
 */
export function shouldTripToolDeviation(consecutiveGeneric: number, threshold = 6): boolean {
  return consecutiveGeneric >= threshold;
}
