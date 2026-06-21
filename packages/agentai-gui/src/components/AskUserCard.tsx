/**
 * AskUserCard — AI 追问问卷卡片
 * ----------------------------------------------------
 * 当 AI 调用 ask_user 工具时，前端展示此卡片让用户回答问题。
 * 支持单选和多选模式。
 *
 * 新增功能 (AI自操作系统):
 *   - 密钥输入框（密码隐藏）
 *   - "信任此密钥"复选框
 *   - 密钥获取地址链接（可点击跳转）
 */
import React, { useState } from 'react';
import { Card, Button, Tag, Space, Radio, Checkbox, Input, message, Switch } from 'antd';
import { QuestionCircleOutlined, CheckOutlined, SendOutlined, KeyOutlined, LinkOutlined, SafetyOutlined, CloseOutlined } from '@ant-design/icons';

interface OptionItem {
  id: string;
  title: string;
  description?: string;
}

interface Props {
  question: string;
  options?: OptionItem[];
  multiSelect?: boolean;
  onAnswer: (answer: string | string[]) => void;
  onClose?: () => void;
  sessionId?: string;
}

export const AskUserCard: React.FC<Props> = ({
  question,
  options = [],
  multiSelect = false,
  onAnswer,
  onClose,
  sessionId,
}) => {
  const [selected, setSelected] = useState<string | string[]>(multiSelect ? [] : '');
  const [customInput, setCustomInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [trustKey, setTrustKey] = useState(false);

  // 检测是否是密钥获取问卷
  const isApiKeyQuestion = question.includes('密钥') || question.includes('API Key') || question.includes('密钥才能');

  // 提取密钥获取地址（从options中查找）
  const getKeyUrl = (): string | null => {
    const getKeyOption = options.find(opt => opt.id === 'get_key' || opt.title.includes('获取密钥'));
    if (getKeyOption?.description) {
      const urlMatch = getKeyOption.description.match(/https?:\/\/[^\s]+/);
      return urlMatch ? urlMatch[0] : null;
    }
    return null;
  };
  const keyUrl = getKeyUrl();

  const handleAnswer = () => {
    setLoading(true);
    let answer: string | string[];

    // 密钥问卷特殊处理
    if (isApiKeyQuestion && selected === 'provide_key') {
      if (!apiKey.trim()) {
        message.warning('请输入API密钥');
        setLoading(false);
        return;
      }
      // 返回密钥信息（包含trust字段）
      onAnswer({
        id: 'provide_key',
        apiKey: apiKey.trim(),
        trust: trustKey,
      } as any);
      return;
    }

    if (options.length > 0) {
      // 有选项的情况
      if (multiSelect) {
        answer = selected as string[];
        if (customInput.trim()) {
          answer = [...answer, customInput.trim()];
        }
      } else {
        answer = selected as string;
        // 修复: 选中选项 + 自定义输入时，合并发送
        if (customInput.trim()) {
          answer = answer ? `${answer}\n${customInput.trim()}` : customInput.trim();
        }
      }
    } else {
      // 无选项的情况，纯文本输入
      answer = customInput.trim();
    }

    if (!answer || (Array.isArray(answer) && answer.length === 0)) {
      message.warning('请选择或输入答案');
      setLoading(false);
      return;
    }

    // 调用回调，将答案发送回 AI
    onAnswer(answer);
  };

  // 单选处理
  const handleRadioChange = (e: any) => {
    setSelected(e.target.value);
  };

  // 多选处理
  const handleCheckboxChange = (checkedValues: string[]) => {
    setSelected(checkedValues);
  };

  return (
    <Card
      size="small"
      style={{
        margin: '8px 0',
        borderLeft: '3px solid #4f46e5',
        background: '#141414',
      }}
      title={
        <Space>
          <QuestionCircleOutlined style={{ color: '#4f46e5' }} />
          <span>AI 追问</span>
          {sessionId && <Tag color="blue">{sessionId.slice(0, 8)}</Tag>}
        </Space>
      }
      extra={
        <Space size={4}>
          <Button
            size="small"
            type="primary"
            icon={<SendOutlined />}
            loading={loading}
            onClick={handleAnswer}
          >
            回答
          </Button>
          {onClose && (
            <Button
              size="small"
              type="text"
              icon={<CloseOutlined />}
              onClick={onClose}
              style={{ color: 'var(--muted)' }}
            />
          )}
        </Space>
      }
    >
      {/* 问题内容 */}
      <div style={{
        fontSize: 14,
        color: '#ddd',
        marginBottom: 12,
        padding: '8px 12px',
        background: '#0d0d0d',
        borderRadius: 6,
        border: '1px solid rgba(79,70,229,0.2)',
      }}>
        {question}
      </div>

      {/* 选项区域 */}
      {options.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          {multiSelect ? (
            <Checkbox.Group
              value={selected as string[]}
              onChange={handleCheckboxChange}
              style={{ width: '100%' }}
            >
              <Space direction="vertical" style={{ width: '100%' }}>
                {options.map((opt) => (
                  <Checkbox
                    key={opt.id}
                    value={opt.id}
                    style={{ fontSize: 13, color: '#ddd' }}
                  >
                    <span style={{ fontWeight: 500 }}>{opt.title}</span>
                    {opt.description && (
                      <span style={{ fontSize: 11, color: '#888', marginLeft: 8 }}>
                        — {opt.description}
                      </span>
                    )}
                  </Checkbox>
                ))}
              </Space>
            </Checkbox.Group>
          ) : (
            <Radio.Group
              value={selected as string}
              onChange={handleRadioChange}
              style={{ width: '100%' }}
            >
              <Space direction="vertical" style={{ width: '100%' }}>
                {options.map((opt) => (
                  <Radio
                    key={opt.id}
                    value={opt.id}
                    style={{ fontSize: 13, color: '#ddd' }}
                  >
                    <span style={{ fontWeight: 500 }}>{opt.title}</span>
                    {opt.description && (
                      <span style={{ fontSize: 11, color: '#888', marginLeft: 8 }}>
                        — {opt.description}
                      </span>
                    )}
                  </Radio>
                ))}
              </Space>
            </Radio.Group>
          )}
        </div>
      )}

      {/* 自由输入区域 */}
      <div style={{
        marginTop: 8,
        padding: '8px 12px',
        background: 'rgba(79,70,229,0.06)',
        borderRadius: 6,
        border: '1px solid rgba(79,70,229,0.15)',
      }}>
        {/* 密钥输入框（如果是密钥问卷且选择了"提供密钥"） */}
        {isApiKeyQuestion && selected === 'provide_key' && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: '#4f46e5', marginBottom: 6, fontWeight: 500 }}>
              <KeyOutlined style={{ marginRight: 4 }} />
              输入API密钥:
            </div>
            <Input.Password
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="请输入您的API密钥..."
              style={{
                background: '#0d0d0d',
                border: '1px solid #333',
                color: '#ddd',
                fontSize: 12,
              }}
              visibilityToggle={{ visible: false }}
            />
            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
              <SafetyOutlined style={{ color: '#4f46e5', fontSize: 12 }} />
              <Switch
                checked={trustKey}
                onChange={setTrustKey}
                size="small"
                checkedChildren="信任"
                unCheckedChildren="不信任"
              />
              <span style={{ fontSize: 11, color: '#888' }}>
                信任此密钥，后续不再询问
              </span>
            </div>
          </div>
        )}

        {/* 密钥获取地址链接 */}
        {isApiKeyQuestion && keyUrl && (
          <div style={{ marginBottom: 12, fontSize: 12, color: '#4f46e5' }}>
            <LinkOutlined style={{ marginRight: 4 }} />
            <a
              href={keyUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: '#4f46e5', textDecoration: 'underline' }}
            >
              点击前往获取密钥
            </a>
            <span style={{ fontSize: 11, color: '#888', marginLeft: 8 }}>
              (获取后返回此页面输入)
            </span>
          </div>
        )}

        {/* 普通文本输入区域 */}
        {!isApiKeyQuestion && (
          <>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 6 }}>
              {options.length > 0 ? '补充说明 (可选):' : '请输入您的回答:'}
            </div>
            <Input.TextArea
              value={customInput}
              onChange={(e) => setCustomInput(e.target.value)}
              placeholder={options.length > 0 ? '如有补充说明，请在此输入...' : '请输入答案...'}
              autoSize={{ minRows: 1, maxRows: 3 }}
              style={{
                background: '#0d0d0d',
                border: '1px solid #333',
                color: '#ddd',
                fontSize: 12,
              }}
            />
          </>
        )}
      </div>

      {/* 提示 */}
      <div style={{ fontSize: 10, color: '#666', marginTop: 8 }}>
        <CheckOutlined style={{ marginRight: 4 }} />
        选择后点击「回答」将答案发送给 AI，AI 会根据您的回答继续执行任务
      </div>
    </Card>
  );
};