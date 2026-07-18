/**
 * MemoryFilesPanel — 记忆文件面板
 * 
 * 功能:
 *   1. 展示AI记忆的文件
 *   2. 管理记忆内容
 *   3. 快速访问重要文件
 */

import React, { useState } from 'react';
import { Card, List, Tag, Button, Space, Typography, Input } from 'antd';
import { FileOutlined, SearchOutlined, DeleteOutlined } from '@ant-design/icons';

const { Title, Text } = Typography;
const { Search } = Input;

interface MemoryFile {
  id: string;
  path: string;
  type: string;
  lastAccessed: string;
  importance: 'high' | 'medium' | 'low';
}

export const MemoryFilesPanel: React.FC = () => {
  const [files, setFiles] = useState<MemoryFile[]>([
    { id: '1', path: '/project/README.md', type: 'markdown', lastAccessed: '2026-07-17 15:00', importance: 'high' },
    { id: '2', path: '/src/config.ts', type: 'typescript', lastAccessed: '2026-07-17 14:30', importance: 'medium' },
    { id: '3', path: '/docs/API.md', type: 'markdown', lastAccessed: '2026-07-17 10:00', importance: 'medium' },
  ]);
  const [searchQuery, setSearchQuery] = useState('');

  const filteredFiles = files.filter(f => f.path.includes(searchQuery));

  const removeFile = (id: string) => {
    setFiles(files.filter(f => f.id !== id));
  };

  const getTagColor = (importance: string) => {
    switch (importance) {
      case 'high': return 'red';
      case 'medium': return 'orange';
      case 'low': return 'blue';
      default: return 'default';
    }
  };

  return (
    <div>
      <Space style={{ marginBottom: 16, width: '100%' }}>
        <Search
          placeholder="搜索记忆文件"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          style={{ width: 200 }}
        />
      </Space>
      <List
        dataSource={filteredFiles}
        renderItem={item => (
          <List.Item
            actions={[
              <Button icon={<DeleteOutlined />} size="small" danger onClick={() => removeFile(item.id)} />
            ]}
          >
            <List.Item.Meta
              avatar={<FileOutlined />}
              title={
                <Space>
                  <Text>{item.path}</Text>
                  <Tag color={getTagColor(item.importance)}>{item.importance}</Tag>
                </Space>
              }
              description={`最后访问: ${item.lastAccessed}`}
            />
          </List.Item>
        )}
      />
    </div>
  );
};

export default MemoryFilesPanel;
