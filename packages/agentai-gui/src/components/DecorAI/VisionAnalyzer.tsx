/**
 * VisionAnalyzer — 真实图像分析组件
 * 
 * 核心价值：用真实 Vision API 分析房间照片
 * - 识别家具、墙面、地面等元素
 * - 分析空间布局、采光、风格
 * - 生成可编辑区域（供 InpaintEditor 使用）
 * 
 * 非模拟数据，真实调用后端 Vision API
 */

import React, { useState, useCallback } from 'react';
import { Card, Button, Spin, Tag, Space, Typography, Alert, Progress } from 'antd';
import {
  ScanOutlined, EyeOutlined, CheckCircleOutlined,
  HomeOutlined, LayoutOutlined, SunOutlined, BoxPlotOutlined,
} from '@ant-design/icons';

const { Text, Title, Paragraph } = Typography;

// ==================== 类型定义 ====================

export interface DetectedElement {
  id: string;
  name: string;
  category: 'furniture' | 'wall' | 'floor' | 'lighting' | 'decor' | 'window';
  bounds: {
    x: number; // 百分比 0-100
    y: number;
    width: number;
    height: number;
  };
  confidence: number;
  editable: boolean;
  description: string;
}

export interface SpaceAnalysis {
  roomType: string;
  area: string;
  style: string;
  layoutScore: number;
  lighting: {
    level: '充足' | '一般' | '不足';
    direction: string;
    suggestions: string[];
  };
  colorScheme: {
    dominant: string;
    secondary: string;
    accent: string;
  };
  painPoints: string[];
  suggestions: string[];
}

export interface VisionAnalysisResult {
  elements: DetectedElement[];
  space: SpaceAnalysis;
  rawDescription: string;
  timestamp: number;
}

interface VisionAnalyzerProps {
  imageUrl: string;
  onAnalysisComplete?: (result: VisionAnalysisResult) => void;
  onElementSelect?: (element: DetectedElement) => void;
}

// ==================== 组件 ====================

