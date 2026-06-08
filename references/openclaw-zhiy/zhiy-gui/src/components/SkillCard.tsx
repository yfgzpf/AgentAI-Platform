import React from 'react'
import { Card, Tag, Button, Tooltip, Progress } from 'antd'
import {
  PlayCircleOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  LoadingOutlined,
  ClockCircleOutlined,
  FileTextOutlined,
  PictureOutlined,
  VideoCameraOutlined,
  GlobalOutlined,
  CodeOutlined,
  MessageOutlined,
  ThunderboltOutlined,
  SettingOutlined
} from '@ant-design/icons'
import { motion } from 'framer-motion'

export interface Skill {
  id: string
  name: string
  displayName: string
  description: string
  category: string
  industry?: string
  status: 'idle' | 'running' | 'completed' | 'failed'
  progress?: number
  lastUsed?: string
  params?: SkillParam[]
  author?: string
  version?: string
}

export interface SkillParam {
  name: string
  label: string
  type: 'text' | 'number' | 'choice' | 'textarea' | 'file'
  required: boolean
  options?: string[]
  default?: string
  description?: string
}

interface SkillCardProps {
  skill: Skill
  onClick?: () => void
  onExecute?: () => void
  compact?: boolean
}

const getCategoryIcon = (category: string): React.ReactNode => {
  const iconMap: Record<string, React.ReactNode> = {
    '办公': <FileTextOutlined />,
    '网页': <GlobalOutlined />,
    '桌面': <SettingOutlined />,
    '视频': <VideoCameraOutlined />,
    '图像': <PictureOutlined />,
    '代码': <CodeOutlined />,
    '通信': <MessageOutlined />,
    '记忆': <ThunderboltOutlined />,
    '元': <ThunderboltOutlined />
  }
  return iconMap[category] || <ThunderboltOutlined />
}

const getCategoryColor = (category: string): string => {
  const colorMap: Record<string, string> = {
    '办公': '#5A67D8',
    '网页': '#00D4AA',
    '桌面': '#F687B3',
    '视频': '#FF6B6B',
    '图像': '#9F7AEA',
    '代码': '#4FD1C5',
    '通信': '#F6AD55',
    '记忆': '#667EEA',
    '元': '#ED64A6'
  }
  return colorMap[category] || '#5A67D8'
}

const getStatusIcon = (status: string): React.ReactNode => {
  switch (status) {
    case 'idle':
      return <ClockCircleOutlined style={{ color: '#8c8c8c' }} />
    case 'running':
      return <LoadingOutlined style={{ color: '#1890ff' }} />
    case 'completed':
      return <CheckCircleOutlined style={{ color: '#52c41a' }} />
    case 'failed':
      return <CloseCircleOutlined style={{ color: '#ff4d4f' }} />
    default:
      return <ClockCircleOutlined />
  }
}

const getStatusColor = (status: string): string => {
  const colors: Record<string, string> = {
    'idle': 'default',
    'running': 'processing',
    'completed': 'success',
    'failed': 'error'
  }
  return colors[status] || 'default'
}

const getStatusText = (status: string): string => {
  const texts: Record<string, string> = {
    'idle': '空闲',
    'running': '运行中',
    'completed': '已完成',
    'failed': '失败'
  }
  return texts[status] || '未知'
}

const SkillCard: React.FC<SkillCardProps> = ({ skill, onClick, onExecute, compact = false }) => {
  const categoryColor = getCategoryColor(skill.category)
  const categoryIcon = getCategoryIcon(skill.category)

  if (compact) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        className="cursor-pointer"
        onClick={onClick}
      >
        <Card
          size="small"
          hoverable
          className="transition-all duration-200"
          styles={{
            body: { padding: '12px' }
          }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: `${categoryColor}20` }}
            >
              <span style={{ color: categoryColor, fontSize: '18px' }}>
                {categoryIcon}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">{skill.displayName}</div>
              <div className="text-xs text-gray-500 truncate">{skill.category}</div>
            </div>
            {skill.status !== 'idle' && (
              <Tag color={getStatusColor(skill.status)} className="m-0">
                {getStatusText(skill.status)}
              </Tag>
            )}
          </div>
        </Card>
      </motion.div>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -4 }}
      transition={{ duration: 0.2 }}
    >
      <Card
        hoverable
        className="h-full overflow-hidden"
        onClick={onClick}
        styles={{
          body: { padding: 0 }
        }}
      >
        <div
          className="h-2"
          style={{ backgroundColor: categoryColor }}
        />
        
        <div className="p-4">
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-3">
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center"
                style={{ backgroundColor: `${categoryColor}15` }}
              >
                <span style={{ color: categoryColor, fontSize: '24px' }}>
                  {categoryIcon}
                </span>
              </div>
              <div>
                <h4 className="font-semibold text-base m-0">{skill.displayName}</h4>
                <Tag color={categoryColor} className="mt-1">
                  {skill.category}
                </Tag>
              </div>
            </div>
            <Tooltip title={getStatusText(skill.status)}>
              {getStatusIcon(skill.status)}
            </Tooltip>
          </div>

          <p className="text-gray-600 text-sm mb-4 line-clamp-2" style={{ minHeight: '40px' }}>
            {skill.description}
          </p>

          {skill.status === 'running' && skill.progress !== undefined && (
            <div className="mb-4">
              <Progress
                percent={skill.progress}
                size="small"
                status="active"
                strokeColor={categoryColor}
              />
            </div>
          )}

          <div className="flex items-center justify-between">
            {skill.industry && (
              <Tag color="blue" bordered={false}>
                {skill.industry}
              </Tag>
            )}
            {skill.lastUsed && (
              <span className="text-xs text-gray-400">
                最近使用: {skill.lastUsed}
              </span>
            )}
          </div>

          <div className="mt-4 pt-4 border-t border-gray-100">
            <Button
              type="primary"
              icon={<PlayCircleOutlined />}
              onClick={(e) => {
                e.stopPropagation()
                onExecute?.()
              }}
              disabled={skill.status === 'running'}
              block
              style={{ backgroundColor: categoryColor, borderColor: categoryColor }}
            >
              {skill.status === 'running' ? '执行中...' : '执行技能'}
            </Button>
          </div>
        </div>
      </Card>
    </motion.div>
  )
}

export default SkillCard
