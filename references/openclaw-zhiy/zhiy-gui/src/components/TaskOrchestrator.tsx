import React, { useState, useEffect } from 'react'
import { Card, Steps, Progress, Tag, Timeline, Button, Input, Space, Typography, Collapse, Badge, Tooltip, Spin } from 'antd'
import {
  CheckCircleOutlined,
  LoadingOutlined,
  ClockCircleOutlined,
  QuestionCircleOutlined,
  CloseCircleOutlined,
  RobotOutlined,
  ThunderboltOutlined,
  FileTextOutlined,
  PictureOutlined,
  VideoCameraOutlined,
  GlobalOutlined,
  MessageOutlined
} from '@ant-design/icons'
import { motion, AnimatePresence } from 'framer-motion'
import { openClawWebSocket } from '../services/websocket'

const { Text, Title } = Typography
const { Panel } = Collapse

interface TaskStep {
  id: string
  name: string
  description: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'waiting_input'
  progress: number
  startedAt?: string
  completedAt?: string
  result?: any
  error?: string
  skillName?: string
  question?: string
  options?: string[]
}

interface Task {
  id: string
  sessionId: string
  type: string
  description: string
  status: 'pending' | 'planning' | 'executing' | 'waiting' | 'completed' | 'failed'
  steps: TaskStep[]
  currentStepIndex: number
  progress: number
  createdAt: string
  updatedAt: string
  result?: any
}

interface AgentState {
  name: string
  status: 'idle' | 'thinking' | 'executing' | 'waiting'
  currentTask?: string
  currentSkill?: string
  thinking?: string
}

const getSkillIcon = (skillName?: string) => {
  if (!skillName) return <RobotOutlined />
  
  const iconMap: Record<string, React.ReactNode> = {
    'doc-generator': <FileTextOutlined />,
    'excel-generator': <FileTextOutlined />,
    'image-generator': <PictureOutlined />,
    'seedance-video': <VideoCameraOutlined />,
    'browser-auto': <GlobalOutlined />,
    'llm-service': <MessageOutlined />,
    'intent-analyzer': <ThunderboltOutlined />
  }
  
  return iconMap[skillName] || <RobotOutlined />
}

const getStatusColor = (status: string) => {
  const colors: Record<string, string> = {
    'pending': '#8c8c8c',
    'running': '#1890ff',
    'completed': '#52c41a',
    'failed': '#ff4d4f',
    'waiting_input': '#faad14'
  }
  return colors[status] || '#8c8c8c'
}

const getStatusIcon = (status: string) => {
  switch (status) {
    case 'pending':
      return <ClockCircleOutlined style={{ color: '#8c8c8c' }} />
    case 'running':
      return <LoadingOutlined style={{ color: '#1890ff' }} />
    case 'completed':
      return <CheckCircleOutlined style={{ color: '#52c41a' }} />
    case 'failed':
      return <CloseCircleOutlined style={{ color: '#ff4d4f' }} />
    case 'waiting_input':
      return <QuestionCircleOutlined style={{ color: '#faad14' }} />
    default:
      return <ClockCircleOutlined />
  }
}

const AgentStatusIndicator: React.FC<{ state: AgentState }> = ({ state }) => {
  const statusColors: Record<string, string> = {
    'idle': '#8c8c8c',
    'thinking': '#722ed1',
    'executing': '#1890ff',
    'waiting': '#faad14'
  }
  
  const statusTexts: Record<string, string> = {
    'idle': '空闲',
    'thinking': '思考中',
    'executing': '执行中',
    'waiting': '等待输入'
  }
  
  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-center gap-3 p-3 bg-gradient-to-r from-purple-50 to-blue-50 rounded-lg mb-4"
    >
      <div className="relative">
        <motion.div
          animate={state.status === 'thinking' || state.status === 'executing' ? { scale: [1, 1.1, 1] } : {}}
          transition={{ repeat: Infinity, duration: 1.5 }}
          className="w-10 h-10 rounded-full flex items-center justify-center"
          style={{ backgroundColor: statusColors[state.status] }}
        >
          <RobotOutlined className="text-white text-xl" />
        </motion.div>
        {state.status !== 'idle' && (
          <motion.div
            animate={{ scale: [1, 1.5], opacity: [0.5, 0] }}
            transition={{ repeat: Infinity, duration: 1 }}
            className="absolute inset-0 rounded-full"
            style={{ backgroundColor: statusColors[state.status] }}
          />
        )}
      </div>
      
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <Text strong>{state.name}</Text>
          <Tag color={statusColors[state.status]}>{statusTexts[state.status]}</Tag>
        </div>
        {state.thinking && (
          <Text type="secondary" className="text-sm">{state.thinking}</Text>
        )}
      </div>
      
      {state.currentSkill && (
        <Tag icon={getSkillIcon(state.currentSkill)} color="blue">
          {state.currentSkill}
        </Tag>
      )}
    </motion.div>
  )
}

