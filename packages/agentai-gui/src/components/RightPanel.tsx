/**
 * RightPanel - 右侧信息面板 (ZCode 风格增强版)
 *   默认展开「上下文", 点击切换记忆/规范/元素
 *   新增:
 *     1. 任务进度摘要 + 文件变更统计 (+xx -yy)
 *     2. 实时审查面板 (编辑文件时显示当前文件内容)
 */
import React, { useState, useMemo, useEffect } from 'react';
import { AimOutlined, HistoryOutlined, FileTextOutlined,
  CheckCircleOutlined, LoadingOutlined, ClockCircleOutlined,
  PlusOutlined, MinusOutlined, FileOutlined, CodeOutlined,
  StopOutlined } from '@ant-design/icons';
import { Tooltip, Tag, Spin } from 'antd';
import { useChatStore } from '../store/chatStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { AIContextPanel } from './AIContextPanel';
import { AIInjectContextPanel } from './AIInjectContextPanel';
import { AIToolCallPanel } from './AIToolCallPanel';
import { MemoryFilesPanel } from './MemoryFilesPanel';
import { ProjectRulesPanel } from './ProjectRulesPanel';
import { GeneratedFilesPanel } from './GeneratedFilesPanel';
import { TaskPlanPanel } from './TaskPlanPanel';

const TABS = [
  { key: 'context', label: '上下文', icon: <AimOutlined /> },
  { key: 'memory',  label: '记忆',   icon: <HistoryOutlined /> },
  { key: 'rules',   label: '规范',   icon: <FileTextOutlined /> },
  // 「元素」Tab 已移除 — 对话页无作用，元素识别应集成到浏览器/预览模式
] as const;

type TabKey = typeof TABS[number]['key'];

