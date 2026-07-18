/**
 * AIInjectContextPanel — AI上下文注入面板
 * 
 * 功能:
 *   1. 管理AI上下文注入规则
 *   2. 配置自动上下文收集
 *   3. 查看上下文历史
 */

import React, { useState } from 'react';
import { Card, List, Tag, Switch, Button, Space, Typography } from 'antd';
import { FileTextOutlined, CodeOutlined, GlobalOutlined } from '@ant-design/icons';

const { Title, Text } = Typography;

interface ContextRule {
  id: string;
  name: string;
  type: 'file' | 'code' | 'web';
  pattern: string;
  enabled: boolean;
}

export const AIInjectContextPanel: React.FC = () => {
  const [rules, setRules] = useState<ContextRule[]>([
    { id: '1', name: '项目README', type: 'file', pattern: 'README.md', enabled: true },
    { id: '2', name: 'package.json', type: 'file', pattern: 'package.json', enabled: true },
    { id: '3', name: '当前打开文件', type: 'code', pattern: '${currentFile}', enabled: true },
  ]);

  const toggleRule = (id: string) => {
    setRules(rules.map(r => r.id === id ? { ...r, enabled: !r.enabled } : r));
  };

  const getIcon = (type: string) => {
    switch (type) {
      case 'file': return <FileTextOutlined />;
      case 'code': return <CodeOutlined />;
      case 'web': return <GlobalOutlined />;
      default: return null;
    }
  };

  return (
    <Card title="AI上下文注入" style={{ margin: 24 }}>
      <List
        dataSource={rules}
        renderItem={item => (
          <List.Item
            actions={[
              <Switch checked={item.enabled} onChange={() => toggleRule(item.id)} />
            ]}
          >
            <List.Item.Meta
              avatar={getIcon(item.type)}
              title={item.name}
              description={<Tag>{item.pattern}</Tag>}
            />
          </List.Item>
        )}
      />
    </Card>
  );
};

export default AIInjectContextPanel;
