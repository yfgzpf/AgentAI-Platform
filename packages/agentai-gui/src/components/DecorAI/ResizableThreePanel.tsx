/**
 * ResizableThreePanel — 三屏可拖拽调整布局
 * 
 * 左: 参考素材区 (上传/拖拽/历史)
 * 中: 主画布区 (所有AI生成物)
 * 右: AI对话区 (自然语言控制)
 * 
 * 支持: 拖拽调整面板宽度、最小宽度限制、双击重置
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Button, Tooltip, Badge } from 'antd';
import { 
  DragOutlined, ExpandOutlined, CompressOutlined,
  PictureOutlined, MessageOutlined, AppstoreOutlined,
} from '@ant-design/icons';

interface ResizableThreePanelProps {
  leftPanel: React.ReactNode;
  centerPanel: React.ReactNode;
  rightPanel: React.ReactNode;
  leftTitle?: string;
  centerTitle?: string;
  rightTitle?: string;
}

const MIN_WIDTH = 200; // 最小宽度
const DEFAULT_LEFT = 280;
const DEFAULT_RIGHT = 380;

export const ResizableThreePanel: React.FC<ResizableThreePanelProps> = ({
  leftPanel,
  centerPanel,
  rightPanel,
  leftTitle = '参考素材',
  centerTitle = '画布',
  rightTitle = 'AI 助手',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [leftWidth, setLeftWidth] = useState(DEFAULT_LEFT);
  const [rightWidth, setRightWidth] = useState(DEFAULT_RIGHT);
  const [isResizing, setIsResizing] = useState<'left' | 'right' | null>(null);

  // 开始拖拽
  const startResize = useCallback((side: 'left' | 'right', e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(side);
    document.body.style.cursor = side === 'left' ? 'col-resize' : 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  // 处理拖拽
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing || !containerRef.current) return;

      const containerRect = containerRef.current.getBoundingClientRect();
      const containerWidth = containerRect.width;

      if (isResizing === 'left') {
        const newLeft = Math.max(MIN_WIDTH, Math.min(e.clientX - containerRect.left, containerWidth - rightWidth - MIN_WIDTH));
        setLeftWidth(newLeft);
      } else if (isResizing === 'right') {
        const newRight = Math.max(MIN_WIDTH, Math.min(containerRect.right - e.clientX, containerWidth - leftWidth - MIN_WIDTH));
        setRightWidth(newRight);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(null);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, leftWidth, rightWidth]);

  // 重置布局
  const resetLayout = () => {
    setLeftWidth(DEFAULT_LEFT);
    setRightWidth(DEFAULT_RIGHT);
  };

  // 最大化中间
  const maximizeCenter = () => {
    setLeftWidth(MIN_WIDTH);
    setRightWidth(MIN_WIDTH);
  };

  return (
    <div 
      ref={containerRef}
      style={{
        display: 'flex',
        height: '100%',
        width: '100%',
        overflow: 'hidden',
        background: 'var(--bg)',
      }}
    >
      {/* 左侧面板 */}
      <div
        style={{
          width: leftWidth,
          minWidth: MIN_WIDTH,
          maxWidth: '40%',
          display: 'flex',
          flexDirection: 'column',
          borderRight: '1px solid var(--border)',
          background: 'var(--panel)',
        }}
      >
        {/* 标题栏 */}
        <div style={{
          height: 40,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 12px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--card)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <PictureOutlined style={{ color: 'var(--accent)' }} />
            <span style={{ fontSize: 13, fontWeight: 500 }}>{leftTitle}</span>
          </div>
          <Badge count={0} size="small" />
        </div>
        {/* 内容区 */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          {leftPanel}
        </div>
      </div>

      {/* 左侧拖拽条 */}
      <div
        onMouseDown={(e) => startResize('left', e)}
        style={{
          width: 6,
          cursor: 'col-resize',
          background: isResizing === 'left' ? 'var(--accent)' : 'transparent',
          transition: 'background 0.2s',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        title="拖拽调整宽度"
      >
        <div style={{
          width: 2,
          height: 24,
          background: isResizing === 'left' ? '#fff' : 'var(--border)',
          borderRadius: 1,
        }} />
      </div>

      {/* 中间面板 */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minWidth: MIN_WIDTH,
          background: 'var(--bg)',
        }}
      >
        {/* 标题栏 */}
        <div style={{
          height: 40,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 12px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--card)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AppstoreOutlined style={{ color: 'var(--accent)' }} />
            <span style={{ fontSize: 13, fontWeight: 500 }}>{centerTitle}</span>
          </div>
          <Space>
            <Tooltip title="最大化画布">
              <Button 
                size="small" 
                type="text" 
                icon={<ExpandOutlined />}
                onClick={maximizeCenter}
              />
            </Tooltip>
            <Tooltip title="重置布局">
              <Button 
                size="small" 
                type="text" 
                icon={<CompressOutlined />}
                onClick={resetLayout}
              />
            </Tooltip>
          </Space>
        </div>
        {/* 内容区 */}
        <div style={{ flex: 1, overflow: 'auto', position: 'relative' }}>
          {centerPanel}
        </div>
      </div>

      {/* 右侧拖拽条 */}
      <div
        onMouseDown={(e) => startResize('right', e)}
        style={{
          width: 6,
          cursor: 'col-resize',
          background: isResizing === 'right' ? 'var(--accent)' : 'transparent',
          transition: 'background 0.2s',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        title="拖拽调整宽度"
      >
        <div style={{
          width: 2,
          height: 24,
          background: isResizing === 'right' ? '#fff' : 'var(--border)',
          borderRadius: 1,
        }} />
      </div>

      {/* 右侧面板 */}
      <div
        style={{
          width: rightWidth,
          minWidth: MIN_WIDTH,
          maxWidth: '50%',
          display: 'flex',
          flexDirection: 'column',
          borderLeft: '1px solid var(--border)',
          background: 'var(--panel)',
        }}
      >
        {/* 标题栏 */}
        <div style={{
          height: 40,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 12px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--card)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <MessageOutlined style={{ color: 'var(--accent)' }} />
            <span style={{ fontSize: 13, fontWeight: 500 }}>{rightTitle}</span>
          </div>
          <Badge status="processing" text="在线" />
        </div>
        {/* 内容区 */}
        <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
          {rightPanel}
        </div>
      </div>
    </div>
  );
};

// Space组件本地定义
const Space: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div style={{ display: 'flex', gap: 4, ...style }}>{children}</div>
);

export default ResizableThreePanel;
