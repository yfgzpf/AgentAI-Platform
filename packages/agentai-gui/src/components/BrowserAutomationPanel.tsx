/**
 * BrowserAutomationPanel - 浏览器自动化面板
 * 
 * 集成到编辑器中，实时通过浏览器自动化执行评论区截流获客
 */
import React, { useState, useEffect, useRef } from 'react';
import { 
  Button, Input, Select, Card, List, Tag, Space, Alert, 
  Tabs, Badge, Tooltip, message, Spin, Divider, Statistic, Row, Col, Typography
} from 'antd';
import { 
  PlayCircleOutlined, PauseCircleOutlined, ReloadOutlined,
  GlobalOutlined, UserAddOutlined, MessageOutlined, ExportOutlined,
  ChromeOutlined, VideoCameraOutlined, FireOutlined, EyeOutlined,
  CommentOutlined, LikeOutlined, ShareAltOutlined
} from '@ant-design/icons';

const { Text } = Typography;

interface InterceptedUser {
  id: string;
  username: string;
  comment: string;
  videoTitle: string;
  platform: 'douyin' | 'xiaohongshu' | 'shipinhao';
  intentScore: number;
  timestamp: string;
  status: 'new' | 'contacted' | 'converted';
}

const PLATFORMS = [
  { value: 'douyin', label: '抖音', icon: <VideoCameraOutlined />, color: '#000000' },
  { value: 'xiaohongshu', label: '小红书', icon: <FireOutlined />, color: '#ff2442' },
  { value: 'shipinhao', label: '视频号', icon: <GlobalOutlined />, color: '#07c160' },
];

