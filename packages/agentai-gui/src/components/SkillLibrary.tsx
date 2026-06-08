import React, { useState, useEffect } from 'react';
import { Input, List, Tag, Tabs, Badge, Empty } from 'antd';
import { SearchOutlined, ApiOutlined, MessageOutlined, PictureOutlined, VideoCameraOutlined, SoundOutlined, CodeOutlined, GlobalOutlined } from '@ant-design/icons';

interface Skill {
  name: string;
  category: string;
  description: string;
  icon: React.ReactNode;
}

const SKILLS: Skill[] = [
  // 通信
  { name: 'qq-bot', category: 'communication', description: 'QQ 群机器人', icon: <MessageOutlined /> },
  { name: 'wecom-bot', category: 'communication', description: '企业微信机器人', icon: <MessageOutlined /> },
  { name: 'dingtalk-bot', category: 'communication', description: '钉钉机器人', icon: <MessageOutlined /> },
  { name: 'feishu-bot', category: 'communication', description: '飞书机器人', icon: <MessageOutlined /> },
  { name: 'telegram-bot', category: 'communication', description: 'Telegram 机器人', icon: <MessageOutlined /> },
  { name: 'discord-bot', category: 'communication', description: 'Discord 机器人', icon: <MessageOutlined /> },
  { name: 'slack-bot', category: 'communication', description: 'Slack 机器人', icon: <MessageOutlined /> },
  // 图像
  { name: 'agentai-image-gen', category: 'image', description: 'Agnes AI 图像生成 (Image 2.1)', icon: <PictureOutlined /> },
  { name: 'nano-banana-pro', category: 'image', description: 'Gemini 3 Pro 图像生成', icon: <PictureOutlined /> },
  { name: 'qwen-image', category: 'image', description: '通义千问图像', icon: <PictureOutlined /> },
  { name: 'sd-local', category: 'image', description: 'Stable Diffusion 本地', icon: <PictureOutlined /> },
  // 视频
  { name: 'agentai-video-gen', category: 'video', description: 'Agnes AI 视频生成', icon: <VideoCameraOutlined /> },
  { name: 'seedance', category: 'video', description: '豆包 Seedance 视频', icon: <VideoCameraOutlined /> },
  { name: 'jimeng', category: 'video', description: '即梦 AI 视频', icon: <VideoCameraOutlined /> },
  // 语音
  { name: 'tts-edge', category: 'voice', description: 'Edge TTS 文本转语音', icon: <SoundOutlined /> },
  { name: 'asr-whisper', category: 'voice', description: 'Whisper 语音转文字', icon: <SoundOutlined /> },
  { name: 'elevenlabs', category: 'voice', description: 'ElevenLabs 高质量 TTS', icon: <SoundOutlined /> },
  // 办公
  { name: 'docx-gen', category: 'office', description: 'Word 文档生成', icon: <ApiOutlined /> },
  { name: 'xlsx-gen', category: 'office', description: 'Excel 表格生成', icon: <ApiOutlined /> },
  { name: 'pptx-gen', category: 'office', description: 'PPT 演示文稿', icon: <ApiOutlined /> },
  { name: 'pdf-gen', category: 'office', description: 'PDF 生成', icon: <ApiOutlined /> },
  // 代码
  { name: 'code-executor', category: 'code', description: 'Python 沙箱执行', icon: <CodeOutlined /> },
  { name: 'code-reviewer', category: 'code', description: '代码审查', icon: <CodeOutlined /> },
  { name: 'github-pr', category: 'code', description: 'GitHub PR 操作', icon: <CodeOutlined /> },
  // 浏览器
  { name: 'browser-automation', category: 'web', description: 'Playwright 浏览器自动化', icon: <GlobalOutlined /> },
  { name: 'web-scraper', category: 'web', description: 'Firecrawl 网页抓取', icon: <GlobalOutlined /> },
  { name: 'mcp-client', category: 'web', description: 'MCP 协议客户端', icon: <GlobalOutlined /> },
];

const CATEGORIES = [
  { key: 'all', label: '全部', color: 'default' },
  { key: 'communication', label: '通讯', color: 'blue' },
  { key: 'image', label: '图像', color: 'magenta' },
  { key: 'video', label: '视频', color: 'purple' },
  { key: 'voice', label: '语音', color: 'cyan' },
  { key: 'office', label: '办公', color: 'orange' },
  { key: 'code', label: '代码', color: 'green' },
  { key: 'web', label: '网页', color: 'gold' },
];

export const SkillLibrary: React.FC = () => {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [counts, setCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    const c: Record<string, number> = { all: SKILLS.length };
    SKILLS.forEach((s) => { c[s.category] = (c[s.category] || 0) + 1; });
    setCounts(c);
  }, []);

  const filtered = SKILLS.filter((s) => {
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
          items={CATEGORIES.map((c) => ({
            key: c.key,
            label: <Badge count={counts[c.key] || 0} size="small" offset={[6, -2]}><span style={{ paddingRight: 8 }}>{c.label}</span></Badge>,
          }))}
        />
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
        {filtered.length === 0 ? (
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
