import React, { useState } from 'react';
import { Input, Button, message } from 'antd';
import { FolderOpenOutlined } from '@ant-design/icons';
import { useProfileStore } from '../store';

export const WorkspaceSelector: React.FC = () => {
  const { profile, setProfile } = useProfileStore();
  const [value, setValue] = useState(profile?.workspace || '');
  const [editing, setEditing] = useState(false);

  const handleSave = () => {
    if (value.trim()) {
      setProfile({ name: profile?.name || 'User', onboardedAt: profile?.onboardedAt || Date.now(), language: profile?.language || 'zh', workspace: value.trim() });
      message.success(`工作区已切换: ${value.trim()}`);
      setEditing(false);
    }
  };

  return (
    <div style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
      <FolderOpenOutlined style={{ color: 'var(--color-text-muted)', fontSize: 14 }} />
      {editing ? (
        <Input
          size="small"
          value={value}
          onChange={e => setValue(e.target.value)}
          onPressEnter={handleSave}
          onBlur={() => setEditing(false)}
          placeholder="输入工作目录路径..."
          autoFocus
          style={{ flex: 1, fontSize: 12 }}
        />
      ) : (
        <span
          onClick={() => { setValue(profile?.workspace || ''); setEditing(true); }}
          style={{ fontSize: 12, color: 'var(--color-text-muted)', cursor: 'pointer', fontFamily: 'monospace' }}
        >
          {profile?.workspace || '点击选择工作目录'}
        </span>
      )}
    </div>
  );
};
