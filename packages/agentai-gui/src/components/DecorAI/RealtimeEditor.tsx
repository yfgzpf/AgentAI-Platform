/**
 * RealtimeEditor — 实时编辑器 v2
 * 
 * 核心能力:
 *   1. 模型选择（GPT Image / Nano Banana / 免费模型）
 *   2. 点击画面任意区域 → 选中元素
 *   3. 自然语言描述修改 → AI实时渲染
 *   4. 修改历史记录 → 可回溯对比
 */

import React, { useState, useRef, useCallback } from 'react';
import {
  Card, Button, Input, Space, Tag, Tooltip, message,
  Select, List, Empty, Badge, Segmented
} from 'antd';
import {
  EditOutlined, UndoOutlined, RedoOutlined, HistoryOutlined,
  DownloadOutlined, ArrowLeftOutlined, CheckCircleOutlined,
  ExpandOutlined, SendOutlined, ThunderboltOutlined,
} from '@ant-design/icons';

const { TextArea } = Input;

interface BudgetTier {
  tier: 'economy' | 'standard' | 'luxury';
  name: string;
  budget: number;
  perSqm: number;
  highlights: string[];
  materials: string[];
  imageUrl?: string;
}

interface EditPoint {
  id: string;
  x: number;
  y: number;
  element: string;
  original: string;
}

interface EditHistory {
  id: string;
  timestamp: number;
  prompt: string;
  imageUrl: string;
  changeDesc: string;
}

const IMAGE_MODELS = [
  { value: 'alrc-gpt-image-2', label: 'GPT Image 2', desc: '编辑最强', cost: '¥0.05' },
  { value: 'alrc-nano-banana-2', label: 'Nano Banana', desc: '高性价比', cost: '¥0.04' },
  { value: 'agnes', label: 'Agnes', desc: '免费', cost: '免费' },
];

interface RealtimeEditorProps {
  initialTier?: BudgetTier;
  onBack?: () => void;
  onSave?: (history: EditHistory[]) => void;
}

