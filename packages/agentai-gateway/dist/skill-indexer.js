/**
 * SkillIndexer - 技能倒排索引
 *
 * 优化技能匹配性能：
 * - 从 O(n) 线性扫描优化到 O(1) 哈希查找
 * - 支持多关键词联合查询
 * - 支持权重排序
 * - 支持模糊匹配
 */
export class SkillIndexer {
    // 倒排索引: keyword -> skill names
    invertedIndex = new Map();
    // 技能存储
    skills = new Map();
    // 缓存常用查询
    queryCache = new Map();
    CACHE_SIZE = 100;
    /**
     * 添加技能到索引
     */
    addSkill(skill) {
        const keywords = this.extractKeywords(skill);
        this.skills.set(skill.name, {
            skill,
            keywords,
            weight: this.calculateWeight(skill),
        });
        // 更新倒排索引
        for (const keyword of keywords) {
            const skillSet = this.invertedIndex.get(keyword) || new Set();
            skillSet.add(skill.name);
            this.invertedIndex.set(keyword, skillSet);
        }
        // 清除缓存
        this.queryCache.clear();
    }
    /**
     * 从索引移除技能
     */
    removeSkill(skillName) {
        const indexed = this.skills.get(skillName);
        if (!indexed)
            return;
        // 从倒排索引移除
        for (const keyword of indexed.keywords) {
            const skillSet = this.invertedIndex.get(keyword);
            if (skillSet) {
                skillSet.delete(skillName);
                if (skillSet.size === 0) {
                    this.invertedIndex.delete(keyword);
                }
            }
        }
        this.skills.delete(skillName);
        this.queryCache.clear();
    }
    /**
     * 搜索技能 - O(1) 复杂度
     */
    search(query, limit = 5) {
        const cacheKey = `${query}:${limit}`;
        // 检查缓存
        const cached = this.queryCache.get(cacheKey);
        if (cached)
            return cached;
        const queryKeywords = this.tokenize(query);
        const skillScores = new Map();
        // 使用倒排索引快速查找
        for (const keyword of queryKeywords) {
            const skillNames = this.invertedIndex.get(keyword);
            if (!skillNames)
                continue;
            for (const skillName of skillNames) {
                const indexed = this.skills.get(skillName);
                if (!indexed)
                    continue;
                const current = skillScores.get(skillName) || { score: 0, matched: [] };
                // 计算得分
                const weight = indexed.weight;
                const exactMatch = indexed.keywords.has(keyword);
                const partialMatch = Array.from(indexed.keywords).some(k => k.includes(keyword) || keyword.includes(k));
                if (exactMatch) {
                    current.score += weight * 2;
                    current.matched.push(keyword);
                }
                else if (partialMatch) {
                    current.score += weight * 0.5;
                }
                skillScores.set(skillName, current);
            }
        }
        // 排序并返回结果
        const results = Array.from(skillScores.entries())
            .filter(([_, data]) => data.score > 0)
            .sort((a, b) => b[1].score - a[1].score)
            .slice(0, limit)
            .map(([skillName, data]) => ({
            skill: this.skills.get(skillName).skill,
            score: data.score,
            matchedKeywords: data.matched,
        }));
        // 缓存结果
        this.cacheResult(cacheKey, results);
        return results;
    }
    /**
     * 模糊搜索 - 支持拼写错误
     */
    fuzzySearch(query, limit = 5) {
        const queryKeywords = this.tokenize(query);
        const skillScores = new Map();
        for (const [skillName, indexed] of this.skills) {
            let score = 0;
            const matched = [];
            for (const queryKw of queryKeywords) {
                for (const skillKw of indexed.keywords) {
                    const similarity = this.calculateSimilarity(queryKw, skillKw);
                    if (similarity > 0.8) {
                        score += indexed.weight * similarity;
                        matched.push(skillKw);
                    }
                }
            }
            if (score > 0) {
                skillScores.set(skillName, { score, matched });
            }
        }
        return Array.from(skillScores.entries())
            .sort((a, b) => b[1].score - a[1].score)
            .slice(0, limit)
            .map(([skillName, data]) => ({
            skill: this.skills.get(skillName).skill,
            score: data.score,
            matchedKeywords: data.matched,
        }));
    }
    /**
     * 获取索引统计
     */
    getStats() {
        return {
            totalSkills: this.skills.size,
            totalKeywords: this.invertedIndex.size,
            cacheHitRate: this.queryCache.size / this.CACHE_SIZE,
        };
    }
    // ═══════════════════════════════════════════════════════════
    // 私有方法
    // ═══════════════════════════════════════════════════════════
    extractKeywords(skill) {
        const keywords = new Set();
        // 添加名称
        skill.name.toLowerCase().split(/[-_]/).forEach((k) => keywords.add(k));
        // 添加标签
        skill.tags.forEach((tag) => keywords.add(tag.toLowerCase()));
        // 添加触发器
        skill.triggers.forEach((trigger) => {
            this.tokenize(trigger).forEach(k => keywords.add(k));
        });
        // 添加描述中的关键词
        const descWords = skill.description.toLowerCase()
            .split(/\s+/)
            .filter((w) => w.length > 2);
        descWords.forEach((w) => keywords.add(w));
        return keywords;
    }
    tokenize(text) {
        return text
            .toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .split(/\s+/)
            .filter(w => w.length > 1);
    }
    calculateWeight(skill) {
        let weight = 1.0;
        // 根据使用频率调整权重
        if (skill.riskLevel === 'high')
            weight *= 0.8;
        if (skill.riskLevel === 'low')
            weight *= 1.2;
        // 标签越多权重越高（更通用）
        weight += skill.tags.length * 0.1;
        return weight;
    }
    calculateSimilarity(a, b) {
        // 简单的编辑距离算法
        const matrix = [];
        for (let i = 0; i <= a.length; i++) {
            matrix[i] = [i];
        }
        for (let j = 0; j <= b.length; j++) {
            matrix[0][j] = j;
        }
        for (let i = 1; i <= a.length; i++) {
            for (let j = 1; j <= b.length; j++) {
                const cost = a[i - 1] === b[j - 1] ? 0 : 1;
                matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost);
            }
        }
        const distance = matrix[a.length][b.length];
        const maxLength = Math.max(a.length, b.length);
        return 1 - distance / maxLength;
    }
    cacheResult(key, results) {
        // LRU 缓存
        if (this.queryCache.size >= this.CACHE_SIZE) {
            const firstKey = this.queryCache.keys().next().value;
            if (firstKey) {
                this.queryCache.delete(firstKey);
            }
        }
        this.queryCache.set(key, results);
    }
}
// 单例导出
export const skillIndexer = new SkillIndexer();
