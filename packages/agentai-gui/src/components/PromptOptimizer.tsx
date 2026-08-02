/**
 * PromptOptimizer — 提示词优化模块
 *   - 调用 LLM 分析用户输入 (评分/问题/建议/增强版)
 *   - 浮窗展示优化结果
 *   - 一键应用增强提示词
 */
import React, { useState, useCallback } from 'react';
import { ThunderboltOutlined, CloseOutlined, CheckOutlined } from '@ant-design/icons';
import { Tooltip } from 'antd';
import { useModelStore } from '../store/modelStore';

/* ==================== 结果类型 ==================== */
interface OptimizeResult {
  score: number;           // 0–100
  issues: string[];        // 问题列表
  suggestions: string[];   // 改进建议
  enhanced: string;        // 增强后的提示词
}

/* ==================== Props ==================== */
interface Props {
  draft: string;
  onApply: (text: string) => void;
  disabled?: boolean;
}

/* ==================== Component ==================== */
export const PromptOptimizer: React.FC<Props> = ({ draft, onApply, disabled }) => {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<OptimizeResult | null>(null);
  const [showPanel, setShowPanel] = useState(false);

  /* ---- 调用 LLM 优化 ---- */
  const handleOptimize = useCallback(async () => {
    if (!draft.trim() || loading) return;
    setLoading(true);
    setResult(null);
    setShowPanel(true);

    try {
      // P3修复 (2026-07-25): 提示词优化是轻量任务, 优先使用免费模型避免浪费付费配额
      const state = useModelStore.getState();
      const freeModelIds = ['agentai', 'zhipu'];
      const optimizeModel = freeModelIds.includes(state.activeModelId)
        ? state.activeModelId
        : 'agentai';  // 非免费模型时回退到默认免费模型

      const resp = await fetch('/v1/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `你是一个提示词优化专家。分析用户的提示词，返回 JSON（不要markdown包裹）：
{
  "score": 0–100,
  "issues": ["问题1", "问题2"],
  "suggestions": ["建议1", "建议2"],
  "enhanced": "优化后的提示词"
}

用户提示词：
"""${draft}"""`,
          stream: false,
          model: optimizeModel,
          mode: 'auto',
          system: '你只输出 JSON，不要包裹 markdown 代码块。score 字段是整数。',
        }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      const text = typeof data === 'object' ? (data.content || data.text || JSON.stringify(data)) : data;

      // 解析 JSON (去除可能的 markdown 包裹)
      let jsonText = text;
      const m = text.match(/```(?:json)?\s*([\s\S]+?)```/);
      if (m) jsonText = m[1];
      const parsed: OptimizeResult = JSON.parse(jsonText);
      setResult(parsed);
    } catch (err) {
      setResult({
        score: 0,
        issues: ['优化请求失败，请稍后重试'],
        suggestions: [],
        enhanced: draft,
      });
    } finally {
      setLoading(false);
    }
  }, [draft, loading]);

  /* ---- 应用增强 ---- */
  const handleApply = () => {
    if (result?.enhanced) {
      onApply(result.enhanced);
      setShowPanel(false);
      setResult(null);
    }
  };

  /* ---- 关闭 ---- */
  const handleClose = () => {
    setShowPanel(false);
    setResult(null);
  };

  /* ---- 评分色 ---- */
  const scoreColor = (s: number) => {
    if (s >= 80) return '#22c55e';
    if (s >= 60) return '#eab308';
    if (s >= 40) return '#f97316';
    return '#ef4444';
  };

  return (
    <>
      {/* 优化触发按钮 */}
      <Tooltip title="优化提示词">
        <button
          onClick={handleOptimize}
          disabled={disabled || !draft.trim() || loading}
          style={{
            width: 28, height: 28, borderRadius: 6,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            color: draft.trim() && !loading ? 'var(--accent)' : 'var(--muted-2)',
            cursor: draft.trim() && !loading ? 'pointer' : 'default',
            border: 'none', background: loading ? 'var(--accent-soft)' : 'transparent',
            transition: 'all 0.15s',
          }}
        >
          {loading ? (
            <span style={{
              width: 14, height: 14, borderRadius: '50%',
              border: '2px solid var(--border)',
              borderTopColor: 'var(--accent)',
              animation: 'spin 0.6s linear infinite',
              display: 'inline-block',
            }} />
          ) : (
            <ThunderboltOutlined style={{ fontSize: 14 }} />
          )}
        </button>
      </Tooltip>

      {/* 注入旋转动画 */}
      {loading && !document.getElementById('spin-anim') && (
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      )}

      {/* 优化结果浮窗 */}
      {showPanel && (
        <div style={{
          position: 'absolute', bottom: '100%', left: 12, right: 12,
          marginBottom: 8,
          background: 'var(--card)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          boxShadow: '0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06)',
          padding: 0,
          maxHeight: 360,
          overflowY: 'auto',
          zIndex: 200,
          animation: 'msgSlideIn 0.25s cubic-bezier(0.16,1,0.3,1) forwards',
        }}>
          {/* Header */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '10px 12px', borderBottom: '1px solid var(--border)',
          }}>
            <ThunderboltOutlined style={{ color: 'var(--accent)', fontSize: 16 }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--fg-2)', flex: 1 }}>
              提示词优化
            </span>
            {result && (
              <span style={{
                fontSize: 14, fontWeight: 800,
                color: scoreColor(result.score),
                background: `${scoreColor(result.score)}14`,
                padding: '0 8px', borderRadius: 6,
              }}>
                {result.score}
              </span>
            )}
            <button
              onClick={handleClose}
              style={{
                width: 22, height: 22, borderRadius: 4,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                border: 'none', background: 'transparent', cursor: 'pointer',
                color: 'var(--muted-2)',
              }}
            >
              <CloseOutlined style={{ fontSize: 11 }} />
            </button>
          </div>

          {/* Content */}
          <div style={{ padding: '8px 12px 10px' }}>
            {loading && !result && (
              <div style={{ textAlign: 'center', padding: '16px 0', color: 'var(--muted)' }}>
                <span style={{
                  width: 18, height: 18, borderRadius: '50%',
                  border: '2px solid var(--border)',
                  borderTopColor: 'var(--accent)',
                  animation: 'spin 0.6s linear infinite',
                  display: 'inline-block',
                  marginBottom: 8,
                }} />
                <div style={{ fontSize: 11 }}>正在分析提示词...</div>
              </div>
            )}

            {result && (
              <>
                {/* Issues */}
                {result.issues.length > 0 && (
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--danger)', marginBottom: 4 }}>
                      发现 {result.issues.length} 个问题
                    </div>
                    {result.issues.map((issue, i) => (
                      <div key={i} style={{
                        fontSize: 11, color: 'var(--muted)', padding: '3px 8px',
                        background: 'var(--panel)', borderRadius: 4, marginBottom: 2,
                        display: 'flex', alignItems: 'flex-start', gap: 4,
                      }}>
                        <span style={{ color: 'var(--danger)', flexShrink: 0 }}>•</span>
                        {issue}
                      </div>
                    ))}
                  </div>
                )}

                {/* Suggestions */}
                {result.suggestions.length > 0 && (
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--accent)', marginBottom: 4 }}>
                      改进建议
                    </div>
                    {result.suggestions.map((sug, i) => (
                      <div key={i} style={{
                        fontSize: 11, color: 'var(--muted)', padding: '3px 8px',
                        background: 'var(--panel)', borderRadius: 4, marginBottom: 2,
                        display: 'flex', alignItems: 'flex-start', gap: 4,
                      }}>
                        <span style={{ color: 'var(--accent)', flexShrink: 0 }}>✦</span>
                        {sug}
                      </div>
                    ))}
                  </div>
                )}

                {/* Enhanced prompt */}
                {result.enhanced && (
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--success)', marginBottom: 4 }}>
                      优化后版本
                    </div>
                    <div style={{
                      fontSize: 11, lineHeight: 1.5, color: 'var(--fg)',
                      padding: '8px 10px', background: 'var(--bg-2)',
                      borderRadius: 6, border: '1px solid var(--border)',
                      whiteSpace: 'pre-wrap', maxHeight: 120, overflowY: 'auto',
                      marginBottom: 8,
                    }}>
                      {result.enhanced}
                    </div>

                    {/* Apply button */}
                    <button
                      onClick={handleApply}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        padding: '4px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                        background: 'var(--success)', color: '#fff', border: 'none',
                        cursor: 'pointer', transition: 'opacity 0.15s',
                        boxShadow: '0 1px 4px rgba(34,197,94,0.3)',
                      }}
                    >
                      <CheckOutlined style={{ fontSize: 11 }} />
                      应用优化
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
};
