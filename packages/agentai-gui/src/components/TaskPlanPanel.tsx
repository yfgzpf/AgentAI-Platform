/**
 * TaskPlanPanel — AI 任务计划面板
 * 显示 AI 通过 plan_task 创建的执行计划和进度
 */
import React, { useState, useEffect } from 'react';
import { Card, Empty } from 'antd';
import { OrderedListOutlined, CheckCircleOutlined, LoadingOutlined, ClockCircleOutlined } from '@ant-design/icons';

interface SubTask {
    id: string;
    title: string;
    priority: string;
    status: string;
    summary?: string;
}

interface TaskPlan {
    id: string;
    goal: string;
    subtasks: SubTask[];
    created_at: number;
}

const STATUS_META: Record<string, { icon: React.ReactNode; color: string }> = {
    pending: { icon: <ClockCircleOutlined />, color: 'var(--muted-2)' },
    in_progress: { icon: <LoadingOutlined />, color: 'var(--accent)' },
    completed: { icon: <CheckCircleOutlined />, color: 'var(--success)' },
    failed: { icon: <span>✗</span>, color: 'var(--danger)' },
};

export const TaskPlanPanel: React.FC = () => {
    const [plan, setPlan] = useState<TaskPlan | null>(null);

    useEffect(() => {
        let cancelled = false;
        const poll = () => {
            fetch('/v1/plan')
                .then(r => r.json())
                .then(data => { if (!cancelled && data?.plan) setPlan(data.plan); })
                .catch(() => {});
        };
        poll();
        const id = setInterval(poll, 3000);
        return () => { cancelled = true; clearInterval(id); };
    }, []);

    if (!plan) {
        return (
            <Card
                size="small"
                title={<span style={{ fontSize: 12, color: 'var(--fg-2)' }}>
                    <OrderedListOutlined style={{ marginRight: 4 }} />任务计划
                </span>}
                style={{ borderRadius: 8, background: 'var(--card)', border: '1px solid var(--border)' }}
                styles={{ body: { padding: '8px 12px' } }}
            >
                <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={<span style={{ fontSize: 11, color: 'var(--muted-2)' }}>暂无计划</span>}
                    style={{ margin: '4px 0' }}
                />
            </Card>
        );
    }

    const done = plan.subtasks.filter(t => t.status === 'completed').length;
    const total = plan.subtasks.length;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;

    return (
        <Card
            size="small"
            title={<span style={{ fontSize: 12, color: 'var(--fg-2)' }}>
                <OrderedListOutlined style={{ marginRight: 4 }} />
                任务计划 ({done}/{total})
            </span>}
            extra={<span style={{ fontSize: 10, color: 'var(--accent)' }}>{pct}%</span>}
            style={{ borderRadius: 8, background: 'var(--card)', border: '1px solid var(--border)' }}
            styles={{ body: { padding: '8px 12px' } }}
        >
            <div style={{ fontSize: 11, color: 'var(--fg)', fontWeight: 600, marginBottom: 6 }}>
                {plan.goal}
            </div>
            <div style={{
                height: 3, borderRadius: 2, background: 'var(--bg-2)', marginBottom: 8,
            }}>
                <div style={{
                    height: '100%', borderRadius: 2,
                    background: 'var(--accent)',
                    width: `${pct}%`,
                    transition: 'width 0.3s ease',
                }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {plan.subtasks.map((t, i) => {
                    const meta = STATUS_META[t.status] || STATUS_META.pending;
                    return (
                        <div key={t.id} style={{
                            display: 'flex', alignItems: 'flex-start', gap: 6,
                            padding: '3px 0', fontSize: 11,
                            color: t.status === 'completed' ? 'var(--muted-2)' : 'var(--fg-2)',
                            textDecoration: t.status === 'completed' ? 'line-through' : 'none',
                        }}>
                            <span style={{ color: meta.color, flexShrink: 0, marginTop: 1 }}>
                                {meta.icon}
                            </span>
                            <span style={{ flex: 1 }}>
                                {i + 1}. {t.title}
                                {t.summary && (
                                    <span style={{
                                        display: 'block', fontSize: 10,
                                        color: 'var(--muted-2)', fontStyle: 'italic',
                                    }}>{t.summary}</span>
                                )}
                            </span>
                        </div>
                    );
                })}
            </div>
        </Card>
    );
};
