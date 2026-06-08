import { useEffect, useState } from 'react'
import { Card, List, Avatar, Tag, Spin, Alert } from 'antd'
import { RobotOutlined } from '@ant-design/icons'

interface Agent {
  name: string
  role: string
  description: string
  isDefault: boolean
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const loadAgents = async () => {
      try {
        const response = await fetch('/api/agents')
        if (response.ok) {
          const data = await response.json()
          setAgents(data.agents || [])
        } else {
          setAgents([
            { name: 'zhiy', role: '主控智能体', description: '接收用户所有请求，分析意图，调度其他智能体', isDefault: true },
            { name: 'guidance', role: '引导智能体', description: '需求模糊时通过多轮追问收集信息', isDefault: true },
            { name: 'script-writer', role: '剧本生成智能体', description: '生成多集剧本', isDefault: true },
            { name: 'character-designer', role: '角色设计智能体', description: '创建角色形象，管理种子', isDefault: true },
            { name: 'storyboard-generator', role: '分镜生成智能体', description: '从剧本生成分镜', isDefault: true },
            { name: 'video-composer', role: '视频合成智能体', description: '合成视频', isDefault: true },
            { name: 'memory-keeper', role: '记忆管理智能体', description: '写入和检索记忆', isDefault: true },
            { name: 'skill-creator', role: '技能生成智能体', description: '自动生成新技能', isDefault: true },
            { name: 'doc-assistant', role: '文档处理智能体', description: '处理文档相关任务', isDefault: true },
            { name: 'web-assistant', role: '网页自动化智能体', description: '处理网页相关任务', isDefault: true },
          ])
        }
      } catch (err) {
        setError('无法连接到网关服务，显示默认智能体列表')
        setAgents([
          { name: 'zhiy', role: '主控智能体', description: '接收用户所有请求，分析意图，调度其他智能体', isDefault: true },
          { name: 'guidance', role: '引导智能体', description: '需求模糊时通过多轮追问收集信息', isDefault: true },
          { name: 'script-writer', role: '剧本生成智能体', description: '生成多集剧本', isDefault: true },
          { name: 'character-designer', role: '角色设计智能体', description: '创建角色形象，管理种子', isDefault: true },
          { name: 'storyboard-generator', role: '分镜生成智能体', description: '从剧本生成分镜', isDefault: true },
          { name: 'video-composer', role: '视频合成智能体', description: '合成视频', isDefault: true },
          { name: 'memory-keeper', role: '记忆管理智能体', description: '写入和检索记忆', isDefault: true },
          { name: 'skill-creator', role: '技能生成智能体', description: '自动生成新技能', isDefault: true },
          { name: 'doc-assistant', role: '文档处理智能体', description: '处理文档相关任务', isDefault: true },
          { name: 'web-assistant', role: '网页自动化智能体', description: '处理网页相关任务', isDefault: true },
        ])
      } finally {
        setLoading(false)
      }
    }

    loadAgents()
  }, [])

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Spin size="large" />
      </div>
    )
  }

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">智能体管理</h2>
      {error && (
        <Alert message="提示" description={error} type="warning" showIcon className="mb-4" />
      )}
      <List
        grid={{ gutter: 16, xs: 1, sm: 2, md: 3, lg: 4 }}
        dataSource={agents}
        renderItem={(agent) => (
          <List.Item>
            <Card hoverable>
              <div className="flex items-center gap-3 mb-3">
                <Avatar
                  size={48}
                  icon={<RobotOutlined />}
                  style={{ backgroundColor: '#5A67D8' }}
                />
                <div>
                  <div className="font-bold text-lg">{agent.name}</div>
                  <div className="text-sm text-gray-500">{agent.role}</div>
                </div>
              </div>
              <p className="text-sm text-gray-600 mb-3">{agent.description}</p>
              {agent.isDefault && <Tag color="blue">内置</Tag>}
            </Card>
          </List.Item>
        )}
      />
    </div>
  )
}
