/**
 * SmartEditor — 智能编辑器 v3
 * 
 * 核心价值：真实可用的 AI 编辑
 * - 基于 VisionAnalyzer 的真实元素识别
 * - 对接后端 /v1/image edit 接口
 * - 支持选中元素 + 自然语言修改
 * 
 * 非模拟，真实调用 AI 生成
 */

import React, { useState, useRef, useCallback } from 'react';
import {
  Card, Button, Input, Space, Tag, Tooltip, message,
  Select, List, Empty, Badge, Segmented, Alert, Typography
} from 'antd';
import {
  EditOutlined, UndoOutlined, RedoOutlined, HistoryOutlined,
  DownloadOutlined, ArrowLeftOutlined, CheckCircleOutlined,
  SendOutlined, ThunderboltOutlined, EyeOutlined,
  BgColorsOutlined, SwapOutlined, DeleteOutlined,
} from '@ant-design/icons';
import { VisionAnalyzer, DetectedElement, VisionAnalysisResult } from './VisionAnalyzer';

const { TextArea } = Input;
const { Title, Paragraph } = Typography;

// ==================== 类型定义 ====================

interface EditHistory {
  id: string;
  timestamp: number;
  prompt: string;
  imageUrl: string;
  elementName: string;
  changeDesc: string;
  cost?: number;
}

interface SmartEditorProps {
  initialImageUrl?: string;
  onBack?: () => void;
  onSave?: (history: EditHistory[]) => void;
}

// ==================== 组件 ====================