export const BrowserAutomationPanel: React.FC = () => {
  const [activeTab, setActiveTab] = useState('monitor');
  const [platform, setPlatform] = useState<string>('douyin');
  const [keywords, setKeywords] = useState<string[]>(['装修']);
  const [newKeyword, setNewKeyword] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [users, setUsers] = useState<InterceptedUser[]>([]);
  const [browserUrl, setBrowserUrl] = useState('');
  const [logs, setLogs] = useState<string[]>([]);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const addLog = (msg: string) => {
    setLogs(prev => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev].slice(0, 100));
  };

  const startMonitoring = async () => {
    setIsRunning(true);
    addLog(`启动${PLATFORMS.find(p => p.value === platform)?.label}监控...`);
    
    const keywordStr = keywords.join(' ');
    let url = '';
    switch (platform) {
      case 'douyin':
        url = `https://www.douyin.com/search/${encodeURIComponent(keywordStr)}?type=video`;
        break;
      case 'xiaohongshu':
        url = `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(keywordStr)}`;
        break;
      case 'shipinhao':
        url = `https://channels.weixin.qq.com/platform/search?keyword=${encodeURIComponent(keywordStr)}`;
        break;
    }
    setBrowserUrl(url);
    
    // 模拟数据采集
    setTimeout(() => {
      const mockUsers: InterceptedUser[] = [
        {
          id: '1',
          username: '装修小白',
          comment: '北京100平房子装修要多少钱？求推荐靠谱的装修公司',
          videoTitle: '北京装修报价清单2024',
          platform: 'douyin',
          intentScore: 10,
          timestamp: new Date().toISOString(),
          status: 'new',
        },
        {
          id: '2',
          username: '准备装修的宝妈',
          comment: '求推荐靠谱的装修公司，怕被坑',
          videoTitle: '装修避坑指南',
          platform: 'xiaohongshu',
          intentScore: 10,
          timestamp: new Date().toISOString(),
          status: 'new',
        },
      ];
      setUsers(mockUsers);
      addLog(`采集到 ${mockUsers.length} 个高意向用户`);
    }, 3000);
  };

  const stopMonitoring = () => {
    setIsRunning(false);
    addLog('监控已停止');
  };

  const addKeyword = () => {
    if (newKeyword && !keywords.includes(newKeyword)) {
      setKeywords([...keywords, newKeyword]);
      setNewKeyword('');
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 9) return 'red';
    if (score >= 7) return 'orange';
    return 'blue';
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: 12 }}>
      <Tabs activeKey={activeTab} onChange={setActiveTab} style={{ flex: 1 }}>
        <Tabs.TabPane tab={<span><ChromeOutlined /> 浏览器监控</span>} key="monitor">
          <Card size="small" style={{ marginBottom: 12 }}>
            <Space direction="vertical" style={{ width: '100%' }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <Select value={platform} onChange={setPlatform} style={{ width: 120 }} disabled={isRunning}>
                  {PLATFORMS.map(p => (
                    <Select.Option key={p.value} value={p.value}>
                      {p.label}
                    </Select.Option>
                  ))}
                </Select>
                <Input
                  placeholder="输入关键词"
                  value={newKeyword}
                  onChange={e => setNewKeyword(e.target.value)}
                  onPressEnter={addKeyword}
                  disabled={isRunning}
                  style={{ flex: 1 }}
                />
                <Button onClick={addKeyword} disabled={isRunning}>添加</Button>
                <Button
                  type={isRunning ? 'default' : 'primary'}
                  icon={isRunning ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
                  onClick={isRunning ? stopMonitoring : startMonitoring}
                  danger={isRunning}
                >
                  {isRunning ? '停止' : '启动'}
                </Button>
              </div>
              <div>
                {keywords.map(k => (
                  <Tag key={k} closable={!isRunning} onClose={() => setKeywords(keywords.filter(kw => kw !== k))}>
                    {k}
                  </Tag>
                ))}
              </div>
            </Space>
          </Card>

          <Card title="浏览器视图" style={{ flex: 1, minHeight: 300 }} bodyStyle={{ padding: 0, height: 'calc(100% - 40px)' }}>
            {browserUrl ? (
              <iframe
                ref={iframeRef}
                src={browserUrl}
                style={{ width: '100%', height: '100%', border: 'none' }}
              />
            ) : (
              <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888' }}>
                <Space direction="vertical" align="center">
                  <GlobalOutlined style={{ fontSize: 48 }} />
                  <p>点击"启动"开始浏览器自动化监控</p>
                </Space>
              </div>
            )}
          </Card>
        </Tabs.TabPane>

        <Tabs.TabPane tab={<span><UserAddOutlined /> 意向用户 ({users.length})</span>} key="users">
          <Row gutter={16} style={{ marginBottom: 12 }}>
            <Col span={8}>
              <Card size="small">
                <Statistic title="采集用户" value={users.length} />
              </Card>
            </Col>
            <Col span={8}>
              <Card size="small">
                <Statistic title="高意向(8+分)" value={users.filter(u => u.intentScore >= 8).length} valueStyle={{ color: '#cf1322' }} />
              </Card>
            </Col>
            <Col span={8}>
              <Card size="small">
                <Statistic title="已转化" value={users.filter(u => u.status === 'converted').length} valueStyle={{ color: '#3f8600' }} />
              </Card>
            </Col>
          </Row>

          <List
            dataSource={users}
            renderItem={user => (
              <List.Item
                actions={[
                  <Button size="small" icon={<MessageOutlined />} onClick={() => {
                    const msg = `您好！看到您在关注${user.videoTitle}，我们可以聊聊吗？`;
                    navigator.clipboard.writeText(msg);
                    message.success('话术已复制');
                  }}>话术</Button>,
                ]}
              >
                <List.Item.Meta
                  title={
                    <Space>
                      <Text strong>{user.username}</Text>
                      <Badge count={user.intentScore} color={getScoreColor(user.intentScore)} />
                      <Tag color={user.status === 'new' ? 'blue' : user.status === 'contacted' ? 'orange' : 'green'}>
                        {user.status}
                      </Tag>
                    </Space>
                  }
                  description={
                    <div>
                      <p>{user.comment}</p>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        来自: {user.videoTitle} · {new Date(user.timestamp).toLocaleString()}
                      </Text>
                    </div>
                  }
                />
              </List.Item>
            )}
          />
        </Tabs.TabPane>

        <Tabs.TabPane tab="运行日志" key="logs">
          <Card style={{ height: '100%', overflow: 'auto' }}>
            {logs.map((log, idx) => (
              <div key={idx} style={{ fontSize: 11, fontFamily: 'monospace', marginBottom: 2 }}>
                {log}
              </div>
            ))}
          </Card>
        </Tabs.TabPane>
      </Tabs>
    </div>
  );
};
