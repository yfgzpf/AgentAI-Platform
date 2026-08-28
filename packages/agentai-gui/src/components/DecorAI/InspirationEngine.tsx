/**
 * InspirationEngine — 灵感引擎
 * 
 * 核心能力:
 *   1. 用户上传任意图片 → AI解析风格偏好
 *   2. 自然语言描述 → AI提取关键元素
 *   3. 生成3档预算方案（经济/品质/豪华）
 *   4. 每个方案包含: 效果图 + 材料清单 + 预算
 */

import React, { useState, useCallback } from 'react';
import { 
  Upload, Button, Card, Space, Tag, Typography, Spin, 
  Row, Col, Badge, Divider, List, Progress
} from 'antd';
import { 
  UploadOutlined, BulbOutlined, ArrowRightOutlined,
  DollarOutlined, HomeOutlined, BgColorsOutlined,
  CheckCircleOutlined, ExperimentOutlined
} from '@ant-design/icons';
import { DECOR_STYLES, DecorStyle } from './styles';

const { Text, Title, Paragraph } = Typography;
const { Dragger } = Upload;

// ==================== 类型定义 ====================

interface InspirationInput {
  type: 'image' | 'text';
  content: string; // 图片URL或文字描述
}

interface DetectedStyle {
  style: DecorStyle;
  confidence: number; // 匹配度 0-100
  keyElements: string[]; // 识别出的关键元素
}

export interface BudgetTier {
  tier: 'economy' | 'standard' | 'luxury';
  name: string;
  budget: number; // 总价
  perSqm: number; // 每平米
  highlights: string[]; // 亮点
  materials: string[]; // 主要材料
  imageUrl?: string; // 效果图
}

interface InspirationResult {
  detectedStyles: DetectedStyle[];
  budgetTiers: BudgetTier[];
  analysis: string; // AI分析总结
}

// ==================== 组件 ====================

interface InspirationEngineProps {
  onSelectTier?: (tier: BudgetTier) => void;
  onEditRequest?: (request: string) => void;
}

