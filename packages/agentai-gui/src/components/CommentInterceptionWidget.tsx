/**
 * CommentInterceptionWidget - 评论区截流获客组件
 * 集成到编辑器右侧面板，一键启动获客监控
 */
import React, { useState, useEffect } from 'react';
import { Button, Input, Select, Tag, List, Badge, Tooltip, message } from 'antd';
import { 
  RadarChartOutlined, 
  PlayCircleOutlined, 
  PauseCircleOutlined,
  UserAddOutlined,
  MessageOutlined,
  FilterOutlined,
  ReloadOutlined,
  FireOutlined
} from '@ant-design/icons';

interface HighIntentUser {
  id: string;
  username: string;
  avatar?: string;
  comment: string;
  videoTitle: string;
  platform: 'douyin' | 'xiaohongshu' | 'shipinhao';
  intentScore: number;
  suggestedMessage: string;
  status: 'new' | 'contacted' | 'replied' | 'converted';
  createdAt: string;
}

interface MonitoringStats {
  isRunning: boolean;
  videosMonitored: number;
  commentsCollected: number;
  highIntentUsers: number;
  messagesSent: number;
  conversionRate: string;
}

const PLATFORMS = [
  { value: 'douyin', label: '抖音', color: '#000000' },
  { value: 'xiaohongshu', label: '小红书', color: '#ff2442' },
  { value: 'shipinhao', label: '视频号', color: '#07c160' },
];

const DEFAULT_KEYWORDS = ['装修', '装修公司', '装修避坑', '老房翻新'];

