/**
 * SceneEditor — 分镜场景精编器
 * ====================================================================
 * 功能:
 * 1. 加载场景图作为背景层
 * 2. 加载角色定妆图, 可抠图(去背景)后作为角色层贴到场景中
 * 3. 拖拽/缩放/旋转角色图层
 * 4. Canvas 合成导出为精编场景图
 * 5. 回写到 StoryboardPanel 的 Episode.scene.imageUrl
 *
 * 交互:
 * - 左侧: 图层面板 (背景+角色层列表)
 * - 中间: Canvas 画布 (所见即所得, 可拖拽)
 * - 右侧: 属性面板 (选中图层的变换属性)
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Button, Input, Space, Tag, Tooltip, message, Spin, Slider, Switch, Upload } from 'antd';
import {
  ScissorOutlined, DownloadOutlined, PlusOutlined, DeleteOutlined,
  EyeOutlined, EyeInvisibleOutlined, CopyOutlined, ArrowUpOutlined, ArrowDownOutlined,
  PictureOutlined, ReloadOutlined, CloseOutlined, DragOutlined,
} from '@ant-design/icons';

// ════════════════════════════════════════════════════════════════════════
// 类型定义
// ════════════════════════════════════════════════════════════════════════

interface Layer {
  id: string;
  type: 'background' | 'character' | 'prop';
  name: string;
  imageUrl: string;         // 原始图片 URL
  cutoutUrl?: string;       // 抠图后的透明 PNG URL
  x: number;                // 画布上的 x 位置 (百分比 0-100)
  y: number;                // 画布上的 y 位置 (百分比 0-100)
  scale: number;            // 缩放 (1 = 原始大小)
  rotation: number;         // 旋转角度
  opacity: number;          // 透明度 0-1
  visible: boolean;
  characterName?: string;
}

export interface SceneEditorProps {
  httpUrl: string;
  sceneImage?: string;        // 场景图 URL
  characters: { name: string; portraitUrl?: string }[];
  onSave: (composedImageUrl: string) => void;
  onClose: () => void;
}

// ════════════════════════════════════════════════════════════════════════
// 主组件
// ════════════════════════════════════════════════════════════════════════

export const SceneEditor: React.FC<SceneEditorProps> = ({
  httpUrl, sceneImage, characters, onSave, onClose,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [layers, setLayers] = useState<Layer[]>([]);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 1280, height: 720 });
  const [removingBg, setRemovingBg] = useState<string | null>(null); // 正在抠图的 layerId
  const [dragging, setDragging] = useState(false);
  const dragStateRef = useRef<{ startX: number; startY: number; layerX: number; layerY: number } | null>(null);

  // 初始化: 场景图作为背景层
  useEffect(() => {
    const initLayers: Layer[] = [];
    if (sceneImage) {
      initLayers.push({
        id: 'bg',
        type: 'background',
        name: '背景 (场景图)',
        imageUrl: sceneImage,
        x: 50, y: 50, scale: 1, rotation: 0, opacity: 1, visible: true,
      });
    }
    // 角色层: 默认放在画布底部中央, 等用户抠图后再贴
    for (const char of characters) {
      if (char.portraitUrl) {
        initLayers.push({
          id: `char-${char.name}`,
          type: 'character',
          name: char.name,
          characterName: char.name,
          imageUrl: char.portraitUrl,
          x: 50, y: 70, scale: 0.4, rotation: 0, opacity: 1, visible: true,
        });
      }
    }
    setLayers(initLayers);
    if (initLayers.length > 0) setSelectedLayerId(initLayers[0].id);

    // 自动对角色层抠图 — 角色九宫格图是白底, 用前端 Canvas 去白底变透明
    // Agnes Image API edit 模式返回 RGB 不带 alpha 通道, 无法真正去背景
    // 所以前端用 Canvas getImageData 把接近白色的像素变透明
    setTimeout(() => {
      for (const layer of initLayers) {
        if (layer.type === 'character' && layer.imageUrl && !layer.cutoutUrl) {
          autoRemoveBg(layer.id, layer.imageUrl);
        }
      }
    }, 500);
  }, [sceneImage, characters]);

  // 加载图片到 Image 对象 (提前定义, autoRemoveBg 和 renderCanvas 都依赖)
  const loadImage = useCallback((url: string): Promise<HTMLImageElement> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  }, []);

  // 前端 Canvas 白底抠图 — 把白色/接近白色的像素变透明
  // 速度快(本地计算), 不消耗 API 额度, 且真正生成带 alpha 通道的 PNG
  const autoRemoveBg = async (layerId: string, imageUrl: string) => {
    setRemovingBg(layerId);
    try {
      const img = await loadImage(imageUrl);
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas 2D context 不可用');

      // 绘制原图
      ctx.drawImage(img, 0, 0);

      // 获取像素数据
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;

      // 白底抠图: 遍历每个像素, 接近白色(RGB 都 > 240)的变透明
      // 同时对边缘做半透明过渡, 避免锯齿
      const WHITE_THRESHOLD = 240; // 白色判定阈值
      const EDGE_THRESHOLD = 200;  // 边缘过渡阈值

      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];

        // 纯白/接近白 → 完全透明
        if (r > WHITE_THRESHOLD && g > WHITE_THRESHOLD && b > WHITE_THRESHOLD) {
          data[i + 3] = 0; // alpha = 0
        }
        // 浅色边缘 → 半透明过渡 (减少锯齿)
        else if (r > EDGE_THRESHOLD && g > EDGE_THRESHOLD && b > EDGE_THRESHOLD) {
          // 根据亮度计算 alpha, 越白越透明
          const brightness = (r + g + b) / 3;
          const alpha = Math.max(0, Math.min(255, (255 - brightness) * 255 / (255 - EDGE_THRESHOLD)));
          data[i + 3] = Math.round(alpha);
        }
      }

      // 写回像素数据
      ctx.putImageData(imageData, 0, 0);

      // 转 Data URL
      const cutoutUrl = canvas.toDataURL('image/png');

      // 更新图层
      setLayers(prev => prev.map(l => l.id === layerId ? { ...l, cutoutUrl } : l));
      console.log(`[SceneEditor] 白底抠图完成: ${layerId} (${canvas.width}x${canvas.height})`);
    } catch (e: any) {
      console.warn(`[SceneEditor] 白底抠图失败: ${layerId} — ${e.message}`);
      // 失败时尝试后端 API 作为降级方案
      try {
        const resp = await fetch(`${httpUrl}/v1/image/remove-bg`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: imageUrl }),
        });
        const data = await resp.json();
        if (data.url) {
          setLayers(prev => prev.map(l => l.id === layerId ? { ...l, cutoutUrl: data.url } : l));
          console.log(`[SceneEditor] 后端抠图降级完成: ${layerId}`);
        }
      } catch (e2: any) {
        console.warn(`[SceneEditor] 后端抠图也失败: ${layerId} — ${e2.message}`);
      }
    } finally {
      setRemovingBg(null);
    }
  };

  // 渲染 Canvas
  const renderCanvas = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = canvasSize.width;
    canvas.height = canvasSize.height;

    // 清空
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 按图层顺序绘制
    for (const layer of layers) {
      if (!layer.visible) continue;
      const imgUrl = layer.cutoutUrl || layer.imageUrl;
      if (!imgUrl) continue;

      try {
        const img = await loadImage(imgUrl);
        ctx.save();
        ctx.globalAlpha = layer.opacity;

        const cx = (layer.x / 100) * canvas.width;
        const cy = (layer.y / 100) * canvas.height;

        ctx.translate(cx, cy);
        ctx.rotate((layer.rotation * Math.PI) / 180);
        ctx.scale(layer.scale, layer.scale);

        // 背景层: 填满画布; 角色层: 以图片中心为锚点
        if (layer.type === 'background') {
          // 按 cover 方式缩放
          const scaleW = canvas.width / img.width;
          const scaleH = canvas.height / img.height;
          const coverScale = Math.max(scaleW, scaleH);
          ctx.drawImage(img, -canvas.width / (2 * coverScale), -canvas.height / (2 * coverScale), canvas.width / coverScale, canvas.height / coverScale);
        } else {
          // 以图片中心为锚点
          const w = img.width;
          const h = img.height;
          ctx.drawImage(img, -w / 2, -h / 2, w, h);
        }
        ctx.restore();
      } catch (e) {
        // 图片加载失败 — 跳过
      }
    }

    // 绘制选中边框
    if (selectedLayerId) {
      const layer = layers.find(l => l.id === selectedLayerId);
      if (layer && layer.visible && layer.type !== 'background') {
        const cx = (layer.x / 100) * canvas.width;
        const cy = (layer.y / 100) * canvas.height;
        ctx.strokeStyle = '#1890ff';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(cx - 40, cy - 40, 80, 80);
        ctx.setLineDash([]);
      }
    }
  }, [layers, canvasSize, selectedLayerId, loadImage]);

  // layers 变化时重绘
  useEffect(() => {
    renderCanvas();
  }, [renderCanvas]);

  // 抠图
  const removeBg = async (layerId: string) => {
    const layer = layers.find(l => l.id === layerId);
    if (!layer) return;
    setRemovingBg(layerId);
    try {
      const resp = await fetch(`${httpUrl}/v1/image/remove-bg`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: layer.imageUrl }),
      });
      const data = await resp.json();
      if (data.error) { message.error(`抠图失败: ${data.error}`); return; }
      if (!data.url) { message.error('抠图失败: 未返回图片'); return; }
      setLayers(prev => prev.map(l => l.id === layerId ? { ...l, cutoutUrl: data.url } : l));
      message.success(`✅ ${layer.name} 抠图完成`);
    } catch (e: any) { message.error('抠图失败: ' + e.message); }
    finally { setRemovingBg(null); }
  };

  // 添加自定义图层 (用户上传图片)
  const addImageLayer = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result as string;
      const newLayer: Layer = {
        id: `layer-${Date.now()}`,
        type: 'prop',
        name: file.name.slice(0, 20),
        imageUrl: url,
        x: 50, y: 50, scale: 0.3, rotation: 0, opacity: 1, visible: true,
      };
      setLayers(prev => [...prev, newLayer]);
      setSelectedLayerId(newLayer.id);
    };
    reader.readAsDataURL(file);
  };

  // 删除图层
  const deleteLayer = (id: string) => {
    if (id === 'bg') { message.warning('背景层不可删除'); return; }
    setLayers(prev => prev.filter(l => l.id !== id));
    if (selectedLayerId === id) setSelectedLayerId(null);
  };

  // 复制图层
  const duplicateLayer = (id: string) => {
    const layer = layers.find(l => l.id === id);
    if (!layer) return;
    const newLayer: Layer = {
      ...layer,
      id: `layer-${Date.now()}`,
      name: `${layer.name} 副本`,
      x: Math.min(layer.x + 10, 90),
    };
    setLayers(prev => [...prev, newLayer]);
    setSelectedLayerId(newLayer.id);
  };

  // 图层排序
  const moveLayer = (id: string, dir: 'up' | 'down') => {
    setLayers(prev => {
      const idx = prev.findIndex(l => l.id === id);
      if (idx < 0) return prev;
      const newIdx = dir === 'up' ? Math.min(idx + 1, prev.length - 1) : Math.max(idx - 1, 0);
      if (newIdx === idx) return prev;
      const next = [...prev];
      const [item] = next.splice(idx, 1);
      next.splice(newIdx, 0, item);
      return next;
    });
  };

  // 更新图层属性
  const updateLayer = (id: string, updates: Partial<Layer>) => {
    setLayers(prev => prev.map(l => l.id === id ? { ...l, ...updates } : l));
  };

  // 合成导出
  const compose = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    // 先取消选中, 重绘一次干净的画面
    const prevSelected = selectedLayerId;
    setSelectedLayerId(null);
    await new Promise(r => setTimeout(r, 100)); // 等 useEffect 重绘
    const dataUrl = canvas.toDataURL('image/png');
    setSelectedLayerId(prevSelected);
    return dataUrl;
  }, [selectedLayerId]);

  const handleSave = async () => {
    const dataUrl = await compose();
    if (!dataUrl) { message.error('合成失败'); return; }
    onSave(dataUrl);
    message.success('✅ 精编场景图已保存');
  };

  // Canvas 鼠标交互 — 拖拽角色层
  const onCanvasMouseDown = (e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = ((e.clientX - rect.left) / rect.width) * 100;
    const my = ((e.clientY - rect.top) / rect.height) * 100;

    // 从上到下查找命中的非背景图层
    for (let i = layers.length - 1; i >= 0; i--) {
      const layer = layers[i];
      if (!layer.visible || layer.type === 'background') continue;
      const dx = mx - layer.x;
      const dy = my - layer.y;
      // 粗略碰撞检测: 基于图层 scale 的范围 (扩大点击区域)
      const hitRange = 15 * layer.scale;
      if (Math.abs(dx) < hitRange && Math.abs(dy) < hitRange) {
        setSelectedLayerId(layer.id);
        setDragging(true);
        dragStateRef.current = { startX: mx, startY: my, layerX: layer.x, layerY: layer.y };
        return;
      }
    }
    // 没命中任何图层 — 取消选中
    setSelectedLayerId(null);
  };

  const onCanvasMouseMove = (e: React.MouseEvent) => {
    if (!dragging || !dragStateRef.current || !selectedLayerId) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = ((e.clientX - rect.left) / rect.width) * 100;
    const my = ((e.clientY - rect.top) / rect.height) * 100;
    const { startX, startY, layerX, layerY } = dragStateRef.current;
    const newX = Math.max(0, Math.min(100, layerX + (mx - startX)));
    const newY = Math.max(0, Math.min(100, layerY + (my - startY)));
    updateLayer(selectedLayerId, { x: newX, y: newY });
  };

  const onCanvasMouseUp = () => {
    setDragging(false);
    dragStateRef.current = null;
  };

  // 鼠标滚轮缩放 — 选中图层时滚动调整大小
  const onCanvasWheel = (e: React.WheelEvent) => {
    if (!selectedLayerId) return;
    const layer = layers.find(l => l.id === selectedLayerId);
    if (!layer || layer.type === 'background') return;
    e.preventDefault();
    // 滚轮向上放大, 向下缩小
    const delta = e.deltaY > 0 ? -0.05 : 0.05;
    const newScale = Math.max(0.05, Math.min(3, layer.scale + delta));
    updateLayer(selectedLayerId, { scale: newScale });
  };

  const selectedLayer = layers.find(l => l.id === selectedLayerId);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--bg)', zIndex: 1000, display: 'flex', flexDirection: 'column' }}>
      {/* 顶部工具栏 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px', borderBottom: '1px solid var(--border)', background: 'var(--panel)' }}>
        <strong style={{ fontSize: 'var(--fs-md)' }}>🎬 场景精编器</strong>
        <Tag color="blue">{layers.length} 图层</Tag>
        <div style={{ flex: 1 }} />
        <Upload showUploadList={false} beforeUpload={(file) => { addImageLayer(file); return false; }}>
          <Button size="small" icon={<PlusOutlined />}>添加图层</Button>
        </Upload>
        <Button size="small" type="primary" icon={<DownloadOutlined />} onClick={handleSave}>合成保存</Button>
        <Button size="small" type="text" danger icon={<CloseOutlined />} onClick={onClose}>退出</Button>
      </div>

      {/* 主体: 三栏布局 */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* 左侧: 图层面板 */}
        <div style={{ width: 240, borderRight: '1px solid var(--border)', overflow: 'auto', padding: 8, background: 'var(--panel)' }}>
          <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, marginBottom: 8, color: 'var(--muted)' }}>图层</div>
          {layers.slice().reverse().map((layer) => (
            <div key={layer.id}
              onClick={() => setSelectedLayerId(layer.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', marginBottom: 4,
                borderRadius: 'var(--radius-md)', cursor: 'pointer',
                background: selectedLayerId === layer.id ? 'var(--bg-active)' : 'var(--bg)',
                border: `1px solid ${selectedLayerId === layer.id ? '#1890ff' : 'transparent'}`,
              }}>
              {/* 缩略图 */}
              <div style={{ width: 32, height: 32, borderRadius: 'var(--radius-sm)', overflow: 'hidden', flexShrink: 0, background: '#000' }}>
                <img src={layer.cutoutUrl || layer.imageUrl} alt={layer.name}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </div>
              {/* 名称 */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 'var(--fs-micro)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {layer.name}
                </div>
                <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted-2)' }}>
                  {layer.type === 'background' ? '背景' : layer.type === 'character' ? '角色' : '道具'}
                  {layer.cutoutUrl && ' · 已抠图'}
                </div>
              </div>
              {/* 操作按钮 */}
              <Tooltip title={layer.visible ? '隐藏' : '显示'}>
                <Button size="small" type="text" icon={layer.visible ? <EyeOutlined /> : <EyeInvisibleOutlined />}
                  onClick={(e) => { e.stopPropagation(); updateLayer(layer.id, { visible: !layer.visible }); }} />
              </Tooltip>
            </div>
          ))}
          {/* 选中图层的操作 */}
          {selectedLayer && selectedLayer.type !== 'background' && (
            <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
              <Tooltip title="上移"><Button size="small" icon={<ArrowUpOutlined />} onClick={() => moveLayer(selectedLayer.id, 'up')} /></Tooltip>
              <Tooltip title="下移"><Button size="small" icon={<ArrowDownOutlined />} onClick={() => moveLayer(selectedLayer.id, 'down')} /></Tooltip>
              <Tooltip title="复制"><Button size="small" icon={<CopyOutlined />} onClick={() => duplicateLayer(selectedLayer.id)} /></Tooltip>
              <Tooltip title="删除"><Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => deleteLayer(selectedLayer.id)} /></Tooltip>
            </div>
          )}
        </div>

        {/* 中间: Canvas 画布 */}
        <div ref={containerRef} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', background: '#1a1a2e' }}>
          <canvas
            ref={canvasRef}
            onMouseDown={onCanvasMouseDown}
            onMouseMove={onCanvasMouseMove}
            onMouseUp={onCanvasMouseUp}
            onMouseLeave={onCanvasMouseUp}
            onWheel={onCanvasWheel}
            style={{ maxWidth: '100%', maxHeight: '100%', boxShadow: '0 4px 20px rgba(0,0,0,0.5)', cursor: dragging ? 'grabbing' : 'default' }}
          />
          {!sceneImage && (
            <div style={{ position: 'absolute', color: 'var(--muted)', textAlign: 'center' }}>
              <PictureOutlined style={{ fontSize: 48, marginBottom: 12 }} />
              <div>无场景图 — 请先在分镜中生成场景图</div>
            </div>
          )}
        </div>

        {/* 右侧: 属性面板 */}
        <div style={{ width: 260, borderLeft: '1px solid var(--border)', overflow: 'auto', padding: 12, background: 'var(--panel)' }}>
          {selectedLayer ? (
            <>
              <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, marginBottom: 12 }}>属性 — {selectedLayer.name}</div>

              {/* 抠图按钮 (角色层/道具层) */}
              {selectedLayer.type !== 'background' && (
                <div style={{ marginBottom: 16 }}>
                  <Button block type="primary" ghost icon={<ScissorOutlined />}
                    loading={removingBg === selectedLayer.id}
                    onClick={() => removeBg(selectedLayer.id)}>
                    {selectedLayer.cutoutUrl ? '重新抠图' : '抠图 (去背景)'}
                  </Button>
                  {selectedLayer.cutoutUrl && (
                    <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--success)', marginTop: 4 }}>✅ 已抠图, 背景透明</div>
                  )}
                </div>
              )}

              {/* 位置 X */}
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted)', marginBottom: 4 }}>X 位置: {selectedLayer.x.toFixed(0)}%</div>
                <Slider min={0} max={100} value={selectedLayer.x} onChange={v => updateLayer(selectedLayer.id, { x: v })} />
              </div>

              {/* 位置 Y */}
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted)', marginBottom: 4 }}>Y 位置: {selectedLayer.y.toFixed(0)}%</div>
                <Slider min={0} max={100} value={selectedLayer.y} onChange={v => updateLayer(selectedLayer.id, { y: v })} />
              </div>

              {/* 缩放 */}
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted)', marginBottom: 4 }}>缩放: {selectedLayer.scale.toFixed(2)}x</div>
                <Slider min={0.05} max={2} step={0.01} value={selectedLayer.scale}
                  onChange={v => updateLayer(selectedLayer.id, { scale: v })} />
              </div>

              {/* 旋转 */}
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted)', marginBottom: 4 }}>旋转: {selectedLayer.rotation}°</div>
                <Slider min={-180} max={180} value={selectedLayer.rotation}
                  onChange={v => updateLayer(selectedLayer.id, { rotation: v })} />
              </div>

              {/* 透明度 */}
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted)', marginBottom: 4 }}>透明度: {(selectedLayer.opacity * 100).toFixed(0)}%</div>
                <Slider min={0} max={1} step={0.01} value={selectedLayer.opacity}
                  onChange={v => updateLayer(selectedLayer.id, { opacity: v })} />
              </div>

              {/* 提示 */}
              {selectedLayer.type !== 'background' && (
                <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted-2)', marginTop: 16, padding: 8, background: 'var(--bg)', borderRadius: 'var(--radius-md)' }}>
                  💡 提示: 在画布上拖拽角色可调整位置。抠图后角色背景变透明，可叠加在场景上。
                </div>
              )}
            </>
          ) : (
            <div style={{ textAlign: 'center', color: 'var(--muted)', marginTop: 40 }}>
              <DragOutlined style={{ fontSize: 32, marginBottom: 8 }} />
              <div style={{ fontSize: 'var(--fs-sm)' }}>选择一个图层查看属性</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
