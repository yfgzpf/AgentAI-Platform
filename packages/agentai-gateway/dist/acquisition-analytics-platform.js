/**
 * AcquisitionAnalyticsPlatform - 获客数据分析平台
 *
 * 功能：
 * 1. 全渠道数据整合
 * 2. 客户旅程分析
 * 3. 转化漏斗优化
 * 4. ROI计算与预测
 * 5. 智能归因分析
 */
import { EventEmitter } from 'events';
// ═══════════════════════════════════════════════════════════
// 获客数据分析平台
// ═══════════════════════════════════════════════════════════
export class AcquisitionAnalyticsPlatform extends EventEmitter {
    data = [];
    attributionModels = new Map();
    constructor() {
        super();
        this.initializeAttributionModels();
    }
    initializeAttributionModels() {
        // 首次触点归因
        this.attributionModels.set('first-touch', {
            name: '首次触点归因',
            touchpointWeights: { first: 1.0, last: 0, linear: 0, timeDecay: 0 },
        });
        // 末次触点归因
        this.attributionModels.set('last-touch', {
            name: '末次触点归因',
            touchpointWeights: { first: 0, last: 1.0, linear: 0, timeDecay: 0 },
        });
        // 线性归因
        this.attributionModels.set('linear', {
            name: '线性归因',
            touchpointWeights: { first: 0, last: 0, linear: 1.0, timeDecay: 0 },
        });
        // 时间衰减归因
        this.attributionModels.set('time-decay', {
            name: '时间衰减归因',
            touchpointWeights: { first: 0, last: 0, linear: 0, timeDecay: 1.0 },
        });
    }
    /**
     * 记录获客事件
     */
    trackEvent(event) {
        this.data.push(event);
        this.emit('event:tracked', event);
    }
    /**
     * 批量导入数据
     */
    importData(data) {
        this.data.push(...data);
        this.emit('data:imported', { count: data.length });
    }
    /**
     * 获取转化漏斗
     */
    getConversionFunnel(timeRange) {
        const filteredData = this.data.filter(d => d.timestamp >= timeRange.start && d.timestamp <= timeRange.end);
        const stages = [
            { name: '曝光', count: 0, conversionRate: 1, avgTimeToConvert: 0, dropOffRate: 0 },
            { name: '点击', count: 0, conversionRate: 0, avgTimeToConvert: 0, dropOffRate: 0 },
            { name: '线索', count: 0, conversionRate: 0, avgTimeToConvert: 0, dropOffRate: 0 },
            { name: '合格线索', count: 0, conversionRate: 0, avgTimeToConvert: 0, dropOffRate: 0 },
            { name: '商机', count: 0, conversionRate: 0, avgTimeToConvert: 0, dropOffRate: 0 },
            { name: '客户', count: 0, conversionRate: 0, avgTimeToConvert: 0, dropOffRate: 0 },
        ];
        // 统计各阶段数量
        const uniqueUsers = new Set(filteredData.map(d => d.userId));
        stages[0].count = uniqueUsers.size; // 曝光用户数
        const eventCounts = {
            click: new Set(filteredData.filter(d => d.eventType === 'click').map(d => d.userId)).size,
            lead: new Set(filteredData.filter(d => d.eventType === 'lead').map(d => d.userId)).size,
            qualified_lead: new Set(filteredData.filter(d => d.eventType === 'qualified_lead').map(d => d.userId)).size,
            opportunity: new Set(filteredData.filter(d => d.eventType === 'opportunity').map(d => d.userId)).size,
            customer: new Set(filteredData.filter(d => d.eventType === 'customer').map(d => d.userId)).size,
        };
        stages[1].count = eventCounts.click;
        stages[2].count = eventCounts.lead;
        stages[3].count = eventCounts.qualified_lead;
        stages[4].count = eventCounts.opportunity;
        stages[5].count = eventCounts.customer;
        // 计算转化率和流失率
        for (let i = 1; i < stages.length; i++) {
            const prevCount = stages[i - 1].count;
            const currCount = stages[i].count;
            stages[i].conversionRate = prevCount > 0 ? currCount / prevCount : 0;
            stages[i].dropOffRate = prevCount > 0 ? (prevCount - currCount) / prevCount : 0;
        }
        const totalUsers = stages[0].count;
        const totalCustomers = stages[stages.length - 1].count;
        return {
            stages,
            overallConversionRate: totalUsers > 0 ? totalCustomers / totalUsers : 0,
            totalUsers,
            totalCustomers,
            avgCustomerValue: this.calculateAvgCustomerValue(timeRange),
        };
    }
    calculateAvgCustomerValue(timeRange) {
        const customerEvents = this.data.filter(d => d.eventType === 'customer' &&
            d.timestamp >= timeRange.start &&
            d.timestamp <= timeRange.end &&
            d.metadata?.revenue);
        if (customerEvents.length === 0)
            return 0;
        const totalRevenue = customerEvents.reduce((sum, e) => sum + (e.metadata.revenue || 0), 0);
        return totalRevenue / customerEvents.length;
    }
    /**
     * 获取渠道表现
     */
    getChannelPerformance(timeRange) {
        const filteredData = this.data.filter(d => d.timestamp >= timeRange.start && d.timestamp <= timeRange.end);
        const channels = new Set(filteredData.map(d => d.channel));
        const performances = [];
        for (const channel of channels) {
            const channelData = filteredData.filter(d => d.channel === channel);
            const spend = channelData.reduce((sum, d) => sum + (d.metadata?.spend || 0), 0);
            const impressions = new Set(channelData.filter(d => d.eventType === 'impression').map(d => d.userId)).size;
            const clicks = new Set(channelData.filter(d => d.eventType === 'click').map(d => d.userId)).size;
            const leads = new Set(channelData.filter(d => d.eventType === 'lead').map(d => d.userId)).size;
            const customers = new Set(channelData.filter(d => d.eventType === 'customer').map(d => d.userId)).size;
            const revenue = channelData
                .filter(d => d.eventType === 'customer')
                .reduce((sum, d) => sum + (d.metadata?.revenue || 0), 0);
            const cac = customers > 0 ? spend / customers : 0;
            const ltv = customers > 0 ? revenue / customers : 0;
            performances.push({
                channel,
                spend,
                impressions,
                clicks,
                leads,
                customers,
                revenue,
                roi: spend > 0 ? (revenue - spend) / spend : 0,
                cac,
                ltv,
                ltvCacRatio: cac > 0 ? ltv / cac : 0,
            });
        }
        return performances.sort((a, b) => b.roi - a.roi);
    }
    /**
     * 归因分析
     */
    analyzeAttribution(userId, model = 'last-touch') {
        const userData = this.data
            .filter(d => d.userId === userId)
            .sort((a, b) => a.timestamp - b.timestamp);
        if (userData.length === 0)
            return [];
        const channelTouches = {};
        for (const event of userData) {
            channelTouches[event.channel] = (channelTouches[event.channel] || 0) + 1;
        }
        const channels = Object.keys(channelTouches);
        const attributionModel = this.attributionModels.get(model);
        if (!attributionModel) {
            // 默认线性归因
            const equalShare = 1 / channels.length;
            return channels.map(channel => ({
                channel,
                contribution: equalShare,
                touchpoints: channelTouches[channel],
            }));
        }
        // 根据归因模型计算贡献度
        const weights = attributionModel.touchpointWeights;
        const result = [];
        if (weights.first > 0) {
            // 首次触点归因
            const firstChannel = userData[0].channel;
            for (const channel of channels) {
                result.push({
                    channel,
                    contribution: channel === firstChannel ? 1 : 0,
                    touchpoints: channelTouches[channel],
                });
            }
        }
        else if (weights.last > 0) {
            // 末次触点归因
            const lastChannel = userData[userData.length - 1].channel;
            for (const channel of channels) {
                result.push({
                    channel,
                    contribution: channel === lastChannel ? 1 : 0,
                    touchpoints: channelTouches[channel],
                });
            }
        }
        else if (weights.linear > 0) {
            // 线性归因
            const equalShare = 1 / channels.length;
            for (const channel of channels) {
                result.push({
                    channel,
                    contribution: equalShare,
                    touchpoints: channelTouches[channel],
                });
            }
        }
        else {
            // 时间衰减归因
            const totalWeight = userData.reduce((sum, _, index) => sum + (index + 1), 0);
            const channelWeights = {};
            for (let i = 0; i < userData.length; i++) {
                const channel = userData[i].channel;
                const weight = (i + 1) / totalWeight;
                channelWeights[channel] = (channelWeights[channel] || 0) + weight;
            }
            for (const channel of channels) {
                result.push({
                    channel,
                    contribution: channelWeights[channel] || 0,
                    touchpoints: channelTouches[channel],
                });
            }
        }
        return result;
    }
    /**
     * 队列分析
     */
    getCohortAnalysis() {
        // 按月份分组用户
        const cohorts = {};
        for (const event of this.data) {
            if (event.eventType === 'customer') {
                const month = new Date(event.timestamp).toISOString().slice(0, 7);
                if (!cohorts[month]) {
                    cohorts[month] = new Set();
                }
                cohorts[month].add(event.userId);
            }
        }
        const analyses = [];
        for (const [month, users] of Object.entries(cohorts)) {
            const userList = Array.from(users);
            const retentionRates = [];
            const avgRevenue = [];
            // 计算后续月份的留存率
            for (let i = 0; i < 6; i++) {
                const targetMonth = this.addMonths(month, i);
                const activeUsers = new Set(this.data
                    .filter(d => {
                    const eventMonth = new Date(d.timestamp).toISOString().slice(0, 7);
                    return eventMonth === targetMonth && userList.includes(d.userId);
                })
                    .map(d => d.userId));
                const retentionRate = userList.length > 0 ? activeUsers.size / userList.length : 0;
                retentionRates.push(retentionRate);
                // 计算平均收入
                const revenue = this.data
                    .filter(d => {
                    const eventMonth = new Date(d.timestamp).toISOString().slice(0, 7);
                    return eventMonth === targetMonth &&
                        userList.includes(d.userId) &&
                        d.metadata?.revenue;
                })
                    .reduce((sum, d) => sum + (d.metadata.revenue || 0), 0);
                avgRevenue.push(activeUsers.size > 0 ? revenue / activeUsers.size : 0);
            }
            analyses.push({
                cohortDate: month,
                cohortSize: userList.length,
                retentionRates,
                avgRevenue,
            });
        }
        return analyses;
    }
    addMonths(dateStr, months) {
        const date = new Date(dateStr + '-01');
        date.setMonth(date.getMonth() + months);
        return date.toISOString().slice(0, 7);
    }
    /**
     * 预测洞察
     */
    getPredictiveInsights() {
        const insights = [];
        // 基于历史数据生成预测
        const lastMonthData = this.data.filter(d => d.timestamp > Date.now() - 30 * 24 * 60 * 60 * 1000);
        const prevMonthData = this.data.filter(d => {
            const timestamp = d.timestamp;
            return timestamp > Date.now() - 60 * 24 * 60 * 60 * 1000 &&
                timestamp <= Date.now() - 30 * 24 * 60 * 60 * 1000;
        });
        // 预测客户获取成本趋势
        const currentCAC = this.calculateCAC(lastMonthData);
        const prevCAC = this.calculateCAC(prevMonthData);
        insights.push({
            metric: '客户获取成本 (CAC)',
            currentValue: currentCAC,
            predictedValue: currentCAC * 1.1, // 预测增长10%
            confidence: 0.75,
            trend: currentCAC > prevCAC ? 'up' : 'down',
            recommendation: currentCAC > prevCAC
                ? '优化高成本渠道，增加有机流量投入'
                : '保持当前策略，扩大规模',
        });
        // 预测转化率
        const currentConversion = this.calculateConversionRate(lastMonthData);
        insights.push({
            metric: '转化率',
            currentValue: currentConversion,
            predictedValue: currentConversion * 1.05,
            confidence: 0.8,
            trend: 'up',
            recommendation: '优化落地页，A/B测试标题和CTA',
        });
        return insights;
    }
    calculateCAC(data) {
        const spend = data.reduce((sum, d) => sum + (d.metadata?.spend || 0), 0);
        const customers = new Set(data.filter(d => d.eventType === 'customer').map(d => d.userId)).size;
        return customers > 0 ? spend / customers : 0;
    }
    calculateConversionRate(data) {
        const visitors = new Set(data.filter(d => d.eventType === 'click').map(d => d.userId)).size;
        const customers = new Set(data.filter(d => d.eventType === 'customer').map(d => d.userId)).size;
        return visitors > 0 ? customers / visitors : 0;
    }
    /**
     * 生成数据报告
     */
    generateReport(timeRange) {
        const funnel = this.getConversionFunnel(timeRange);
        const channels = this.getChannelPerformance(timeRange);
        const insights = this.getPredictiveInsights();
        // 生成建议
        const recommendations = [];
        // 基于漏斗分析
        const weakestStage = funnel.stages.reduce((weakest, stage, index) => {
            if (index === 0)
                return weakest;
            return stage.conversionRate < weakest.conversionRate ? stage : weakest;
        }, funnel.stages[1]);
        recommendations.push(`优化"${weakestStage.name}"阶段：转化率仅${(weakestStage.conversionRate * 100).toFixed(1)}%，建议进行A/B测试改进`);
        // 基于渠道表现
        const bestChannel = channels[0];
        const worstChannel = channels[channels.length - 1];
        if (bestChannel) {
            recommendations.push(`增加对"${bestChannel.channel}"的投入：ROI为${(bestChannel.roi * 100).toFixed(1)}%，表现最佳`);
        }
        if (worstChannel && worstChannel.roi < 0) {
            recommendations.push(`审查"${worstChannel.channel}"策略：ROI为负，考虑暂停或优化`);
        }
        return {
            funnel,
            channels,
            insights,
            recommendations,
        };
    }
}
// 单例导出
let analyticsPlatform = null;
export function getAcquisitionAnalyticsPlatform() {
    if (!analyticsPlatform) {
        analyticsPlatform = new AcquisitionAnalyticsPlatform();
    }
    return analyticsPlatform;
}