export const CommentInterceptionWidget: React.FC = () => {
  const [isRunning, setIsRunning] = useState(false);
  const [platform, setPlatform] = useState<string>('douyin');
  const [city, setCity] = useState('');
  const [keywords, setKeywords] = useState<string[]>(DEFAULT_KEYWORDS);
  const [newKeyword, setNewKeyword] = useState('');
  const [users, setUsers] = useState<HighIntentUser[]>([]);
  const [stats, setStats] = useState<MonitoringStats>({
    isRunning: false,
    videosMonitored: 0,
    commentsCollected: 0,
    highIntentUsers: 0,
    messagesSent: 0,
    conversionRate: '0%',
  });
  const [selectedUser, setSelectedUser] = useState<HighIntentUser | null>(null);
  const [loading, setLoading] = useState(false);

  // 模拟启动监控
  const startMonitoring = async () => {
    setLoading(true);
    try {
      // 调用后端API
      const response = await fetch('/api/skills/comment-interception-system', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'start_monitoring',
          context: {
            platform,
            keywords,
            city,
          },
        }),
      });

      const data = await response.json();
      
      if (data.success) {
        setIsRunning(true);
        setStats(prev => ({
          ...prev,
          isRunning: true,
          videosMonitored: data.data.videos_monitored,
          commentsCollected: data.data.comments_collected,
          highIntentUsers: data.data.high_intent_count,
        }));
        
        // 添加新发现的用户
        if (data.data.high_intent_users) {
          setUsers(prev => [...data.data.high_intent_users, ...prev].slice(0, 50));
        }
        
        message.success('监控已启动');
      } else {
        message.error(data.error || '启动失败');
      }
    } catch (error) {
      message.error('网络错误');
      // 模拟数据用于演示
      simulateMonitoring();
    } finally {
      setLoading(false);
    }
  };

  // 模拟监控数据
  const simulateMonitoring = () => {
    setIsRunning(true);
    setStats({
      isRunning: true,
      videosMonitored: 12,
      commentsCollected: 287,
      highIntentUsers: 23,
      messagesSent: 8,
      conversionRate: '35%',
    });

    const mockUsers: HighIntentUser[] = [
      {
        id: '1',
        username: '装修小白',
        comment: '北京100平房子装修要多少钱？求推荐靠谱的装修公司',
        videoTitle: '北京装修报价清单2024',
        platform: 'douyin',
        intentScore: 10,
        suggestedMessage: '您好！看到您在了解装修报价，我们在北京做了8年装修，100平全包大概15-20万，可以发您详细报价单参考~',
        status: 'new',
        createdAt: '2分钟前',
      },
      {
        id: '2',
        username: '准备装修的宝妈',
        comment: '求推荐靠谱的装修公司，怕被坑',
        videoTitle: '装修避坑指南',
        platform: 'xiaohongshu',
        intentScore: 10,
        suggestedMessage: '理解您的担心！我们服务过3000+业主，0增项承诺，可以先免费量房出方案，满意再签约~',
        status: 'new',
        createdAt: '5分钟前',
      },
      {
        id: '3',
        username: '老王装修记',
        comment: '正在找装修公司，哪家好？',
        videoTitle: '装修公司怎么选',
        platform: 'douyin',
        intentScore: 9,
        suggestedMessage: '您好！我们在本地口碑很好，可以先看看我们的完工案例，满意再决定~',
        status: 'contacted',
        createdAt: '10分钟前',
      },
    ];

    setUsers(mockUsers);
    message.success('监控已启动（演示模式）');
  };

  const stopMonitoring = () => {
    setIsRunning(false);
    setStats(prev => ({ ...prev, isRunning: false }));
    message.info('监控已停止');
  };

  const addKeyword = () => {
    if (newKeyword && !keywords.includes(newKeyword)) {
      setKeywords([...keywords, newKeyword]);
      setNewKeyword('');
    }
  };

  const removeKeyword = (keyword: string) => {
    setKeywords(keywords.filter(k => k !== keyword));
  };

  const copyMessage = (msg: string) => {
    navigator.clipboard.writeText(msg);
    message.success('话术已复制');
  };

  const markAsContacted = (userId: string) => {
    setUsers(users.map(u => 
      u.id === userId ? { ...u, status: 'contacted' } : u
    ));
  };

  return (
    <div style={{ 
      background: 'var(--panel)', 
      borderRadius: 8, 
      padding: 12,
      marginBottom: 12,
    }}>
      {/* 标题 */}
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        gap: 8, 
        marginBottom: 12,
        paddingBottom: 8,
        borderBottom: '1px solid var(--border)',
      }}>
        <RadarChartOutlined style={{ color: 'var(--accent)', fontSize: 16 }} />
        <span style={{ fontWeight: 600, fontSize: 13 }}>评论区截流获客</span>
        {isRunning && (
          <Badge status="processing" text="运行中" style={{ marginLeft: 'auto' }} />
        )}
      </div>

      {/* 配置区域 */}
      <div style={{ marginBottom: 12 }}>
        {/* 平台选择 */}
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>监控平台</div>
          <Select
            value={platform}
            onChange={setPlatform}
            style={{ width: '100%' }}
            
            disabled={isRunning}
          >
            {PLATFORMS.map(p => (
              <Select.Option key={p.value} value={p.value}>
                <span style={{ color: p.color }}>●</span> {p.label}
              </Select.Option>
            ))}
          </Select>
        </div>

        {/* 城市输入 */}
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>目标城市（可选）</div>
          <Input
            placeholder="如：北京、上海"
            value={city}
            onChange={e => setCity(e.target.value)}
            
            disabled={isRunning}
          />
        </div>

        {/* 关键词 */}
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>监控关键词</div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 4 }}>
            {keywords.map(k => (
              <Tag
                key={k}
                closable={!isRunning}
                onClose={() => removeKeyword(k)}
                style={{ fontSize: 11 }}
              >
                {k}
              </Tag>
            ))}
          </div>
          {!isRunning && (
            <div style={{ display: 'flex', gap: 4 }}>
              <Input
                placeholder="添加关键词"
                value={newKeyword}
                onChange={e => setNewKeyword(e.target.value)}
                onPressEnter={addKeyword}
                
                style={{ flex: 1 }}
              />
              <Button  onClick={addKeyword}>添加</Button>
            </div>
          )}
        </div>

        {/* 启动/停止按钮 */}
        <Button
          type={isRunning ? 'default' : 'primary'}
          icon={isRunning ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
          onClick={isRunning ? stopMonitoring : startMonitoring}
          loading={loading}
          
          block
          danger={isRunning}
          style={{ 
            background: isRunning ? undefined : 'var(--accent)',
            borderColor: isRunning ? undefined : 'var(--accent)',
          }}
        >
          {isRunning ? '停止监控' : '启动监控'}
        </Button>
      </div>

      {/* 统计数据 */}
      {stats.videosMonitored > 0 && (
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: '1fr 1fr', 
          gap: 8,
          padding: 8,
          background: 'var(--bg)',
          borderRadius: 4,
          marginBottom: 12,
        }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--accent)' }}>
              {stats.videosMonitored}
            </div>
            <div style={{ fontSize: 10, color: 'var(--muted)' }}>监控视频</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--accent)' }}>
              {stats.commentsCollected}
            </div>
            <div style={{ fontSize: 10, color: 'var(--muted)' }}>采集评论</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#52c41a' }}>
              {stats.highIntentUsers}
            </div>
            <div style={{ fontSize: 10, color: 'var(--muted)' }}>意向用户</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#faad14' }}>
              {stats.conversionRate}
            </div>
            <div style={{ fontSize: 10, color: 'var(--muted)' }}>转化率</div>
          </div>
        </div>
      )}

      {/* 高意向用户列表 */}
      {users.length > 0 && (
        <div>
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'space-between',
            marginBottom: 8,
          }}>
            <span style={{ fontSize: 11, fontWeight: 600 }}>
              <FireOutlined style={{ color: '#ff4d4f', marginRight: 4 }} />
              高意向用户 ({users.length})
            </span>
            <Button 
               
              icon={<ReloadOutlined />}
              onClick={() => setUsers([])}
              style={{ fontSize: 10 }}
            >
              清空
            </Button>
          </div>

          <List
            
            dataSource={users.slice(0, 5)}
            renderItem={user => (
              <List.Item
                style={{ 
                  padding: '8px 0',
                  borderBottom: '1px solid var(--border)',
                  cursor: 'pointer',
                }}
                onClick={() => setSelectedUser(user)}
              >
                <div style={{ width: '100%' }}>
                  <div style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'space-between',
                    marginBottom: 4,
                  }}>
                    <span style={{ fontWeight: 500, fontSize: 12 }}>
                      <UserAddOutlined style={{ marginRight: 4 }} />
                      {user.username}
                    </span>
                    <Tag 
                      color={user.intentScore >= 9 ? 'red' : user.intentScore >= 7 ? 'orange' : 'blue'}
                      
                      style={{ fontSize: 10 }}
                    >
                      意向分 {user.intentScore}
                    </Tag>
                  </div>
                  <div style={{ 
                    fontSize: 11, 
                    color: 'var(--muted)', 
                    marginBottom: 4,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {user.comment}
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <Tooltip title="复制话术">
                      <Button
                        
                        icon={<MessageOutlined />}
                        onClick={(e) => {
                          e.stopPropagation();
                          copyMessage(user.suggestedMessage);
                        }}
                        style={{ fontSize: 10 }}
                      >
                        话术
                      </Button>
                    </Tooltip>
                    {user.status === 'new' && (
                      <Button
                        
                        type="primary"
                        onClick={(e) => {
                          e.stopPropagation();
                          markAsContacted(user.id);
                        }}
                        style={{ fontSize: 10 }}
                      >
                        标记已联系
                      </Button>
                    )}
                    {user.status === 'contacted' && (
                      <Tag  style={{ fontSize: 10 }}>已联系</Tag>
                    )}
                  </div>
                </div>
              </List.Item>
            )}
          />

          {users.length > 5 && (
            <div style={{ textAlign: 'center', padding: 8 }}>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                还有 {users.length - 5} 个用户...
              </span>
            </div>
          )}
        </div>
      )}

      {/* 用户详情弹窗 */}
      {selectedUser && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={() => setSelectedUser(null)}
        >
          <div
            style={{
              background: 'var(--panel)',
              borderRadius: 8,
              padding: 16,
              width: 400,
              maxWidth: '90%',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ fontWeight: 600, marginBottom: 12 }}>
              {selectedUser.username}
              <Tag color="red" style={{ marginLeft: 8 }}>意向分 {selectedUser.intentScore}</Tag>
            </div>
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>评论内容</div>
              <div style={{ padding: 8, background: 'var(--bg)', borderRadius: 4 }}>
                {selectedUser.comment}
              </div>
            </div>
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>推荐话术</div>
              <div style={{ padding: 8, background: 'var(--bg)', borderRadius: 4, fontSize: 12 }}>
                {selectedUser.suggestedMessage}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button type="primary" block onClick={() => copyMessage(selectedUser.suggestedMessage)}>
                复制话术
              </Button>
              <Button block onClick={() => setSelectedUser(null)}>
                关闭
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
