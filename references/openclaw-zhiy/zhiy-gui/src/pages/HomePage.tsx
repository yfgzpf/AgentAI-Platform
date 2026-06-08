import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Card, Row, Col, Statistic, Button, List, Tag, Tooltip } from 'antd'
import {
  MessageOutlined,
  AppstoreOutlined,
  RobotOutlined,
  ThunderboltOutlined,
  SettingOutlined,
  ApiOutlined,
  CloudServerOutlined,
  CheckCircleOutlined,
  SyncOutlined,
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { openClawWebSocket } from '../services/websocket'

interface SystemStatus {
  gateway: 'online' | 'offline' | 'connecting'
  openclaw: 'online' | 'offline' | 'connecting'
  skills: number
  agents: number
}

export default function HomePage() {
  const navigate = useNavigate()
  const [status, setStatus] = useState<SystemStatus>({
    gateway: 'connecting',
    openclaw: 'connecting',
    skills: 0,
    agents: 0,
  })

  useEffect(() => {
    checkSystemStatus()
    const interval = setInterval(checkSystemStatus, 30000)
    return () => clearInterval(interval)
  }, [])

  const checkSystemStatus = async () => {
    const wsConnected = openClawWebSocket.getConnectionStatus()
    
    if (wsConnected) {
      setStatus(prev => ({ 
        ...prev, 
        gateway: 'online',
        openclaw: 'online',
      }))
    } else {
      try {
        await openClawWebSocket.connect()
        setStatus(prev => ({ 
          ...prev, 
          gateway: 'online',
          openclaw: 'online',
        }))
      } catch {
        setStatus(prev => ({ 
          ...prev, 
          gateway: 'offline',
          openclaw: 'offline',
        }))
      }
    }

    setStatus(prev => ({ 
      ...prev, 
      skills: 14,
      agents: 4 
    }))
  }

  const getStatusTag = (s: 'online' | 'offline' | 'connecting') => {
    const config = {
      online: { color: 'green', icon: <CheckCircleOutlined />, text: '在线' },
      offline: { color: 'red', icon: <ThunderboltOutlined />, text: '离线' },
      connecting: { color: 'orange', icon: <SyncOutlined spin />, text: '连接中' },
    }
    const c = config[s]
    return <Tag color={c.color} icon={c.icon}>{c.text}</Tag>
  }

  const quickActions = [
    { key: 'chat', title: '开始对话', icon: <MessageOutlined />, path: '/chat', color: '#5A67D8' },
    { key: 'skills', title: '技能市场', icon: <AppstoreOutlined />, path: '/skills', color: '#F687B3' },
    { key: 'agents', title: '智能体', icon: <RobotOutlined />, path: '/agents', color: '#52c41a' },
    { key: 'settings', title: '系统设置', icon: <SettingOutlined />, path: '/settings', color: '#faad14' },
  ]

  const recentSkills = [
    { name: 'browser-automation', desc: '浏览器自动化', category: '工具' },
    { name: 'doc-generator', desc: '文档生成', category: '办公' },
    { name: 'video-composer', desc: '视频合成', category: '媒体' },
    { name: 'wechat-bot', desc: '微信机器人', category: '通讯' },
  ]

  return (
    <div>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <h1 className="text-3xl font-bold mb-2">欢迎使用 智 Y.Ai</h1>
        <p className="text-gray-500 mb-8">你的智慧伙伴，与你同行</p>
      </motion.div>

      <Row gutter={[16, 16]} className="mb-8">
        <Col xs={24} sm={12} lg={6}>
          <motion.div
            whileHover={{ scale: 1.02 }}
            transition={{ type: 'spring', stiffness: 300 }}
          >
            <Card hoverable>
              <Statistic
                title="网关状态"
                value={status.gateway === 'online' ? '运行中' : status.gateway === 'connecting' ? '连接中' : '离线'}
                prefix={<CloudServerOutlined />}
                valueStyle={{ color: status.gateway === 'online' ? '#52c41a' : status.gateway === 'connecting' ? '#faad14' : '#ff4d4f' }}
              />
              <div className="mt-2">{getStatusTag(status.gateway)}</div>
            </Card>
          </motion.div>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <motion.div
            whileHover={{ scale: 1.02 }}
            transition={{ type: 'spring', stiffness: 300 }}
          >
            <Card hoverable>
              <Statistic
                title="OpenClaw"
                value={status.openclaw === 'online' ? '已连接' : status.openclaw === 'connecting' ? '连接中' : '未连接'}
                prefix={<ApiOutlined />}
                valueStyle={{ color: status.openclaw === 'online' ? '#52c41a' : status.openclaw === 'connecting' ? '#faad14' : '#ff4d4f' }}
              />
              <div className="mt-2">{getStatusTag(status.openclaw)}</div>
            </Card>
          </motion.div>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <motion.div
            whileHover={{ scale: 1.02 }}
            transition={{ type: 'spring', stiffness: 300 }}
          >
            <Card hoverable>
              <Statistic
                title="已安装技能"
                value={status.skills}
                prefix={<AppstoreOutlined />}
                valueStyle={{ color: '#F687B3' }}
              />
              <Button type="link" size="small" onClick={() => navigate('/skills')}>查看全部</Button>
            </Card>
          </motion.div>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <motion.div
            whileHover={{ scale: 1.02 }}
            transition={{ type: 'spring', stiffness: 300 }}
          >
            <Card hoverable>
              <Statistic
                title="可用智能体"
                value={status.agents}
                prefix={<RobotOutlined />}
                valueStyle={{ color: '#52c41a' }}
              />
              <Button type="link" size="small" onClick={() => navigate('/agents')}>查看全部</Button>
            </Card>
          </motion.div>
        </Col>
      </Row>

      <Row gutter={[16, 16]} className="mb-8">
        <Col xs={24} lg={12}>
          <Card title="快捷操作">
            <Row gutter={[12, 12]}>
              {quickActions.map(action => (
                <Col xs={12} key={action.key}>
                  <Tooltip title={action.title}>
                    <motion.div
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                    >
                      <Button
                        type="primary"
                        icon={action.icon}
                        size="large"
                        block
                        onClick={() => navigate(action.path)}
                        style={{ 
                          background: action.color,
                          height: '60px',
                          fontSize: '14px'
                        }}
                      >
                        {action.title}
                      </Button>
                    </motion.div>
                  </Tooltip>
                </Col>
              ))}
            </Row>
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card 
            title="可用技能" 
            extra={<Button type="link" onClick={() => navigate('/skills')}>查看更多</Button>}
          >
            <List
              size="small"
              dataSource={recentSkills}
              renderItem={item => (
                <List.Item>
                  <div className="flex items-center justify-between w-full">
                    <div>
                      <span className="font-medium">{item.name}</span>
                      <span className="text-gray-400 ml-2">- {item.desc}</span>
                    </div>
                    <Tag color="blue">{item.category}</Tag>
                  </div>
                </List.Item>
              )}
            />
          </Card>
        </Col>
      </Row>

      <Card title="快速开始">
        <Row gutter={[16, 16]}>
          <Col xs={24} md={12}>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-[#5A67D8] flex items-center justify-center text-white">1</div>
                <div>
                  <p className="font-medium">配置 API 密钥</p>
                  <p className="text-sm text-gray-400">在设置页面配置 DeepSeek 或其他模型 API</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-[#5A67D8] flex items-center justify-center text-white">2</div>
                <div>
                  <p className="font-medium">安装技能</p>
                  <p className="text-sm text-gray-400">从技能市场安装需要的技能</p>
                </div>
              </div>
            </div>
          </Col>
          <Col xs={24} md={12}>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-[#F687B3] flex items-center justify-center text-white">3</div>
                <div>
                  <p className="font-medium">开始对话</p>
                  <p className="text-sm text-gray-400">告诉 AI 您的需求，它会自动调用工具完成</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-[#F687B3] flex items-center justify-center text-white">4</div>
                <div>
                  <p className="font-medium">享受自动化</p>
                  <p className="text-sm text-gray-400">AI 会自动打开浏览器、操作文件、发送消息</p>
                </div>
              </div>
            </div>
          </Col>
        </Row>
      </Card>
    </div>
  )
}
