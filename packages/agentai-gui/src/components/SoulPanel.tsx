/**
 * SoulPanel — AI 灵魂层面板
 * ----------------------------------------------------
 * 可视化 AI 的"内心世界":
 *   1. 情绪状态 (PainSense: calm/anxious/confident)
 *   2. 梦境历史 (DreamEngine: 时间线 + 洞察)
 *   3. 好奇心队列 (CuriosityEngine: 未解问题)
 *   4. 内心独白 (InnerVoice: 最近思维活动)
 *   5. 内部辩论 (InternalDebate: 三方观点)
 *
 * 数据源: GET /v1/soul/status
 */
import React, { useEffect, useState, useCallback } from 'react';
import { Card, Tag, Tooltip, Button, Collapse, Spin, Empty, Badge, Progress } from 'antd';
import {
  MoonOutlined, BulbOutlined, ThunderboltOutlined, MessageOutlined,
  ReloadOutlined, PlayCircleOutlined,
} from '@ant-design/icons';

interface SoulStatus {
  dream: {
    dreaming: boolean;
    recentDreams: any[];
  };
  emotion: {
    pain: string;
    joy: string;
    mood: string;
    intensity: number;
    consecutiveFailures: number;
    consecutiveSuccesses: number;
  };
  curiosity: {
    stats: { totalQuestions: number; pending: number; resolved: number; insights: number };
    pending: any[];
    insights: any[];
  };
  debate: any[];
  innerVoice: any[];
}

const MOOD_CONFIG: Record<string, { emoji: string; color: string; label: string }> = {
  calm:       { emoji: '😌', color: '#9ca3af', label: '平静' },
  anxious:    { emoji: '😟', color: '#f59e0b', label: '焦虑' },
  frustrated: { emoji: '😣', color: '#ef4444', label: '沮丧' },
  confident:  { emoji: '😊', color: '#10b981', label: '自信' },
  thrilled:   { emoji: '🤩', color: '#8b5cf6', label: '兴奋' },
  determined: { emoji: '💪', color: '#3b82f6', label: '坚定' },
  reflective: { emoji: '🤔', color: '#6366f1', label: '沉思' },
  curious:    { emoji: '🔍', color: '#06b6d4', label: '好奇' },
};

const PAIN_COLORS: Record<string, string> = {
  none: '#9ca3af', mild: '#fbbf24', moderate: '#f59e0b',
  severe: '#ef4444', critical: '#dc2626',
};