export const RightPanel: React.FC = () => {
  const [active, setActive] = useState<TabKey>('context');

  // ═══ ZCode 风格: 从 chatStore 提取任务进度和文件变更统计 ═══
  const messages = useChatStore(s => s.messages);

  // ═══ ZCode 实时审查: 监听当前编辑的文件 ═══
  const currentFile = useWorkspaceStore(s => s.currentFile);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [fileLoading, setFileLoading] = useState(false);

  // 当编辑器中打开文件时，自动加载文件内容到右侧审查面板
  useEffect(() => {
    if (!currentFile?.path) {
      setFileContent(null);
      return;
    }
    // 避免频繁加载（仅在文件切换时加载）
    const loadFileContent = async () => {
      setFileLoading(true);
      try {
        const baseUrl = (window as any).__GATEWAY_HTTP__ || `http://127.0.0.1:18789`;
        const resp = await fetch(`${baseUrl}/v1/files/read?path=${encodeURIComponent(currentFile.path)}`);
        if (resp.ok) {
          const data = await resp.json();
          setFileContent(data.content || null);
        } else {
          setFileContent(null);
        }
      } catch {
        setFileContent(null);
      } finally {
        setFileLoading(false);
      }
    };
    loadFileContent();
  }, [currentFile?.path]);

  // 任务进度统计
  const taskStats = useMemo(() => {
    const toolSegments = messages.flatMap(m => m.segments?.filter((s: any) => s.kind === 'tool') || []);
    const total = toolSegments.length;
    const success = toolSegments.filter((s: any) => s.ok).length;
    const failed = toolSegments.filter((s: any) => !s.ok && s.state !== 'running').length;
    const running = toolSegments.filter((s: any) => s.state === 'running').length;
    return { total, success, failed, running };
  }, [messages]);

  // 文件变更统计 (+xx -yy)
  const fileChangeStats = useMemo(() => {
    const writeOps = messages.flatMap(m => m.segments?.filter(
      (s: any) => s.kind === 'tool' && ['write_file', 'multi_edit'].includes(s.name)
    ) || []);
    let additions = 0, deletions = 0;
    writeOps.forEach((op: any) => {
      // 尝试从 result 中解析变更行数
      const result = typeof op.result === 'string' ? op.result : '';
      const addMatch = result.match(/\+(\d+)/);
      const delMatch = result.match(/-(\d+)/);
      if (addMatch) additions += parseInt(addMatch[1]) || 0;
      if (delMatch) deletions += parseInt(delMatch[1]) || 0;
    });
    return { additions, deletions, files: writeOps.length };
  }, [messages]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--panel)' }}>
      {/* ═══ ZCode 风格: 任务状态栏 (计时 + 进度 + 文件变更) ═══ */}
      {(taskStats.total > 0 || fileChangeStats.files > 0) && (
        <div style={{
          padding: '6px 10px',
          borderBottom: '1px solid var(--border)',
          background: 'rgba(0,0,0,0.12)',
          fontSize: 11,
        }}>
          {/* 第一行: 计时器 (ZCode 风格: "已工作 2分46秒") */}
          {taskStats.running > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4, fontSize: 10, color: 'var(--muted-2)' }}>
              <ClockCircleOutlined style={{ fontSize: 9 }} />
              <span>已工作</span>
              <TaskTimer />
            </div>
          )}
          
          {/* 第二行: 进度 + 文件变更 (紧凑一行显示) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {/* 工具调用进度 */}
            {taskStats.total > 0 && (
              <Tooltip title={`${taskStats.success} 成功 / ${taskStats.total} 总计`}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                  {taskStats.running > 0 ? (
                    <LoadingOutlined style={{ fontSize: 9, color: 'var(--accent)' }} />
                  ) : taskStats.failed > 0 ? (
                    <span style={{ color: 'var(--danger)', fontSize: 9 }}>!</span>
                  ) : (
                    <CheckCircleOutlined style={{ fontSize: 9, color: 'var(--success)' }} />
                  )}
                  <span style={{ color: 'var(--fg-2)', fontWeight: 500 }}>
                    {taskStats.success}/{taskStats.total}
                  </span>
                </span>
              </Tooltip>
            )}
            
            {/* 文件变更统计 (ZCode 风格: "> 3 files +195 -64") */}
            {fileChangeStats.files > 0 && (
              <Tooltip title={`${fileChangeStats.files} 个文件变更`}>
                <span style={{ 
                  display: 'flex', alignItems: 'center', gap: 3,
                  padding: '1px 6px',
                  borderRadius: 4,
                  background: 'rgba(34,197,94,0.08)',
                  border: '1px solid rgba(34,197,94,0.15)',
                  cursor: 'help',
                }}>
                  <span style={{ color: 'var(--muted-2)', fontSize: 9 }}>&gt;</span>
                  <span style={{ color: 'var(--muted-2)', fontSize: 9 }}>{fileChangeStats.files} files</span>
                  <span style={{ color: 'var(--success)', fontWeight: 600, fontFamily: 'monospace', fontSize: 10 }}>
                    +{fileChangeStats.additions}
                  </span>
                  <span style={{ color: 'var(--danger)', fontWeight: 600, fontFamily: 'monospace', fontSize: 10 }}>
                    -{fileChangeStats.deletions}
                  </span>
                </span>
              </Tooltip>
            )}
            
            {/* Stop 按钮 (有进行中任务时显示) */}
            {taskStats.running > 0 && (
              <span
                onClick={() => window.dispatchEvent(new CustomEvent('agentai:stop-task'))}
                style={{ 
                  marginLeft: 'auto',
                  cursor: 'pointer', 
                  color: 'var(--muted-2)', 
                  fontSize: 9,
                  padding: '1px 6px',
                  borderRadius: 3,
                  border: '1px solid var(--border)',
                }}
              >
                <StopOutlined style={{ marginRight: 3 }} />Stop
              </span>
            )}
          </div>
        </div>
      )}

      {/* Tab 切换栏 */}
      <div style={{
        display: 'flex', padding: '6px 8px 0 0',
        borderBottom: '1px solid var(--border)',
      }}>
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setActive(t.key)}
            style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
              padding: '6px 8px', fontSize: 11, fontWeight: 500,
              border: 'none', borderBottom: active === t.key ? '2px solid var(--accent)' : '2px solid transparent',
              background: 'transparent',
              color: active === t.key ? 'var(--accent)' : 'var(--muted-2)',
              cursor: 'pointer',
              transition: 'color 0.15s, border-color 0.15s',
            }}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* 内容区 */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 8px' }}>
        {active === 'context' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {/* AI 上下文 — 可折叠 */}
            <AIContextPanel />
            {/* 模型注入上下文 */}
            <AIInjectContextPanel />

            {/* ═══ ZCode 实时审查面板 (放在注入上下文下方，更自然) ═══ */}
            {currentFile?.path && (
              <div style={{
                border: '1px solid var(--border)',
                borderRadius: 5,
                background: 'rgba(99,102,241,0.04)',
                overflow: 'hidden',
              }}>
                {/* 文件头 - 紧凑版 */}
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '4px 8px',
                  background: 'rgba(99,102,241,0.08)',
                  borderBottom: '1px solid var(--border)',
                  fontSize: 9,
                }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--accent)', fontWeight: 500 }}>
                    <CodeOutlined style={{ fontSize: 8 }} />
                    <span style={{ maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {currentFile.name || currentFile.path.split(/[\\/]/).pop()}
                    </span>
                  </span>
                  <span style={{ fontSize: 8, color: 'var(--muted-2)' }}>实时预览</span>
                </div>
                {/* 文件内容 - 紧凑版 (最多50行) */}
                <div style={{
                  maxHeight: 140,
                  overflow: 'auto',
                  fontFamily: 'Consolas, "Courier New", monospace',
                  fontSize: 9,
                  lineHeight: 1.35,
                  padding: '0',
                }}>
                  {fileLoading ? (
                    <div style={{ padding: 10, textAlign: 'center', color: 'var(--muted)' }}>
                      <Spin size="small" /> 加载中...
                    </div>
                  ) : fileContent ? (
                    <pre style={{ margin: 0, color: 'var(--fg-2)', whiteSpace: 'pre' }}>
                      {fileContent.split('\n').slice(0, 50).map((line, i) => (
                        <div key={i} style={{ display: 'flex' }}>
                          <span style={{
                            width: 26, flexShrink: 0,
                            textAlign: 'right', paddingRight: 5,
                            color: 'var(--muted-2)',
                            userSelect: 'none',
                            fontSize: 8,
                          }}>{i + 1}</span>
                          <span style={{ paddingLeft: 5 }}>{line || ' '}</span>
                        </div>
                      ))}
                      {fileContent.split('\n').length > 50 && (
                        <div style={{ padding: '3px 8px', color: 'var(--muted-2)', fontSize: 8, textAlign: 'center', borderTop: '1px solid var(--border)' }}>
                          ... +{fileContent.split('\n').length - 50} 行
                        </div>
                      )}
                    </pre>
                  ) : null}
                </div>
              </div>
            )}
            {/* 任务计划 */}
            <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: 4 }}>
              <TaskPlanPanel />
            </div>
            {/* 生成的文件 */}
            <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: 4 }}>
              <GeneratedFilesPanel />
            </div>
            {/* 工具调用快照 */}
            <AIToolCallPanel />
          </div>
        )}
        {active === 'memory'  && <MemoryFilesPanel />}
        {active === 'rules'   && <ProjectRulesPanel />}
      </div>
    </div>
  );
};

