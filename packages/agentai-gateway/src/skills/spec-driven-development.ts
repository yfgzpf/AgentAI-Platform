/**
 * Spec-Driven Development — 结构化 PRD 生成
 * 
 * 需求模糊时，先自动生成 PRD 模板，明确：
 * - 目标（Goal）
 * - 边界（Scope）
 * - 验收标准（Acceptance Criteria）
 * - 测试标准（Test Criteria）
 * 
 * 然后基于 PRD 再执行 plan_task 拆分子任务。
 */

export interface PRD {
  /** 需求标题 */
  title: string;
  /** 需求描述（用户故事格式）*/
  userStory: string;
  /** 目标 */
  goal: {
    primary: string;
    secondary?: string[];
  };
  /** 边界（包含/不包含）*/
  scope: {
    inScope: string[];
    outOfScope: string[];
  };
  /** 验收标准 */
  acceptanceCriteria: {
    mustHave: string[];
    shouldHave?: string[];
    niceToHave?: string[];
  };
  /** 测试标准 */
  testCriteria?: {
    unitTests: string[];
    integrationTests?: string[];
    performance?: {
      responseTime?: string;
      throughput?: string;
    };
  };
  /** 依赖/前提条件 */
  dependencies?: string[];
  /** 风险/注意事项 */
  risks?: string[];
  /** 时间估算（可选）*/
  timeEstimate?: string;
}

/**
 * 检测需求是否模糊
 */
export function isVagueRequest(request: string): boolean {
  const vaguePatterns = [
    /帮我.*功能/i,
    /做一个.*功能/i,
    /添加.*功能/i,
    /实现.*功能/i,
    /搞.*功能/i,
    /弄.*功能/i,
    /加.*功能/i,
    /写.*功能/i,
    /开发.*功能/i,
    /创建.*功能/i,
    /增加.*功能/i,
    /完善.*功能/i,
    /优化.*功能/i,
    /改进.*功能/i,
    /修复.*功能/i,
    /支持.*功能/i,
    /让.*支持/i,
    /使.*可以/i,
    /能不能.*功能/i,
    /有没有.*功能/i,
    /怎么.*功能/i,
    /如何.*功能/i,
  ];

  return vaguePatterns.some(pattern => pattern.test(request));
}

/**
 * 生成 PRD 模板
 */
export function generatePRD(request: string): PRD {
  // 从请求中提取标题
  const title = extractTitle(request);

  // 生成用户故事
  const userStory = generateUserStory(request);

  // 生成目标
  const goal = generateGoal(request);

  // 生成边界
  const scope = generateScope(request);

  // 生成验收标准
  const acceptanceCriteria = generateAcceptanceCriteria(request);

  // 生成测试标准
  const testCriteria = generateTestCriteria(request);

  // 生成依赖
  const dependencies = generateDependencies(request);

  // 生成风险
  const risks = generateRisks(request);

  return {
    title,
    userStory,
    goal,
    scope,
    acceptanceCriteria,
    testCriteria,
    dependencies,
    risks,
  };
}

/**
 * 从请求中提取标题
 */
function extractTitle(request: string): string {
  // 尝试提取核心关键词
  const match = request.match(/(帮我|做一个|添加|实现|搞|弄|加|写|开发|创建|增加|完善|优化|改进|修复|支持|让|使|能不能|有没有|怎么|如何)\s*(.+?)(功能|模块|系统|组件|工具|页面|接口|API)?/i);
  if (match && match[2]) {
    return match[2].trim().slice(0, 50);
  }
  return '新需求';
}

/**
 * 生成用户故事
 */
function generateUserStory(request: string): string {
  // 尝试识别用户角色
  let role = '用户';
  if (request.includes('管理员') || request.includes('admin')) {
    role = '管理员';
  } else if (request.includes('访客') || request.includes('guest')) {
    role = '访客';
  } else if (request.includes('开发者') || request.includes('dev')) {
    role = '开发者';
  } else if (request.includes('客户') || request.includes('customer')) {
    role = '客户';
  }

  return `作为 **${role}**，我希望 ${request.replace(/帮我|做一个|添加|实现|搞|弄|加|写|开发|创建|增加|完善|优化|改进|修复|支持|让|使/i, '').trim()}，以便更好地完成相关任务。`;
}

/**
 * 生成目标
 */
function generateGoal(request: string): PRD['goal'] {
  return {
    primary: request.trim().slice(0, 100),
    secondary: [
      '确保功能符合预期且易于使用',
      '遵循项目现有的代码规范和架构',
      '提供清晰的错误处理和用户反馈',
    ],
  };
}

/**
 * 生成边界
 */
function generateScope(request: string): PRD['scope'] {
  return {
    inScope: [
      '实现核心功能需求',
      '提供必要的用户界面或接口',
      '编写单元测试确保功能正确性',
      '更新相关文档（如适用）',
    ],
    outOfScope: [
      '与当前需求无关的额外功能',
      '大规模架构重构（除非明确提及）',
      '性能优化（除非明确提及）',
    ],
  };
}

/**
 * 生成验收标准
 */
function generateAcceptanceCriteria(request: string): PRD['acceptanceCriteria'] {
  return {
    mustHave: [
      '功能按需求描述正常工作',
      '无明显的 bug 或崩溃',
      '代码通过类型检查和 lint 检查',
      '有基本的单元测试覆盖',
    ],
    shouldHave: [
      '代码结构清晰，遵循项目规范',
      '有适当的错误处理和日志记录',
      '用户界面（如有）符合设计标准',
    ],
    niceToHave: [
      '有完整的文档说明',
      '有性能基准测试',
      '有用户手册或帮助文档',
    ],
  };
}

