/**
 * Self-Modify Integration — 自编程引擎与 Evolution 流程集成
 * ----------------------------------------------------
 * 解决 TODO: 接入 evolution 流程, 需人工审批后才能执行自修改
 *
 * 集成设计:
 *   1. 当 evolution 检测到 skill_defect 类型失败时，触发自编程流程
 *   2. 生成修改提案后，写入 evolution 记录（类型: self_modify_proposal）
 *   3. 人工审批通过后，执行修改并记录结果（类型: self_modify_executed）
 *   4. 修改失败自动回滚，记录回滚（类型: self_modify_rollback）
 *
 * 安全机制:
 *   - 所有修改必须通过人工审批
 *   - 修改前自动备份
 *   - 修改后自动编译验证
 *   - 支持一键回滚
 */
import * as fs from 'fs';
import * as path from 'path';
import { writeEvolution, readEvolution } from '../evolution.js';
import { getSelfModifier } from './self-modify.js';
/** 类型守卫：检查是否为自编程进化记录 */
function isSelfModifyEntry(entry) {
    return ['self_modify_proposal', 'self_modify_executed', 'self_modify_rollback'].includes(entry.type);
}
// ---------------------------------------------------------------------------
// SelfModifyEvolution — 自编程进化管理器
// ---------------------------------------------------------------------------
export class SelfModifyEvolution {
    modifier;
    pendingApprovals = new Map();
    backupDir;
    constructor(workspaceRoot) {
        this.modifier = getSelfModifier();
        this.backupDir = path.join(workspaceRoot, '.agentai', 'backups', 'self-modify');
        this._ensureBackupDir();
    }
    _ensureBackupDir() {
        if (!fs.existsSync(this.backupDir)) {
            fs.mkdirSync(this.backupDir, { recursive: true });
        }
    }
    /**
     * 触发自编程流程 — 从 evolution 失败记录生成修改提案
     *
     * 流程:
     *   1. 检查失败类型是否为 skill_defect
     *   2. 定位需要修改的源文件
     *   3. 生成修改提案
     *   4. 写入 evolution 记录（等待审批）
     *   5. 返回提案 ID
     */
    async triggerFromFailure(failureEntry, sourceCode, aiGeneratedFix) {
        // 构建修改请求
        const request = {
            targetFile: failureEntry.relatedSkill || 'unknown.ts',
            reason: `Auto-generated fix for ${failureEntry.errorType}: ${failureEntry.failureCategory}`,
            desiredOutcome: `Fix the ${failureEntry.errorType} error in ${failureEntry.relatedSkill}`,
            failureInfo: failureEntry.content,
        };
        // 生成提案
        const proposal = await this.modifier.generateProposal(request, sourceCode, aiGeneratedFix);
        // 安全检查未通过，直接拒绝
        if (proposal.status === 'rejected') {
            writeEvolution({
                type: 'self_modify_proposal',
                content: `Proposal rejected by security scan: ${proposal.securityScan.violations?.join(', ')}`,
                proposalId: proposal.id,
                targetFile: request.targetFile,
                reason: request.reason,
                failureInfo: request.failureInfo,
                proposal,
                result: { success: false, message: 'Security scan failed' },
                sessionId: failureEntry.sessionId,
                userId: failureEntry.userId,
                workspace: failureEntry.workspace,
            });
            return { proposalId: proposal.id, needsApproval: false };
        }
        // 保存提案到待审批列表
        this.pendingApprovals.set(proposal.id, proposal);
        // 写入 evolution 记录
        writeEvolution({
            type: 'self_modify_proposal',
            content: `Self-modify proposal generated for ${request.targetFile}. Awaiting human approval.`,
            proposalId: proposal.id,
            targetFile: request.targetFile,
            reason: request.reason,
            failureInfo: request.failureInfo,
            proposal,
            sessionId: failureEntry.sessionId,
            userId: failureEntry.userId,
            workspace: failureEntry.workspace,
        });
        return { proposalId: proposal.id, needsApproval: true };
    }
    /**
     * 人工审批 — 批准修改提案
     */
    approveProposal(proposalId, approvedBy) {
        const proposal = this.pendingApprovals.get(proposalId);
        if (!proposal) {
            return { success: false, message: `Proposal ${proposalId} not found or already processed` };
        }
        proposal.status = 'approved';
        // 记录审批
        writeEvolution({
            type: 'self_modify_executed',
            content: `Proposal ${proposalId} approved by ${approvedBy}. Ready to apply.`,
            proposalId,
            targetFile: proposal.targetFile,
            reason: proposal.reason,
            result: { success: true, message: 'Approved, pending execution' },
        });
        return { success: true, message: `Proposal ${proposalId} approved` };
    }
    /**
     * 人工审批 — 拒绝修改提案
     */
    rejectProposal(proposalId, rejectReason) {
        const proposal = this.pendingApprovals.get(proposalId);
        if (!proposal) {
            return { success: false, message: `Proposal ${proposalId} not found or already processed` };
        }
        proposal.status = 'rejected';
        // 记录拒绝
        writeEvolution({
            type: 'self_modify_rollback',
            content: `Proposal ${proposalId} rejected: ${rejectReason}`,
            proposalId,
            targetFile: proposal.targetFile,
            reason: proposal.reason,
            result: { success: false, message: `Rejected: ${rejectReason}` },
        });
        this.pendingApprovals.delete(proposalId);
        return { success: true, message: `Proposal ${proposalId} rejected` };
    }
    /**
     * 执行已批准的修改
     *
     * 流程:
     *   1. 检查提案是否已批准
     *   2. 备份原文件
     *   3. 写入新代码
     *   4. 编译验证
     *   5. 记录结果
     */
    async executeProposal(proposalId) {
        const proposal = this.pendingApprovals.get(proposalId);
        if (!proposal) {
            return { success: false, message: `Proposal ${proposalId} not found` };
        }
        if (proposal.status !== 'approved') {
            return { success: false, message: `Proposal ${proposalId} is not approved (status: ${proposal.status})` };
        }
        // 构建完整路径
        const workspaceRoot = process.cwd();
        const targetPath = path.join(workspaceRoot, 'src', proposal.targetFile);
        // 检查文件是否存在
        if (!fs.existsSync(targetPath)) {
            return { success: false, message: `Target file not found: ${targetPath}` };
        }
        // 备份原文件
        const backupPath = path.join(this.backupDir, `${proposal.id}_${path.basename(proposal.targetFile)}`);
        try {
            fs.copyFileSync(targetPath, backupPath);
        }
        catch (e) {
            return { success: false, message: `Failed to create backup: ${e.message}` };
        }
        // 写入新代码
        try {
            fs.writeFileSync(targetPath, proposal.newCode, 'utf-8');
        }
        catch (e) {
            return { success: false, message: `Failed to write file: ${e.message}` };
        }
        // 编译验证
        const compileResult = await this._compileCheck(targetPath);
        if (!compileResult.passed) {
            // 编译失败，自动回滚
            this._rollbackFile(targetPath, backupPath);
            writeEvolution({
                type: 'self_modify_rollback',
                content: `Compilation failed after applying ${proposalId}. Auto-rollback executed.`,
                proposalId,
                targetFile: proposal.targetFile,
                reason: proposal.reason,
                result: {
                    success: false,
                    message: `Compilation failed: ${compileResult.errors?.join(', ')}`,
                    rolledBackAt: new Date().toISOString(),
                },
            });
            this.pendingApprovals.delete(proposalId);
            return { success: false, message: `Compilation failed, auto-rollback executed` };
        }
        // 记录成功
        writeEvolution({
            type: 'self_modify_executed',
            content: `Successfully applied self-modify proposal ${proposalId}`,
            proposalId,
            targetFile: proposal.targetFile,
            reason: proposal.reason,
            result: {
                success: true,
                message: 'Modification applied and compiled successfully',
                appliedAt: new Date().toISOString(),
            },
        });
        this.pendingApprovals.delete(proposalId);
        return { success: true, message: `Proposal ${proposalId} executed successfully` };
    }
    /**
     * 回滚已执行的修改
     */
    rollbackExecuted(proposalId) {
        const backupFile = fs.readdirSync(this.backupDir).find(f => f.startsWith(proposalId));
        if (!backupFile) {
            return { success: false, message: `Backup not found for ${proposalId}` };
        }
        const backupPath = path.join(this.backupDir, backupFile);
        const workspaceRoot = process.cwd();
        // 从 evolution 记录中查找目标文件
        const entries = readEvolution(100);
        const entry = entries.filter(isSelfModifyEntry).find(e => e.proposalId === proposalId);
        if (!entry) {
            return { success: false, message: `Evolution entry not found for ${proposalId}` };
        }
        const targetPath = path.join(workspaceRoot, 'src', entry.targetFile);
        // 执行回滚
        const rollbackResult = this._rollbackFile(targetPath, backupPath);
        // 记录回滚
        writeEvolution({
            type: 'self_modify_rollback',
            content: `Manual rollback executed for ${proposalId}`,
            proposalId,
            targetFile: entry.targetFile,
            reason: entry.reason,
            result: {
                success: rollbackResult.success,
                message: rollbackResult.message,
                rolledBackAt: new Date().toISOString(),
            },
        });
        return rollbackResult;
    }
    /**
     * 获取待审批列表
     */
    getPendingApprovals() {
        return Array.from(this.pendingApprovals.values()).filter(p => p.status === 'pending');
    }
    /**
     * 获取修改历史
     */
    getModificationHistory(limit = 20) {
        const entries = readEvolution(limit * 2);
        return entries
            .filter(isSelfModifyEntry)
            .slice(-limit);
    }
    // ---- 内部辅助 ----
    async _compileCheck(filePath) {
        try {
            const { execSync } = await import('child_process');
            // 使用 tsc --noEmit 检查类型
            const result = execSync(`npx tsc --noEmit "${filePath}"`, {
                encoding: 'utf-8',
                timeout: 30000,
                cwd: process.cwd(),
            });
            return { passed: true };
        }
        catch (e) {
            const output = e.stdout || e.stderr || e.message || '';
            const errors = output.split('\n').filter((l) => l.includes('error TS'));
            return { passed: false, errors: errors.length > 0 ? errors : [output.slice(0, 200)] };
        }
    }
    _rollbackFile(targetPath, backupPath) {
        try {
            fs.copyFileSync(backupPath, targetPath);
            return { success: true, message: 'Rollback successful' };
        }
        catch (e) {
            return { success: false, message: `Rollback failed: ${e.message}` };
        }
    }
}
// ---------------------------------------------------------------------------
// 单例导出
// ---------------------------------------------------------------------------
let _integration = null;
export function getSelfModifyEvolution(workspaceRoot) {
    if (!_integration) {
        _integration = new SelfModifyEvolution(workspaceRoot || process.cwd());
    }
    return _integration;
}
// ---------------------------------------------------------------------------
// 工具函数: 检查是否应该触发自编程
// ---------------------------------------------------------------------------
/**
 * 根据 evolution 失败记录判断是否触发自编程
 *
 * 触发条件:
 *   1. 失败类型为 skill_defect
 *   2. 有关联的技能名
 *   3. 不是临时性错误（网络超时等）
 */
export function shouldTriggerSelfModify(failureEntry) {
    // 必须是技能缺陷
    if (failureEntry.failureCategory !== 'skill_defect') {
        return false;
    }
    // 必须有关联的技能
    if (!failureEntry.relatedSkill) {
        return false;
    }
    // 不能是网络/超时错误
    if (failureEntry.errorType === 'NetworkError' || failureEntry.errorType === 'TimeoutError') {
        return false;
    }
    return true;
}
