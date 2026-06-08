import React, { useState, useMemo } from 'react'
import { Input, Menu, Typography, Tag, Empty, Tooltip, Badge, Collapse, Space } from 'antd'
import {
  SearchOutlined,
  FileTextOutlined,
  PictureOutlined,
  VideoCameraOutlined,
  GlobalOutlined,
  CodeOutlined,
  MessageOutlined,
  ThunderboltOutlined,
  SettingOutlined,
  HistoryOutlined,
  StarOutlined,
  ClockCircleOutlined,
  AppstoreOutlined
} from '@ant-design/icons'
import { motion, AnimatePresence } from 'framer-motion'
import type { Skill } from './SkillCard'

const { Text } = Typography

interface SkillSidebarProps {
  skills: Skill[]
  recentSkills: Skill[]
  onSkillClick: (skill: Skill) => void
  onCategoryChange?: (category: string) => void
  collapsed?: boolean
}

const categoryConfig: Record<string, { icon: React.ReactNode; color: string }> = {
  '办公': { icon: <FileTextOutlined />, color: '#5A67D8' },
  '网页': { icon: <GlobalOutlined />, color: '#00D4AA' },
  '桌面': { icon: <SettingOutlined />, color: '#F687B3' },
  '视频': { icon: <VideoCameraOutlined />, color: '#FF6B6B' },
  '图像': { icon: <PictureOutlined />, color: '#9F7AEA' },
  '代码': { icon: <CodeOutlined />, color: '#4FD1C5' },
  '通信': { icon: <MessageOutlined />, color: '#F6AD55' },
  '记忆': { icon: <ThunderboltOutlined />, color: '#667EEA' },
  '元': { icon: <ThunderboltOutlined />, color: '#ED64A6' }
}

