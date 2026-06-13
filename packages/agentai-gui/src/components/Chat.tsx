/**
 * Chat (DEPRECATED)
 * ----------------------------------------------------
 * 旧版聊天组件, 已由 ChatView.tsx 替代.
 * 此组件保留仅为向后兼容编译, 内部已注释掉所有实际逻辑.
 */
import React from 'react';
import { Card, Empty } from 'antd';

export const Chat: React.FC = () => {
  return (
    <Card title="Chat (Deprecated)" style={{ padding: 20 }}>
      <Empty description="此组件已弃用, 请使用 ChatView.tsx" />
    </Card>
  );
};
