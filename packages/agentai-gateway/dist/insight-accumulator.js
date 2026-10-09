/**
 * InsightAccumulator — 行业洞察自主积累引擎
 * ----------------------------------------------------
 * 理念: 授人以渔，AI 不是被动回答问题，而是主动积累行业深度洞察
 *
 * 核心能力:
 *   1. 行业知识自动发现 — 从对话中提取行业关键词，触发知识搜索
 *   2. 洞察持久化 — 将发现的洞察存入记忆系统，跨会话可用
 *   3. 知识图谱构建 — 行业概念之间的关联关系
 *   4. 洞察推送 — 当用户进入某行业场景时，主动推送相关洞察
 *
 * 设计原则:
 *   - 不依赖外部 LLM 调用 (纯本地规则 + 记忆系统)
 *   - 洞察积累是渐进式的，不是一次性的
 *   - 用户可以审查、修正、删除洞察
 */
import * as fsSync from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
const AGENTAI_DIR = path.join(process.env.HOME || process.env.USERPROFILE || '~', '.agentai');
const INSIGHTS_FILE = path.join(AGENTAI_DIR, 'insights', 'industry-insights.json');
// ===== 行业识别关键词库 =====
const INDUSTRY_KEYWORDS = {
    'software_dev': {
        name: '软件开发',
        keywords: ['代码', '编程', '开发', '项目', 'bug', '部署', 'API', '框架', '重构', '测试', 'code', 'develop', 'deploy', 'refactor', 'framework'],
        coreConcepts: ['版本控制', 'CI/CD', '代码审查', '架构设计', '测试驱动开发', '敏捷开发'],
        workflows: ['需求分析→设计→编码→测试→部署', '代码审查流程', 'Bug修复流程', '发布流程'],
        tools: ['Git', 'VSCode', 'Docker', 'Jenkins', 'npm/pnpm'],
        painPoints: ['技术债务', '代码重构风险', '上线回归', '多人协作冲突', '性能瓶颈定位'],
    },
    'decoration': {
        name: '装修建材',
        keywords: ['装修', '报价', '建材', '施工', '瓷砖', '橱柜', '设计', '户型', '水电', '报价单', '量房'],
        coreConcepts: ['空间报价法', '工程量计算', '材料损耗率', '施工规范', '设计风格'],
        workflows: ['量房→设计→报价→施工→验收', '材料选型流程', '变更管理'],
        tools: ['CAD', '酷家乐', 'Excel报价', 'ezdxf'],
        painPoints: ['报价不准', '材料浪费', '工期延误', '客户需求变化频繁'],
    },
    'ecommerce': {
        name: '电商运营',
        keywords: ['电商', '店铺', '运营', '流量', '转化率', 'SKU', 'GMV', '直播', '选品', '供应链'],
        coreConcepts: ['用户生命周期', '转化漏斗', 'ROI', 'SKU管理', '供应链优化'],
        workflows: ['选品→上架→推广→客服→复盘', '直播带货流程', '库存管理'],
        tools: ['淘宝/京东后台', '数据罗盘', 'ERP系统', '客服系统'],
        painPoints: ['流量成本高', '退货率高', '库存积压', '竞品价格战'],
    },
    'education': {
        name: '教育培训',
        keywords: ['教学', '课程', '学生', '考试', '培训', '教育', '学习', '知识', '教案'],
        coreConcepts: ['教学设计', '知识图谱', '学习路径', '能力评估', '课程体系'],
        workflows: ['备课→授课→作业→评估→调整', '课程开发流程', '学生跟踪'],
        tools: ['LMS系统', '在线题库', '视频平台', '互动白板'],
        painPoints: ['学生参与度低', '教学效果难量化', '内容更新慢', '个性化难'],
    },
    'healthcare': {
        name: '中医问诊',
        keywords: ['中医', '辨证', '舌象', '脉象', '药材', '方剂', '经方', '养生', '体质', '针灸', '推拿', '头痛', '失眠', '咳嗽', '胃痛', '腹泻', '便秘', '高血压', '糖尿病', '医案', '伤寒论', '黄帝内经', '金匮要略', '温病条辨', '八纲辨证', '脏腑辨证', '气血津液', '君臣佐使', '十八反', '十九畏', '医疗', '诊断', '处方', '健康', '问诊', '把脉', '舌苔', '中药', '煎服', '医嘱'],
        coreConcepts: ['四诊合参(望闻问切)', '八纲辨证(阴阳表里寒热虚实)', '脏腑辨证', '气血津液辨证', '君臣佐使组方原则', '三因制宜(因人因地因时)', '治未病(预防医学)'],
        workflows: ['十问歌收集症状→四诊合参→八纲辨证→脏腑定位→确定证型→选方用药→医嘱交代', '经典条文检索→临床解读→方证对应→随症加减', '体质辨识(王琦九分法)→个性化养生方案'],
        tools: ['中医智能辨证系统', '古籍检索引擎(RAG)', '医案匹配库', '药材性味归经数据库', '体质辨识问卷'],
        painPoints: ['同病异治/异病同治的辨证难度', '经方与时方的选择权衡', '特殊人群剂量把握(孕妇/儿童/老人)', '配伍禁忌(十八反十九畏)的识别'],
    },
    'comic': {
        name: '漫剧创作',
        keywords: ['漫画', '短剧', '剧本', '分镜', '角色设计', '动画', '创作', '连载', '漫画家'],
        coreConcepts: ['分镜设计', '角色弧光', '叙事节奏', '视觉叙事', '对白技巧'],
        workflows: ['构思→大纲→分镜→绘制→后期', '剧本创作流程', '角色设定流程'],
        tools: ['Clip Studio Paint', 'Procreate', 'Photoshop', 'AI绘图工具'],
        painPoints: ['创意枯竭', '连载压力', '读者留存', '版权保护'],
    },
    'real_estate': {
        name: '房地产',
        keywords: ['房产', '楼盘', '户型', '房价', '购房', '租房', '学区房', '物业', '中介', '房产证'],
        coreConcepts: ['市场分析', '户型评价', '区位价值', '投资回报', '政策影响'],
        workflows: ['看房→评估→议价→签约→过户', '房产估值流程', '市场调研'],
        tools: ['房产APP', 'GIS系统', '估价模型', 'CRM系统'],
        painPoints: ['信息不对称', '价格波动', '政策风险', '交易流程复杂'],
    },
    'legal': {
        name: '法律',
        keywords: ['法律', '合同', '诉讼', '律师', '法规', '条款', '纠纷', '仲裁', '合规', '知识产权'],
        coreConcepts: ['合同审查', '法律风险', '证据链', '诉讼策略', '合规管理'],
        workflows: ['咨询→调研→起草→审查→签署', '诉讼流程', '合规审查流程'],
        tools: ['法律数据库', '合同模板库', '案例检索', '电子签章'],
        painPoints: ['法律条文复杂', '证据收集难', '诉讼周期长', '合规成本高'],
    },
    'manufacturing': {
        name: '制造业',
        keywords: ['生产', '制造', '工艺', '质检', '车间', '产线', 'BOM', '物料', '设备', '良率'],
        coreConcepts: ['精益生产', '质量控制', '供应链管理', '设备维护', '工艺优化'],
        workflows: ['订单→排产→采购→生产→质检→出货', '工艺改进流程', '质量异常处理'],
        tools: ['ERP系统', 'MES系统', 'PLC', 'SCADA', '质量检测设备'],
        painPoints: ['产能瓶颈', '质量波动', '物料短缺', '设备故障', '成本控制'],
    },
};
// ===== 核心引擎 =====
export class InsightAccumulator extends EventEmitter {
    insights = new Map();
    profiles = new Map();
    loaded = false;
    constructor() {
        super();
        this.load();
    }
    /**
     * 从用户消息中识别行业
     * 纯关键词匹配，不依赖 LLM
     */
    detectIndustry(message) {
        const msgLower = message.toLowerCase();
        let bestMatch = null;
        for (const [id, config] of Object.entries(INDUSTRY_KEYWORDS)) {
            let hits = 0;
            for (const kw of config.keywords) {
                if (msgLower.includes(kw.toLowerCase()))
                    hits++;
            }
            const confidence = hits / config.keywords.length;
            if (confidence > 0.3 && (!bestMatch || confidence > bestMatch.confidence)) {
                bestMatch = { industryId: id, confidence };
            }
        }
        return bestMatch;
    }
    /**
     * 从对话中提取洞察 — 授人以渔的关键
     * 不是替用户回答，而是把用户展示的知识沉淀下来
     */
    extractInsight(message, response) {
        const industry = this.detectIndustry(message);
        if (!industry || industry.confidence < 0.6)
            return null;
        const config = INDUSTRY_KEYWORDS[industry.industryId];
        if (!config)
            return null;
        // 从消息中提取可能是知识/经验的片段
        const patterns = [
            // 工作流描述
            { regex: /(?:流程|步骤|过程|怎么.*做|如何.*做|先.*再.*然后)(.{20,150})/i, category: 'workflow' },
            // 最佳实践
            { regex: /(?:建议|推荐|最好|应该|务必|关键|核心|重点)(.{10,150})/i, category: 'best_practices' },
            // 痛点
            { regex: /(?:痛点|问题|难点|坑|踩坑|容易.*错|注意|避免|千万不要)(.{10,150})/i, category: 'pain_points' },
            // 术语
            { regex: /(?:叫|称为|简称|术语|专业词汇|行话)(.{5,80})/i, category: 'terminology' },
            // 工具
            { regex: /(?:工具|软件|平台|系统|插件|用.*来)(.{5,100})/i, category: 'tools' },
        ];
        for (const { regex, category } of patterns) {
            const match = message.match(regex) || response.match(regex);
            if (match && match[1]) {
                const insight = {
                    industryId: industry.industryId,
                    industryName: config.name,
                    category,
                    content: match[1].trim().slice(0, 300),
                    source: 'conversation',
                    confidence: Math.min(industry.confidence + 0.2, 1.0),
                    hitCount: 0,
                    createdAt: new Date().toISOString(),
                    lastVerifiedAt: new Date().toISOString(),
                    relatedConcepts: this.extractConcepts(match[1], config),
                    tags: [config.name, category],
                };
                // 去重: 相同 category + 相似内容 不重复存储
                const existing = this.insights.get(industry.industryId) || [];
                const isDuplicate = existing.some(i => i.category === category && this.similarity(i.content, insight.content) > 0.8);
                if (!isDuplicate) {
                    existing.push(insight);
                    this.insights.set(industry.industryId, existing);
                    this.emit('insight:discovered', insight);
                    this.persist();
                    return insight;
                }
            }
        }
        return null;
    }
    /**
     * 获取行业画像 — 给 AI 的 system prompt 用
     * 这是"授人以渔"的核心: AI 有了行业画像就能自主决策
     */
    getIndustryProfile(industryId) {
        const config = INDUSTRY_KEYWORDS[industryId];
        if (!config)
            return null;
        const insights = this.insights.get(industryId) || [];
        const profile = {
            industryId,
            industryName: config.name,
            description: `${config.name}行业, 核心概念: ${config.coreConcepts.slice(0, 5).join('、')}`,
            coreConcepts: config.coreConcepts,
            workflows: config.workflows,
            tools: config.tools,
            painPoints: config.painPoints,
            latestInsights: insights.slice(-5),
            completenessScore: this.calcCompleteness(industryId, config),
            updatedAt: new Date().toISOString(),
        };
        return profile;
    }
    /**
     * 生成行业洞察提示 — 注入到 system prompt
     * 关键: 精简，不浪费 token
     */
    buildInsightPrompt(industryId) {
        const profile = this.getIndustryProfile(industryId);
        if (!profile)
            return '';
        const lines = [];
        lines.push(`# 行业洞察: ${profile.industryName} (完整度 ${profile.completenessScore}%)`);
        if (profile.coreConcepts.length > 0) {
            lines.push(`核心概念: ${profile.coreConcepts.join('、')}`);
        }
        if (profile.workflows.length > 0) {
            lines.push(`典型流程: ${profile.workflows.join(' | ')}`);
        }
        if (profile.painPoints.length > 0) {
            lines.push(`常见痛点: ${profile.painPoints.join('、')}`);
        }
        if (profile.latestInsights.length > 0) {
            lines.push(`最近洞察:`);
            for (const ins of profile.latestInsights.slice(0, 3)) {
                lines.push(`  - [${ins.category}] ${(ins.content || '').slice(0, 100)}`);
            }
        }
        // 如果完整度低，提示 AI 主动学习
        if (profile.completenessScore < 50) {
            lines.push(`\n⚠️ 行业知识完整度较低 (${profile.completenessScore}%), 请在对话中主动了解用户的具体业务流程和痛点，并用 remember 工具保存。`);
        }
        return lines.join('\n');
    }
    /**
     * 获取所有已积累的行业洞察摘要
     */
    getAllInsightsSummary() {
        const lines = [];
        for (const [id, insights] of this.insights) {
            const config = INDUSTRY_KEYWORDS[id];
            if (!config)
                continue;
            lines.push(`${config.name}: ${insights.length} 条洞察`);
        }
        return lines.length > 0 ? lines.join('\n') : '暂无行业洞察积累';
    }
    /**
     * 手动添加洞察 (用户显式录入)
     */
    addManualInsight(industryId, category, content) {
        const config = INDUSTRY_KEYWORDS[industryId];
        if (!config)
            return null;
        const insight = {
            industryId,
            industryName: config.name,
            category,
            content,
            source: 'manual',
            confidence: 1.0,
            hitCount: 0,
            createdAt: new Date().toISOString(),
            lastVerifiedAt: new Date().toISOString(),
            relatedConcepts: this.extractConcepts(content, config),
            tags: [config.name, category],
        };
        const existing = this.insights.get(industryId) || [];
        existing.push(insight);
        this.insights.set(industryId, existing);
        this.persist();
        return insight;
    }
    // ===== 内部方法 =====
    extractConcepts(text, config) {
        const concepts = [];
        for (const kw of config.keywords) {
            if (text.toLowerCase().includes(kw.toLowerCase())) {
                concepts.push(kw);
            }
        }
        for (const cc of config.coreConcepts) {
            if (text.includes(cc)) {
                concepts.push(cc);
            }
        }
        return [...new Set(concepts)].slice(0, 5);
    }
    similarity(a, b) {
        // 简单 Jaccard 相似度
        const setA = new Set(a.split(''));
        const setB = new Set(b.split(''));
        const intersection = [...setA].filter(x => setB.has(x)).length;
        const union = new Set([...setA, ...setB]).size;
        return union > 0 ? intersection / union : 0;
    }
    calcCompleteness(industryId, config) {
        const insights = this.insights.get(industryId) || [];
        if (insights.length === 0)
            return 5; // 最低5% (识别到了行业但还没积累)
        // 按类别统计覆盖度
        const categories = new Set(insights.map(i => i.category));
        const categoryCoverage = categories.size / 7; // 7 种类别
        // 核心概念覆盖度
        const conceptCoverage = config.coreConcepts.filter(c => insights.some(i => i.content.includes(c) || i.relatedConcepts.includes(c))).length / config.coreConcepts.length;
        // 数量加分 (最多 10 条就算充分)
        const countScore = Math.min(insights.length / 10, 1.0);
        return Math.round((categoryCoverage * 30 + conceptCoverage * 40 + countScore * 30));
    }
    load() {
        try {
            if (!fsSync.existsSync(INSIGHTS_FILE)) {
                this.loaded = true;
                return;
            }
            const data = JSON.parse(fsSync.readFileSync(INSIGHTS_FILE, 'utf-8'));
            for (const [id, insights] of Object.entries(data.insights || {})) {
                this.insights.set(id, insights);
            }
        }
        catch { /* ignore corrupt data */ }
        this.loaded = true;
    }
    persist() {
        try {
            const dir = path.dirname(INSIGHTS_FILE);
            if (!fsSync.existsSync(dir))
                fsSync.mkdirSync(dir, { recursive: true });
            const data = { insights: {} };
            for (const [id, insights] of this.insights) {
                data.insights[id] = insights;
            }
            fsSync.writeFileSync(INSIGHTS_FILE, JSON.stringify(data, null, 2), 'utf-8');
        }
        catch { /* ignore write errors */ }
    }
}
export const insightAccumulator = new InsightAccumulator();
