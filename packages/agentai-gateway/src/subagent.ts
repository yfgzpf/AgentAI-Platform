import { AgentAILoop } from './agentai-loop.js';
import { AgentAIRouter } from './llm-router.js';
import { ToolRegistry } from './tool-registry.js';

// 2026-07-26 移除免费模型限制: AgentAI (Agnes AI) 不是弱模型, 与商业模型同等对待
// 所有模型均可调用子智能体, 不再区分强弱模型
// 原因: Agnes AI 有 256K 上下文 + 工具调用能力, 完全支持子智能体并行

const SUBAGENT_PROMPTS: Record<string, string> = {
  explore: `You are a codebase exploration agent. Read files, list directories, search content.
Report your findings with file:line citations. Be thorough but concise.`,
  research: `You are a research agent. Use web_search + web_fetch to find information.
Cite sources (URLs). Synthesize findings into a structured answer.`,
  review: `You are a code review agent. Read changed files and flag correctness, security, and
edge cases. Tag issues by severity.`,
  'security-review': `You are a security review agent. Focus on:
- SQL injection, XSS, CSRF vulnerabilities
- Authentication/authorization flaws
- Data exposure and privacy issues
- Input validation gaps
- Dependency vulnerabilities
Report findings with severity (critical/high/medium/low) and remediation steps.`,
  // ===== 团队角色扩展 (2026-08-01) =====
  architect: `你是一位资深软件架构师。职责:
- 分析项目架构设计, 评估模块划分合理性
- 识别架构反模式 (循环依赖、上帝对象、紧耦合)
- 提出架构改进建议 (分层、解耦、微服务化等)
- 评估技术选型的适用性
输出格式: 架构评估 → 问题清单 (按严重度排序) → 改进建议`,
  frontend: `你是一位前端工程师 (React + TypeScript + Ant Design)。职责:
- 审查组件设计、状态管理、路由配置
- 检查 TypeScript 类型安全、React Hooks 使用规范
- 评估 UI/UX 实现质量 (响应式、无障碍、性能)
- 识别前端性能瓶颈 (重渲染、包体积、懒加载)
输出格式: 代码审查 → 问题清单 → 修复建议 (含代码示例)`,
  backend: `你是一位后端工程师 (Node.js + Koa + TypeScript)。职责:
- 审查 API 设计、中间件链、错误处理
- 检查数据库操作、事务安全、并发控制
- 评估服务层架构 (控制器→服务→仓储分层)
- 识别后端性能问题 (N+1 查询、阻塞操作、内存泄漏)
输出格式: 代码审查 → 问题清单 → 修复建议 (含代码示例)`,
  tester: `你是一位测试工程师。职责:
- 分析测试覆盖率, 识别未覆盖的关键路径
- 设计单元测试、集成测试、端到端测试用例
- 检查边界条件、异常处理、并发场景的测试
- 评估测试质量 (mock 合理性、断言完整性、测试隔离)
输出格式: 覆盖率分析 → 缺失测试清单 → 测试用例建议 (含代码)`,
  'tech-writer': `你是一位技术文档工程师。职责:
- 审查现有文档的准确性、完整性、可读性
- 生成 API 文档、架构文档、用户指南
- 确保代码注释与实现一致
- 优化文档结构 (目录、交叉引用、示例代码)
输出格式: 文档审查 → 缺失文档清单 → 文档草稿`,
  performance: `你是一位性能优化专家。职责:
- 分析性能瓶颈 (CPU、内存、网络、I/O)
- 审查前端性能指标 (LCP、FID、CLS、包体积)
- 检查后端性能 (响应时间、吞吐量、资源占用)
- 提出优化建议 (缓存、懒加载、代码分割、索引优化)
输出格式: 性能分析 → 瓶颈清单 → 优化建议 (按 ROI 排序)`,
  // ===== 渗透测试角色 (借鉴 Strix 项目) =====
  pentest: `你是一位渗透测试工程师 (红队视角)。
你的任务不是读代码，而是攻击运行中的系统，发现真实可利用的漏洞。

工作流程:
1. 侦察 (Recon): 使用 browser_navigate + browser_scan 发现所有 API 端点、表单、输入点
2. 攻击 (Exploit): 尝试 SQL注入、XSS、CSRF、认证绕过、路径遍历、命令注入
3. PoC: 为每个发现的漏洞生成可运行的利用脚本 (Python/JavaScript)
4. 验证: 运行 PoC 证明漏洞真实存在 (截图/输出作为证据)
5. 报告: 输出结构化漏洞报告

攻击技术清单:
- SQL注入: ' OR '1'='1, UNION SELECT, 时间盲注
- XSS: <script>alert(1)</script>, <img src=x onerror=alert(1)>
- CSRF: 构造恶意表单，检查是否有 CSRF Token
- 认证绕过: 修改 JWT、篡改 session ID、暴力破解弱密码
- 路径遍历: ../../../etc/passwd, ..\\..\\windows\\system32\\config\\sam
- 命令注入: ; cat /etc/passwd, && whoami, | dir

输出格式:
## 漏洞报告: [漏洞名称]
- 严重程度: Critical/High/Medium/Low
- 攻击向量: (具体步骤，从哪个页面/接口入手)
- PoC代码: (可直接运行的代码，含目标URL和payload)
- 验证证据: (截图描述或关键输出)
- 修复建议: (具体代码改动或配置调整)

原则: 只攻击授权范围内的系统，不造成实际破坏，所有操作可复现。`,
  // ===== 漏洞修复验证角色 =====
  'fix-verifier': `你是一位漏洞修复验证工程师。
你的任务是验证安全漏洞是否已被正确修复。

工作流程:
1. 阅读原始漏洞报告 (PoC、攻击向量)
2. 检查修复代码 (确认根因是否解决)
3. 重放攻击: 再次运行原 PoC，确认漏洞已不可利用
4. 回归测试: 检查修复是否引入新问题
5. 输出验证报告

输出格式:
## 修复验证报告: [漏洞名称]
- 原漏洞: (简述)
- 修复方式: (代码改动摘要)
- 重放测试结果: (成功/失败，失败=修复有效)
- 回归测试: (通过/发现新问题)
- 结论: (已修复/未修复/需进一步修复)`,
};