/**
 * TaskTimer — 任务计时器组件 (ZCode 风格: "2分46秒")
 * 自动更新，显示已工作时长
 * 修复: 使用全局 startTime 避免每次渲染重置计时器
 */
const TaskTimer: React.FC = () => {
  const [elapsed, setElapsed] = useState(0);
  
  useEffect(() => {
    // 使用模块级变量确保计时器在组件重新渲染时不会重置
    if (!TaskTimerStartTime) {
      TaskTimerStartTime = Date.now();
    }
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - TaskTimerStartTime!) / 1000));
    }, 1000);
    
    return () => clearInterval(timer);
  }, []);

  // 格式化: "2分46秒"
  const formatTime = (seconds: number): string => {
    if (seconds < 60) return `${seconds}秒`;
    
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins < 60) return `${mins}分${secs.toString().padStart(2, '0')}秒`;
    
    const hours = Math.floor(mins / 60);
    const remainingMins = mins % 60;
    return `${hours}小时${remainingMins}分`;
  };

  return (
    <span style={{ 
      color: 'var(--accent)', 
      fontWeight: 500,
      fontFamily: 'monospace',
      fontSize: 10,
    }}>
      {formatTime(elapsed)}
    </span>
  );
};

// 模块级变量，用于跨渲染保持计时器起点
let TaskTimerStartTime: number | null = null;

/** 重置计时器（在任务完成时调用） */
export function resetTaskTimer() {
  TaskTimerStartTime = null;
}
