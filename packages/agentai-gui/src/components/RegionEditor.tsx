/**
 * RegionEditor — 区域标注编辑器
 * ====================================================================
 * 功能:
 * 1. 框选 (rect) — 矩形区域
 * 2. 套索 (lasso) — 自由曲线区域
 * 3. 涂抹 (brush) — 画笔涂抹区域
 * 4. 每个区域分配不同颜色 + 对应提示词输入
 * 5. 完成后自动整合为结构化提示词发送到主提示词框
 *
 * 交互流程:
 * 用户在图上画区域 → 下方填入"这个区域改成什么" → 点击整合
 * → 系统自动优化提示词 → 填入主提示词框
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Button, Input, Space, Tag, Tooltip, message } from 'antd';
import {
  BorderOutlined, HighlightOutlined, EditOutlined, DeleteOutlined,
  CheckOutlined, ThunderboltOutlined, ReloadOutlined, PictureOutlined,
} from '@ant-design/icons';

const { TextArea } = Input;

export type ToolType = 'rect' | 'lasso' | 'brush';

export interface Region {
  id: string;
  tool: ToolType;
  color: string;
  // rect: {x, y, w, h}; lasso/brush: points[]
  points: { x: number; y: number }[];
  prompt: string; // 用户输入: "这个区域改成什么"
  refImages?: string[]; // 该区域的参考图 (data URI)
}

export interface RegionEditorProps {
  imageUrl: string;
  onApply: (combinedPrompt: string, refImages?: string[], annotatedImage?: string, maskImage?: string) => void;
  onClose: () => void;
}

const COLORS = [
  '#FFD700', '#FF6B6B', '#4ECDC4', '#95E1D3',
  '#A8E6CF', '#FFAAA5', '#C9B1FF', '#FFB7C5',
];

// 颜色名称映射 — 用于 prompt 中告诉 AI 每个区域对应什么颜色
const REGION_COLORS = [
  { color: '#FFD700', name: '金色/Gold' },
  { color: '#FF6B6B', name: '红色/Red' },
  { color: '#4ECDC4', name: '青色/Cyan' },
  { color: '#95E1D3', name: '薄荷绿/Mint' },
  { color: '#A8E6CF', name: '浅绿/Light Green' },
  { color: '#FFAAA5', name: '粉色/Pink' },
  { color: '#C9B1FF', name: '紫色/Purple' },
  { color: '#FFB7C5', name: '樱花粉/Cherry' },
];

const TOOL_LABELS: Record<ToolType, string> = {
  rect: '框选',
  lasso: '套索',
  brush: '涂抹',
};

const TOOL_ICONS: Record<ToolType, React.ReactNode> = {
  rect: <BorderOutlined />,
  lasso: <EditOutlined />,
  brush: <HighlightOutlined />,
};

export const RegionEditor: React.FC<RegionEditorProps> = ({ imageUrl, onApply, onClose }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [imgEl, setImgEl] = useState<HTMLImageElement | null>(null);
  const [tool, setTool] = useState<ToolType>('rect');
  const [regions, setRegions] = useState<Region[]>([]);
  const [currentRegion, setCurrentRegion] = useState<Region | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 });
  const [canvasScale, setCanvasScale] = useState(1);
  const [optimizing, setOptimizing] = useState(false);
  const colorIdx = useRef(0);

  // 图片加载后初始化 canvas
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      setImgEl(img);
      const container = containerRef.current;
      if (!container) return;
      const maxW = container.clientWidth;
      const maxH = container.clientHeight - 60;
      const scale = Math.min(maxW / img.width, maxH / img.height, 1);
      const w = img.width * scale;
      const h = img.height * scale;
      setImgSize({ w: img.width, h: img.height });
      setCanvasScale(scale);
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.width = img.width;
        canvas.height = img.height;
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
        redraw();
      }
    };
    img.src = imageUrl;
  }, [imageUrl]);

  // 重绘 canvas
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgEl;
    if (!canvas || !img) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    // 画所有区域
    for (const region of regions) {
      drawRegion(ctx, region);
    }
    // 画当前正在画的区域
    if (currentRegion) {
      drawRegion(ctx, currentRegion);
    }
  }, [regions, currentRegion, imgEl]);

  useEffect(() => { redraw(); }, [redraw]);

  const drawRegion = (ctx: CanvasRenderingContext2D, region: Region) => {
    ctx.save();
    ctx.fillStyle = region.color + '40'; // 25% 透明度
    ctx.strokeStyle = region.color;
    ctx.lineWidth = 3;
    if (region.tool === 'rect' && region.points.length >= 2) {
      const p0 = region.points[0];
      const p1 = region.points[region.points.length - 1];
      ctx.fillRect(p0.x, p0.y, p1.x - p0.x, p1.y - p0.y);
      ctx.strokeRect(p0.x, p0.y, p1.x - p0.x, p1.y - p0.y);
    } else if (region.points.length > 1) {
      ctx.beginPath();
      ctx.moveTo(region.points[0].x, region.points[0].y);
      for (let i = 1; i < region.points.length; i++) {
        ctx.lineTo(region.points[i].x, region.points[i].y);
      }
      if (region.tool === 'lasso') ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    // 标注序号
    if (region.points.length > 0) {
      const center = region.points.reduce(
        (acc, p) => ({ x: acc.x + p.x / region.points.length, y: acc.y + p.y / region.points.length }),
        { x: 0, y: 0 },
      );
      ctx.fillStyle = region.color;
      ctx.beginPath();
      ctx.arc(center.x, center.y, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#000';
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const idx = regions.findIndex(r => r.id === region.id);
      ctx.fillText(String(idx + 1), center.x, center.y);
    }
    ctx.restore();
  };

  // 鼠标坐标转 canvas 坐标
  const getCanvasPos = (e: React.MouseEvent): { x: number; y: number } => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / canvasScale;
    const y = (e.clientY - rect.top) / canvasScale;
    return { x, y };
  };

  const onMouseDown = (e: React.MouseEvent) => {
    const pos = getCanvasPos(e);
    const color = COLORS[colorIdx.current % COLORS.length];
    colorIdx.current++;
    const region: Region = {
      id: `r-${Date.now()}`,
      tool,
      color,
      points: [pos],
      prompt: '',
    };
    setCurrentRegion(region);
    setIsDrawing(true);
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!isDrawing || !currentRegion) return;
    const pos = getCanvasPos(e);
    if (tool === 'rect') {
      // 矩形: 只保留起点和当前点
      setCurrentRegion({ ...currentRegion, points: [currentRegion.points[0], pos] });
    } else if (tool === 'brush') {
      // 画笔: 每隔一定距离记录点
      const last = currentRegion.points[currentRegion.points.length - 1];
      const dist = Math.hypot(pos.x - last.x, pos.y - last.y);
      if (dist > 5) {
        setCurrentRegion({ ...currentRegion, points: [...currentRegion.points, pos] });
      }
    } else {
      // 套索: 记录所有点
      setCurrentRegion({ ...currentRegion, points: [...currentRegion.points, pos] });
    }
  };

  const onMouseUp = () => {
    if (!isDrawing || !currentRegion) return;
    setIsDrawing(false);
    if (currentRegion.points.length > 1) {
      setRegions(prev => [...prev, currentRegion]);
    }
    setCurrentRegion(null);
  };

  // 删除区域
  const removeRegion = (id: string) => {
    setRegions(prev => prev.filter(r => r.id !== id));
  };

  // 更新区域提示词
  const updateRegionPrompt = (id: string, prompt: string) => {
    setRegions(prev => prev.map(r => r.id === id ? { ...r, prompt } : r));
  };

  // 添加区域参考图
  const addRegionRefImage = (id: string, img: string) => {
    setRegions(prev => prev.map(r => r.id === id ? { ...r, refImages: [...(r.refImages || []), img] } : r));
  };

  // 删除区域参考图
  const removeRegionRefImage = (id: string, idx: number) => {
    setRegions(prev => prev.map(r => r.id === id ? { ...r, refImages: (r.refImages || []).filter((_, i) => i !== idx) } : r));
  };

  // 读取图片文件为 data URI
  const readImageFile = (file: File, callback: (dataUri: string) => void) => {
    if (file.size > 6 * 1024 * 1024) { message.error('图片超过 6MB'); return; }
    const reader = new FileReader();
    reader.onload = () => callback(reader.result as string);
    reader.readAsDataURL(file);
  };

  // 清空所有区域
  const clearAll = () => {
    setRegions([]);
    colorIdx.current = 0;
  };

  // 整合提示词 — 发送到主提示词框
  const applyRegions = async () => {
    if (regions.length === 0) {
      message.warning('请先在图片上画至少一个区域');
      return;
    }
    const emptyPrompt = regions.filter(r => !r.prompt.trim());
    if (emptyPrompt.length > 0) {
      message.warning(`还有 ${emptyPrompt.length} 个区域未填写修改描述`);
      return;
    }

    setOptimizing(true);
    try {
      // 1. 导出带标注的图片 (原图+框选印记+编号, 这是给 AI 看的主图)
      const canvas = canvasRef.current;
      let annotatedImage: string | undefined;
      let maskImage: string | undefined;
      if (canvas) {
        try {
          annotatedImage = canvas.toDataURL('image/jpeg', 0.92);
        } catch {
          annotatedImage = undefined; // CORS
        }
        // 2. 生成彩色 mask 图 — 每个区域用不同颜色, AI 通过颜色区分区域
        try {
          const maskCanvas = document.createElement('canvas');
          maskCanvas.width = canvas.width;
          maskCanvas.height = canvas.height;
          const maskCtx = maskCanvas.getContext('2d');
          if (maskCtx) {
            maskCtx.fillStyle = '#000000';
            maskCtx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
            for (const region of regions) {
              maskCtx.fillStyle = region.color;
              maskCtx.beginPath();
              if (region.tool === 'rect' && region.points.length >= 2) {
                const p0 = region.points[0];
                const p1 = region.points[region.points.length - 1];
                maskCtx.fillRect(p0.x, p0.y, p1.x - p0.x, p1.y - p0.y);
              } else if (region.points.length > 1) {
                maskCtx.moveTo(region.points[0].x, region.points[0].y);
                for (let i = 1; i < region.points.length; i++) {
                  maskCtx.lineTo(region.points[i].x, region.points[i].y);
                }
                if (region.tool === 'lasso') maskCtx.closePath();
                maskCtx.fill();
              }
            }
            maskImage = maskCanvas.toDataURL('image/png');
          }
        } catch {
          maskImage = undefined;
        }
      }
      // 3. 构建 prompt — 用带编号的标注图 + 彩色蒙版图, 明确对应关系
      const parts = regions.map((r, i) => {
        const label = TOOL_LABELS[r.tool];
        const colorName = REGION_COLORS[i % REGION_COLORS.length].name;
        const refNote = (r.refImages && r.refImages.length > 0) ? ` (参考第${i + 1}张附图)` : '';
        return `Region ${i + 1} (${colorName} ${label}${refNote}): ${r.prompt}`;
      });
      const combined = `Edit the image with the following regional modifications:\n${parts.join('\n')}\n\nThe first image is the original with numbered annotations. The second image is a color mask: each colored area corresponds to the region number above. Only modify the masked regions, keep everything else exactly the same.\n\n区域的颜色对应:\n${regions.map((r, i) => `Region ${i + 1}: ${REGION_COLORS[i % REGION_COLORS.length].name}`).join('\n')}`;
      // 收集所有区域的参考图
      const allRefImages = regions.flatMap(r => r.refImages || []);
      onApply(combined, allRefImages.length > 0 ? allRefImages : undefined, annotatedImage, maskImage);
      message.success('已整合到主提示词框');
      onClose();
    } catch (e: any) {
      message.error('整合失败: ' + e.message);
    } finally {
      setOptimizing(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 8 }}>
      {/* 工具栏 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <Space>
          {(Object.keys(TOOL_LABELS) as ToolType[]).map(t => (
            <Tooltip key={t} title={TOOL_LABELS[t]}>
              <Button
                size="small"
                type={tool === t ? 'primary' : 'default'}
                icon={TOOL_ICONS[t]}
                onClick={() => setTool(t)}
              >
                {TOOL_LABELS[t]}
              </Button>
            </Tooltip>
          ))}
        </Space>
        <div style={{ flex: 1 }} />
        <Space>
          <Button size="small" icon={<ReloadOutlined />} onClick={clearAll} disabled={regions.length === 0}>
            清空
          </Button>
          <Button size="small" type="primary" icon={<ThunderboltOutlined />} loading={optimizing} onClick={applyRegions}>
            整合发送
          </Button>
          <Button size="small" onClick={onClose}>取消</Button>
        </Space>
      </div>

      <div style={{ display: 'flex', gap: 8, flex: 1, minHeight: 0 }}>
        {/* 左侧: 图片画布 */}
        <div ref={containerRef} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--panel)', borderRadius: 'var(--radius-md)', overflow: 'hidden', position: 'relative' }}>
          <canvas
            ref={canvasRef}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}
            style={{ cursor: 'crosshair', display: 'block' }}
          />
          {regions.length === 0 && !isDrawing && (
            <div style={{ position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)', color: 'var(--muted)', fontSize: 'var(--fs-sm)', background: 'rgba(0,0,0,0.5)', padding: '4px 12px', borderRadius: 'var(--radius-md)', whiteSpace: 'nowrap' }}>
              在图片上拖拽画区域 → 下方填写修改描述 → 点击整合发送
            </div>
          )}
        </div>

        {/* 右侧: 区域提示词列表 */}
        <div style={{ width: 320, display: 'flex', flexDirection: 'column', gap: 6, overflow: 'auto', flexShrink: 0 }}>
          <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)', fontWeight: 600, marginBottom: 4 }}>
            已标注区域 ({regions.length})
          </div>
          {regions.length === 0 && (
            <div style={{ color: 'var(--muted-2)', fontSize: 'var(--fs-sm)', textAlign: 'center', marginTop: 40 }}>
              画一个区域试试
            </div>
          )}
          {regions.map((region, i) => (
            <div key={region.id} style={{ padding: 8, borderRadius: 'var(--radius-md)', background: 'var(--panel)', border: `2px solid ${region.color}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <div style={{ width: 20, height: 20, borderRadius: '50%', background: region.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 'var(--fs-micro)', fontWeight: 700, color: '#000' }}>
                  {i + 1}
                </div>
                <Tag style={{ margin: 0, fontSize: 'var(--fs-micro)' }}>{TOOL_LABELS[region.tool]}</Tag>
                <div style={{ flex: 1 }} />
                <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => removeRegion(region.id)} />
              </div>
              <TextArea
                value={region.prompt}
                onChange={e => updateRegionPrompt(region.id, e.target.value)}
                placeholder="这个区域改成什么..."
                autoSize={{ minRows: 2, maxRows: 4 }}
                style={{ fontSize: 'var(--fs-sm)', marginBottom: 6 }}
              />
              {/* 参考图缩略图 */}
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                {(region.refImages || []).map((img, idx) => (
                  <div key={idx} style={{ position: 'relative', width: 44, height: 44 }}>
                    <img src={img} alt={`ref-${idx}`} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }} />
                    <button onClick={() => removeRegionRefImage(region.id, idx)}
                      style={{ position: 'absolute', top: -3, right: -3, width: 14, height: 14, borderRadius: '50%', background: 'var(--danger)', color: 'var(--fg-on-accent)', border: 'none', cursor: 'pointer', fontSize: 'var(--fs-micro)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
                  </div>
                ))}
                {(region.refImages || []).length < 2 && (
                  <label style={{ width: 44, height: 44, borderRadius: 'var(--radius-sm)', border: '1px dashed var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--muted)', fontSize: 'var(--fs-lg)' }}
                    title="上传参考图">
                    <PictureOutlined />
                    <input type="file" accept="image/*" style={{ display: 'none' }}
                      onChange={e => { if (e.target.files?.[0]) { readImageFile(e.target.files[0], img => addRegionRefImage(region.id, img)); e.target.value = ''; } }} />
                  </label>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