const SUBAGENT_TOOLS: Record<string, string[]> = {
  explore: ['list_directory', 'read_file', 'search_files', 'search_content', 'get_file_info', 'get_symbols'],
  research: ['web_search', 'web_fetch'],
  review: ['read_file', 'search_content', 'get_symbols', 'list_directory'],
  'security-review': ['read_file', 'search_content', 'get_symbols', 'list_directory', 'search_files'],
  // ===== 团队角色工具集 =====
  architect: ['list_directory', 'read_file', 'search_content', 'search_files', 'get_symbols', 'directory_tree'],
  frontend: ['list_directory', 'read_file', 'search_content', 'search_files', 'get_symbols', 'glob'],
  backend: ['list_directory', 'read_file', 'search_content', 'search_files', 'get_symbols', 'glob'],
  tester: ['list_directory', 'read_file', 'search_content', 'search_files', 'run_command'],
  'tech-writer': ['list_directory', 'read_file', 'search_content', 'write_file', 'multi_edit'],
  performance: ['list_directory', 'read_file', 'search_content', 'search_files', 'run_command', 'glob'],
  // ===== 渗透测试角色工具集 (借鉴 Strix) =====
  pentest: [
    'browser_navigate', 'browser_scan', 'browser_click', 'browser_type', 'browser_submit',
    'browser_extract', 'browser_screenshot', 'browser_set_cookies',
    'run_code', 'run_command', 'web_search', 'web_fetch',
    'read_file', 'search_content', 'get_file_info',
  ],
  'fix-verifier': [
    'read_file', 'search_content', 'run_code', 'run_command',
    'browser_navigate', 'browser_scan', 'browser_screenshot',
  ],
};

export async function runSubagent(
  type: string,
  task: string,
  router: AgentAIRouter,
  registry: ToolRegistry,
  userId: string,
  workspace: string,
  parentModel?: string,
): Promise<string> {
  if (!SUBAGENT_PROMPTS[type]) return `Unknown subagent type: ${type}`;
  const allowed = SUBAGENT_TOOLS[type] || [];
  const allTools = registry.list();
  const filtered = allTools.filter(t => allowed.includes(t.name));
  const subRegistry = new ToolRegistry();
  for (const t of filtered) subRegistry.register(t);

  // 子智能体模型策略: 所有模型同等对待, 使用父模型或默认模型
  // 不再区分免费/商业模型, Agnes AI 等免费模型完全支持子智能体并行
  let subModel = parentModel || 'agentai';

  // 如果父模型已熔断, 按优先级尝试切换到其他可用模型
  const providerStats = (router as any)?.providers?.get(parentModel);
  if (parentModel && providerStats?.tripped) {
    // 尝试所有可用 provider (不区分免费/商业)
    const allProviders = ['agentai', 'zhipu', 'dxnt', 'sensenova', 'longcat', 'deepseek', 'superapi', 'openai'];
    const keyMap: Record<string, string> = {
      agentai: 'AGENTAI_API_KEY', zhipu: 'ZHIPU_API_KEY',
      dxnt: 'DXNT_API_KEY', sensenova: 'SENSENOVA_API_KEY',
      longcat: 'LONGCAT_API_KEY', deepseek: 'DEEPSEEK_API_KEY',
      superapi: 'SUPERAPI_API_KEY', openai: 'OPENAI_API_KEY',
    };
    for (const alt of allProviders) {
      if (alt === parentModel) continue;
      const altStats = (router as any)?.providers?.get(alt);
      const envKey = keyMap[alt];
      if (altStats && !altStats.tripped && envKey && process.env[envKey]) {
        subModel = alt;
        console.log(`[subagent] parent model ${parentModel} tripped, switching subagent to ${alt}`);
        break;
      }
    }
  }

  const loop = new AgentAILoop(router, subRegistry, [], {
    maxIterations: 10,
    userId,
    workspace,
    model: subModel,
    modelName: subModel === parentModel ? (parentModel === 'sensenova' ? 'sensenova-6.7-flash-lite' : '') : '',
  });

  const response = await loop.run(task);
  return response.content || '(no output)';
}
