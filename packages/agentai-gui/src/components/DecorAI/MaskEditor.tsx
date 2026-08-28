/**
 * MaskEditor — 遮罩式精准改图工具
 *
 * 功能:
 *   - 画笔涂抹遮罩 (可调大小)
 *   - 矩形选框遮罩
 *   - 橡皮擦擦除
 *   - 撤销/重做
 *   - 清除全部
 *   - 遮罩预览 (半透明红色)
 *
 * 输出: maskDataUrl (base64 PNG) + bounds (边界框)
 */

import React, { useRef, useState, useCallback, useEffect } from 'react';
import { Button, Space, Tooltip, Slider, Tag, Divider } from 'antd';
import {
  BorderOutlined,
  UndoOutlined, RedoOutlined, ClearOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons';

interface MaskEditorProps {
  /** 原始图片 URL */
  imageUrl: string;
  /** 当前缩放比例 */
  scale?: number;
  /** 遮罩完成回调 */
  onMaskComplete: (maskDataUrl: string, bounds: { x: number; y: number; w: number; h: number }) => void;
  /** 取消回调 */
  onCancel?: () => void;
}

type Tool = 'brush' | 'rect' | 'eraser' | 'none';

const MASK_COLOR = 'rgba(239, 68, 68, 0.45)'; // 半透明红色

export function MaskEditor({ imageUrl, scale = 1, onMaskComplete, onCancel }: MaskEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  const [tool, setTool] = useState<Tool>('brush');
  const [brushSize, setBrushSize] = useState(30);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasMask, setHasMask] = useState(false);

  // 历史记录用于撤销/重做
  const [history, setHistory] = useState<ImageData[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);

  // 矩形选框状态
  const rectStartRef = useRef<{ x: number; y: number } | null>(null);

  // 获取 canvas context
  const getCtx = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    return canvas.getContext('2d');
  }, []);

  // 保存当前状态到历史
  const saveToHistory = useCallback(() => {
    const ctx = getCtx();
    const canvas = canvasRef.current;
    if (!ctx || !canvas) return;
    
    const snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const newHistory = [...history.slice(0, historyIdx + 1), snapshot];
    setHistory(newHistory);
    setHistoryIdx(newHistory.length - 1);
  }, [getCtx, history, historyIdx]);

  // 初始化 canvas 尺寸匹配图片
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      
      // 设置 canvas 实际像素尺寸 (基于显示尺寸 * scale)
      const displayWidth = containerRef.current?.clientWidth || 600;
      const displayHeight = (displayWidth / img.naturalWidth) * img.naturalHeight;
      
      canvas.width = Math.max(512, Math.round(displayWidth * window.devicePixelRatio));
      canvas.height = Math.max(384, Math.round(displayHeight * window.devicePixelRatio));
      
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // 绘制原图
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      
      // 初始化历史
      setHistory([ctx.getImageData(0, 0, canvas.width, canvas.height)]);
      setHistoryIdx(0);
    };
    img.src = imageUrl;
  }, [imageUrl]);

  // ===== 绘制事件处理 =====

  const getCanvasPoint = useCallback((e: React.MouseEvent): { x: number; y: number } => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height),
    };
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (tool === 'none') return;
    
    const ctx = getCtx();
    if (!ctx) return;

    if (tool === 'brush' || tool === 'eraser') {
      setIsDrawing(true);
      saveToHistory();
      
      const pt = getCanvasPoint(e);
      ctx.beginPath();
      ctx.moveTo(pt.x, pt.y);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = brushSize * (canvasRef.current!.width / containerRef.current!.clientWidth);
      ctx.strokeStyle = tool === 'eraser' ? 'destination-out' : MASK_COLOR;
      ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
    }
    
    else if (tool === 'rect') {
      setIsDrawing(true);
      saveToHistory();
      rectStartRef.current = getCanvasPoint(e);
    }
  }, [tool, brushSize, getCanvasPoint, getCtx, saveToHistory]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDrawing || tool === 'none') return;
    
    const ctx = getCtx();
    if (!ctx) return;
    const pt = getCanvasPoint(e);

    if (tool === 'brush' || tool === 'eraser') {
      ctx.lineTo(pt.x, pt.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(pt.x, pt.y);
    }
    
    else if (tool === 'rect' && rectStartRef.current) {
      // 矩形预览: 先恢复到历史状态，再画当前矩形
      if (history[historyIdx]) {
        ctx.putImageData(history[historyIdx], 0, 0);
      }
      const w = pt.x - rectStartRef.current.x;
      const h = pt.y - rectStartRef.current.y;
      ctx.fillStyle = MASK_COLOR;
      ctx.fillRect(rectStartRef.current.x, rectStartRef.current.y, w, h);
    }

    setHasMask(true);
  }, [isDrawing, tool, getCanvasPoint, getCtx, history, historyIdx]);

  const handleMouseUp = useCallback((_e: React.MouseEvent) => {
    if (!isDrawing) return;
    setIsDrawing(false);
    
    const ctx = getCtx();
    if (ctx) {
      ctx.closePath();
      // 重置 composite operation
      ctx.globalCompositeOperation = 'source-over';
    }
    
    rectStartRef.current = null;
  }, [isDrawing, getCtx]);

  // ===== 操作按钮 =====

  const handleUndo = () => {
    if (historyIdx > 0) {
      const newIdx = historyIdx - 1;
      setHistoryIdx(newIdx);
      const ctx = getCtx();
      if (ctx && history[newIdx]) {
        ctx.putImageData(history[newIdx], 0, 0);
      }
      setHasMask(true);
    }
  };

  const handleRedo = () => {
    if (historyIdx < history.length - 1) {
      const newIdx = historyIdx + 1;
      setHistoryIdx(newIdx);
      const ctx = getCtx();
      if (ctx && history[newIdx]) {
        ctx.putImageData(history[newIdx], 0, 0);
      }
      setHasMask(true);
    }
  };

  const handleClear = () => {
    const ctx = getCtx();
    const canvas = canvasRef.current;
    if (!ctx || !canvas || history.length === 0) return;
    
    // 恢复到初始状态（原图）
    ctx.putImageData(history[0], 0, 0);
    setHistory([history[0]]);
    setHistoryIdx(0);
    setHasMask(false);
  };

  const handleConfirm = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    try {
      // 导出遮罩层为 PNG
      const maskDataUrl = canvas.toDataURL('image/png');
      
      // 计算遮罩区域边界框 (简化版: 整个非透明区域)
      // 实际生产中可用更精确的算法
      const bounds = { x: 0, y: 0, w: canvas.width, h: canvas.height };
      
      onMaskComplete(maskDataUrl, bounds);
    } catch (err) {
      console.error('Failed to export mask:', err);
    }
  };

  return (
    <div style={{
      position: 'relative',
      background: 'var(--bg)',
      borderRadius: 8,
      overflow: 'hidden',
      border: '1px solid var(--border)',
    }}>
      {/* 工具栏 */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 12px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--panel)',
        flexWrap: 'wrap',
        gap: 8,
      }}>
        <Space size={4}>
          <Tooltip title="画笔涂抹">
            <Button
              size="small"
              type={tool === 'brush' ? 'primary' : 'default'}
              onClick={() => setTool('brush')}
            >
              🖌️ 画笔
            </Button>
          </Tooltip>
          <Tooltip title="矩形选框">
            <Button
              size="small"
              type={tool === 'rect' ? 'primary' : 'default'}
              icon={<BorderOutlined />}
              onClick={() => setTool('rect')}
            />
          </Tooltip>
          <Tooltip title="橡皮擦">
            <Button
              size="small"
              type={tool === 'eraser' ? 'primary' : 'default'}
              onClick={() => setTool('eraser')}
            >
              🧹 擦除
            </Button>
          </Tooltip>
          
          <Divider type="vertical" />
          
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>画笔:</span>
          <Slider
            min={5}
            max={80}
            value={brushSize}
            onChange={(v) => setBrushSize(v)}
            style={{ width: 80 }}
            tooltip={{ formatter: (v) => `${v}px` }}
          />
          <Tag style={{ fontSize: 10 }}>{brushSize}px</Tag>
        </Space>

        <Space size={4}>
          <Tooltip title="撤销 (Ctrl+Z)">
            <Button size="small" icon={<UndoOutlined />} onClick={handleUndo} disabled={historyIdx <= 0} />
          </Tooltip>
          <Tooltip title="重做 (Ctrl+Y)">
            <Button size="small" icon={<RedoOutlined />} onClick={handleRedo} disabled={historyIdx >= history.length - 1} />
          </Tooltip>
          <Tooltip title="清除遮罩">
            <Button size="small" danger icon={<ClearOutlined />} onClick={handleClear} disabled={!hasMask} />
          </Tooltip>
          
          <Divider type="vertical" />
          
          <Button
            size="small"
            type="primary"
            icon={<CheckCircleOutlined />}
            onClick={handleConfirm}
            disabled={!hasMask}
          >
            应用遮罩
          </Button>
          {onCancel && (
            <Button size="small" onClick={onCancel}>取消</Button>
          )}
        </Space>
      </div>

      {/* Canvas 区域 */}
      <div ref={containerRef} style={{ position: 'relative', cursor: tool === 'none' ? 'default' : 'crosshair' }}>
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={() => setIsDrawing(false)}
          style={{
            display: 'block',
            width: '100%',
            maxHeight: 450,
            objectFit: 'contain',
          }}
        />
        
        {/* 提示覆盖层 */}
        {!hasMask && (
          <div style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            pointerEvents: 'none',
            textAlign: 'center',
            color: 'var(--muted)',
            opacity: 0.6,
          }}>
            <div style={{ fontSize: 24, marginBottom: 4 }}>🖌️</div>
            <div style={{ fontSize: 12 }}>涂抹或框选要修改的区域</div>
          </div>
        )}
      </div>

      {/* 底部提示 */}
      <div style={{
        padding: '6px 12px',
        borderTop: '1px solid var(--border)',
        fontSize: 11,
        color: 'var(--muted-2)',
        display: 'flex',
        justifyContent: 'space-between',
      }}>
        <span>💡 提示: 用画笔涂抹需要修改的区域，然后点击"应用遮罩"</span>
        <span>{hasMask ? '✅ 已绘制遮罩' : '⬜ 等待绘制'}</span>
      </div>

      {/* 快捷键提示 */}
      <style>{`
        .mask-editor-canvas { touch-action: none; }
      `}</style>
    </div>
  );
}

export default MaskEditor;
