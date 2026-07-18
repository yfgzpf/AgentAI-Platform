/**
 * KnowledgeBasePanel — 行业知识库管理
 * ----------------------------------------------------
 * 用户可上传行业文档（txt/md），AI 在回答时自动检索。
 * 使用 BM25 搜索引擎（本地，无需外部 API）。
 */
import React, { useState, useEffect, useCallback } from 'react';
import { Card, Button, Upload, List, Tag, Typography, Input, Empty, Popconfirm, Space, message as antMsg, Progress, Alert, Tabs } from 'antd';
const KnowledgeGraphPanel = React.lazy(() => import('./knowledge/KnowledgeGraphPanel'));
import { UploadOutlined, DeleteOutlined, SearchOutlined, FileTextOutlined, InboxOutlined, BookOutlined, ReloadOutlined, FileExcelOutlined, FileWordOutlined, FilePdfOutlined } from '@ant-design/icons';
import { gatewayFallback } from '../services/GatewayFallback';

const { Text, Title, Paragraph } = Typography;
const { TextArea } = Input;
const { Dragger } = Upload;

interface KbDocument {
  id: string;
  name: string;
  industry: string;
  addedAt: number;
  charCount: number;
  chunkCount: number;
  source?: string;
  description?: string;
}

interface SearchResult {
  chunk: { docId: string; idx: number; text: string; industry: string };
  score: number;
  docName: string;
}

interface KbStats {
  docCount: number;
  chunkCount: number;
  industries: string[];
}

const base = () => gatewayFallback.url;

