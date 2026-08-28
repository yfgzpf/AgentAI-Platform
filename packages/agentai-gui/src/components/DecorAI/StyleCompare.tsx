/**
 * StyleCompare — 风格对比工具
 * 
 * 为设计师提供:
 *   - 同一场景多风格对比
 *   - A/B 方案展示
 *   - 客户方案选择
 *   - 风格切换动画
 */

import React, { useState } from 'react';
import { Card, Button, Space, Tag, Radio, Row, Col, Divider, Tooltip, Badge } from 'antd';
import { 
  SwapOutlined, EyeOutlined, DownloadOutlined, 
  CheckCircleOutlined, CopyOutlined, DeleteOutlined,
} from '@ant-design/icons';
import { DECOR_STYLES, DecorStyle } from './styles';

// ==================== 类型定义 ====================

interface CompareItem {
  id: string;
  style: DecorStyle;
  imageUrl?: string;
  prompt: string;
  isGenerating: boolean;
}

interface StyleCompareProps {
  basePrompt?: string;
  onGenerate?: (style: DecorStyle) => void;
  onSelect?: (style: DecorStyle) => void;
}

// ==================== 组件 ====================

export const StyleCompare: React.FC<StyleCompareProps> = ({
  basePrompt = '现代简约客厅，开放式布局，落地窗',
  onGenerate,
  onSelect,
}) => {
  const [compareMode, setCompareMode] = useState<'2way' | '3way' | '4way'>('2way');
  const [selectedStyles, setSelectedStyles] = useState<string[]>(['modern', 'nordic']);
  const [items, setItems] = useState<CompareItem[]>([]);
  const [clientChoice, setClientChoice] = useState<string | null>(null);

  // 切换选中风格
  const toggleStyle = (styleKey: string) => {
    const max = compareMode === '2way' ? 2 : compareMode === '3way' ? 3 : 4;
    
    if (selectedStyles.includes(styleKey)) {
      setSelectedStyles(selectedStyles.filter(s => s !== styleKey));
    } else if (selectedStyles.length < max) {
      setSelectedStyles([...selectedStyles, styleKey]);
    }
  };

  // 生成对比图
  const generateCompare = () => {
    const newItems = selectedStyles.map(key => {
      const style = DECOR_STYLES.find(s => s.key === key)!;
      return {
        id: `compare-${key}-${Date.now()}`,
        style,
        prompt: `${basePrompt}, ${style.prompt}`,
        isGenerating: true,
      };
    });
    setItems(newItems);
    
    // 触发外部生成
    newItems.forEach(item => {
      onGenerate?.(item.style);
    });
  };

  // 模拟生成完成
  const simulateComplete = (id: string) => {
    setItems(items => items.map(item => 
      item.id === id ? { ...item, isGenerating: false } : item
    ));
  };

  return (
    <div style={{ padding: 16 }}>
      {/* 顶部控制栏 */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <Row gutter={16} align="middle">
          <Col>
            <span style={{ fontSize: 12, marginRight: 8 }}>对比模式:</span>
            <Radio.Group 
              size="small" 
              value={compareMode}
              onChange={e => {
                setCompareMode(e.target.value);
                setSelectedStyles(selectedStyles.slice(0, e.target.value === '2way' ? 2 : e.target.value === '3way' ? 3 : 4));
              }}
            >
              <Radio.Button value="2way">2风格</Radio.Button>
              <Radio.Button value="3way">3风格</Radio.Button>
              <Radio.Button value="4way">4风格</Radio.Button>
            </Radio.Group>
          </Col>
          <Col flex={1}>
            <Button 
              type="primary" 
              size="small"
              icon={<SwapOutlined />}
              onClick={generateCompare}
              disabled={selectedStyles.length < 2}
            >
              生成对比
            </Button>
          </Col>
        </Row>
      </Card>

      {/* 风格选择 */}
      <Card size="small" title="选择要对比的风格" style={{ marginBottom: 16 }}>
        <Space wrap>
          {DECOR_STYLES.map(style => {
            const isSelected = selectedStyles.includes(style.key);
            const canSelect = selectedStyles.length < (compareMode === '2way' ? 2 : compareMode === '3way' ? 3 : 4);
            
            return (
              <Tag
                key={style.key}
                color={isSelected ? 'blue' : canSelect ? undefined : 'default'}
                style={{ 
                  cursor: canSelect || isSelected ? 'pointer' : 'not-allowed',
                  opacity: !isSelected && !canSelect ? 0.5 : 1,
                  padding: '4px 12px',
                  fontSize: 12,
                }}
                onClick={() => toggleStyle(style.key)}
              >
                <span style={{ marginRight: 4 }}>{style.icon}</span>
                {style.label}
                {isSelected && <CheckCircleOutlined style={{ marginLeft: 4 }} />}
              </Tag>
            );
          })}
        </Space>
        <div style={{ marginTop: 8, fontSize: 11, color: '#666' }}>
          已选择 {selectedStyles.length} / {compareMode === '2way' ? 2 : compareMode === '3way' ? 3 : 4} 个风格
        </div>
      </Card>

      {/* 对比展示区 */}
      {items.length > 0 && (
        <Card size="small" title="方案对比">
          <Row gutter={[16, 16]}>
            {items.map((item, index) => (
              <Col 
                key={item.id} 
                span={compareMode === '2way' ? 12 : compareMode === '3way' ? 8 : 6}
              >
                <div
                  style={{
                    border: `2px solid ${clientChoice === item.style.key ? '#52c41a' : 'var(--border)'}`,
                    borderRadius: 8,
                    overflow: 'hidden',
                    position: 'relative',
                  }}
                >
                  {/* 风格标签 */}
                  <div style={{
                    position: 'absolute',
                    top: 8,
                    left: 8,
                    background: 'rgba(0,0,0,0.7)',
                    color: '#fff',
                    padding: '4px 12px',
                    borderRadius: 4,
                    fontSize: 12,
                    zIndex: 1,
                  }}>
                    <span style={{ marginRight: 4 }}>{item.style.icon}</span>
                    {item.style.label}
                  </div>

                  {/* 客户选择标记 */}
                  {clientChoice === item.style.key && (
                    <div style={{
                      position: 'absolute',
                      top: 8,
                      right: 8,
                      background: '#52c41a',
                      color: '#fff',
                      padding: '4px 12px',
                      borderRadius: 4,
                      fontSize: 12,
                      zIndex: 1,
                    }}>
                      <CheckCircleOutlined style={{ marginRight: 4 }} />
                      客户选定
                    </div>
                  )}

                  {/* 图片区域 */}
                  <div style={{
                    height: 200,
                    background: item.isGenerating ? 'linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%)' : '#f5f5f5',
                    backgroundSize: '200% 100%',
                    animation: item.isGenerating ? 'shimmer 1.5s infinite' : 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                    {item.isGenerating ? (
                      <div style={{ textAlign: 'center', color: '#999' }}>
                        <div style={{ fontSize: 24, marginBottom: 8 }}>⏳</div>
                        <div style={{ fontSize: 12 }}>生成中...</div>
                      </div>
                    ) : item.imageUrl ? (
                      <img 
                        src={item.imageUrl} 
                        alt={item.style.label}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    ) : (
                      <div style={{ textAlign: 'center', color: '#999' }}>
                        <div style={{ fontSize: 24, marginBottom: 8 }}>🖼️</div>
                        <div style={{ fontSize: 12 }}>效果图占位</div>
                        <Button 
                          size="small" 
                          style={{ marginTop: 8 }}
                          onClick={() => simulateComplete(item.id)}
                        >
                          模拟完成
                        </Button>
                      </div>
                    )}
                  </div>

                  {/* 底部信息 */}
                  <div style={{ padding: 12 }}>
                    <div style={{ fontSize: 11, color: '#666', marginBottom: 8 }}>
                      {item.style.desc}
                    </div>
                    <div style={{ fontSize: 10, color: '#999', marginBottom: 8 }}>
                      主材: {item.style.materials}
                    </div>
                    <Space>
                      <Button 
                        size="small" 
                        type={clientChoice === item.style.key ? 'primary' : 'default'}
                        icon={<CheckCircleOutlined />}
                        onClick={() => {
                          setClientChoice(item.style.key);
                          onSelect?.(item.style);
                        }}
                      >
                        {clientChoice === item.style.key ? '已选定' : '选此方案'}
                      </Button>
                      <Tooltip title="查看详情">
                        <Button size="small" icon={<EyeOutlined />} />
                      </Tooltip>
                    </Space>
                  </div>
                </div>
              </Col>
            ))}
          </Row>

          {/* 客户选择反馈 */}
          {clientChoice && (
            <div style={{ 
              marginTop: 16, 
              padding: 12, 
              background: '#f6ffed', 
              border: '1px solid #b7eb8f',
              borderRadius: 4,
            }}>
              <CheckCircleOutlined style={{ color: '#52c41a', marginRight: 8 }} />
              <span style={{ color: '#389e0d' }}>
                客户已选择 <strong>{DECOR_STYLES.find(s => s.key === clientChoice)?.label}</strong> 风格
              </span>
            </div>
          )}
        </Card>
      )}

      {/* 使用说明 */}
      <Card size="small" style={{ marginTop: 16 }}>
        <div style={{ fontSize: 12, color: '#666' }}>
          <strong>使用说明:</strong>
          <ol style={{ margin: '8px 0', paddingLeft: 16 }}>
            <li>选择 2-4 个想要对比的装修风格</li>
            <li>点击"生成对比"同时生成多个风格的效果图</li>
            <li>与客户一起对比查看，点击"选此方案"记录客户选择</li>
          </ol>
        </div>
      </Card>

      <style>{`
        @keyframes shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
    </div>
  );
};

export default StyleCompare;
