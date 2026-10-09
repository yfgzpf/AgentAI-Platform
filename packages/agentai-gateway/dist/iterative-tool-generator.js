/**
 * Iterative Tool Generator — 迭代工具生成器
 * -----------------------------------------
 * 从简单脚本开始，逐步迭代生成复杂工具
 *
 * 迭代流程:
 * 1. 需求分析 → 2. 生成V1 → 3. 测试验证 → 4. 收集反馈 → 5. 生成V2 → ...
 *
 * 每次迭代基于:
 * - 上次版本的执行结果
 * - 用户反馈
 * - 错误日志
 * - 性能指标
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { writeEvolutionAsync } from './evolution.js';
const TOOLS_DIR = path.join(os.homedir(), '.agentai', 'custom-tools');
const PROJECTS_FILE = path.join(TOOLS_DIR, 'projects.json');
class IterativeToolGenerator {
    projects = new Map();
    constructor() {
        this.loadProjects();
    }
    loadProjects() {
        try {
            if (fs.existsSync(PROJECTS_FILE)) {
                const data = JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf-8'));
                for (const [id, project] of Object.entries(data)) {
                    this.projects.set(id, project);
                }
                console.log(`[tool-generator] Loaded ${this.projects.size} tool projects`);
            }
        }
        catch (e) {
            console.warn('[tool-generator] Failed to load projects:', e);
        }
    }
    saveProjects() {
        try {
            if (!fs.existsSync(TOOLS_DIR)) {
                fs.mkdirSync(TOOLS_DIR, { recursive: true });
            }
            const data = Object.fromEntries(this.projects);
            fs.writeFileSync(PROJECTS_FILE, JSON.stringify(data, null, 2), 'utf-8');
        }
        catch (e) {
            console.warn('[tool-generator] Failed to save projects:', e);
        }
    }
    /**
     * 创建新工具项目
     */
    createProject(name, description, purpose, initialCode) {
        const id = `tool_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const now = Date.now();
        const project = {
            id,
            name,
            description,
            purpose,
            versions: [{
                    version: 1,
                    code: initialCode,
                    timestamp: now
                }],
            currentVersion: 1,
            status: 'developing',
            createdAt: now,
            updatedAt: now
        };
        this.projects.set(id, project);
        this.saveProjects();
        this.saveVersionCode(project, 1);
        console.log(`[tool-generator] Created project ${id}: ${name}`);
        return project;
    }
    /**
     * 添加新版本
     */
    addVersion(projectId, code, testResults, feedback, performance) {
        const project = this.projects.get(projectId);
        if (!project)
            return null;
        const newVersion = {
            version: project.currentVersion + 1,
            code,
            timestamp: Date.now(),
            testResults,
            feedback,
            performance
        };
        project.versions.push(newVersion);
        project.currentVersion = newVersion.version;
        project.updatedAt = Date.now();
        // 根据测试结果更新状态
        if (testResults) {
            if (testResults.passed && testResults.coverage && testResults.coverage > 80) {
                project.status = 'stable';
            }
            else if (testResults.passed) {
                project.status = 'testing';
            }
            else {
                project.status = 'developing';
            }
        }
        this.projects.set(projectId, project);
        this.saveProjects();
        this.saveVersionCode(project, newVersion.version);
        // 记录到进化系统
        this.recordEvolution(project, newVersion);
        console.log(`[tool-generator] Added v${newVersion.version} to project ${projectId}`);
        return newVersion;
    }
    /**
     * 生成迭代计划
     */
    generateIterationPlan(projectId) {
        const project = this.projects.get(projectId);
        if (!project)
            return null;
        const current = project.versions[project.versions.length - 1];
        const goals = [];
        const improvements = [];
        const bugFixes = [];
        // 基于测试结果
        if (current.testResults) {
            if (!current.testResults.passed) {
                goals.push('修复测试失败');
                bugFixes.push(...current.testResults.errors.slice(0, 3));
            }
            if (current.testResults.coverage && current.testResults.coverage < 80) {
                goals.push('提高测试覆盖率到80%以上');
                improvements.push('添加边界条件测试');
            }
        }
        // 基于用户反馈
        if (current.feedback) {
            if (current.feedback.rating < 4) {
                goals.push('提升用户满意度');
                improvements.push(...current.feedback.featureRequests.slice(0, 2));
            }
            if (current.feedback.issues.length > 0) {
                bugFixes.push(...current.feedback.issues.slice(0, 3));
            }
        }
        // 基于性能
        if (current.performance) {
            if (current.performance.executionTimeMs > 1000) {
                goals.push('优化执行性能');
                improvements.push('减少执行时间');
            }
        }
        // 默认目标
        if (goals.length === 0) {
            goals.push('代码重构和优化');
            improvements.push('提高代码可读性');
        }
        const effort = bugFixes.length > 3 ? 'high' :
            bugFixes.length > 0 ? 'medium' : 'low';
        return {
            targetVersion: project.currentVersion + 1,
            goals,
            improvements,
            bugFixes,
            estimatedEffort: effort
        };
    }
    /**
     * 获取项目
     */
    getProject(id) {
        return this.projects.get(id);
    }
    /**
     * 获取所有项目
     */
    getAllProjects() {
        return Array.from(this.projects.values())
            .sort((a, b) => b.updatedAt - a.updatedAt);
    }
    /**
     * 获取项目统计
     */
    getStats() {
        const projects = this.getAllProjects();
        const byStatus = {};
        let totalVersions = 0;
        for (const p of projects) {
            byStatus[p.status] = (byStatus[p.status] || 0) + 1;
            totalVersions += p.versions.length;
        }
        return {
            totalProjects: projects.length,
            byStatus,
            totalVersions,
            averageVersionsPerProject: projects.length > 0 ? totalVersions / projects.length : 0
        };
    }
    /**
     * 保存版本代码到文件
     */
    saveVersionCode(project, version) {
        const versionData = project.versions.find(v => v.version === version);
        if (!versionData)
            return;
        const projectDir = path.join(TOOLS_DIR, project.id);
        if (!fs.existsSync(projectDir)) {
            fs.mkdirSync(projectDir, { recursive: true });
        }
        const codePath = path.join(projectDir, `v${version}.js`);
        fs.writeFileSync(codePath, versionData.code, 'utf-8');
    }
    /**
     * 记录到进化系统
     */
    async recordEvolution(project, version) {
        const entry = {
            type: 'tool_iteration',
            content: `Tool ${project.name} v${version.version}: ${project.description}`,
            taskType: 'coding',
            keywords: ['tool_generation', `v${version.version}`, project.status, 'iterative'],
            success: version.testResults?.passed ?? false,
            failureCategory: version.testResults?.passed ? undefined : 'skill_defect',
            errorType: version.testResults?.errors?.[0],
            metadata: {
                projectId: project.id,
                version: version.version,
                testCoverage: version.testResults?.coverage,
                userRating: version.feedback?.rating
            }
        };
        await writeEvolutionAsync(entry);
    }
}
// 单例
let generator = null;
export function getToolGenerator() {
    if (!generator) {
        generator = new IterativeToolGenerator();
    }
    return generator;
}
// 便捷导出
export const createToolProject = (name, description, purpose, initialCode) => getToolGenerator().createProject(name, description, purpose, initialCode);
export const addToolVersion = (projectId, code, testResults, feedback, performance) => getToolGenerator().addVersion(projectId, code, testResults, feedback, performance);
export { IterativeToolGenerator };
export default getToolGenerator;
