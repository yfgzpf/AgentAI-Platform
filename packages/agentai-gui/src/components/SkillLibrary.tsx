import React, { useState, useEffect } from 'react';
import { Input, List, Tag, Tabs, Badge, Empty, Spin, Alert } from 'antd';
import { SearchOutlined, ApiOutlined, MessageOutlined, PictureOutlined, VideoCameraOutlined, SoundOutlined, CodeOutlined, GlobalOutlined } from '@ant-design/icons';

interface Skill {
  name: string;
  category: string;
  description: string;
  tools: string[];
  triggers: string[];
  icon: React.ReactNode;
}

const CATEGORIES = [
  { key: 'all', label: '全部', color: 'default' },
  { key: 'communication', label: '通讯', color: 'blue' },
  { key: 'image', label: '图像', color: 'magenta' },
  { key: 'video', label: '视频', color: 'purple' },
  { key: 'voice', label: '语音', color: 'cyan' },
  { key: 'office', label: '办公', color: 'orange' },
  { key: 'code', label: '代码', color: 'green' },
  { key: 'web', label: '网页', color: 'gold' },
  { key: 'general', label: '通用', color: 'default' },
  { key: 'deployment', label: '部署', color: 'volcano' },
  { key: 'security', label: '安全', color: 'red' },
  { key: 'git', label: 'Git', color: 'geekblue' },
  { key: 'data', label: '数据', color: 'lime' },
  { key: 'documentation', label: '文档', color: 'cyan' },
  { key: 'code-quality', label: '代码质量', color: 'green' },
  { key: 'testing', label: '测试', color: 'purple' },
];

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  communication: <MessageOutlined />,
  image: <PictureOutlined />,
  video: <VideoCameraOutlined />,
  voice: <SoundOutlined />,
  office: <ApiOutlined />,
  code: <CodeOutlined />,
  web: <GlobalOutlined />,
  default: <ApiOutlined />,
};

const httpUrl = () => ((window as any).__AGENTAI_GATEWAY__ || 'ws://127.0.0.1:18789').replace(/^ws/, 'http');

export const SkillLibrary: React.FC = () => {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [apiOffline, setApiOffline] = useState(false);

  // 从网关动态获取技能
  const loadSkills = async () => {
    setLoading(true);
    try {
      const r = await fetch(httpUrl() + '/v1/skills');
      if (r.ok) {
        const data = await r.json();
        if (data.skills && data.skills.length > 0) {
          setSkills(data.skills.map((s: any) => ({
            ...s,
            icon: CATEGORY_ICONS[s.category] || CATEGORY_ICONS.default,
          })));
          setApiOffline(false);
          setLoading(false);
          return;
        }
      }
    } catch {
      // API 离线, 用默认数据
    }
    // 静态备用
    setSkills(DEFAULT_SKILLS);
    setApiOffline(true);
    setLoading(false);
  };

  useEffect(() => {
    loadSkills();
  }, []);

  const filtered = skills.filter((s) => {
    if (category !== 'all' && s.category !== category) return false;
    if (search && !s.name.includes(search.toLowerCase()) && !s.description.includes(search)) return false;
    return true;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: 12, borderBottom: '1px solid #303030' }}>
        <Input
          prefix={<SearchOutlined />}
          placeholder="搜索技能..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          allowClear
        />
        <Tabs
          activeKey={category}
          onChange={setCategory}
          size="small"
          tabBarStyle={{ marginBottom: 0, marginTop: 8 }}
          items={CATEGORIES.filter(c => c.key === 'all' || skills.some(s => s.category === c.key)).map((c) => ({
            key: c.key,
            label: <Badge count={c.key === 'all' ? skills.length : skills.filter(s => s.category === c.key).length} size="small" offset={[6, -2]}><span style={{ paddingRight: 8 }}>{c.label}</span></Badge>,
          }))}
        />
      </div>
      {apiOffline && skills.length > 0 && (
        <Alert type="info" message="网关离线, 显示内置技能列表" banner style={{ fontSize: 11 }} closable />
      )}
      <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 40 }}><Spin tip="加载技能..." /></div>
        ) : filtered.length === 0 ? (
          <Empty description="没找到技能" />
        ) : (
          <List
            dataSource={filtered}
            renderItem={(s) => (
              <List.Item style={{ padding: '8px 12px', cursor: 'pointer' }} className="skill-item">
                <List.Item.Meta
                  avatar={<span style={{ fontSize: 18, color: '#4F46E5' }}>{s.icon}</span>}
                  title={<span style={{ fontSize: 13 }}>{s.name}</span>}
                  description={<span style={{ fontSize: 11, color: '#888' }}>{s.description}</span>}
                />
                <Tag color={CATEGORIES.find((c) => c.key === s.category)?.color}>{s.category}</Tag>
              </List.Item>
            )}
          />
        )}
      </div>
    </div>
  );
};

