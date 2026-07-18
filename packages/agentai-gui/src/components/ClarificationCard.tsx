/**
 * ClarificationCard — 意图澄清卡片
 * ----------------------------------------------------
 * 当 AI 检测到用户输入有歧义时，展示此卡片让用户澄清
 * 例如："帮我改一下这个" → 追问 "哪个文件？改什么？"
 */
import React, { useState } from 'react';
import { Card, Button, Space, Radio, Input, Typography, Tag } from 'antd';
import { QuestionCircleOutlined, CheckOutlined } from '@ant-design/icons';
import { GATEWAY_HTTP } from '../services/config';

const { Text, Title } = Typography;

export interface ClarificationQuestion {
  id: string;
  question: string;
  options?: string[];
  allowFreeText?: boolean;
  context?: string;
}

export interface ClarificationRequest {
  id: string;
  originalMessage: string;
  questions: ClarificationQuestion[];
  ambiguities: Array<{ type: string; text: string }>;
}

interface Props {
  request: ClarificationRequest;
  onResolved: (id: string) => void;
}

const AMBIGUITY_LABELS: Record<string, string> = {
  vague_verb: '模糊动词',
  unclear_reference: '指代不明',
  unresolved_choice: '未决选择',
  missing_param: '缺少参数',
  conflict: '冲突',
};

const AMBIGUITY_COLORS: Record<string, string> = {
  vague_verb: 'orange',
  unclear_reference: 'blue',
  unresolved_choice: 'purple',
  missing_param: 'cyan',
  conflict: 'red',
};

export const ClarificationCard: React.FC<Props> = ({ request, onResolved }) => {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const handleAnswer = (questionId: string, value: string) => {
    setAnswers(prev => ({ ...prev, [questionId]: value }));
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const res = await fetch(GATEWAY_HTTP + '/v1/clarify/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clarificationId: request.id,
          answers,
        }),
      });
      if (res.ok) {
        onResolved(request.id);
      } else {
        console.error('[ClarificationCard] submit failed:', await res.text());
      }
    } catch (e) {
      console.error('[ClarificationCard] submit error:', e);
    } finally {
      setSubmitting(false);
    }
  };

  const allAnswered = request.questions.every(q => answers[q.id] || q.allowFreeText);

  return (
    <Card
      style={{
        margin: '12px 0',
        border: '1px solid var(--primary)',
        background: 'var(--panel)',
        borderRadius: 12,
      }}
      bodyStyle={{ padding: 16 }}
    >
      {/* 头部：歧义类型标签 */}
      <div style={{ marginBottom: 12 }}>
        <QuestionCircleOutlined style={{ color: 'var(--primary)', marginRight: 8 }} />
        <Text type="secondary">AI 需要澄清您的意图</Text>
        <div style={{ marginTop: 8 }}>
          {request.ambiguities.map((a, i) => (
            <Tag
              key={i}
              color={AMBIGUITY_COLORS[a.type] || 'default'}
              style={{ marginRight: 8, marginBottom: 4 }}
            >
              {AMBIGUITY_LABELS[a.type] || a.type}: "{a.text}"
            </Tag>
          ))}
        </div>
      </div>

      {/* 原始消息 */}
      <div
        style={{
          padding: 12,
          background: 'var(--bg)',
          borderRadius: 8,
          marginBottom: 16,
          borderLeft: '3px solid var(--primary)',
        }}
      >
        <Text type="secondary" style={{ fontSize: 12 }}>您的输入：</Text>
        <div style={{ marginTop: 4, color: 'var(--fg)' }}>{request.originalMessage}</div>
      </div>

      {/* 问题列表 */}
      <Space direction="vertical" style={{ width: '100%' }} size="large">
        {request.questions.map((q, idx) => (
          <div key={q.id} style={{ width: '100%' }}>
            <Title level={5} style={{ margin: '0 0 8px 0', fontSize: 14 }}>
              {idx + 1}. {q.question}
            </Title>
            {q.context && (
              <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
                {q.context}
              </Text>
            )}

            {/* 选项选择 */}
            {q.options && q.options.length > 0 && (
              <Radio.Group
                value={answers[q.id]}
                onChange={e => handleAnswer(q.id, e.target.value)}
                style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
              >
                {q.options.map(opt => (
                  <Radio key={opt} value={opt} style={{ color: 'var(--fg)' }}>
                    {opt}
                  </Radio>
                ))}
                {q.allowFreeText && (
                  <Radio value="__custom__" style={{ color: 'var(--fg)' }}>
                    其他...
                  </Radio>
                )}
              </Radio.Group>
            )}

            {/* 自由输入 */}
            {(q.allowFreeText || answers[q.id] === '__custom__') && (
              <Input.TextArea
                placeholder="请输入您的回答..."
                value={answers[q.id] === '__custom__' ? '' : answers[q.id]}
                onChange={e => handleAnswer(q.id, e.target.value)}
                rows={2}
                style={{
                  marginTop: 8,
                  background: 'var(--bg)',
                  borderColor: 'var(--border)',
                  color: 'var(--fg)',
                }}
              />
            )}
          </div>
        ))}
      </Space>

      {/* 提交按钮 */}
      <div style={{ marginTop: 20, textAlign: 'right' }}>
        <Button
          type="primary"
          icon={<CheckOutlined />}
          onClick={handleSubmit}
          loading={submitting}
          disabled={!allAnswered}
        >
          确认并继续
        </Button>
      </div>
    </Card>
  );
};