export const SmartEditor: React.FC<SmartEditorProps> = ({
  initialImageUrl,
  onBack,
  onSave,
}) => {
  const [currentImage, setCurrentImage] = useState<string>(
    initialImageUrl || ''
  );
  const [analysisResult, setAnalysisResult] = useState<VisionAnalysisResult | null>(null);
  const [selectedElement, setSelectedElement] = useState<DetectedElement | null>(null);
  const [editPrompt, setEditPrompt] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [history, setHistory] = useState<EditHistory[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [mode, setMode] = useState<'analyze' | 'select' | 'edit'>('analyze');
  const [selectedModel, setSelectedModel] = useState('alrc-gpt-image-2');
  
  const imageRef = useRef<HTMLDivElement>(null);

  // 模型选项
  const MODEL_OPTIONS = [
    { value: 'alrc-gpt-image-2', label: 'GPT Image 2', desc: '编辑最强', cost: '¥0.05' },
    { value: 'alrc-nano-banana-2', label: 'Nano Banana', desc: '高性价比', cost: '¥0.04' },
    { value: 'agnes', label: 'Agnes', desc: '免费', cost: '免费' },
  ];

  // 分析完成回调
  const handleAnalysisComplete = useCallback((result: VisionAnalysisResult) => {
    setAnalysisResult(result);
    setMode('select');
    message.success(`识别到 ${result.elements.length} 个可编辑元素`);
  }, []);

  // 选择元素
  const handleElementSelect = useCallback((element: DetectedElement) => {
    setSelectedElement(element);
    setMode('edit');
    setEditPrompt(`把${element.name}改成`);
    message.info(`已选中：${element.name}，在右侧描述修改`);
  }, []);

  // 执行编辑 - 真实调用 API
  const executeEdit = useCallback(async () => {
    if (!editPrompt.trim() || !selectedElement || !currentImage) {
      message.warning('请先选择元素并描述修改');
      return;
    }

    setIsEditing(true);
    const hideLoading = message.loading('AI 正在重新渲染...', 0);

    try {
      // 调用后端 image/edit 接口
      const response = await fetch('/v1/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: editPrompt,
          image: currentImage,
          mode: 'edit',
          model: selectedModel,
          size: '1024x1024',
        }),
      });

      if (!response.ok) {
        throw new Error(`编辑失败: ${response.status}`);
      }

      const data = await response.json();
      const newImageUrl = data.data?.[0]?.url || data.url;

      if (!newImageUrl) {
        throw new Error('未生成图片');
      }

      const newHistory: EditHistory = {
        id: `edit-${Date.now()}`,
        timestamp: Date.now(),
        prompt: editPrompt,
        imageUrl: newImageUrl,
        elementName: selectedElement.name,
        changeDesc: `修改${selectedElement.name}: ${editPrompt}`,
        cost: data.cost,
      };

      const newHistories = history.slice(0, historyIndex + 1);
      newHistories.push(newHistory);
      setHistory(newHistories);
      setHistoryIndex(newHistories.length - 1);
      
      setCurrentImage(newImageUrl);
      setSelectedElement(null);
      setEditPrompt('');
      setMode('select');
      
      hideLoading();
      message.success('修改完成！');
    } catch (err: any) {
      hideLoading();
      message.error(err.message || '编辑失败');
      console.error('Edit error:', err);
    } finally {
      setIsEditing(false);
    }
  }, [editPrompt, selectedElement, currentImage, selectedModel, history, historyIndex]);

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

  // 快捷修改选项
  const QUICK_EDITS = [
    { label: '换颜色', template: (name: string) => `把${name}换成[颜色]色` },
    { label: '换材质', template: (name: string) => `把${name}换成[材质]材质`},
    { label: '加装饰', template: (name: string) => `在${name}上添加[装饰品]` },
    { label: '移除', template: (name: string) => `移除${name}` },
  ];

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
            
            <Segmented
              value={mode}
              onChange={(v) => setMode(v as any)}
              options={[
                { value: 'analyze', label: '分析', icon: <EyeOutlined /> },
                { value: 'select', label: '选择', icon: <EditOutlined /> },
                { value: 'edit', label: '编辑', icon: <ThunderboltOutlined /> },
              ]}
            />
          </Space>

          <Space>
            {/* 模型选择 */}
            <Select
              size="small"
              value={selectedModel}
              onChange={setSelectedModel}
              style={{ width: 180 }}
              options={MODEL_OPTIONS.map(m => ({
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
            
            <Tooltip title="撤销">
              <Button icon={<UndoOutlined />} onClick={undo} disabled={historyIndex <= 0} />
            </Tooltip>
            <Tooltip title="重做">
              <Button icon={<RedoOutlined />} onClick={redo} disabled={historyIndex >= history.length - 1} />
            </Tooltip>
            
            <Button type="primary" icon={<DownloadOutlined />} onClick={() => onSave?.(history)}>
              保存
            </Button>
          </Space>
        </div>

        {/* 画布 */}
        <div style={{ flex: 1, padding: 24, overflow: 'auto', background: '#1a1a2e', position: 'relative' }}>
          {!currentImage ? (
            <div style={{
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#666',
            }}>
              <Empty description="请先上传房间照片" />
            </div>
          ) : (
            <div
              ref={imageRef}
              style={{
                position: 'relative',
                maxWidth: 900,
                margin: '0 auto',
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

              {/* 元素标记层 */}
              {mode === 'select' && analysisResult && (
                <div style={{ position: 'absolute', inset: 0 }}>
                  {analysisResult.elements
                    .filter(e => e.editable)
                    .map((element) => (
                      <div
                        key={element.id}
                        onClick={() => handleElementSelect(element)}
                        style={{
                          position: 'absolute',
                          left: `${element.bounds.x}%`,
                          top: `${element.bounds.y}%`,
                          width: `${element.bounds.width}%`,
                          height: `${element.bounds.height}%`,
                          border: selectedElement?.id === element.id 
                            ? '3px solid #1890ff' 
                            : '2px dashed rgba(255,255,255,0.5)',
                          background: selectedElement?.id === element.id 
                            ? 'rgba(24,144,255,0.2)' 
                            : 'rgba(255,255,255,0.05)',
                          cursor: 'pointer',
                          borderRadius: 4,
                          transition: 'all 0.2s',
                        }}
                        title={element.name}
                      >
                        <div style={{
                          position: 'absolute',
                          top: -24,
                          left: 0,
                          background: selectedElement?.id === element.id ? '#1890ff' : 'rgba(0,0,0,0.7)',
                          color: '#fff',
                          padding: '2px 8px',
                          borderRadius: 4,
                          fontSize: 12,
                          whiteSpace: 'nowrap',
                        }}>
                          {element.name}
                        </div>
                      </div>
                    ))}
                </div>
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
                    <div style={{ marginTop: 8 }}>AI 渲染中...</div>
                  </Card>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 右侧：功能面板 */}
      <div style={{
        width: 360,
        borderLeft: '1px solid var(--border)',
        background: 'var(--panel)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'auto',
      }}>
        {/* 模式：分析 */}
        {mode === 'analyze' && (
          <VisionAnalyzer
            imageUrl={currentImage}
            onAnalysisComplete={handleAnalysisComplete}
            onElementSelect={handleElementSelect}
          />
        )}

        {/* 模式：选择提示 */}
        {mode === 'select' && analysisResult && (
          <Card style={{ height: '100%', background: 'var(--card)' }}>
            <div style={{ textAlign: 'center', padding: '40px 20px' }}>
              <EditOutlined style={{ fontSize: 48, color: 'var(--accent)', opacity: 0.6 }} />
              <Title level={5} style={{ marginTop: 24 }}>选择要编辑的元素</Title>
              <Paragraph type="secondary">
                点击画面中的虚线框选区域<br />
                选择家具、墙面等进行修改
              </Paragraph>
              <Alert
                message={`已识别 ${analysisResult.elements.filter(e => e.editable).length} 个可编辑元素`}
                type="info"
                showIcon
                style={{ marginTop: 16, textAlign: 'left' }}
              />
            </div>
          </Card>
        )}

        {/* 模式：编辑 */}
        {mode === 'edit' && selectedElement && (
          <>
            <div style={{ padding: 16, borderBottom: '1px solid var(--border)' }}>
              <div style={{ fontWeight: 500, marginBottom: 12, display: 'flex', alignItems: 'center' }}>
                <EditOutlined style={{ marginRight: 8, color: 'var(--accent)' }} />
                编辑 {selectedElement.name}
              </div>
              
              <div style={{
                padding: 12,
                background: 'var(--accent-soft)',
                borderRadius: 8,
                marginBottom: 12,
              }}>
                <div style={{ fontSize: 12, color: '#666' }}>{selectedElement.description}</div>
              </div>

              <TextArea
                value={editPrompt}
                onChange={e => setEditPrompt(e.target.value)}
                placeholder={`描述你想要的修改，例如："换成深灰色布艺沙发"`}
                autoSize={{ minRows: 3, maxRows: 5 }}
                style={{ marginBottom: 12 }}
              />

              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, color: '#999', marginBottom: 8 }}>快捷修改：</div>
                <Space wrap>
                  {QUICK_EDITS.map(({ label, template }) => (
                    <Tag 
                      key={label}
                      style={{ cursor: 'pointer' }}
                      onClick={() => setEditPrompt(template(selectedElement.name))}
                    >
                      {label}
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
                          {item.cost && ` · ¥${item.cost}`}
                        </div>
                      </div>
                      {index === historyIndex && <CheckCircleOutlined style={{ color: 'var(--accent)' }} />}
                    </List.Item>
                  )}
                />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default SmartEditor;