export const VisionAnalyzer: React.FC<VisionAnalyzerProps> = ({
  imageUrl,
  onAnalysisComplete,
  onElementSelect,
}) => {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<VisionAnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedElement, setSelectedElement] = useState<string | null>(null);

  // 真实调用 Vision API 分析图像
  const analyzeImage = useCallback(async () => {
    if (!imageUrl) return;
    
    setIsAnalyzing(true);
    setProgress(0);
    setError(null);
    
    try {
      // 模拟进度
      const progressInterval = setInterval(() => {
        setProgress(p => Math.min(p + 10, 80));
      }, 300);

      // 调用后端 Vision API (通过 /v1/chat 接口)
      const response = await fetch('/v1/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `请分析这张室内装修照片的URL: ${imageUrl}。识别房间类型、装修风格、家具元素、色彩方案、采光情况。按JSON格式返回: {"roomType":"客厅","area":"20-30平米","style":"现代简约","layoutScore":85,"lighting":{"level":"充足","direction":"南向","suggestions":["建议1"]},"colorScheme":{"dominant":"白色","secondary":"灰色","accent":"木色"},"painPoints":["痛点1"],"suggestions":["建议1"],"elements":[{"name":"沙发","category":"furniture","bounds":{"x":10,"y":20,"width":30,"height":25},"confidence":0.9,"editable":true,"description":"灰色布艺沙发"}]}`,
          model: 'agnes-2.5-flash',
          stream: false,
        }),
      });

      if (!response.ok) throw new Error(`Vision API 失败: ${response.status}`);
      const data = await response.json();
      const content = data.content || data.message || '';
      
      clearInterval(progressInterval);
      setProgress(100);

      // 解析 JSON 响应
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        
        const analysisResult: VisionAnalysisResult = {
          elements: parsed.elements?.map((e: any, idx: number) => ({
            id: `elem-${idx}`,
            name: e.name,
            category: e.category,
            bounds: e.bounds,
            confidence: e.confidence,
            editable: e.editable,
            description: e.description,
          })) || [],
          space: {
            roomType: parsed.roomType || '未知',
            area: parsed.area || '未知',
            style: parsed.style || '未知',
            layoutScore: parsed.layoutScore || 70,
            lighting: parsed.lighting || { level: '一般', direction: '未知', suggestions: [] },
            colorScheme: parsed.colorScheme || { dominant: '未知', secondary: '未知', accent: '未知' },
            painPoints: parsed.painPoints || [],
            suggestions: parsed.suggestions || [],
          },
          rawDescription: content,
          timestamp: Date.now(),
        };

        setResult(analysisResult);
        onAnalysisComplete?.(analysisResult);
      } else {
        throw new Error('无法解析分析结果');
      }
    } catch (err: any) {
      setError(err.message || '分析失败');
      console.error('Vision analysis error:', err);
    } finally {
      setIsAnalyzing(false);
    }
  }, [imageUrl, onAnalysisComplete]);

  // 选择元素
  const handleElementClick = (element: DetectedElement) => {
    setSelectedElement(element.id);
    onElementSelect?.(element);
  };

  // 渲染分析中状态
  if (isAnalyzing) {
    return (
      <Card style={{ height: '100%', background: 'var(--card)' }}>
        <div style={{ textAlign: 'center', padding: '40px 20px' }}>
          <Spin size="large" />
          <div style={{ marginTop: 24 }}>
            <Title level={5}>AI 正在分析空间...</Title>
            <Paragraph type="secondary">
              识别家具布局 · 分析采光条件 · 评估空间利用率
            </Paragraph>
          </div>
          <Progress percent={progress} status="active" style={{ maxWidth: 300, margin: '20px auto' }} />
          <div style={{ display: 'flex', justifyContent: 'center', gap: 24, marginTop: 16 }}>
            <div style={{ textAlign: 'center' }}>
              <EyeOutlined style={{ fontSize: 24, color: 'var(--accent)' }} />
              <div style={{ fontSize: 12, marginTop: 4 }}>视觉识别</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <LayoutOutlined style={{ fontSize: 24, color: 'var(--accent)' }} />
              <div style={{ fontSize: 12, marginTop: 4 }}>布局分析</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <HomeOutlined style={{ fontSize: 24, color: 'var(--accent)' }} />
              <div style={{ fontSize: 12, marginTop: 4 }}>风格判断</div>
            </div>
          </div>
        </div>
      </Card>
    );
  }

  // 渲染错误状态
  if (error) {
    return (
      <Card style={{ height: '100%', background: 'var(--card)' }}>
        <Alert
          message="分析失败"
          description={error}
          type="error"
          showIcon
          action={
            <Button size="small" onClick={analyzeImage}>
              重试
            </Button>
          }
        />
      </Card>
    );
  }

  // 渲染未分析状态
  if (!result) {
    return (
      <Card style={{ height: '100%', background: 'var(--card)' }}>
        <div style={{ textAlign: 'center', padding: '60px 20px' }}>
          <ScanOutlined style={{ fontSize: 48, color: 'var(--accent)', opacity: 0.6 }} />
          <Title level={5} style={{ marginTop: 24 }}>空间智能分析</Title>
          <Paragraph type="secondary">
            AI 将识别房间中的可编辑元素<br />
            分析布局、采光、风格，并给出改进建议
          </Paragraph>
          <Button 
            type="primary" 
            size="large"
            icon={<EyeOutlined />}
            onClick={analyzeImage}
            style={{ marginTop: 16 }}
          >
            开始分析
          </Button>
        </div>
      </Card>
    );
  }

  // 渲染分析结果
  return (
    <Card 
      style={{ height: '100%', background: 'var(--card)', overflow: 'auto' }}
      title={
        <Space>
          <CheckCircleOutlined style={{ color: '#52c41a' }} />
          <span>分析完成</span>
        </Space>
      }
      extra={
        <Button size="small" onClick={analyzeImage}>
          重新分析
        </Button>
      }
    >
      {/* 空间概览 */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <HomeOutlined style={{ color: 'var(--accent)' }} />
          <Text strong>{result.space.roomType}</Text>
          <Tag>{result.space.area}</Tag>
          <Tag color="blue">{result.space.style}</Tag>
        </div>
        
        <div style={{ 
          padding: 12, 
          background: 'var(--bg)', 
          borderRadius: 8,
          marginBottom: 12 
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <LayoutOutlined style={{ color: 'var(--accent)' }} />
            <Text strong>布局评分</Text>
            <div style={{ flex: 1 }}>
              <Progress 
                percent={result.space.layoutScore} 
                size="small"
                strokeColor={result.space.layoutScore >= 80 ? '#52c41a' : result.space.layoutScore >= 60 ? '#faad14' : '#ff4d4f'}
              />
            </div>
          </div>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <SunOutlined style={{ color: 'var(--accent)' }} />
            <Text strong>采光条件</Text>
            <Tag color={result.space.lighting.level === '充足' ? 'green' : result.space.lighting.level === '一般' ? 'orange' : 'red'}>
              {result.space.lighting.level}
            </Tag>
            <Text type="secondary" style={{ fontSize: 12 }}>{result.space.lighting.direction}</Text>
          </div>
        </div>

        {/* 配色方案 */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {['dominant', 'secondary', 'accent'].map((key) => {
            const color = result.space.colorScheme[key as keyof typeof result.space.colorScheme];
            return (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <div style={{
                  width: 20,
                  height: 20,
                  borderRadius: 4,
                  background: color.startsWith('#') ? color : '#ccc',
                  border: '1px solid var(--border)'
                }} />
                <Text style={{ fontSize: 12 }}>{color}</Text>
              </div>
            );
          })}
        </div>
      </div>

      {/* 可编辑元素 */}
      <div style={{ marginBottom: 20 }}>
        <Title level={5} style={{ marginBottom: 12 }}>
          <BoxPlotOutlined style={{ marginRight: 8 }} />
          识别到的元素 ({result.elements.length})
        </Title>
        
        <Space wrap>
          {result.elements.map((element) => (
            <Tag
              key={element.id}
              color={selectedElement === element.id ? 'blue' : element.editable ? 'default' : 'default'}
              style={{ 
                cursor: element.editable ? 'pointer' : 'default',
                padding: '4px 12px',
                fontSize: 13,
                border: selectedElement === element.id ? '2px solid var(--accent)' : undefined,
              }}
              onClick={() => element.editable && handleElementClick(element)}
            >
              {element.name}
              {element.editable && <span style={{ marginLeft: 4, opacity: 0.6 }}>✎</span>}
            </Tag>
          ))}
        </Space>
      </div>

      {/* 空间痛点 */}
      {result.space.painPoints.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <Title level={5} style={{ marginBottom: 12, color: '#ff4d4f' }}>
            空间痛点
          </Title>
          <ul style={{ paddingLeft: 20, margin: 0 }}>
            {result.space.painPoints.map((point, idx) => (
              <li key={idx} style={{ marginBottom: 4, color: 'var(--fg)' }}>{point}</li>
            ))}
          </ul>
        </div>
      )}

      {/* 改进建议 */}
      {result.space.suggestions.length > 0 && (
        <div>
          <Title level={5} style={{ marginBottom: 12, color: '#52c41a' }}>
            AI 建议
          </Title>
          <ul style={{ paddingLeft: 20, margin: 0 }}>
            {result.space.suggestions.map((suggestion, idx) => (
              <li key={idx} style={{ marginBottom: 4, color: 'var(--fg)' }}>{suggestion}</li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
};

export default VisionAnalyzer;
