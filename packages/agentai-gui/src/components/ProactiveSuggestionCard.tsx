/**
 * ProactiveSuggestionCard.tsx
 * ✨ 颠覆性主动建议卡片组件
 */

import React, { useState, useEffect } from 'react';
import { Card, Tag, Button, Tooltip, Space, Modal, List, Progress, Badge } from 'antd';
import {
  ThunderboltFilled,
  RocketOutlined,
  BulbOutlined,
  StarOutlined,
  CheckCircleOutlined,
  CloseOutlined,
  ArrowRightOutlined
} from '@ant-design/icons';
import { Suggestion } from './ProactiveSuggestionsPanel';

interface Props {
  suggestion: Suggestion;
  onAccept: (suggestion: Suggestion) => void;
  onDismiss: (suggestionId: string) => void;
}

const ProactiveSuggestionCard: React.FC<Props> = ({ suggestion, onAccept, onDismiss }) => {
  // 防御性空值检查
  if (!suggestion || !suggestion.context) {
    return null;
  }

  const [expanded, setExpanded] = useState(false);
  const [impactBreakdown, setImpactBreakdown] = useState(false);

  // ✨ 动态效果状态
  const [glowing, setGlowing] = useState(false);
  useEffect(() => {
    if (suggestion.context.urgency > 0.8) {
      const interval = setInterval(() => {
        setGlowing(prev => !prev);
      }, 1500);
      return () => clearInterval(interval);
    }
  }, [suggestion.context.urgency]);

  // ✨ 优先级映射
  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'critical': return '#ff4d4f';
      case 'high': return '#ff7a45';
      case 'medium': return '#1890ff';
      case 'low': return '#52c41a';
      default: return '#d9d9d9';
    }
  };

  const getPriorityIcon = (priority: string) => {
    switch (priority) {
      case 'critical': return <ThunderboltFilled />;
      case 'high': return <RocketOutlined />;
      case 'medium': return <BulbOutlined />;
      case 'low': return <StarOutlined />;
      default: return <StarOutlined />;
    }
  };

  // ✨ 类别图标映射
  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'task_prediction': return '🔮';
      case 'resource_optimization': return '⚡';
      case 'decision_support': return '🎯';
      case 'innovation_opportunity': return '🚀';
      case 'knowledge_linking': return '🧠';
      default: return '💡';
    }
  };

  // ✨ 紧急性量化条
  const getUrgencyBar = () => (
    <div style={{ margin: '12px 0' }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        marginBottom: 4,
        fontSize: 12,
        color: '#8c8c8c'
      }}>
        <span>紧急性</span>
        <span>{(suggestion.context.urgency * 100).toFixed(0)}%</span>
      </div>
      <Progress
        percent={suggestion.context.urgency * 100}
        size="small"
        strokeColor={{
          '0%': '#108ee9',
          '100%': '#87d068',
        }}
        style={{ marginBottom: 0 }}
      />
    </div>
  );

  // ✨ 影响雷达图 (简化版)
  const getImpactDisplay = () => {
    const { impact } = suggestion.context;
    const maxVal = Math.max(impact.user_experience, impact.efficiency, impact.cost_saving, impact.business_value);

    return (
      <div style={{ margin: '12px 0' }}>
        <div style={{ fontSize: 12, color: '#8c8c8c', marginBottom: 8 }}>预期价值</div>
        <div style={{ display: 'flex', gap: 8, fontSize: 11 }}>
          <Tag color={impact.user_experience > 0.7 ? 'green' : 'default'}>
            体验 {(impact.user_experience * 100).toFixed(0)}%
          </Tag>
          <Tag color={impact.efficiency > 0.7 ? 'blue' : 'default'}>
            效率 {(impact.efficiency * 100).toFixed(0)}%
          </Tag>
          <Tag color={impact.cost_saving > 0.7 ? 'orange' : 'default'}>
            成本 {(impact.cost_saving * 100).toFixed(0)}%
          </Tag>
          <Tag color={impact.business_value > 0.7 ? 'purple' : 'default'}>
            业务 {(impact.business_value * 100).toFixed(0)}%
          </Tag>
        </div>
      </div>
    );
  };

  // ✨ 预估工作量
  const getEffortDisplay = () => {
    const hours = suggestion.context.metadata?.estimated_effort;
    if (!hours) return null;

    let color = '#52c41a';
    let label = '轻松';
    if (hours > 8) {
      color = '#ff4d4f';
      label = '艰巨';
    } else if (hours > 4) {
      color = '#faad14';
      label = '中等';
    }

    return (
      <Tag color={color} style={{ marginLeft: 8 }}>
        ⏱️ {hours}h · {label}
      </Tag>
    );
  };

  return (
    <>
      <Card
        style={{
          margin: '16px 0',
          borderRadius: 12,
          border: expanded ? '2px solid #1890ff' : '1px solid #f0f0f0',
          boxShadow: expanded
            ? '0 4px 16px rgba(24, 144, 255, 0.15)'
            : glowing && suggestion.priority === 'critical'
            ? '0 4px 16px rgba(255, 77, 79, 0.3)'
            : '0 2px 8px rgba(0, 0, 0, 0.06)',
          transition: 'all 0.3s cubic-bezier(0.645, 0.045, 0.355, 1)',
          background: expanded
            ? 'linear-gradient(135deg, #f6f9fc 0%, #e9f4ff 100%)'
            : '#fff'
        }}
        bodyStyle={{ padding: expanded ? 20 : 16 }}
      >
        {/* ✨ 卡片头部 */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{
            fontSize: 24,
            background: 'linear-gradient(135deg, #1890ff 0%, #36cfc9 100%)',
            borderRadius: 20,
            width: 40,
            height: 40,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            flexShrink: 0
          }}>
            {suggestion.icon}
          </div>

          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontWeight: 600, fontSize: 16 }}>
                {suggestion.title}
              </span>
              <Badge
                count={suggestion.priority.toUpperCase()}
                color={getPriorityColor(suggestion.priority)}
                style={{ fontSize: 10 }}
              />
              {getEffortDisplay()}
            </div>

            <div style={{ fontSize: 14, color: '#595959', marginBottom: expanded ? 12 : 0 }}>
              {expanded ? suggestion.description : suggestion.description.slice(0, 120) + (suggestion.description.length > 120 ? '...' : '')}
            </div>
          </div>

          <Space>
            <Button
              type="text"
              icon={<ArrowRightOutlined />}
              onClick={() => setExpanded(!expanded)}
              style={{ color: '#1890ff' }}
            >
              {expanded ? '收起' : '展开'}
            </Button>
            <Button
              type="text"
              icon={<CloseOutlined />}
              onClick={() => onDismiss(suggestion.id)}
              style={{ color: '#ff4d4f' }}
            />
          </Space>
        </div>

        {/* ✨ 展开部分 */}
        {expanded && (
          <div style={{ marginTop: 16 }}>
            {getUrgencyBar()}
            {getImpactDisplay()}

            {/* ✨ 关联信息 */}
            {suggestion.context.metadata?.related_tasks && (
              <div style={{ margin: '12px 0' }}>
                <div style={{ fontSize: 12, color: '#8c8c8c', marginBottom: 6 }}>前置依赖</div>
                <Space wrap>
                  {suggestion.context.metadata.related_tasks.map((task: string, idx: number) => (
                    <Tag key={idx}>{task}</Tag>
                  ))}
                </Space>
              </div>
            )}

            {/* ✨ 操作按钮 */}
            <div style={{ marginTop: 16, textAlign: 'right' }}>
              <Button
                type="primary"
                icon={<CheckCircleOutlined />}
                onClick={() => onAccept(suggestion)}
                style={{
                  borderRadius: 8,
                  background: 'linear-gradient(135deg, #52c41a 0%, #73d13d 100%)',
                  border: 'none'
                }}
              >
                立即采纳建议
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* ✨ 浮动操作面板 (高紧急性建议特有) */}
      {suggestion.priority === 'critical' && (
        <div
          style={{
            position: 'fixed',
            bottom: 24,
            right: 24,
            background: 'linear-gradient(135deg, #ff4d4f 0%, #ff7875 100%)',
            color: '#fff',
            borderRadius: 50,
            padding: '12px 20px',
            boxShadow: '0 8px 24px rgba(255, 77, 79, 0.3)',
            cursor: 'pointer',
            zIndex: 1000,
            animation: glowing ? 'pulse 2s infinite' : 'none'
          }}
          onClick={() => setExpanded(true)}
        >
          <Space>
            <ThunderboltFilled />
            <span style={{ fontWeight: 600 }}>紧急建议待处理</span>
          </Space>
        </div>
      )}

      {/* ✨ 全局样式 */}
      <style>{`
        @keyframes pulse {
          0% { transform: scale(1); }
          50% { transform: scale(1.05); }
          100% { transform: scale(1); }
        }
      `}</style>
    </>
  );
};

export { ProactiveSuggestionCard };
export default ProactiveSuggestionCard;