// 静态备用数据 (API 离线时使用)
const DEFAULT_SKILLS: Skill[] = [
  // 通讯
  { name: 'qq-bot', category: 'communication', description: 'QQ 群机器人', tools: [], triggers: [], icon: <MessageOutlined /> },
  { name: 'wecom-bot', category: 'communication', description: '企业微信机器人', tools: [], triggers: [], icon: <MessageOutlined /> },
  { name: 'feishu-bot', category: 'communication', description: '飞书机器人', tools: [], triggers: [], icon: <MessageOutlined /> },
  { name: 'telegram-bot', category: 'communication', description: 'Telegram 机器人', tools: [], triggers: [], icon: <MessageOutlined /> },
  { name: 'dingtalk-bot', category: 'communication', description: '钉钉机器人', tools: [], triggers: [], icon: <MessageOutlined /> },
  { name: 'discord-bot', category: 'communication', description: 'Discord 机器人', tools: [], triggers: [], icon: <MessageOutlined /> },
  { name: 'slack-bot', category: 'communication', description: 'Slack 机器人', tools: [], triggers: [], icon: <MessageOutlined /> },
  // 图像
  { name: 'agentai-image-gen', category: 'image', description: 'Agnes AI 图像生成 (Image 2.1)', tools: [], triggers: [], icon: <PictureOutlined /> },
  { name: 'qwen-image', category: 'image', description: '通义千问图像', tools: [], triggers: [], icon: <PictureOutlined /> },
  // 视频
  { name: 'agentai-video-gen', category: 'video', description: 'Agnes AI 视频生成', tools: [], triggers: [], icon: <VideoCameraOutlined /> },
  // 语音
  { name: 'tts-edge', category: 'voice', description: 'Edge TTS 文本转语音', tools: [], triggers: [], icon: <SoundOutlined /> },
  { name: 'asr-whisper', category: 'voice', description: 'Whisper 语音转文字', tools: [], triggers: [], icon: <SoundOutlined /> },
  // 办公
  { name: 'docx-gen', category: 'office', description: 'Word 文档生成', tools: [], triggers: [], icon: <ApiOutlined /> },
  { name: 'xlsx-gen', category: 'office', description: 'Excel 表格生成', tools: [], triggers: [], icon: <ApiOutlined /> },
  { name: 'pptx-gen', category: 'office', description: 'PPT 演示文稿', tools: [], triggers: [], icon: <ApiOutlined /> },
  { name: 'pdf-gen', category: 'office', description: 'PDF 生成', tools: [], triggers: [], icon: <ApiOutlined /> },
  // 代码
  { name: 'code-executor', category: 'code', description: 'Python 沙箱执行', tools: [], triggers: [], icon: <CodeOutlined /> },
  { name: 'code-reviewer', category: 'code', description: '代码审查', tools: [], triggers: [], icon: <CodeOutlined /> },
  // Web
  { name: 'web-scraper', category: 'web', description: '网页抓取', tools: [], triggers: [], icon: <GlobalOutlined /> },
  { name: 'browser-automation', category: 'web', description: '浏览器自动化', tools: [], triggers: [], icon: <GlobalOutlined /> },
  { name: 'mcp-client', category: 'web', description: 'MCP 协议客户端', tools: [], triggers: [], icon: <GlobalOutlined /> },
];
