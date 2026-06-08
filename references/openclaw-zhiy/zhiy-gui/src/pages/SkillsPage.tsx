import { useState, useMemo } from 'react'
import { Card, Empty, Button, Space, Modal } from 'antd'
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import SkillList from '../components/SkillList'
import SkillDetail from '../components/SkillDetail'
import type { Skill, SkillParam } from '../components/SkillCard'

const mockSkills: Skill[] = [
  {
    id: '1',
    name: 'doc-generator',
    displayName: '文档生成器',
    description: '生成Word文档，支持合同、报告、通知等多种格式。可以自定义模板和样式，支持批量生成。',
    category: '办公',
    industry: 'construction',
    status: 'idle',
    params: [
      { name: 'docType', label: '文档类型', type: 'choice', required: true, options: ['合同', '报告', '通知', '备忘录'] },
      { name: 'title', label: '文档标题', type: 'text', required: true },
      { name: 'content', label: '主要内容', type: 'textarea', required: true }
    ],
    version: '1.0.0',
    author: '智 Y.Ai Team',
    lastUsed: '2小时前'
  },
  {
    id: '2',
    name: 'excel-generator',
    displayName: 'Excel生成器',
    description: '生成Excel电子表格，支持多种数据格式和样式。可以导入数据源，自动生成图表。',
    category: '办公',
    status: 'idle',
    params: [
      { name: 'dataType', label: '数据类型', type: 'choice', required: true, options: ['销售数据', '财务报表', '客户名单'] },
      { name: 'period', label: '时间周期', type: 'text', required: true }
    ],
    version: '1.0.0',
    lastUsed: '昨天'
  },
  {
    id: '3',
    name: 'ppt-generator',
    displayName: 'PPT生成器',
    description: '自动生成演示文稿，支持多种主题和布局。',
    category: '办公',
    status: 'idle',
    params: [
      { name: 'theme', label: '主题', type: 'choice', required: true, options: ['商务', '简约', '科技', '创意'] },
      { name: 'slides', label: '页数', type: 'number', required: true }
    ],
    version: '1.0.0'
  },
  {
    id: '4',
    name: 'image-gen',
    displayName: '图像生成',
    description: '使用AI生成高质量图片，支持多种风格和尺寸。基于Stable Diffusion技术。',
    category: '图像',
    status: 'idle',
    params: [
      { name: 'prompt', label: '图片描述', type: 'textarea', required: true },
      { name: 'style', label: '风格', type: 'choice', required: false, options: ['写实', '卡通', '抽象', '油画'] },
      { name: 'size', label: '尺寸', type: 'choice', required: false, options: ['512x512', '1024x1024', '1920x1080'] }
    ],
    version: '2.1.0',
    lastUsed: '3天前'
  },
  {
    id: '5',
    name: 'image-edit',
    displayName: '图像编辑',
    description: '对图片进行编辑处理，支持裁剪、滤镜、调色等功能。',
    category: '图像',
    status: 'idle',
    params: [
      { name: 'imagePath', label: '图片路径', type: 'file', required: true },
      { name: 'operation', label: '操作', type: 'choice', required: true, options: ['裁剪', '滤镜', '调色', '压缩'] }
    ],
    version: '1.5.0'
  },
  {
    id: '6',
    name: 'seedance-video',
    displayName: '视频生成',
    description: '使用豆包Seedance生成视频内容，支持多种场景和风格。',
    category: '视频',
    status: 'idle',
    params: [
      { name: 'script', label: '剧本内容', type: 'textarea', required: true },
      { name: 'duration', label: '时长(秒)', type: 'number', required: false, default: '30' }
    ],
    version: '1.0.0'
  },
  {
    id: '7',
    name: 'video-composer',
    displayName: '视频合成',
    description: '使用FFmpeg进行视频合成、剪辑、转码等操作。',
    category: '视频',
    status: 'idle',
    params: [
      { name: 'inputFiles', label: '输入文件', type: 'textarea', required: true },
      { name: 'outputFormat', label: '输出格式', type: 'choice', required: true, options: ['MP4', 'AVI', 'MOV', 'GIF'] }
    ],
    version: '1.2.0'
  },
  {
    id: '8',
    name: 'browser-auto',
    displayName: '浏览器自动化',
    description: '自动化浏览器操作，支持网页抓取和交互。基于Playwright实现。',
    category: '网页',
    status: 'idle',
    params: [
      { name: 'url', label: '目标网址', type: 'text', required: true },
      { name: 'action', label: '操作类型', type: 'choice', required: true, options: ['抓取', '点击', '填写表单', '滚动'] }
    ],
    version: '1.2.0',
    lastUsed: '1周前'
  },
  {
    id: '9',
    name: 'web-scraper',
    displayName: '网页抓取',
    description: '从网页中提取结构化数据，支持多种解析方式。',
    category: '网页',
    status: 'idle',
    params: [
      { name: 'url', label: '目标网址', type: 'text', required: true },
      { name: 'selector', label: 'CSS选择器', type: 'text', required: true }
    ],
    version: '1.0.0'
  },
  {
    id: '10',
    name: 'desktop-control',
    displayName: '桌面控制',
    description: '控制本地应用程序，支持启动、关闭、窗口操作等。',
    category: '桌面',
    status: 'idle',
    params: [
      { name: 'appName', label: '应用名称', type: 'text', required: true },
      { name: 'action', label: '操作', type: 'choice', required: true, options: ['启动', '关闭', '最大化', '最小化'] }
    ],
    version: '1.0.0'
  },
  {
    id: '11',
    name: 'auto-gui',
    displayName: 'GUI自动化',
    description: '模拟键盘鼠标操作，实现GUI自动化。',
    category: '桌面',
    status: 'idle',
    params: [
      { name: 'script', label: '脚本内容', type: 'textarea', required: true }
    ],
    version: '1.0.0'
  },
  {
    id: '12',
    name: 'code-writer',
    displayName: '代码生成',
    description: '根据需求自动生成代码，支持多种编程语言。',
    category: '代码',
    status: 'idle',
    params: [
      { name: 'language', label: '编程语言', type: 'choice', required: true, options: ['Python', 'JavaScript', 'Java', 'C++', 'Go'] },
      { name: 'description', label: '功能描述', type: 'textarea', required: true }
    ],
    version: '1.5.0',
    lastUsed: '5天前'
  },
  {
    id: '13',
    name: 'code-runner',
    displayName: '代码执行',
    description: '在沙箱环境中安全执行代码。',
    category: '代码',
    status: 'idle',
    params: [
      { name: 'code', label: '代码内容', type: 'textarea', required: true },
      { name: 'language', label: '语言', type: 'choice', required: true, options: ['Python', 'JavaScript', 'Shell'] }
    ],
    version: '1.0.0'
  },
  {
    id: '14',
    name: 'email-sender',
    displayName: '邮件发送',
    description: '发送邮件，支持HTML格式和附件。',
    category: '通信',
    status: 'idle',
    params: [
      { name: 'to', label: '收件人', type: 'text', required: true },
      { name: 'subject', label: '主题', type: 'text', required: true },
      { name: 'content', label: '内容', type: 'textarea', required: true }
    ],
    version: '1.0.0'
  },
  {
    id: '15',
    name: 'wechat-bot',
    displayName: '微信机器人',
    description: '通过微信发送消息和文件。',
    category: '通信',
    status: 'idle',
    params: [
      { name: 'contact', label: '联系人', type: 'text', required: true },
      { name: 'message', label: '消息内容', type: 'textarea', required: true }
    ],
    version: '1.0.0'
  },
  {
    id: '16',
    name: 'memory-keeper',
    displayName: '记忆保存',
    description: '将重要信息保存到记忆系统，支持分类存储。',
    category: '记忆',
    status: 'idle',
    params: [
      { name: 'content', label: '记忆内容', type: 'textarea', required: true },
      { name: 'category', label: '分类', type: 'choice', required: false, options: ['核心', '每日', '任务'] }
    ],
    version: '1.0.0'
  },
  {
    id: '17',
    name: 'memory-search',
    displayName: '记忆搜索',
    description: '搜索历史记忆和对话记录。',
    category: '记忆',
    status: 'idle',
    params: [
      { name: 'query', label: '搜索关键词', type: 'text', required: true },
      { name: 'dateRange', label: '时间范围', type: 'choice', required: false, options: ['今天', '本周', '本月', '全部'] }
    ],
    version: '1.0.0'
  },
  {
    id: '18',
    name: 'skill-generator',
    displayName: '技能生成器',
    description: '根据需求自动生成新技能，支持预览和测试。',
    category: '元',
    status: 'idle',
    params: [
      { name: 'name', label: '技能名称', type: 'text', required: true },
      { name: 'description', label: '功能描述', type: 'textarea', required: true },
      { name: 'params', label: '参数定义', type: 'textarea', required: false }
    ],
    version: '1.0.0'
  }
]