const TaskStepItem: React.FC<{
  step: TaskStep
  isCurrent: boolean
  onProvideInput?: (input: string) => void
}> = ({ step, isCurrent, onProvideInput }) => {
  const [inputValue, setInputValue] = useState('')
  
  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      className={`p-3 rounded-lg mb-2 ${isCurrent ? 'bg-blue-50 border border-blue-200' : 'bg-gray-50'}`}
    >
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          {getStatusIcon(step.status)}
          <span className="text-lg">{getSkillIcon(step.skillName)}</span>
        </div>
        
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <Text strong>{step.name}</Text>
            <Tag color={getStatusColor(step.status)} className="text-xs">
              {step.status}
            </Tag>
          </div>
          <Text type="secondary" className="text-sm">{step.description}</Text>
        </div>
        
        {step.status === 'running' && (
          <Progress
            percent={step.progress}
            size="small"
            style={{ width: 100 }}
            showInfo={false}
          />
        )}
      </div>
      
      {step.status === 'waiting_input' && step.question && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="mt-3 p-3 bg-yellow-50 rounded border border-yellow-200"
        >
          <Text className="block mb-2">{step.question}</Text>
          {step.options ? (
            <Space wrap>
              {step.options.map((option, idx) => (
                <Button
                  key={idx}
                  size="small"
                  onClick={() => onProvideInput?.(option)}
                >
                  {option}
                </Button>
              ))}
            </Space>
          ) : (
            <Space.Compact style={{ width: '100%' }}>
              <Input
                value={inputValue}
                onChange={e => setInputValue(e.target.value)}
                placeholder="请输入..."
                onPressEnter={() => {
                  if (inputValue.trim()) {
                    onProvideInput?.(inputValue)
                    setInputValue('')
                  }
                }}
              />
              <Button
                type="primary"
                onClick={() => {
                  if (inputValue.trim()) {
                    onProvideInput?.(inputValue)
                    setInputValue('')
                  }
                }}
              >
                提交
              </Button>
            </Space.Compact>
          )}
        </motion.div>
      )}
      
      {step.error && (
        <Text type="danger" className="text-sm block mt-2">{step.error}</Text>
      )}
    </motion.div>
  )
}

const TaskCard: React.FC<{ task: Task }> = ({ task }) => {
  const statusColors: Record<string, string> = {
    'pending': 'default',
    'planning': 'purple',
    'executing': 'processing',
    'waiting': 'warning',
    'completed': 'success',
    'failed': 'error'
  }
  
  return (
    <Card
      size="small"
      className="mb-3"
      title={
        <div className="flex items-center justify-between">
          <Space>
            <Text strong>{task.description}</Text>
            <Tag color={statusColors[task.status]}>{task.status}</Tag>
          </Space>
          <Progress
            percent={task.progress}
            size="small"
            style={{ width: 120 }}
            status={task.status === 'failed' ? 'exception' : undefined}
          />
        </div>
      }
    >
      <AnimatePresence>
        {task.steps.map((step, index) => (
          <TaskStepItem
            key={step.id}
            step={step}
            isCurrent={index === task.currentStepIndex && task.status === 'executing'}
          />
        ))}
      </AnimatePresence>
    </Card>
  )
}

export const TaskOrchestrator: React.FC = () => {
  const [agentState, setAgentState] = useState<AgentState>({
    name: '智 Y',
    status: 'idle'
  })
  const [tasks, setTasks] = useState<Task[]>([])
  const [expanded, setExpanded] = useState(true)
  
  useEffect(() => {
    const unsubTaskUpdated = openClawWebSocket.subscribe('task_updated', (data: Task) => {
      setTasks(prev => {
        const index = prev.findIndex(t => t.id === data.id)
        if (index >= 0) {
          const newTasks = [...prev]
          newTasks[index] = data
          return newTasks
        }
        return [...prev, data]
      })
    })
    
    const unsubAgentState = openClawWebSocket.subscribe('agent_state_changed', (data: AgentState) => {
      setAgentState(data)
    })
    
    const unsubTaskCreated = openClawWebSocket.subscribe('task_created', (data: Task) => {
      setTasks(prev => [...prev, data])
    })
    
    const unsubTaskCompleted = openClawWebSocket.subscribe('task_completed', (data: Task) => {
      setTasks(prev => {
        const index = prev.findIndex(t => t.id === data.id)
        if (index >= 0) {
          const newTasks = [...prev]
          newTasks[index] = data
          return newTasks
        }
        return prev
      })
    })
    
    return () => {
      unsubTaskUpdated()
      unsubAgentState()
      unsubTaskCreated()
      unsubTaskCompleted()
    }
  }, [])
  
  const activeTasks = tasks.filter(t => 
    t.status === 'planning' || t.status === 'executing' || t.status === 'waiting'
  )
  
  return (
    <div className="task-orchestrator">
      <AgentStatusIndicator state={agentState} />
      
      {activeTasks.length > 0 && (
        <Collapse
          activeKey={expanded ? ['1'] : []}
          onChange={keys => setExpanded(keys.includes('1'))}
          className="mb-4"
        >
          <Panel
            header={
              <Space>
                <Badge count={activeTasks.length} size="small">
                  <ThunderboltOutlined />
                </Badge>
                <span>正在执行的任务</span>
              </Space>
            }
            key="1"
          >
            <AnimatePresence>
              {activeTasks.map(task => (
                <motion.div
                  key={task.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                >
                  <TaskCard task={task} />
                </motion.div>
              ))}
            </AnimatePresence>
          </Panel>
        </Collapse>
      )}
      
      {tasks.length > 0 && activeTasks.length === 0 && (
        <Card size="small" title="最近任务">
          <Timeline
            items={tasks.slice(-5).reverse().map(task => ({
              color: task.status === 'completed' ? 'green' : task.status === 'failed' ? 'red' : 'blue',
              children: (
                <div>
                  <Text>{task.description}</Text>
                  <br />
                  <Text type="secondary" className="text-xs">
                    {new Date(task.createdAt).toLocaleTimeString()}
                  </Text>
                </div>
              )
            }))}
          />
        </Card>
      )}
    </div>
  )
}

export default TaskOrchestrator
