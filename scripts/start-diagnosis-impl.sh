#!/bin/bash
# ATLAS 诊断优先主链路实施启动脚本
# 用法: ./scripts/start-diagnosis-impl.sh

set -e

echo "🚀 ATLAS 诊断优先主链路实施启动"
echo "=================================="
echo ""

# 检查分支
echo "📋 步骤 1: 检查 Git 状态"
if [ -n "$(git status --porcelain)" ]; then
    echo "❌ 工作区有未提交更改，请先提交"
    exit 1
fi

echo "✅ 工作区干净"
echo ""

# 创建分支
echo "📋 步骤 2: 创建功能分支"
BRANCH_NAME="feature/diagnosis-pipeline"
git checkout -b "$BRANCH_NAME"
echo "✅ 已创建分支: $BRANCH_NAME"
echo ""

# 创建目录结构
echo "📋 步骤 3: 创建目录结构"
mkdir -p packages/agentai-gateway/src/diagnosis
mkdir -p packages/agentai-gateway/src/types
echo "✅ 目录结构创建完成"
echo ""

# Day 1 文件
echo "📋 步骤 4: 创建 Day 1 类型定义文件"
cat > packages/agentai-gateway/src/types/diagnosis.ts << 'EOF'
/**
 * 诊断优先类型定义
 * Day 1 实施
 */

export type ComplexityLevel = 'ultraSimple' | 'simple' | 'medium' | 'complex' | 'hard';
export type TaskType = 'coding' | 'writing' | 'analysis' | 'creative' | 'general';
export type GapType = 'missing_context' | 'ambiguous_requirement' | 'unclear_scope' | 'technical_unknown';
export type ActionType = 'proceed' | 'ask' | 'self_fill' | 'defer';
export type RiskLevel = 'low' | 'medium' | 'high';
export type ApproachType = 'direct' | 'planning' | 'exploratory' | 'multi_step';

export interface InformationGap {
  type: GapType;
  description: string;
  severity: 'low' | 'medium' | 'high';
  suggestedResolution: string;
}

export interface TaskPerceptionReport {
  taskType: TaskType;
  complexity: ComplexityLevel;
  ambiguity: number;
  gapList: InformationGap[];
  suggestedAction: ActionType;
}

export interface DiagnosisReport {
  confidence: number;
  riskLevel: RiskLevel;
  recommendedApproach: ApproachType;
  estimatedSteps: number;
  potentialBlockers: string[];
}

export interface PlanStep {
  id: string;
  description: string;
  expectedOutput: string;
  verificationMethod: string;
  fallbackAction?: string;
}

export interface TreatmentPlan {
  steps: PlanStep[];
  verificationPoints: string[];
  rollbackStrategy?: string;
}

export interface VerificationResult {
  passed: boolean;
  score: number;
  issues: string[];
  suggestion?: string;
}
EOF

echo "✅ Day 1 类型定义创建完成"
echo ""

# 提交 Day 1
echo "📋 步骤 5: 提交 Day 1"
git add packages/agentai-gateway/src/types/diagnosis.ts
git commit -m "diagnosis(types): add diagnosis pipeline type definitions

- TaskPerceptionReport: 任务感知报告
- DiagnosisReport: 结构化诊断报告  
- TreatmentPlan: 治疗方案
- VerificationResult: 步骤验证结果

Refs: docs/IMPLEMENTATION_PLAN.md Day 1"

echo "✅ Day 1 提交完成"
echo ""

# 创建后续文件占位
echo "📋 步骤 6: 创建后续文件占位"
touch packages/agentai-gateway/src/diagnosis/task-perception.ts
touch packages/agentai-gateway/src/diagnosis/diagnosis-engine.ts
touch packages/agentai-gateway/src/diagnosis/plan-assembler.ts
touch packages/agentai-gateway/src/diagnosis/step-verifier.ts
touch packages/agentai-gui/src/components/DiagnosisCards.tsx

echo "✅ 后续文件占位创建完成"
echo ""

# 输出下一步
echo "=================================="
echo "🎉 启动完成！下一步："
echo "=================================="
echo ""
echo "当前分支: $BRANCH_NAME"
echo ""
echo "Day 1 已完成："
echo "  ✅ 类型定义创建"
echo "  ✅ 初始提交"
echo ""
echo "Day 2 开始："
echo "  📝 编辑: packages/agentai-gateway/src/diagnosis/task-perception.ts"
echo "  📖 参考: docs/IMPLEMENTATION_PLAN.md Day 2 章节"
echo ""
echo "实施期间每日提交："
echo "  git add ."
echo "  git commit -m \"diagnosis(gateway): Day X - 描述\""
echo ""
echo "6 天后合并："
echo "  git checkout develop"
echo "  git merge $BRANCH_NAME"
echo ""
