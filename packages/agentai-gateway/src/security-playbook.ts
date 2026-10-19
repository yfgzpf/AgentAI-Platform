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

## 阶段 5 · 报告 + 固化经验
report_vulnerability (evidencePaths 至少一项) → record_pentest_experience (成功/失败都记!)
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
  'wsl_scan', 'enum_subdomains', 'extract_js_endpoints', 'http_replay', 'batch_pentest',
  'scope_guard', 'grant_scope', 'list_scope', 'report_vulnerability', 'save_evidence',
  // 2026-10-19: 经验/漏洞库 + 串链编排也算"用了专用工具" ——
  //   否则 AI 开工先查一下历史经验, 却被判成"偏离"而被纠正, 荒谬。
  'search_pentest_experience', 'search_vulns', 'record_pentest_experience', 'pentest_pipeline',
  'wsl_exec',
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
