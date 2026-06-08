import React, { useState, useMemo } from 'react'
import { Input, Select, Tabs, Empty, Row, Col, Space, Tag, Badge } from 'antd'
import { SearchOutlined, AppstoreOutlined, UnorderedListOutlined, FilterOutlined } from '@ant-design/icons'
import { motion, AnimatePresence } from 'framer-motion'
import SkillCard, { Skill } from './SkillCard'

interface SkillListProps {
  skills: Skill[]
  onSkillClick?: (skill: Skill) => void
  onSkillExecute?: (skill: Skill) => void
  selectedCategory?: string
  selectedIndustry?: string
}

const categories = [
  { value: 'all', label: '全部' },
  { value: '办公', label: '办公' },
  { value: '网页', label: '网页' },
  { value: '桌面', label: '桌面' },
  { value: '视频', label: '视频' },
  { value: '图像', label: '图像' },
  { value: '代码', label: '代码' },
  { value: '通信', label: '通信' },
  { value: '记忆', label: '记忆' },
  { value: '元', label: '元' }
]

const industries = [
  { value: 'all', label: '全部行业' },
  { value: 'construction', label: '装饰建材' },
  { value: 'auto', label: '汽修服务' },
  { value: 'beauty', label: '美容美发' },
  { value: 'office', label: '办公自动化' }
]

const SkillList: React.FC<SkillListProps> = ({
  skills,
  onSkillClick,
  onSkillExecute,
  selectedCategory: externalCategory,
  selectedIndustry: externalIndustry
}) => {
  const [searchText, setSearchText] = useState('')
  const [category, setCategory] = useState(externalCategory || 'all')
  const [industry, setIndustry] = useState(externalIndustry || 'all')
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')

  const filteredSkills = useMemo(() => {
    return skills.filter(skill => {
      const matchesSearch = !searchText || 
        skill.name.toLowerCase().includes(searchText.toLowerCase()) ||
        skill.displayName.toLowerCase().includes(searchText.toLowerCase()) ||
        skill.description.toLowerCase().includes(searchText.toLowerCase())
      
      const matchesCategory = category === 'all' || skill.category === category
      const matchesIndustry = industry === 'all' || skill.industry === industry

      return matchesSearch && matchesCategory && matchesIndustry
    })
  }, [skills, searchText, category, industry])

  const groupedSkills = useMemo(() => {
    const groups: Record<string, Skill[]> = {}
    filteredSkills.forEach(skill => {
      if (!groups[skill.category]) {
        groups[skill.category] = []
      }
      groups[skill.category].push(skill)
    })
    return groups
  }, [filteredSkills])

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { all: skills.length }
    skills.forEach(skill => {
      counts[skill.category] = (counts[skill.category] || 0) + 1
    })
    return counts
  }, [skills])

  const runningCount = skills.filter(s => s.status === 'running').length

  return (
    <div className="skill-list">
      <div className="mb-4 space-y-3">
        <Input
          placeholder="搜索技能名称、描述..."
          prefix={<SearchOutlined className="text-gray-400" />}
          value={searchText}
          onChange={e => setSearchText(e.target.value)}
          allowClear
          size="large"
        />

        <div className="flex flex-wrap gap-2">
          <Select
            value={category}
            onChange={setCategory}
            style={{ minWidth: 120 }}
            suffixIcon={<FilterOutlined />}
          >
            {categories.map(cat => (
              <Select.Option key={cat.value} value={cat.value}>
                <Space>
                  {cat.label}
                  {categoryCounts[cat.value] !== undefined && (
                    <Badge count={categoryCounts[cat.value]} style={{ backgroundColor: '#5A67D8' }} />
                  )}
                </Space>
              </Select.Option>
            ))}
          </Select>

          <Select
            value={industry}
            onChange={setIndustry}
            style={{ minWidth: 140 }}
            placeholder="选择行业"
          >
            {industries.map(ind => (
              <Select.Option key={ind.value} value={ind.value}>
                {ind.label}
              </Select.Option>
            ))}
          </Select>

          <div className="flex-1" />

          <Space>
            <Tag color={runningCount > 0 ? 'processing' : 'default'}>
              {runningCount > 0 ? `${runningCount} 个运行中` : '无运行中'}
            </Tag>
            <div className="flex border border-gray-200 rounded overflow-hidden">
              <button
                className={`px-3 py-1 ${viewMode === 'grid' ? 'bg-blue-500 text-white' : 'bg-white'}`}
                onClick={() => setViewMode('grid')}
              >
                <AppstoreOutlined />
              </button>
              <button
                className={`px-3 py-1 ${viewMode === 'list' ? 'bg-blue-500 text-white' : 'bg-white'}`}
                onClick={() => setViewMode('list')}
              >
                <UnorderedListOutlined />
              </button>
            </div>
          </Space>
        </div>
      </div>

      {filteredSkills.length === 0 ? (
        <Empty
          description={
            <span>
              {searchText || category !== 'all' || industry !== 'all'
                ? '未找到匹配的技能'
                : '暂无已安装技能'}
            </span>
          }
          className="py-12"
        />
      ) : viewMode === 'grid' ? (
        <Tabs
          defaultActiveKey="all"
          items={[
            {
              key: 'all',
              label: `全部 (${filteredSkills.length})`,
              children: (
                <Row gutter={[16, 16]}>
                  <AnimatePresence>
                    {filteredSkills.map((skill, index) => (
                      <Col key={skill.id} xs={24} sm={12} md={8} lg={6}>
                        <motion.div
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -20 }}
                          transition={{ delay: index * 0.05 }}
                        >
                          <SkillCard
                            skill={skill}
                            onClick={() => onSkillClick?.(skill)}
                            onExecute={() => onSkillExecute?.(skill)}
                          />
                        </motion.div>
                      </Col>
                    ))}
                  </AnimatePresence>
                </Row>
              )
            },
            ...Object.entries(groupedSkills).map(([cat, catSkills]) => ({
              key: cat,
              label: `${cat} (${catSkills.length})`,
              children: (
                <Row gutter={[16, 16]}>
                  <AnimatePresence>
                    {catSkills.map((skill, index) => (
                      <Col key={skill.id} xs={24} sm={12} md={8} lg={6}>
                        <motion.div
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -20 }}
                          transition={{ delay: index * 0.05 }}
                        >
                          <SkillCard
                            skill={skill}
                            onClick={() => onSkillClick?.(skill)}
                            onExecute={() => onSkillExecute?.(skill)}
                          />
                        </motion.div>
                      </Col>
                    ))}
                  </AnimatePresence>
                </Row>
              )
            }))
          ]}
        />
      ) : (
        <div className="space-y-2">
          <AnimatePresence>
            {filteredSkills.map((skill, index) => (
              <motion.div
                key={skill.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                transition={{ delay: index * 0.03 }}
              >
                <SkillCard
                  skill={skill}
                  compact
                  onClick={() => onSkillClick?.(skill)}
                  onExecute={() => onSkillExecute?.(skill)}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}

export default SkillList
