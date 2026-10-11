/**
 * PromptOptimizer — 提示词优化模块
 *   - 挂载时自动调用 LLM 优化用户输入
 *   - 中文输入→中文输出, 只补全意图/结构化/更清晰
 *   - 支持应用优化文本 / 恢复原始
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { CloseOutlined, CheckOutlined, UndoOutlined } from '@ant-design/icons';
import { apiPost } from '../services/api';

interface Props {
  draft: string;
  onApply: (text: string) => void;
  onClose: () => void;
  disabled?: boolean;
}

export const PromptOptimizer: React.FC<Props> = ({ draft, onApply, onClose }) => {
  const [loading, setLoading] = useState(false);
  const [enhanced, setEnhanced] = useState('');
  const [error, setError] = useState<string | null>(null);
  const originalRef = useRef(draft);
  const triggeredRef = useRef(false);

  const handleOptimize = useCallback(async () => {
    if (!draft.trim() || loading) return;
    setLoading(true);
    setError(null);

    try {
      const data = await apiPost('/v1/prompt/optimize', {
        text: draft,
        type: 'chat',
      });

      if (data.ok && data.enhanced) {
        setEnhanced(data.enhanced);
      } else {
        setError(data.error || '优化失败');
      }
    } catch (err: any) {
      setError(err?.message || '优化失败');
    } finally {
      setLoading(false);
    }
  }, [draft, loading]);

  // 挂载时自动触发
  useEffect(() => {
    if (!triggeredRef.current && draft.trim()) {
      triggeredRef.current = true;
      originalRef.current = draft;
      handleOptimize();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <div style={{
        position: 'absolute', bottom: '100%', left: 12, right: 12,
        marginBottom: 8,
        background: 'var(--card)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)', boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
        maxHeight: 400, overflowY: 'auto', zIndex: 'var(--z-drawer)',
        animation: 'msgSlideIn 0.25s cubic-bezier(0.16,1,0.3,1) forwards',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 12px', borderBottom: '1px solid var(--border)',
        }}>
          <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, color: 'var(--fg-2)', flex: 1 }}>
            ✨ 提示词优化
          </span>
          <button onClick={onClose} style={{
            width: 22, height: 22, borderRadius: 'var(--radius-sm)', border: 'none',
            background: 'transparent', cursor: 'pointer', color: 'var(--muted-2)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <CloseOutlined style={{ fontSize: 'var(--fs-micro)' }} />
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: '8px 12px 10px' }}>
          {loading && (
            <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--muted)' }}>
              <span style={{
                width: 20, height: 20, borderRadius: '50%',
                border: '2px solid var(--border)', borderTopColor: 'var(--accent)',
                animation: 'spin 0.6s linear infinite', display: 'inline-block', marginBottom: 8,
              }} />
              <div style={{ fontSize: 'var(--fs-micro)' }}>正在调用 AI 优化提示词...</div>
            </div>
          )}

          {error && !loading && (
            <div style={{
              padding: '8px 12px', background: 'rgba(239,68,68,0.1)',
              border: '1px solid rgba(239,68,68,0.2)', borderRadius: 'var(--radius-md)',
              fontSize: 'var(--fs-micro)', color: 'var(--danger)',
            }}>
              ❌ {error}
            </div>
          )}

          {enhanced && !loading && (
            <>
              {/* 原始文本 */}
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 'var(--fs-micro)', fontWeight: 600, color: 'var(--muted)', marginBottom: 4 }}>
                  原始输入
                </div>
                <div style={{
                  fontSize: 'var(--fs-micro)', lineHeight: 1.5, color: 'var(--muted)',
                  padding: '6px 10px', background: 'var(--panel)', borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border)', whiteSpace: 'pre-wrap', maxHeight: 60, overflowY: 'auto',
                }}>
                  {originalRef.current}
                </div>
              </div>

              {/* 优化后文本 */}
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 'var(--fs-micro)', fontWeight: 600, color: 'var(--success)', marginBottom: 4 }}>
                  优化后
                </div>
                <div style={{
                  fontSize: 'var(--fs-micro)', lineHeight: 1.5, color: 'var(--fg)',
                  padding: '8px 10px', background: 'var(--bg-2)', borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border)', whiteSpace: 'pre-wrap', maxHeight: 150, overflowY: 'auto',
                }}>
                  {enhanced}
                </div>
              </div>

              {/* 操作按钮 */}
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => { onApply(enhanced); onClose(); }} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '5px 14px', borderRadius: 'var(--radius-md)', fontSize: 'var(--fs-micro)', fontWeight: 600,
                  background: 'var(--success)', color: 'var(--fg-on-accent)', border: 'none',
                  cursor: 'pointer', boxShadow: '0 1px 4px rgba(34,197,94,0.3)',
                }}>
                  <CheckOutlined style={{ fontSize: 'var(--fs-micro)' }} />
                  应用优化
                </button>
                <button onClick={() => { onApply(originalRef.current); onClose(); }} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '5px 14px', borderRadius: 'var(--radius-md)', fontSize: 'var(--fs-micro)', fontWeight: 600,
                  background: 'var(--panel)', color: 'var(--muted)', border: '1px solid var(--border)',
                  cursor: 'pointer',
                }}>
                  <UndoOutlined style={{ fontSize: 'var(--fs-micro)' }} />
                  恢复原始
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
};
