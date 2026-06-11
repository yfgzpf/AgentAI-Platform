import { useState, useEffect, useRef, useCallback } from 'react';
import { Input, Button, Tooltip } from 'antd';
import { SendOutlined, StopOutlined } from '@ant-design/icons';

interface ChatInputProps {
  onSend: (text: string) => void;
  onStop?: () => void;
  loading?: boolean;
  disabled?: boolean;
  placeholder?: string;
}

export const ChatInput: React.FC<ChatInputProps> = ({ onSend, onStop, loading, disabled, placeholder }) => {
  const [value, setValue] = useState('');
  const inputRef = useRef<any>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleSend = useCallback(() => {
    const text = value.trim();
    if (!text || loading || disabled) return;
    setValue('');
    onSend(text);
  }, [value, loading, disabled, onSend]);

  return (
    <div style={{ display: 'flex', gap: 8, padding: '12px 16px', borderTop: '1px solid var(--color-border)' }}>
      <Input.TextArea
        ref={inputRef}
        value={value}
        onChange={e => setValue(e.target.value)}
        onPressEnter={e => { if (!e.shiftKey) { e.preventDefault(); handleSend(); } }}
        placeholder={placeholder || '输入消息...'}
        disabled={disabled}
        autoSize={{ minRows: 1, maxRows: 6 }}
        style={{ flex: 1, borderRadius: 8, fontSize: 14 }}
      />
      {loading ? (
        <Tooltip title="停止">
          <Button icon={<StopOutlined />} shape="circle" danger onClick={onStop} />
        </Tooltip>
      ) : (
        <Tooltip title="发送">
          <Button type="primary" icon={<SendOutlined />} shape="circle" onClick={handleSend} disabled={!value.trim() || disabled} />
        </Tooltip>
      )}
    </div>
  );
};