export default function SkillsPage() {
  const [skills, setSkills] = useState<Skill[]>(mockSkills)
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null)
  const [detailVisible, setDetailVisible] = useState(false)

  const handleSkillClick = (skill: Skill) => {
    setSelectedSkill(skill)
    setDetailVisible(true)
  }

  const handleSkillExecute = async (skill: Skill, params: Record<string, any>) => {
    setSkills(prev => prev.map(s => 
      s.id === skill.id ? { ...s, status: 'running' as const, progress: 0 } : s
    ))

    await new Promise(resolve => setTimeout(resolve, 2000))

    setSkills(prev => prev.map(s => 
      s.id === skill.id ? { ...s, status: 'completed' as const, progress: 100, lastUsed: '刚刚' } : s
    ))

    setDetailVisible(false)
  }

  const handleRefresh = () => {
    setSkills(prev => prev.map(s => ({ ...s, status: 'idle' as const, progress: undefined })))
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold m-0">技能管理</h2>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={handleRefresh}>
            刷新状态
          </Button>
          <Button type="primary" icon={<PlusOutlined />} style={{ backgroundColor: '#5A67D8' }}>
            创建技能
          </Button>
        </Space>
      </div>

      <Card>
        {skills.length > 0 ? (
          <SkillList
            skills={skills}
            onSkillClick={handleSkillClick}
            onSkillExecute={(skill) => {
              setSelectedSkill(skill)
              setDetailVisible(true)
            }}
          />
        ) : (
          <Empty
            description={
              <span>
                暂无已安装技能
                <br />
                技能将自动加载到 ~/.zhiy/skills/ 目录
              </span>
            }
          />
        )}
      </Card>

      <SkillDetail
        skill={selectedSkill}
        visible={detailVisible}
        onClose={() => setDetailVisible(false)}
        onExecute={handleSkillExecute}
      />
    </div>
  )
}