const SkillSidebar: React.FC<SkillSidebarProps> = ({
  skills,
  recentSkills,
  onSkillClick,
  onCategoryChange,
  collapsed = false
}) => {
  const [searchText, setSearchText] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('all')

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { all: skills.length }
    skills.forEach(skill => {
      counts[skill.category] = (counts[skill.category] || 0) + 1
    })
    return counts
  }, [skills])

  const filteredRecentSkills = useMemo(() => {
    if (!searchText) return recentSkills
    return recentSkills.filter(skill =>
      skill.name.toLowerCase().includes(searchText.toLowerCase()) ||
      skill.displayName.toLowerCase().includes(searchText.toLowerCase())
    )
  }, [recentSkills, searchText])

  const menuItems = [
    {
      key: 'all',
      icon: <AppstoreOutlined />,
      label: '全部技能',
      count: categoryCounts['all']
    },
    ...Object.entries(categoryConfig).map(([name, config]) => ({
      key: name,
      icon: config.icon,
      label: name,
      count: categoryCounts[name] || 0,
      color: config.color
    }))
  ]

  const handleCategoryClick = (category: string) => {
    setSelectedCategory(category)
    onCategoryChange?.(category)
  }

  if (collapsed) {
    return (
      <div className="skill-sidebar-collapsed h-full flex flex-col items-center py-4 gap-2">
        <Tooltip title="全部技能" placement="right">
          <div
            className={`w-10 h-10 rounded-lg flex items-center justify-center cursor-pointer transition-all ${
              selectedCategory === 'all' ? 'bg-[#5A67D8] text-white' : 'hover:bg-gray-100'
            }`}
            onClick={() => handleCategoryClick('all')}
          >
            <AppstoreOutlined />
          </div>
        </Tooltip>
        <div className="w-8 h-px bg-gray-200 my-2" />
        {Object.entries(categoryConfig).map(([name, config]) => (
          <Tooltip key={name} title={`${name} (${categoryCounts[name] || 0})`} placement="right">
            <div
              className={`w-10 h-10 rounded-lg flex items-center justify-center cursor-pointer transition-all ${
                selectedCategory === name
                  ? 'text-white'
                  : 'hover:bg-gray-100'
              }`}
              style={{
                backgroundColor: selectedCategory === name ? config.color : undefined,
                color: selectedCategory === name ? 'white' : config.color
              }}
              onClick={() => handleCategoryClick(name)}
            >
              {config.icon}
            </div>
          </Tooltip>
        ))}
      </div>
    )
  }

  return (
    <div className="skill-sidebar h-full flex flex-col bg-white border-r border-gray-200">
      <div className="p-4 border-b border-gray-100">
        <div className="flex items-center gap-2 mb-3">
          <ThunderboltOutlined className="text-[#5A67D8] text-lg" />
          <Text strong className="text-base">技能库</Text>
          <Badge count={skills.length} style={{ backgroundColor: '#5A67D8' }} />
        </div>
        <Input
          placeholder="搜索技能..."
          prefix={<SearchOutlined className="text-gray-400" />}
          value={searchText}
          onChange={e => setSearchText(e.target.value)}
          allowClear
          size="small"
        />
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="p-2">
          {menuItems.map(item => (
            <motion.div
              key={item.key}
              whileHover={{ x: 2 }}
              whileTap={{ scale: 0.98 }}
            >
              <div
                className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer mb-1 transition-all ${
                  selectedCategory === item.key
                    ? 'bg-[#5A67D8] text-white'
                    : 'hover:bg-gray-50'
                }`}
                onClick={() => handleCategoryClick(item.key)}
                style={{
                  borderLeft: selectedCategory !== item.key && item.color ? `3px solid ${item.color}` : undefined
                }}
              >
                <span style={{ color: selectedCategory === item.key ? 'white' : (item.color || '#666') }}>
                  {item.icon}
                </span>
                <span className="flex-1">{item.label}</span>
                <Badge
                  count={item.count}
                  style={{
                    backgroundColor: selectedCategory === item.key ? 'rgba(255,255,255,0.2)' : '#f0f0f0',
                    color: selectedCategory === item.key ? 'white' : '#666'
                  }}
                />
              </div>
            </motion.div>
          ))}
        </div>

        {filteredRecentSkills.length > 0 && (
          <div className="border-t border-gray-100 mt-2 pt-2">
            <div className="px-4 py-2 flex items-center gap-2 text-gray-500">
              <HistoryOutlined />
              <Text type="secondary" className="text-xs">最近使用</Text>
            </div>
            <AnimatePresence>
              {filteredRecentSkills.slice(0, 5).map((skill, index) => {
                const config = categoryConfig[skill.category] || { color: '#5A67D8' }
                return (
                  <motion.div
                    key={skill.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    transition={{ delay: index * 0.05 }}
                    className="px-4 py-2 hover:bg-gray-50 cursor-pointer flex items-center gap-3"
                    onClick={() => onSkillClick(skill)}
                  >
                    <div
                      className="w-8 h-8 rounded flex items-center justify-center"
                      style={{ backgroundColor: `${config.color}20` }}
                    >
                      <span style={{ color: config.color, fontSize: '14px' }}>
                        {config.icon}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <Text className="block truncate text-sm">{skill.displayName}</Text>
                      <Text type="secondary" className="text-xs">
                        {skill.lastUsed || '刚刚'}
                      </Text>
                    </div>
                    {skill.status === 'running' && (
                      <Tag color="processing" className="m-0 text-xs">运行中</Tag>
                    )}
                  </motion.div>
                )
              })}
            </AnimatePresence>
          </div>
        )}

        {recentSkills.length === 0 && (
          <div className="px-4 py-8 text-center">
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                <Text type="secondary" className="text-xs">
                  暂无最近使用的技能
                </Text>
              }
            />
          </div>
        )}
      </div>

      <div className="p-3 border-t border-gray-100 bg-gray-50">
        <div className="flex items-center justify-between text-xs text-gray-500">
          <Space>
            <StarOutlined />
            <span>收藏技能</span>
          </Space>
          <Tag color="blue" className="m-0">开发中</Tag>
        </div>
      </div>
    </div>
  )
}

export default SkillSidebar