export const InspirationEngine: React.FC<InspirationEngineProps> = ({
  onSelectTier,
  onEditRequest,
}) => {
  const [input, setInput] = useState<InspirationInput | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<InspirationResult | null>(null);

  // 调用真实 AI 解析
  const analyzeInspiration = useCallback(async () => {
    if (!input) return;
    
    setIsAnalyzing(true);
    
    try {
      // 调用后端 AI 生成装修方案
      const prompt = input.type === 'image' 
        ? `请分析这张装修参考图，生成3档预算方案（经济型15万/品质型28万/豪华型50万）。每档包含: 效果图描述、主要材料、亮点。按JSON格式返回: {"detectedStyles":[{"style":"风格名","confidence":85,"keyElements":["元素1","元素2"]}],"budgetTiers":[{"tier":"economy","name":"经济型","budget":150000,"perSqm":1500,"highlights":["亮点1"],"materials":["材料1"],"imageUrl":""},...],"analysis":"分析总结"}`
        : `用户描述: "${input.content}"。请生成3档预算方案（经济型15万/品质型28万/豪华型50万）。每档包含: 效果图描述、主要材料、亮点。按JSON格式返回: {"detectedStyles":[{"style":"风格名","confidence":85,"keyElements":["元素1"]}],"budgetTiers":[{"tier":"economy","name":"经济型","budget":150000,"perSqm":1500,"highlights":["亮点1"],"materials":["材料1"],"imageUrl":""},...],"analysis":"分析总结"}`;

      const response = await fetch('/v1/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: prompt,
          model: 'agnes-2.5-flash',
          stream: false,
        }),
      });

      if (!response.ok) throw new Error(`AI 分析失败: ${response.status}`);
      
      const data = await response.json();
      const content = data.content || data.message || '';
      
      // 解析 JSON
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        
        // 为每个方案生成效果图
        const tiers = (parsed.budgetTiers || []).slice(0, 3);
        for (const tier of tiers) {
          if (!tier.imageUrl) {
            // 用文字描述作为效果图占位 (后续可调用图片生成)
            tier.imageUrl = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#f0f0f0"/><text x="300" y="200" font-size="24" text-anchor="middle" fill="#666">${tier.name}方案</text><text x="300" y="240" font-size="16" text-anchor="middle" fill="#999">¥${(tier.budget/10000).toFixed(0)}万</text></svg>`)}`;
          }
        }
        
        setResult({
          detectedStyles: parsed.detectedStyles || [{ style: DECOR_STYLES[0], confidence: 80, keyElements: ['现代简约'] }],
          budgetTiers: tiers,
          analysis: parsed.analysis || '分析完成',
        });
      } else {
        // AI 没返回 JSON, 用文字结果
        setResult({
          detectedStyles: [{ style: DECOR_STYLES[0], confidence: 70, keyElements: ['AI分析'] }],
          budgetTiers: [],
          analysis: content.slice(0, 500),
        });
      }
    } catch (err: any) {
      // 降级: 如果 AI 调用失败, 用模拟数据
      console.warn('[InspirationEngine] AI 调用失败, 降级:', err?.message);
      setResult({
        detectedStyles: [
          { style: DECOR_STYLES[0], confidence: 85, keyElements: ['无主灯设计', '浅灰色墙面', '原木元素'] },
        ],
        budgetTiers: [
          { tier: 'economy', name: '经济型', budget: 150000, perSqm: 1500, highlights: ['基础硬装', '国产主材'], materials: ['乳胶漆', '强化地板', '普通瓷砖'], imageUrl: '' },
          { tier: 'standard', name: '品质型', budget: 280000, perSqm: 2800, highlights: ['品质硬装', '进口主材'], materials: ['艺术涂料', '实木复合地板', '大理石瓷砖'], imageUrl: '' },
          { tier: 'luxury', name: '豪华型', budget: 500000, perSqm: 5000, highlights: ['高端定制', '进口家具'], materials: ['微水泥', '实木地板', '岩板'], imageUrl: '' },
        ],
        analysis: 'AI 分析暂时不可用, 显示默认方案。',
      });
    }
    
    setIsAnalyzing(false);
  }, [input]);

  // 处理图片上传
  const handleUpload = (file: File) => {
    const url = URL.createObjectURL(file);
    setInput({ type: 'image', content: url });
    return false;
  };

  // 处理文字输入
  const handleTextSubmit = (text: string) => {
    if (!text.trim()) return;
    setInput({ type: 'text', content: text });
  };

  // 渲染输入区
  const renderInput = () => (
    <div style={{ padding: 24 }}>
      <Title level={4} style={{ textAlign: 'center', marginBottom: 8 }}>
        <BulbOutlined style={{ color: '#faad14', marginRight: 8 }} />
        告诉我你喜欢的风格
      </Title>
      <Paragraph type="secondary" style={{ textAlign: 'center', marginBottom: 24 }}>
        上传一张参考图，或描述你想要的装修感觉
      </Paragraph>

      <Row gutter={16}>
        <Col span={12}>
          <Dragger
            beforeUpload={handleUpload}
            showUploadList={false}
            style={{ background: 'var(--card)', height: 200 }}
          >
            <p><UploadOutlined style={{ fontSize: 32, color: 'var(--accent)' }} /></p>
            <p style={{ fontSize: 14 }}>点击或拖拽上传参考图</p>
            <p style={{ fontSize: 12, color: '#999' }}>支持小红书/抖音截图</p>
          </Dragger>
        </Col>
        <Col span={12}>
          <Card style={{ height: 200, background: 'var(--card)' }}>
            <div style={{ marginBottom: 12 }}>
              <ExperimentOutlined style={{ marginRight: 8 }} />
              <Text strong>文字描述</Text>
            </div>
            <textarea
              placeholder="例如：想要温馨明亮的客厅，有大落地窗，喜欢原木色..."
              style={{
                width: '100%',
                height: 100,
                border: '1px solid var(--border)',
                borderRadius: 4,
                padding: 8,
                background: 'var(--bg)',
                color: 'var(--fg)',
                resize: 'none',
              }}
              onBlur={(e) => handleTextSubmit(e.target.value)}
            />
          </Card>
        </Col>
      </Row>

      {/* 快捷描述 */}
      <div style={{ marginTop: 16 }}>
        <Text type="secondary" style={{ fontSize: 12 }}>热门描述：</Text>
        <Space wrap style={{ marginTop: 8 }}>
          {[
            '120平三室两厅现代简约',
            '温馨北欧风，要有大书柜',
            '新中式，喜欢木质元素',
            '极简侘寂风，微水泥地面',
          ].map(desc => (
            <Tag 
              key={desc} 
              style={{ cursor: 'pointer' }}
              onClick={() => handleTextSubmit(desc)}
            >
              {desc}
            </Tag>
          ))}
        </Space>
      </div>
    </div>
  );

  // 渲染分析中
  const renderAnalyzing = () => (
    <div style={{ padding: 48, textAlign: 'center' }}>
      <Spin size="large" />
      <div style={{ marginTop: 24 }}>
        <Title level={4}>AI正在分析你的喜好...</Title>
        <Paragraph type="secondary">
          识别风格元素 · 匹配材料方案 · 生成预算报价
        </Paragraph>
      </div>
      <Progress percent={60} status="active" style={{ maxWidth: 400, margin: '24px auto' }} />
    </div>
  );

  // 渲染结果
  const renderResult = () => {
    if (!result) return null;
    
    return (
      <div style={{ padding: 24 }}>
        {/* 风格识别结果 */}
        <Card style={{ marginBottom: 24, background: 'var(--card)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
            <div style={{ fontSize: 48 }}>{result.detectedStyles[0].style.icon}</div>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                <Title level={4} style={{ margin: 0 }}>
                  识别风格：{result.detectedStyles[0].style.label}
                </Title>
                <Badge 
                  count={`匹配度 ${result.detectedStyles[0].confidence}%`} 
                  style={{ backgroundColor: '#52c41a' }}
                />
              </div>
              <Paragraph>{result.analysis}</Paragraph>
              <Space wrap>
                {result.detectedStyles[0].keyElements.map(el => (
                  <Tag key={el} color="blue">{el}</Tag>
                ))}
              </Space>
            </div>
          </div>
        </Card>

        {/* 三档预算方案 */}
        <Title level={5} style={{ marginBottom: 16 }}>
          <DollarOutlined style={{ marginRight: 8 }} />
          为你生成3档预算方案
        </Title>
        
        <Row gutter={16}>
          {result.budgetTiers.map((tier, index) => (
            <Col key={tier.tier} span={8}>
              <Card
                hoverable
                onClick={() => onSelectTier?.(tier)}
                style={{ 
                  height: '100%',
                  borderColor: index === 1 ? 'var(--accent)' : undefined,
                }}
                title={
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span>{tier.name}</span>
                    {index === 1 && <Tag color="orange">推荐</Tag>}
                  </div>
                }
              >
                <img 
                  src={tier.imageUrl} 
                  style={{ width: '100%', height: 120, objectFit: 'cover', borderRadius: 4, marginBottom: 12 }}
                />
                
                <div style={{ textAlign: 'center', marginBottom: 12 }}>
                  <Text style={{ fontSize: 24, fontWeight: 'bold', color: 'var(--accent)' }}>
                    ¥{(tier.budget / 10000).toFixed(0)}万
                  </Text>
                  <div style={{ fontSize: 12, color: '#999' }}>
                    约{tier.perSqm}元/㎡（按100㎡计）
                  </div>
                </div>

                <Divider style={{ margin: '12px 0' }} />

                <div style={{ marginBottom: 12 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>核心亮点：</Text>
                  <div style={{ marginTop: 4 }}>
                    {tier.highlights.map(h => (
                      <div key={h} style={{ fontSize: 12, marginBottom: 2 }}>
                        <CheckCircleOutlined style={{ color: '#52c41a', marginRight: 4 }} />
                        {h}
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <Text type="secondary" style={{ fontSize: 12 }}>主要材料：</Text>
                  <div style={{ marginTop: 4 }}>
                    {tier.materials.slice(0, 3).map(m => (
                      <Tag key={m} style={{ marginBottom: 4, fontSize: 11 }}>{m}</Tag>
                    ))}
                  </div>
                </div>

                <Button 
                  type="primary" 
                  block 
                  style={{ marginTop: 12 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectTier?.(tier);
                  }}
                >
                  选此方案，开始编辑 <ArrowRightOutlined />
                </Button>
              </Card>
            </Col>
          ))}
        </Row>

        {/* 不满意？ */}
        <div style={{ marginTop: 24, textAlign: 'center' }}>
          <Text type="secondary">不太满意？</Text>
          <Space style={{ marginLeft: 8 }}>
            <Button onClick={() => onEditRequest?.('换风格')}>换种风格</Button>
            <Button onClick={() => onEditRequest?.('调预算')}>调整预算</Button>
            <Button onClick={() => onEditRequest?.('改需求')}>修改需求</Button>
          </Space>
        </div>
      </div>
    );
  };

  return (
    <div style={{ height: '100%', overflow: 'auto' }}>
      {!input && renderInput()}
      {input && isAnalyzing && renderAnalyzing()}
      {input && !isAnalyzing && result && renderResult()}
    </div>
  );
};

export default InspirationEngine;
