/**
 * DecorAI v4.0 — AI驱动的装修方案可视化平台
 * 
 * 核心流程:
 *   Step 1: 灵感引擎 → 用户上传图/描述 → AI解析 → 生成3档方案
 *   Step 2: 智能编辑 → Vision分析 → 选中元素 → AI精准修改
 * 
 * 差异化价值:
 *   - Vision真实分析：识别真实元素，非随机模拟
 *   - 精准编辑：选中即改，对接真实AI图像编辑API
 *   - 从灵感到落地：一键贯通，真实可用
 */

import React, { useState } from 'react';
import { Button, Space, Tag, Typography, Steps, Card, Upload } from 'antd';
import {
  BulbOutlined, EditOutlined, CheckCircleOutlined,
  ArrowRightOutlined, HomeOutlined, DollarOutlined,
  UploadOutlined, EyeOutlined,
} from '@ant-design/icons';
import { InspirationEngine, BudgetTier } from './InspirationEngine';
import { SmartEditor } from './SmartEditor';

const { Title, Paragraph } = Typography;
const { Step } = Steps;

// ==================== 主组件 ====================

type AppStep = 'inspiration' | 'editing' | 'final';

export const DecorAI: React.FC = () => {
  const [currentStep, setCurrentStep] = useState<AppStep>('inspiration');
  const [selectedTier, setSelectedTier] = useState<BudgetTier | null>(null);

  // 选择方案，进入编辑
  const handleSelectTier = (tier: BudgetTier) => {
    setSelectedTier(tier);
    setCurrentStep('editing');
  };

  // 返回灵感引擎
  const handleBack = () => {
    setCurrentStep('inspiration');
    setSelectedTier(null);
  };

  // 渲染步骤指示器
  const renderSteps = () => (
    <div style={{ 
      padding: '16px 24px', 
      borderBottom: '1px solid var(--border)',
      background: 'var(--card)',
    }}>
      <Steps
        size="small"
        current={currentStep === 'inspiration' ? 0 : currentStep === 'editing' ? 1 : 2}
        items={[
          {
            title: '灵感捕捉',
            icon: <BulbOutlined />,
            description: '上传参考图或描述需求',
          },
          {
            title: '方案编辑',
            icon: <EditOutlined />,
            description: '实时调整细节',
          },
          {
            title: '方案确定',
            icon: <CheckCircleOutlined />,
            description: '导出详细报价',
          },
        ]}
      />
    </div>
  );

  // 渲染主内容区
  const renderContent = () => {
    switch (currentStep) {
      case 'inspiration':
        return (
          <InspirationEngine
            onSelectTier={handleSelectTier}
            onEditRequest={(request) => {
              // 如果用户想直接编辑, 跳转到编辑步骤
              if (selectedTier) {
                setCurrentStep('editing');
              }
            }}
          />
        );
      
      case 'editing':
        return selectedTier ? (
          <SmartEditor
            initialImageUrl={selectedTier.imageUrl}
            onBack={handleBack}
            onSave={(history) => {
              // 保存方案到本地存储
              try {
                const saved = JSON.parse(localStorage.getItem('decorai-saved') || '[]');
                saved.push({ tier: selectedTier.name, history, savedAt: Date.now() });
                localStorage.setItem('decorai-saved', JSON.stringify(saved.slice(-10)));
              } catch {}
              setCurrentStep('final');
            }}
          />
        ) : null;
      
      case 'final':
        return (
          <div style={{ padding: 48, textAlign: 'center' }}>
            <Card style={{ maxWidth: 600, margin: '0 auto' }}>
              <div style={{ fontSize: 64, marginBottom: 16 }}>🎉</div>
              <Title level={3}>方案已完成！</Title>
              <Paragraph type="secondary">
                你的装修方案已保存，可以导出详细报价单或分享给家人查看。
              </Paragraph>
              <Space style={{ marginTop: 24 }}>
                <Button type="primary" icon={<DollarOutlined />}>
                  导出报价单
                </Button>
                <Button icon={<HomeOutlined />} onClick={handleBack}>
                  再做一版方案
                </Button>
              </Space>
            </Card>
          </div>
        );
    }
  };

  return (
    <div style={{ 
      height: '100%', 
      display: 'flex', 
      flexDirection: 'column',
      background: 'var(--bg)',
    }}>
      {/* 顶部标题栏 */}
      <div style={{
        height: 56,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 24px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--card)',
      }}>
        <Space>
          <div style={{
            width: 36,
            height: 36,
            borderRadius: 8,
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            fontSize: 18,
          }}>
            🏠
          </div>
          <div>
            <Title level={5} style={{ margin: 0, fontSize: 16 }}>DecorAI</Title>
            <Paragraph type="secondary" style={{ margin: 0, fontSize: 11 }}>
              AI驱动的装修方案平台
            </Paragraph>
          </div>
        </Space>

        <Space>
          <Tag color="blue">v3.0</Tag>
          {selectedTier && (
            <Tag color="orange">
              <DollarOutlined /> {selectedTier.name} · ¥{(selectedTier.budget / 10000).toFixed(0)}万
            </Tag>
          )}
        </Space>
      </div>

      {/* 步骤指示器 */}
      {renderSteps()}

      {/* 主内容区 */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {renderContent()}
      </div>
    </div>
  );
};

export default DecorAI;