/**
 * 生成测试标准
 */
function generateTestCriteria(request: string): PRD['testCriteria'] {
  return {
    unitTests: [
      '核心功能必须有单元测试',
      '边界条件和异常输入必须测试',
      '测试覆盖率至少 70%',
    ],
    integrationTests: request.includes('API') || request.includes('接口') ? [
      'API 接口必须有集成测试',
      '测试各种输入参数的有效性',
    ] : undefined,
    performance: undefined,
  };
}

/**
 * 生成依赖
 */
function generateDependencies(request: string): string[] | undefined {
  const deps: string[] = [];

  if (request.includes('数据库') || request.includes('database')) {
    deps.push('数据库设计和迁移脚本');
  }
  if (request.includes('API') || request.includes('接口')) {
    deps.push('API 接口定义和文档');
  }
  if (request.includes('前端') || request.includes('UI') || request.includes('界面')) {
    deps.push('前端组件设计和实现');
  }
  if (request.includes('第三方') || request.includes('external')) {
    deps.push('第三方服务集成和认证');
  }

  return deps.length > 0 ? deps : undefined;
}

/**
 * 生成风险
 */
function generateRisks(request: string): string[] | undefined {
  const risks: string[] = [];

  if (request.includes('生产') || request.includes('prod')) {
    risks.push('生产环境变更需要谨慎处理，建议先在测试环境验证');
  }
  if (request.includes('安全') || request.includes('security')) {
    risks.push('安全相关功能需要额外的安全审查和测试');
  }
  if (request.includes('性能') || request.includes('performance')) {
    risks.push('性能优化需要基准测试验证，避免引入回归');
  }

  return risks.length > 0 ? risks : undefined;
}

/**
 * 格式化 PRD 为 Markdown
 */
export function formatPRD(prd: PRD): string {
  const lines: string[] = [];

  lines.push(`# 📋 PRD: ${prd.title}`);
  lines.push('');
  lines.push('## 用户故事');
  lines.push(`> ${prd.userStory}`);
  lines.push('');

  lines.push('## 目标');
  lines.push(`**主要目标**：${prd.goal.primary}`);
  if (prd.goal.secondary && prd.goal.secondary.length > 0) {
    lines.push('');
    lines.push('**次要目标**：');
    for (const s of prd.goal.secondary) {
      lines.push(`- ${s}`);
    }
  }
  lines.push('');

  lines.push('## 边界');
  lines.push('### ✅ 包含');
  for (const item of prd.scope.inScope) {
    lines.push(`- ${item}`);
  }
  lines.push('');
  lines.push('### ❌ 不包含');
  for (const item of prd.scope.outOfScope) {
    lines.push(`- ${item}`);
  }
  lines.push('');

  lines.push('## 验收标准');
  lines.push('### 🔴 必须');
  for (const item of prd.acceptanceCriteria.mustHave) {
    lines.push(`- [ ] ${item}`);
  }
  if (prd.acceptanceCriteria.shouldHave && prd.acceptanceCriteria.shouldHave.length > 0) {
    lines.push('');
    lines.push('### 🟡 应该');
    for (const item of prd.acceptanceCriteria.shouldHave) {
      lines.push(`- [ ] ${item}`);
    }
  }
  if (prd.acceptanceCriteria.niceToHave && prd.acceptanceCriteria.niceToHave.length > 0) {
    lines.push('');
    lines.push('### 🟢 可选');
    for (const item of prd.acceptanceCriteria.niceToHave) {
      lines.push(`- [ ] ${item}`);
    }
  }
  lines.push('');

  if (prd.testCriteria) {
    lines.push('## 测试标准');
    lines.push('### 单元测试');
    for (const item of prd.testCriteria.unitTests) {
      lines.push(`- ${item}`);
    }
    if (prd.testCriteria.integrationTests && prd.testCriteria.integrationTests.length > 0) {
      lines.push('');
      lines.push('### 集成测试');
      for (const item of prd.testCriteria.integrationTests) {
        lines.push(`- ${item}`);
      }
    }
    lines.push('');
  }

  if (prd.dependencies && prd.dependencies.length > 0) {
    lines.push('## 依赖/前提条件');
    for (const dep of prd.dependencies) {
      lines.push(`- ${dep}`);
    }
    lines.push('');
  }

  if (prd.risks && prd.risks.length > 0) {
    lines.push('## ⚠️ 风险/注意事项');
    for (const risk of prd.risks) {
      lines.push(`- ${risk}`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('> 💡 **下一步**：确认 PRD 后，使用 \`plan_task\` 拆分子任务，然后逐步执行。');

  return lines.join('\n');
}

/**
 * 完整流程：检测模糊需求 → 生成 PRD → 询问确认
 */
export function processVagueRequest(request: string): {
  shouldGeneratePRD: boolean;
  prd?: PRD;
  prdMarkdown?: string;
  nextStep: string;
} {
  if (!isVagueRequest(request)) {
    return {
      shouldGeneratePRD: false,
      nextStep: '直接执行任务',
    };
  }

  const prd = generatePRD(request);
  const prdMarkdown = formatPRD(prd);

  return {
    shouldGeneratePRD: true,
    prd,
    prdMarkdown,
    nextStep: '展示 PRD 给用户确认，确认后调用 plan_task 拆分子任务',
  };
}