export const RealtimeEditor: React.FC<RealtimeEditorProps> = ({
  initialTier,
  onBack,
  onSave,
}) => {
  const [currentImage, setCurrentImage] = useState<string>(
    initialTier?.imageUrl || 'https://placehold.co/1200x800/2c3e50/ffffff?text=点击"开始编辑"选择画面元素'
  );
  const [selectedPoint, setSelectedPoint] = useState<EditPoint | null>(null);
  const [editPrompt, setEditPrompt] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [history, setHistory] = useState<EditHistory[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [mode, setMode] = useState<'select' | 'view'>('view');
  const [selectedModel, setSelectedModel] = useState('alrc-gpt-image-2');
  
  const imageRef = useRef<HTMLDivElement>(null);

  // 点击画面选择编辑点
  const handleImageClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (mode !== 'select') {
      message.info('请先点击"开始编辑"按钮');
      return;
    }
    
    const rect = imageRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;

    const elements = ['背景墙', '沙发', '地板', '灯具', '窗帘', '茶几', '电视柜', '装饰画'];
    const randomElement = elements[Math.floor(Math.random() * elements.length)];

    const newPoint: EditPoint = {
      id: `point-${Date.now()}`,
      x,
      y,
      element: randomElement,
      original: '当前样式',
    };

    setSelectedPoint(newPoint);
    setEditPrompt(`把${randomElement}换成`);
    message.success(`已选中：${randomElement}，在右侧描述修改`);
  }, [mode]);

  // 执行编辑
  const executeEdit = useCallback(async () => {
    if (!editPrompt.trim() || !selectedPoint) {
      message.warning('请先选择元素并描述修改');
      return;
    }

    setIsEditing(true);
    message.loading('AI正在重新渲染...', 2);

    // 模拟AI编辑
    await new Promise(r => setTimeout(r, 2000));

    const newImageUrl = `https://placehold.co/1200x800/3498db/ffffff?text=${encodeURIComponent(editPrompt)}&t=${Date.now()}`;
    
    const newHistory: EditHistory = {
      id: `edit-${Date.now()}`,
      timestamp: Date.now(),
      prompt: editPrompt,
      imageUrl: newImageUrl,
      changeDesc: `修改${selectedPoint.element}: ${editPrompt}`,
    };

    const newHistories = history.slice(0, historyIndex + 1);
    newHistories.push(newHistory);
    setHistory(newHistories);
    setHistoryIndex(newHistories.length - 1);
    
    setCurrentImage(newImageUrl);
    setIsEditing(false);
    setSelectedPoint(null);
    setEditPrompt('');
    setMode('view');
    
    message.success('修改完成！');
  }, [editPrompt, selectedPoint, history, historyIndex]);

  // 撤销
  const undo = () => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      setCurrentImage(history[newIndex].imageUrl);
    }
  };

  // 重做
  const redo = () => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      setCurrentImage(history[newIndex].imageUrl);
    }
  };

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      {/* 左侧：画布区 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {/* 顶部工具栏 */}
        <div style={{
          height: 56,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 16px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--card)',
        }}>
          <Space>
            <Button icon={<ArrowLeftOutlined />} onClick={onBack}>
              返回
            </Button>
            
            {/* 模型选择 */}
            <Select
              size="small"
              value={selectedModel}
              onChange={setSelectedModel}
              style={{ width: 180 }}
              options={IMAGE_MODELS.map(m => ({
                value: m.value,
                label: (
                  <Space>
                    <span>{m.label}</span>
                    <Tag color={m.cost === '免费' ? 'green' : 'orange'} style={{ fontSize: 10 }}>
                      {m.cost}
                    </Tag>
                  </Space>
                ),
              }))}
            />
          </Space>

          <Space>
            <Button 
              type={mode === 'select' ? 'primary' : 'default'}
              icon={<EditOutlined />}
              onClick={() => {
                setMode(mode === 'select' ? 'view' : 'select');
                if (mode === 'view') {
                  message.info('现在可以点击画面任意位置选择要修改的元素');
                }
              }}
            >
              {mode === 'select' ? '退出编辑' : '开始编辑'}
            </Button>
            
            <Tooltip title="撤销">
              <Button icon={<UndoOutlined />} onClick={undo} disabled={historyIndex <= 0} />
            </Tooltip>
            <Tooltip title="重做">
              <Button icon={<RedoOutlined />} onClick={redo} disabled={historyIndex >= history.length - 1} />
            </Tooltip>
            
            <Button type="primary" icon={<DownloadOutlined />} onClick={() => onSave?.(history)}>
              保存方案
            </Button>
          </Space>
        </div>

        {/* 画布 */}
        <div style={{ flex: 1, padding: 24, overflow: 'auto', background: '#1a1a2e' }}>
          <div
            ref={imageRef}
            onClick={handleImageClick}
            style={{
              position: 'relative',
              maxWidth: 900,
              margin: '0 auto',
              cursor: mode === 'select' ? 'crosshair' : 'default',
              borderRadius: 8,
              overflow: 'hidden',
              boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
            }}
          >
            <img
              src={currentImage}
              style={{
                width: '100%',
                display: 'block',
                opacity: isEditing ? 0.5 : 1,
              }}
            />

            {/* 选中点标记 */}
            {selectedPoint && (
              <div
                style={{
                  position: 'absolute',
                  left: `${selectedPoint.x}%`,
                  top: `${selectedPoint.y}%`,
                  width: 24,
                  height: 24,
                  marginLeft: -12,
                  marginTop: -12,
                  borderRadius: '50%',
                  background: '#1890ff',
                  border: '3px solid #fff',
                  boxShadow: '0 0 0 4px rgba(24,144,255,0.3)',
                  animation: 'pulse 1.5s infinite',
                  zIndex: 10,
                }}
              />
            )}

            {/* 编辑中遮罩 */}
            {isEditing && (
              <div style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(0,0,0,0.5)',
              }}>
                <Card style={{ textAlign: 'center' }}>
                  <ThunderboltOutlined style={{ fontSize: 32, color: '#1890ff' }} />
                  <div style={{ marginTop: 8 }}>AI渲染中...</div>
                </Card>
              </div>
            )}

            {/* 编辑模式提示 */}
            {mode === 'select' && !selectedPoint && (
              <div style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(24,144,255,0.1)',
                pointerEvents: 'none',
              }}>
                <div style={{
                  padding: '16px 32px',
                  background: 'rgba(24,144,255,0.9)',
                  color: '#fff',
                  borderRadius: 8,
                  fontSize: 16,
                }}>
                  <EditOutlined style={{ marginRight: 8 }} />
                  点击画面任意位置选择要修改的元素
                </div>
              </div>
            )}
          </div>

          {/* 方案信息 */}
          {initialTier && (
            <div style={{
              position: 'absolute',
              bottom: 40,
              left: 40,
              background: 'rgba(0,0,0,0.8)',
              color: '#fff',
              padding: '12px 16px',
              borderRadius: 8,
            }}>
              <div style={{ fontSize: 14, fontWeight: 500 }}>{initialTier.name}</div>
              <div style={{ fontSize: 12, opacity: 0.8 }}>
                预算 ¥{(initialTier.budget / 10000).toFixed(0)}万 · {initialTier.perSqm}元/㎡
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 右侧：编辑面板 */}
      <div style={{
        width: 340,
        borderLeft: '1px solid var(--border)',
        background: 'var(--panel)',
        display: 'flex',
        flexDirection: 'column',
      }}>
        {/* 选中元素编辑 */}
        <div style={{ padding: 16, borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontWeight: 500, marginBottom: 12, display: 'flex', alignItems: 'center' }}>
            <EditOutlined style={{ marginRight: 8, color: 'var(--accent)' }} />
            元素编辑
          </div>
          
          {selectedPoint ? (
            <>
              <div style={{
                padding: 12,
                background: 'var(--accent-soft)',
                borderRadius: 8,
                marginBottom: 12,
              }}>
                <div style={{ fontWeight: 500 }}>已选中：{selectedPoint.element}</div>
                <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
                  位置: {selectedPoint.x.toFixed(1)}%, {selectedPoint.y.toFixed(1)}%
                </div>
              </div>

              <TextArea
                value={editPrompt}
                onChange={e => setEditPrompt(e.target.value)}
                placeholder={`描述你想要的修改，例如："换成深灰色大理石纹理"`}
                autoSize={{ minRows: 3, maxRows: 5 }}
                style={{ marginBottom: 12 }}
              />

              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, color: '#999', marginBottom: 8 }}>快捷修改：</div>
                <Space wrap>
                  {['换成浅色', '加深颜色', '换材质', '加装饰'].map(s => (
                    <Tag 
                      key={s} 
                      style={{ cursor: 'pointer' }}
                      onClick={() => setEditPrompt(`把${selectedPoint.element}${s}`)}
                    >
                      {s}
                    </Tag>
                  ))}
                </Space>
              </div>

              <Button 
                type="primary" 
                block 
                icon={<SendOutlined />}
                loading={isEditing}
                onClick={executeEdit}
                disabled={!editPrompt.trim()}
              >
                确认修改
              </Button>
            </>
          ) : (
            <div style={{ textAlign: 'center', padding: 24, color: '#999' }}>
              <EditOutlined style={{ fontSize: 32, marginBottom: 8 }} />
              <div>点击"开始编辑"后</div>
              <div>选择画面元素进行修改</div>
            </div>
          )}
        </div>

        {/* 修改历史 */}
        <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
          <div style={{ fontWeight: 500, marginBottom: 12 }}>
            <HistoryOutlined style={{ marginRight: 8 }} />
            修改记录 ({history.length})
          </div>
          
          {history.length === 0 ? (
            <Empty description="暂无修改记录" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          ) : (
            <List
              size="small"
              dataSource={history}
              renderItem={(item, index) => (
                <List.Item
                  style={{
                    padding: 8,
                    cursor: 'pointer',
                    background: index === historyIndex ? 'var(--accent-soft)' : 'transparent',
                    borderRadius: 4,
                    marginBottom: 4,
                  }}
                  onClick={() => {
                    setHistoryIndex(index);
                    setCurrentImage(item.imageUrl);
                  }}
                >
                  <div style={{ width: '100%' }}>
                    <div style={{ fontSize: 12, marginBottom: 4 }}>{item.changeDesc}</div>
                    <div style={{ fontSize: 10, color: '#999' }}>
                      {new Date(item.timestamp).toLocaleTimeString()}
                    </div>
                  </div>
                  {index === historyIndex && <CheckCircleOutlined style={{ color: 'var(--accent)' }} />}
                </List.Item>
              )}
            />
          )}
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.2); opacity: 0.8; }
        }
      `}</style>
    </div>
  );
};

export default RealtimeEditor;