export const SoulPanel: React.FC = () => {
  const [status, setStatus] = useState<SoulStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [dreaming, setDreaming] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await fetch('/v1/soul/status');
      if (resp.ok) {
        const data = await resp.json();
        if (data.ok) setStatus(data.data);
      }
    } catch (e) {
      console.warn('[soul] load failed:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 10000); // 10s 刷新
    return () => clearInterval(timer);
  }, [load]);

  const triggerDream = async () => {
    setDreaming(true);
    try {
      await fetch('/v1/soul/dream', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trigger: 'manual' }) });
      await load();
    } catch (e) {
      console.warn('[soul] dream trigger failed:', e);
    } finally {
      setDreaming(false);
    }
  };

  if (loading && !status) {
    return <div style={{ padding: 20, textAlign: 'center' }}><Spin tip="加载灵魂状态..." /></div>;
  }

  if (!status) {
    return <Empty description="灵魂层未启用" />;
  }

  const mood = MOOD_CONFIG[status.emotion.mood] || MOOD_CONFIG.calm;
  const painColor = PAIN_COLORS[status.emotion.pain] || '#9ca3af';

  return (
    <div style={{ padding: 12, overflow: 'auto', height: '100%', background: 'var(--bg-1)' }}>
      {/* ===== 情绪状态卡片 ===== */}
      <Card size="small" style={{ marginBottom: 12, background: 'var(--bg-2)', border: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ fontSize: 32 }}>{mood.emoji}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 'var(--fs-md)', fontWeight: 600, color: 'var(--fg)' }}>
              当前心境: <span style={{ color: mood.color }}>{mood.label}</span>
            </div>
            <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted-2)', marginTop: 2 }}>
              痛感: <Tag color={painColor} style={{ fontSize: 'var(--fs-micro)', margin: 0 }}>{status.emotion.pain}</Tag>
              {' '}愉悦: <Tag color={status.emotion.joy !== 'none' ? '#10b981' : '#9ca3af'} style={{ fontSize: 'var(--fs-micro)', margin: 0 }}>{status.emotion.joy}</Tag>
            </div>
            {status.emotion.intensity > 0 && (
              <Progress
                percent={Math.round(status.emotion.intensity * 100)}
                size="small"
                strokeColor={mood.color}
                style={{ marginTop: 4, width: 120 }}
                showInfo={false}
              />
            )}
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 'var(--fs-micro)', color: status.emotion.consecutiveFailures > 0 ? '#ef4444' : 'var(--muted-2)' }}>
              连续失败 {status.emotion.consecutiveFailures}
            </div>
            <div style={{ fontSize: 'var(--fs-micro)', color: status.emotion.consecutiveSuccesses > 0 ? '#10b981' : 'var(--muted-2)' }}>
              连续成功 {status.emotion.consecutiveSuccesses}
            </div>
          </div>
        </div>
      </Card>

      {/* ===== 梦境卡片 ===== */}
      <Card
        size="small"
        title={<span style={{ fontSize: 'var(--fs-sm)' }}><MoonOutlined /> 梦境</span>}
        extra={
          <Button size="small" type="text" icon={<PlayCircleOutlined />} onClick={triggerDream} loading={dreaming}>
            做个梦
          </Button>
        }
        style={{ marginBottom: 12, background: 'var(--bg-2)', border: '1px solid var(--border)' }}
      >
        {status.dream.dreaming && (
          <div style={{ marginBottom: 8, padding: 6, background: 'rgba(99,102,241,0.08)', borderRadius: 6 }}>
            <Spin size="small" /> <span style={{ fontSize: 'var(--fs-micro)', color: '#6366f1' }}>正在梦境中...</span>
          </div>
        )}
        {status.dream.recentDreams.length === 0 && !status.dream.dreaming ? (
          <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted-2)', padding: 8 }}>暂无梦境记录</div>
        ) : (
          status.dream.recentDreams.map((dream, i) => {
            const ageMin = Math.round((Date.now() - dream.ts) / 60000);
            const moodCfg = MOOD_CONFIG[dream.mood] || MOOD_CONFIG.curious;
            return (
              <div key={i} style={{ marginBottom: 8, padding: 8, borderRadius: 6, background: 'var(--bg-1)', border: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <span style={{ fontSize: 'var(--fs-md)' }}>{moodCfg.emoji}</span>
                  <span style={{ fontSize: 'var(--fs-micro)', fontWeight: 600, color: 'var(--fg)' }}>
                    {ageMin}分钟前 · {dream.type}
                  </span>
                  <Tag style={{ fontSize: 'var(--fs-micro)', margin: 0, color: moodCfg.color, borderColor: moodCfg.color }}>{moodCfg.label}</Tag>
                </div>
                <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted-1)', lineHeight: 1.5 }}>
                  {dream.summary?.slice(0, 120)}
                </div>
                {dream.insights?.length > 0 && (
                  <div style={{ marginTop: 4, fontSize: 'var(--fs-micro)', color: '#06b6d4' }}>
                    💡 {dream.insights[0].slice(0, 80)}
                  </div>
                )}
                {dream.openQuestions?.length > 0 && (
                  <div style={{ marginTop: 2, fontSize: 'var(--fs-micro)', color: '#8b5cf6' }}>
                    ❓ {dream.openQuestions[0].slice(0, 80)}
                  </div>
                )}
              </div>
            );
          })
        )}
      </Card>

      {/* ===== 好奇心卡片 ===== */}
      <Card
        size="small"
        title={
          <span style={{ fontSize: 'var(--fs-sm)' }}>
            <BulbOutlined /> 好奇心
            <Badge count={status.curiosity.stats.pending} style={{ marginLeft: 6, backgroundColor: '#8b5cf6' }} />
          </span>
        }
        style={{ marginBottom: 12, background: 'var(--bg-2)', border: '1px solid var(--border)' }}
      >
        <div style={{ display: 'flex', gap: 12, marginBottom: 8, fontSize: 'var(--fs-micro)', color: 'var(--muted-2)' }}>
          <span>总问题: {status.curiosity.stats.totalQuestions}</span>
          <span style={{ color: '#10b981' }}>已解决: {status.curiosity.stats.resolved}</span>
          <span style={{ color: '#06b6d4' }}>洞察: {status.curiosity.stats.insights}</span>
        </div>
        {status.curiosity.pending.length === 0 ? (
          <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted-2)', padding: 8 }}>暂无未解问题</div>
        ) : (
          status.curiosity.pending.map((q, i) => (
            <div key={i} style={{ marginBottom: 6, padding: 6, borderRadius: 4, background: 'var(--bg-1)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <Tag color="purple" style={{ fontSize: 'var(--fs-micro)', margin: 0 }}>{q.type}</Tag>
                <Progress percent={Math.round(q.priority * 100)} size="small" style={{ width: 60 }} showInfo={false} strokeColor="#8b5cf6" />
                <span style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted-2)' }}>探索 {q.exploreCount}次</span>
              </div>
              <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--fg)', marginTop: 2 }}>
                {q.question.slice(0, 100)}
              </div>
            </div>
          ))
        )}
        {status.curiosity.insights.length > 0 && (
          <Collapse ghost size="small" style={{ marginTop: 4 }}>
            <Collapse.Panel header={<span style={{ fontSize: 'var(--fs-micro)', color: '#06b6d4' }}>💡 近期洞察 ({status.curiosity.insights.length})</span>} key="insights">
              {status.curiosity.insights.map((ins, i) => (
                <div key={i} style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted-1)', padding: 4, borderBottom: '1px solid var(--border)' }}>
                  [{ins.type}] {ins.text.slice(0, 100)}
                </div>
              ))}
            </Collapse.Panel>
          </Collapse>
        )}
      </Card>

      {/* ===== 内心独白 ===== */}
      {status.innerVoice.length > 0 && (
        <Card
          size="small"
          title={<span style={{ fontSize: 'var(--fs-sm)' }}><MessageOutlined /> 内心独白</span>}
          style={{ marginBottom: 12, background: 'var(--bg-2)', border: '1px solid var(--border)' }}
        >
          {status.innerVoice.map((t, i) => (
            <div key={i} style={{ marginBottom: 4, padding: 4, borderRadius: 4, background: 'rgba(139,92,246,0.06)' }}>
              <Tag color="purple" style={{ fontSize: 'var(--fs-micro)', margin: 0 }}>{t.mood}</Tag>
              <span style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted-2)', marginLeft: 4 }}>{t.context}</span>
              <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--fg)', marginTop: 2, fontStyle: 'italic' }}>
                "{t.text.slice(0, 120)}"
              </div>
            </div>
          ))}
        </Card>
      )}

      {/* ===== 内部辩论 ===== */}
      {status.debate.length > 0 && (
        <Card
          size="small"
          title={<span style={{ fontSize: 'var(--fs-sm)' }}><ThunderboltOutlined /> 内部辩论</span>}
          style={{ marginBottom: 12, background: 'var(--bg-2)', border: '1px solid var(--border)' }}
        >
          {status.debate.map((d, i) => {
            const ageMin = Math.round((Date.now() - d.ts) / 60000);
            return (
              <div key={i} style={{ marginBottom: 8, padding: 6, borderRadius: 4, background: 'var(--bg-1)' }}>
                <div style={{ fontSize: 'var(--fs-micro)', fontWeight: 600, color: 'var(--fg)' }}>
                  💭 {ageMin}分钟前: {d.topic.slice(0, 60)}
                </div>
                <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted-1)', marginTop: 2 }}>
                  {d.recommendation?.slice(0, 100)}
                </div>
                {d.contradictions?.length > 0 && (
                  <div style={{ fontSize: 'var(--fs-micro)', color: '#f59e0b', marginTop: 2 }}>
                    ⚡ 矛盾: {d.contradictions[0].slice(0, 80)}
                  </div>
                )}
                <Tag color={d.confidence > 0.7 ? 'green' : d.confidence > 0.4 ? 'orange' : 'red'} style={{ fontSize: 'var(--fs-micro)', margin: 0, marginTop: 2 }}>
                  置信度 {Math.round(d.confidence * 100)}%
                </Tag>
              </div>
            );
          })}
        </Card>
      )}

      {/* 刷新按钮 */}
      <div style={{ textAlign: 'center', marginBottom: 12 }}>
        <Button size="small" type="text" icon={<ReloadOutlined />} onClick={load} loading={loading}>
          刷新
        </Button>
      </div>
    </div>
  );
};

export default SoulPanel;