export const KnowledgeBasePanel: React.FC = () => {
  const [docs, setDocs] = useState<KbDocument[]>([]);
  const [stats, setStats] = useState<KbStats | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [loading, setLoading] = useState(false);

  // 上传表单
  const [uploadName, setUploadName] = useState('');
  const [uploadIndustry, setUploadIndustry] = useState('');
  const [uploadContent, setUploadContent] = useState('');
  const [fileIndustry, setFileIndustry] = useState('装修建材');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [listResp, statsResp] = await Promise.all([
        fetch(base() + '/v1/knowledge/list'),
        fetch(base() + '/v1/knowledge/stats'),
      ]);
      if (listResp.ok) {
        const listData = await listResp.json();
        setDocs(listData.documents || []);
      }
      if (statsResp.ok) {
        const statsData = await statsResp.json();
        setStats(statsData.stats || null);
      }
    } catch (e: any) {
      console.warn('[knowledge] refresh failed:', e?.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const handleUpload = async () => {
    if (!uploadName.trim() || !uploadIndustry.trim() || !uploadContent.trim()) {
      antMsg.warning('请填写文档名称、行业和内容');
      return;
    }
    try {
      const resp = await fetch(base() + '/v1/knowledge/upload-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: uploadName.trim(),
          industry: uploadIndustry.trim(),
          content: uploadContent,
          description: `通过知识库管理面板上传 (${new Date().toLocaleDateString()})`,
        }),
      });
      const data = await resp.json();
      if (data.ok) {
        antMsg.success(data.message || '✅ 上传成功');
        setUploadName('');
        setUploadContent('');
        refresh();
      } else {
        antMsg.error(data.error || '上传失败');
      }
    } catch (e: any) {
      antMsg.error(`上传失败: ${e?.message}`);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    try {
      const resp = await fetch(base() + `/v1/knowledge/${id}`, { method: 'DELETE' });
      const data = await resp.json();
      if (data.ok) {
        antMsg.success(`已删除「${name}」`);
        refresh();
      } else {
        antMsg.error(data.error || '删除失败');
      }
    } catch (e: any) {
      antMsg.error(`删除失败: ${e?.message}`);
    }
  };

  const handleSearch = async () => {
    const q = searchQuery.trim();
    if (!q) return;
    setSearching(true);
    try {
      const resp = await fetch(base() + `/v1/knowledge/search?q=${encodeURIComponent(q)}&topK=5`);
      const data = await resp.json();
      if (data.ok) {
        setSearchResults(data.results || []);
      } else {
        antMsg.error(data.error || '搜索失败');
      }
    } catch (e: any) {
      antMsg.error(`搜索失败: ${e?.message}`);
    }
    setSearching(false);
  };

  // 预设行业列表
  const presetIndustries = ['装修建材', '电商', '教育', '医疗', '法律', '金融', '制造', 'IT', '其他'];

  const handleFileUpload = async (file: File): Promise<boolean> => {
    setUploading(true);
    setUploadProgress(0);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('industry', fileIndustry || 'general');

      const xhr = new XMLHttpRequest();
      xhr.upload.onprogress = (e) => {
        if (e.total > 0) setUploadProgress(Math.round((e.loaded / e.total) * 100));
      };

      const resp = await fetch(base() + '/v1/knowledge/upload-raw', {
        method: 'POST',
        body: formData,
      });
      const data = await resp.json();
      if (data.ok) {
        antMsg.success(data.message || `✅ 已导入「${file.name}」`);
        refresh();
      } else {
        antMsg.error(data.error || '上传失败');
      }
    } catch (e: any) {
      antMsg.error(`上传失败: ${e?.message}`);
    }
    setUploading(false);
    setUploadProgress(0);
    return false; // 阻止默认上传行为
  };

  return (
    <div style={{ padding: 24, maxWidth: 960, margin: '0 auto' }}>
      {/* 头部统计 */}
      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <Title level={4} style={{ margin: 0 }}>
              <BookOutlined /> 行业知识库
            </Title>
            <Text type="secondary">
              上传行业文档（txt/md），AI 在回答时自动检索相关知识
            </Text>
          </div>
          <Space>
            {stats && (
              <Text type="secondary">
                {stats.docCount} 个文档 · {stats.chunkCount} 个片段
                {stats.industries.length > 0 && ` · ${stats.industries.join(', ')}`}
              </Text>
            )}
            <Button icon={<ReloadOutlined />} onClick={refresh} loading={loading}>刷新</Button>
          </Space>
        </div>
      </Card>

      {/* 搜索栏 */}
      <Card style={{ marginBottom: 16 }} size="small">
        <div style={{ display: 'flex', gap: 8 }}>
          <Input.Search
            placeholder="搜索知识库内容..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onSearch={handleSearch}
            enterButton={<><SearchOutlined /> 搜索</>}
            loading={searching}
            style={{ flex: 1 }}
          />
        </div>
        {searchResults.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <Text strong>搜索结果 ({searchResults.length})：</Text>
            {searchResults.map((r, i) => (
              <Card key={i} size="small" style={{ marginTop: 8 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  来源: {r.docName} · 相关度: {(r.score * 10).toFixed(1)}%
                </Text>
                <Paragraph style={{ margin: '4px 0 0', fontSize: 13, whiteSpace: 'pre-wrap' }}>
                  {r.chunk.text.slice(0, 300)}...
                </Paragraph>
              </Card>
            ))}
          </div>
        )}
      </Card>

      {/* 上传区域 */}
      <Card title="上传文档" style={{ marginBottom: 16 }} size="small">
        <Tabs items={[
          {
            key: 'text',
            label: '粘贴文本',
            children: (
              <Space direction="vertical" style={{ width: '100%' }}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Input
                    placeholder="文档名称（如：装修报价模板）"
                    value={uploadName}
                    onChange={e => setUploadName(e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                    <Text type="secondary">行业:</Text>
                    {presetIndustries.map(ind => (
                      <Tag
                        key={ind}
                        color={uploadIndustry === ind ? '#1677ff' : undefined}
                        style={{ cursor: 'pointer' }}
                        onClick={() => setUploadIndustry(ind)}
                      >
                        {ind}
                      </Tag>
                    ))}
                  </div>
                </div>
                <TextArea
                  rows={4}
                  placeholder="粘贴文档内容（支持 txt/md 格式文本）..."
                  value={uploadContent}
                  onChange={e => setUploadContent(e.target.value)}
                />
                <Button type="primary" icon={<UploadOutlined />} onClick={handleUpload}>
                  导入到知识库
                </Button>
              </Space>
            ),
          },
          {
            key: 'file',
            label: '上传文件',
            children: (
              <Space direction="vertical" style={{ width: '100%' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <Text strong>文件行业:</Text>
                  {presetIndustries.map(ind => (
                    <Tag
                      key={ind}
                      color={fileIndustry === ind ? '#1677ff' : undefined}
                      style={{ cursor: 'pointer' }}
                      onClick={() => setFileIndustry(ind)}
                    >
                      {ind}
                    </Tag>
                  ))}
                </div>
                <Dragger
                  name="file"
                  multiple={false}
                  accept=".xlsx,.xls,.docx,.pdf,.dxf,.pptx,.txt,.md,.csv"
                  showUploadList={false}
                  beforeUpload={handleFileUpload}
                >
                  <p className="ant-upload-drag-icon">
                    <InboxOutlined />
                  </p>
                  <p className="ant-upload-text">点击或拖拽文件到此处上传</p>
                  <p className="ant-upload-hint">
                    支持 Excel (.xlsx .xls) / Word (.docx) / PDF / 图纸 (.dxf) / PPT (.pptx) / 文本 (.txt .md .csv)
                  </p>
                </Dragger>
                {uploading && <Progress percent={uploadProgress} />}
              </Space>
            ),
          },
        ]} />
      </Card>

      {/* 文档列表 */}
      <Card title={`已上传文档 (${docs.length})`}>
        {docs.length === 0 ? (
          <Empty description="暂无文档，上传行业资料让 AI 更懂你" />
        ) : (
          <List
            dataSource={docs}
            renderItem={doc => (
              <List.Item
                actions={[
                  <Popconfirm
                    title={`删除「${doc.name}」?`}
                    onConfirm={() => handleDelete(doc.id, doc.name)}
                    okText="删除"
                    cancelText="取消"
                  >
                    <Button type="link" danger icon={<DeleteOutlined />}>删除</Button>
                  </Popconfirm>,
                ]}
              >
                <List.Item.Meta
                  avatar={<FileTextOutlined style={{ fontSize: 24, color: '#1677ff' }} />}
                  title={doc.name}
                  description={
                    <Space>
                      <Tag color="blue">{doc.industry}</Tag>
                      <Text type="secondary">{doc.charCount} 字符</Text>
                      <Text type="secondary">{doc.chunkCount} 片段</Text>
                      {doc.description && <Text type="secondary">· {doc.description}</Text>}
                    </Space>
                  }
                />
              </List.Item>
            )}
          />
        )}
      </Card>

      {/* 记忆图谱 */}
      <Card title="记忆图谱" style={{ marginTop: 16 }}>
        <React.Suspense fallback={<div style={{ padding: 20, color: 'var(--muted)' }}>加载中...</div>}>
          <KnowledgeGraphPanel />
        </React.Suspense>
      </Card>
    </div>
  );
};
