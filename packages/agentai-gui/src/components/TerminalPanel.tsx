/**
 * TerminalPanel — 终端运行显示面板
 * 类似 Reasonix 的任务面板，显示终端命令执行过程和结果
 * 
 * 核心功能:
 * 1. 实时显示命令执行输出
 * 2. 支持多任务并行显示
 * 3. 命令执行历史记录
 * 4. 一键复制输出结果
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  Terminal, 
  X, 
  Copy, 
  Trash2, 
  ChevronDown, 
  ChevronUp,
  Play,
  Square,
  Clock
} from 'lucide-react';
import { Button, Badge, Space, Typography, Tooltip } from 'antd';

const { Text } = Typography;

export interface TerminalTask {
  id: string;
  command: string;
  status: 'running' | 'completed' | 'error';
  output: string[];
  startTime: Date;
  endTime?: Date;
  exitCode?: number;
}

interface TerminalPanelProps {
  visible: boolean;
  onClose: () => void;
  tasks?: TerminalTask[];
  onClearTasks?: () => void;
}

export const TerminalPanel: React.FC<TerminalPanelProps> = ({ 
  visible, 
  onClose, 
  tasks = [],
  onClearTasks 
}) => {
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const scrollRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // 自动展开正在运行的任务
  useEffect(() => {
    tasks.forEach(task => {
      if (task.status === 'running' && !expandedTasks.has(task.id)) {
        setExpandedTasks(prev => new Set([...prev, task.id]));
        setActiveTaskId(task.id);
      }
    });
  }, [tasks]);

  // 自动滚动到底部
  useEffect(() => {
    tasks.forEach(task => {
      if (task.status === 'running' && scrollRefs.current.has(task.id)) {
        const el = scrollRefs.current.get(task.id);
        if (el) {
          el.scrollTop = el.scrollHeight;
        }
      }
    });
  }, [tasks]);

  const toggleTask = (taskId: string) => {
    setExpandedTasks(prev => {
      const next = new Set(prev);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  };

  const copyOutput = (task: TerminalTask) => {
    const text = task.output.join('\n');
    navigator.clipboard.writeText(text);
    // 可以添加 toast 提示
  };

  const formatDuration = (start: Date, end?: Date) => {
    const endTime = end || new Date();
    const diff = endTime.getTime() - start.getTime();
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  };

  if (!visible) return null;

  const runningCount = tasks.filter(t => t.status === 'running').length;

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.panel} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={styles.header}>
          <Space>
            <Terminal size={18} />
            <span style={styles.title}>终端任务</span>
            {runningCount > 0 && (
              <Badge count={runningCount} style={{ backgroundColor: '#52c41a' }} />
            )}
          </Space>
          <Space>
            {tasks.length > 0 && (
              <Tooltip title="清空所有任务">
                <Button
                  icon={<Trash2 size={14} />}
                  size="small"
                  type="text"
                  onClick={onClearTasks}
                />
              </Tooltip>
            )}
            <Button
              icon={<X size={14} />}
              size="small"
              type="text"
              onClick={onClose}
            />
          </Space>
        </div>

        {/* Task List */}
        <div style={styles.taskList}>
          {tasks.length === 0 ? (
            <div style={styles.empty}>
              <Terminal size={48} style={{ opacity: 0.3 }} />
              <Text type="secondary">暂无运行中的任务</Text>
            </div>
          ) : (
            tasks.map(task => (
              <div 
                key={task.id} 
                style={{
                  ...styles.task,
                  borderColor: task.status === 'running' ? '#52c41a' : 
                               task.status === 'error' ? '#ff4d4f' : '#d9d9d9'
                }}
              >
                {/* Task Header */}
                <div 
                  style={styles.taskHeader}
                  onClick={() => toggleTask(task.id)}
                >
                  <Space>
                    {task.status === 'running' ? (
                      <Play size={14} style={{ color: '#52c41a' }} />
                    ) : task.status === 'error' ? (
                      <Square size={14} style={{ color: '#ff4d4f' }} />
                    ) : (
                      <div style={{ ...styles.statusDot, background: '#52c41a' }} />
                    )}
                    <Text strong style={{ fontFamily: 'monospace' }}>
                      {task.command}
                    </Text>
                  </Space>
                  <Space>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      <Clock size={12} style={{ marginRight: 4 }} />
                      {formatDuration(task.startTime, task.endTime)}
                    </Text>
                    {expandedTasks.has(task.id) ? (
                      <ChevronUp size={16} />
                    ) : (
                      <ChevronDown size={16} />
                    )}
                  </Space>
                </div>

                {/* Task Output */}
                {expandedTasks.has(task.id) && (
                  <div style={styles.taskContent}>
                    <div 
                      ref={el => {
                        if (el) scrollRefs.current.set(task.id, el);
                      }}
                      style={styles.output}
                    >
                      {task.output.length === 0 ? (
                        <Text type="secondary" style={{ fontStyle: 'italic' }}>
                          等待输出...
                        </Text>
                      ) : (
                        task.output.map((line, i) => (
                          <div key={i} style={styles.outputLine}>
                            <span style={styles.lineNumber}>{i + 1}</span>
                            <span style={styles.lineContent}>{line}</span>
                          </div>
                        ))
                      )}
                    </div>
                    <div style={styles.taskActions}>
                      <Button
                        icon={<Copy size={14} />}
                        size="small"
                        onClick={() => copyOutput(task)}
                      >
                        复制输出
                      </Button>
                      {task.status !== 'running' && task.exitCode !== undefined && (
                        <Text type={task.exitCode === 0 ? 'success' : 'danger'} style={{ fontSize: 12 }}>
                          退出码: {task.exitCode}
                        </Text>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

// 全局任务管理器
class TerminalTaskManager {
  private tasks: TerminalTask[] = [];
  private listeners: Set<(tasks: TerminalTask[]) => void> = new Set();
  private static instance: TerminalTaskManager;

  static getInstance(): TerminalTaskManager {
    if (!TerminalTaskManager.instance) {
      TerminalTaskManager.instance = new TerminalTaskManager();
    }
    return TerminalTaskManager.instance;
  }

  addTask(command: string): TerminalTask {
    const task: TerminalTask = {
      id: Math.random().toString(36).substr(2, 9),
      command,
      status: 'running',
      output: [],
      startTime: new Date(),
    };
    this.tasks = [task, ...this.tasks];
    this.notify();
    return task;
  }

  updateTask(id: string, updates: Partial<TerminalTask>) {
    this.tasks = this.tasks.map(t => 
      t.id === id ? { ...t, ...updates } : t
    );
    this.notify();
  }

  appendOutput(id: string, line: string) {
    this.tasks = this.tasks.map(t => 
      t.id === id ? { ...t, output: [...t.output, line] } : t
    );
    this.notify();
  }

  completeTask(id: string, exitCode: number) {
    this.tasks = this.tasks.map(t => 
      t.id === id ? { 
        ...t, 
        status: exitCode === 0 ? 'completed' : 'error',
        exitCode,
        endTime: new Date()
      } : t
    );
    this.notify();
  }

  clearTasks() {
    this.tasks = [];
    this.notify();
  }

  getTasks(): TerminalTask[] {
    return [...this.tasks];
  }

  onChange(listener: (tasks: TerminalTask[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    this.listeners.forEach(l => l([...this.tasks]));
  }
}

export const terminalTaskManager = TerminalTaskManager.getInstance();

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0,0,0,0.5)',
    zIndex: 1000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  panel: {
    width: 720,
    maxHeight: '80vh',
    background: 'var(--panel, #1e1e1e)',
    borderRadius: 8,
    boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    padding: '12px 16px',
    borderBottom: '1px solid var(--border, #333)',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontSize: 14,
    fontWeight: 600,
  },
  taskList: {
    flex: 1,
    overflow: 'auto',
    padding: 12,
  },
  empty: {
    padding: 60,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 16,
  },
  task: {
    marginBottom: 8,
    border: '1px solid',
    borderRadius: 6,
    overflow: 'hidden',
  },
  taskHeader: {
    padding: '10px 12px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    cursor: 'pointer',
    background: 'var(--bg, #252525)',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
  },
  taskContent: {
    borderTop: '1px solid var(--border, #333)',
  },
  output: {
    maxHeight: 300,
    overflow: 'auto',
    padding: 12,
    background: '#0d0d0d',
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 1.6,
  },
  outputLine: {
    display: 'flex',
    gap: 12,
  },
  lineNumber: {
    color: '#666',
    minWidth: 30,
    textAlign: 'right',
    userSelect: 'none',
  },
  lineContent: {
    color: '#e0e0e0',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
  },
  taskActions: {
    padding: '8px 12px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTop: '1px solid var(--border, #333)',
    background: 'var(--bg, #252525)',
  },
};

export default TerminalPanel;
