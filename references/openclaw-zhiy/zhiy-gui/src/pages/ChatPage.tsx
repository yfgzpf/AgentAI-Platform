import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import {
  Input,
  Button,
  Avatar,
  Spin,
  Select,
  Space,
  message as antMessage,
  Tag,
  Modal,
  Slider,
  Switch,
  Dropdown,
  Typography,
  Popover
} from 'antd'
import {
  SendOutlined,
  AudioOutlined,
  SoundOutlined,
  AppstoreOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  UploadOutlined,
  PaperClipOutlined,
  ThunderboltOutlined,
  MessageOutlined
} from '@ant-design/icons'
import { motion, AnimatePresence } from 'framer-motion'
import { openClawWebSocket } from '../services/websocket'
import SkillSidebar from '../components/SkillSidebar'
import SkillDetail from '../components/SkillDetail'
import TaskOrchestrator from '../components/TaskOrchestrator'
import MusicPlayer from '../components/MusicPlayer'
import FileUpload, { UploadedFile } from '../components/FileUpload'
import GuidanceCollector, { GuidanceConfig } from '../components/GuidanceCollector'
import ConversationPanel from '../components/ConversationPanel'
import type { Skill } from '../components/SkillCard'

const { Text } = Typography

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  agent?: string
  type?: 'text' | 'file' | 'image' | 'task' | 'guidance'
  suggestedActions?: string[]
  files?: UploadedFile[]
  metadata?: any
}

interface MusicTrack {
  id: string
  name: string
  artist?: string
  url: string
}

interface TaskStep {
  id: string
  name: string
  description: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'waiting_input'
  progress: number
  skillName?: string
  question?: string
  options?: string[]
  error?: string
}

interface Task {
  id: string
  description: string
  status: 'pending' | 'planning' | 'executing' | 'waiting' | 'completed' | 'failed'
  steps: TaskStep[]
  currentStepIndex: number
  progress: number
}

interface AgentState {
  name: string
  status: 'idle' | 'thinking' | 'executing' | 'waiting'
  currentTask?: string
  currentSkill?: string
  thinking?: string
}

const defaultPlaylist: MusicTrack[] = [
  { id: '1', name: '轻音乐 - 放松时刻', url: '' },
  { id: '2', name: '钢琴曲 - 静心思考', url: '' },
  { id: '3', name: '自然音 - 森林鸟鸣', url: '' },
  { id: '4', name: '电子音乐 - 专注编程', url: '' },
  { id: '5', name: '古典乐 - 莫扎特', url: '' },
]

const industryConfigs: Record<string, GuidanceConfig> = {
  construction: {
    taskType: 'contract',
    taskName: '装修合同',
    industry: '装饰建材',
    description: '生成装修合同文档',
    fields: [
      { name: 'customerName', label: '客户姓名', type: 'text', required: true },
      { name: 'area', label: '装修面积（平方米）', type: 'number', required: true },
      { name: 'style', label: '户型风格', type: 'choice', required: true, options: ['现代', '欧式', '中式', '美式', '北欧'] },
      { name: 'budget', label: '预算范围', type: 'text', required: false },
      { name: 'address', label: '装修地址', type: 'text', required: true },
      { name: 'phone', label: '联系电话', type: 'text', required: true },
    ],
    skill: 'construction/contract'
  },
  auto: {
    taskType: 'repair',
    taskName: '维修报价',
    industry: '汽修',
    description: '生成汽修维修报价单',
    fields: [
      { name: 'vehicleModel', label: '车辆型号', type: 'text', required: true },
      { name: 'licensePlate', label: '车牌号', type: 'text', required: true },
      { name: 'repairItems', label: '维修项目', type: 'multi_choice', required: true, options: ['机油更换', '轮胎更换', '刹车片更换', '空调维修', '发动机维修', '钣金喷漆'] },
      { name: 'customerName', label: '客户姓名', type: 'text', required: true },
      { name: 'phone', label: '联系电话', type: 'text', required: true },
    ],
    skill: 'auto/repair-quote'
  },
  beauty: {
    taskType: 'appointment',
    taskName: '预约服务',
    industry: '美容',
    description: '创建美容服务预约',
    fields: [
      { name: 'customerName', label: '客户姓名', type: 'text', required: true },
      { name: 'service', label: '服务项目', type: 'choice', required: true, options: ['面部护理', '身体按摩', '美甲美睫', '头发护理', 'SPA'] },
      { name: 'date', label: '预约日期', type: 'date', required: true },
      { name: 'time', label: '预约时间', type: 'choice', required: true, options: ['上午', '下午', '晚上'] },
      { name: 'phone', label: '联系电话', type: 'text', required: true },
    ],
    skill: 'beauty/appointment'
  }
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'assistant',
      content: '你好！我是智 Y，你的智慧伙伴。有什么我可以帮助你的吗？\n\n你可以：\n• 直接输入问题与我对话\n• 点击左侧技能执行自动化任务\n• 上传文件进行处理\n• 选择行业生成专业文档',
      agent: 'zhiy',
      type: 'text',
    },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [connected, setConnected] = useState(false)
  const [sessionId] = useState<string>('main')
  const [selectedModel, setSelectedModel] = useState<string>('deepseek')
  const [isListening, setIsListening] = useState(false)
  const [autoSpeak, setAutoSpeak] = useState(false)
  const [speechRate, setSpeechRate] = useState(1)
  const [showSpeechSettings, setShowSpeechSettings] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [showTaskPanel, setShowTaskPanel] = useState(false)
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null)
  const [skillDetailVisible, setSkillDetailVisible] = useState(false)
  
  const [showMusicPlayer, setShowMusicPlayer] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTrackIndex, setCurrentTrackIndex] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration] = useState(180)
  const [volume] = useState(80)
  
  const [showFileUpload, setShowFileUpload] = useState(false)
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([])
  
  const [showGuidance, setShowGuidance] = useState(false)
  const [guidanceConfig, setGuidanceConfig] = useState<GuidanceConfig | null>(null)
  const [selectedIndustry, setSelectedIndustry] = useState<string | null>(null)
  const [showConversationPanel, setShowConversationPanel] = useState(true)
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null)
  
  const [agentState, setAgentState] = useState<AgentState>({
    name: '智 Y',
    status: 'idle'
  })
  
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const speechRecognitionRef = useRef<any>(null)
  const progressInterval = useRef<ReturnType<typeof setInterval> | null>(null)

  const skills: Skill[] = useMemo(() => [
    { id: '1', name: 'browser-automation', displayName: '浏览器自动化', description: '自动化浏览器操作', category: '网页', status: 'idle' },
    { id: '2', name: 'doc-generator', displayName: '文档生成', description: '生成Word文档', category: '办公', status: 'idle' },
    { id: '3', name: 'excel-generator', displayName: 'Excel报表', description: '生成Excel报表', category: '办公', status: 'idle' },
    { id: '4', name: 'ppt-generator', displayName: 'PPT演示', description: '生成PPT演示文稿', category: '办公', status: 'idle' },
    { id: '5', name: 'web-scraper', displayName: '网页抓取', description: '抓取网页数据', category: '网页', status: 'idle' },
    { id: '6', name: 'desktop-control', displayName: '桌面控制', description: '控制桌面应用', category: '桌面', status: 'idle' },
    { id: '7', name: 'seedance-video', displayName: '视频生成', description: 'AI视频生成', category: '视频', status: 'idle' },
    { id: '8', name: 'image-gen', displayName: '图像生成', description: 'AI图像生成', category: '图像', status: 'idle' },
    { id: '9', name: 'code-executor', displayName: '代码执行', description: '安全执行代码', category: '代码', status: 'idle' },
    { id: '10', name: 'email-sender', displayName: '邮件发送', description: '发送邮件', category: '通信', status: 'idle' },
    { id: '11', name: 'wechat-bot', displayName: '微信机器人', description: '微信自动化', category: '通信', status: 'idle' },
    { id: '12', name: 'memory-keeper', displayName: '记忆写入', description: '保存记忆', category: '记忆', status: 'idle' },
    { id: '13', name: 'memory-search', displayName: '记忆搜索', description: '搜索记忆', category: '记忆', status: 'idle' },
    { id: '14', name: 'skill-creator', displayName: '技能创建', description: '创建新技能', category: '元', status: 'idle' },
  ], [])

  const recentSkills = useMemo(() => skills.slice(0, 5), [skills])

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const addMessage = useCallback((msg: Omit<Message, 'id'>) => {
    setMessages(prev => [...prev, { ...msg, id: Date.now().toString() }])
  }, [])

  useEffect(() => {
    const initWebSocket = async () => {
      if (openClawWebSocket.getConnectionStatus()) {
        setConnected(true)
        return
      }
      
      try {
        await openClawWebSocket.connect()
        setConnected(true)
        antMessage.success('已连接到智 Y 后端服务')
      } catch (error) {
        console.error('Failed to connect:', error)
        setConnected(false)
        antMessage.warning('无法连接到后端服务，请检查OpenClaw Gateway是否启动')
      }
    }

    initWebSocket()

    const unsubMessage = openClawWebSocket.subscribe('message', (data) => {
      if (data.content) {
        addMessage({
          role: data.role || 'assistant',
          content: data.content,
          agent: 'zhiy',
          type: 'text',
          suggestedActions: data.suggestedActions || [],
        })
        setLoading(false)
        
        if (autoSpeak && data.role === 'assistant') {
          speakText(data.content)
        }
      }
    })

    const unsubConnected = openClawWebSocket.subscribe('connected', () => {
      setConnected(true)
    })

    const unsubDisconnected = openClawWebSocket.subscribe('disconnected', () => {
      setConnected(false)
    })

    const unsubAgentState = openClawWebSocket.subscribe('agent_state_changed' as any, (data: AgentState) => {
      setAgentState(data)
    })

    return () => {
      unsubMessage()
      unsubConnected()
      unsubDisconnected()
      unsubAgentState()
    }
  }, [addMessage, autoSpeak])

  useEffect(() => {
    if (isPlaying) {
      progressInterval.current = setInterval(() => {
        setCurrentTime(prev => {
          if (prev >= duration) {
            handleNextTrack()
            return 0
          }
          return prev + 1
        })
      }, 1000)
    } else {
      if (progressInterval.current) {
        clearInterval(progressInterval.current)
      }
    }

    return () => {
      if (progressInterval.current) {
        clearInterval(progressInterval.current)
      }
    }
  }, [isPlaying])

  const speakText = (text: string) => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel()
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.rate = speechRate
      utterance.lang = 'zh-CN'
      window.speechSynthesis.speak(utterance)
    }
  }

  const handleSend = () => {
    if (!input.trim() && uploadedFiles.length === 0) return
    
    if (uploadedFiles.length > 0) {
      addMessage({
        role: 'user',
        content: input || '上传了文件',
        agent: 'user',
        type: 'file',
        files: uploadedFiles,
      })
      setUploadedFiles([])
    } else {
      addMessage({
        role: 'user',
        content: input,
        agent: 'user',
        type: 'text',
      })
    }
    
    setLoading(true)
    openClawWebSocket.send(input, sessionId)
    setInput('')
  }

  const handleFileUpload = (files: UploadedFile[]) => {
    setUploadedFiles(files)
    antMessage.success(`已添加 ${files.length} 个文件`)
  }

  const handleIndustrySelect = (industry: string) => {
    const config = industryConfigs[industry]
    if (config) {
      setGuidanceConfig(config)
      setShowGuidance(true)
      setSelectedIndustry(industry)
    }
  }

  const handleGuidanceComplete = (data: Record<string, any>) => {
    addMessage({
      role: 'user',
      content: `创建${guidanceConfig?.taskName || '任务'}：${JSON.stringify(data, null, 2)}`,
      agent: 'user',
      type: 'guidance',
      metadata: { industry: selectedIndustry, taskType: guidanceConfig?.taskType, data }
    })
    
    setLoading(true)
    openClawWebSocket.send(`请帮我生成${guidanceConfig?.taskName}，信息如下：${JSON.stringify(data)}`, sessionId)
    
    setShowGuidance(false)
    setGuidanceConfig(null)
  }

  const handleSkillExecute = async (skill: Skill, params: Record<string, any>) => {
    addMessage({
      role: 'user',
      content: `执行技能：${skill.displayName}`,
      agent: 'user',
      type: 'task',
    })
    
    setLoading(true)
    openClawWebSocket.send(`执行技能 ${skill.name}，参数：${JSON.stringify(params)}`, sessionId)
    setSkillDetailVisible(false)
  }

  const toggleListening = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) {
      antMessage.warning('浏览器不支持语音识别')
      return
    }
    
    if (isListening) {
      speechRecognitionRef.current?.stop()
      setIsListening(false)
    } else {
      speechRecognitionRef.current = new SpeechRecognition()
      speechRecognitionRef.current.continuous = true
      speechRecognitionRef.current.lang = 'zh-CN'
      speechRecognitionRef.current.onresult = (event: any) => {
        let transcript = ''
        for (let i = event.resultIndex; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript
        }
        setInput(transcript)
      }
      speechRecognitionRef.current.start()
      setIsListening(true)
    }
  }

  const handleNextTrack = () => {
    setCurrentTrackIndex(prev => (prev + 1) % defaultPlaylist.length)
    setCurrentTime(0)
  }

  const handleNewConversation = () => {
    setMessages([
      {
        id: Date.now().toString(),
        role: 'assistant',
        content: '你好！我是智 Y.Ai，有什么可以帮助你的吗？',
        agent: 'zhiy',
        type: 'text',
      },
    ])
    setCurrentConversationId(null)
    antMessage.success('已创建新对话')
  }

  const handleSelectConversation = (conv: any) => {
    setCurrentConversationId(conv.id)
    const stored = localStorage.getItem(`zhiy_conv_messages_${conv.id}`)
    if (stored) {
      setMessages(JSON.parse(stored))
    }
    antMessage.info(`已切换到: ${conv.title}`)
  }

  const handleDeleteConversation = (id: string) => {
    localStorage.removeItem(`zhiy_conv_messages_${id}`)
    if (currentConversationId === id) {
      handleNewConversation()
    }
  }

  useEffect(() => {
    if (messages.length > 1 && currentConversationId) {
      localStorage.setItem(`zhiy_conv_messages_${currentConversationId}`, JSON.stringify(messages))
    }
  }, [messages, currentConversationId])

  const industryMenuItems = [
    { key: 'construction', label: '装饰建材', icon: '🏠' },
    { key: 'auto', label: '汽修行业', icon: '🚗' },
    { key: 'beauty', label: '美容行业', icon: '💆' },
  ]

  return (
    <div className="h-full flex bg-gray-50">
      <AnimatePresence>
        {!sidebarCollapsed && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 280, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="border-r border-gray-200 overflow-hidden bg-white"
          >
            <SkillSidebar
              skills={skills}
              recentSkills={recentSkills}
              onSkillClick={(skill) => {
                setSelectedSkill(skill)
                setSkillDetailVisible(true)
              }}
              collapsed={false}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex-1 flex flex-col h-full">
        <div className="flex-1 overflow-y-auto p-4">
          <div className="max-w-4xl mx-auto">
            <div className="flex items-center justify-between mb-4 sticky top-0 bg-gray-50 py-2 z-10">
              <div className="flex items-center gap-2">
                <Button
                  type="text"
                  icon={sidebarCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                  onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                />
                <h2 className="text-xl font-bold">智 Y 对话</h2>
                <Tag color={connected ? 'green' : 'red'}>
                  {connected ? '已连接' : '未连接'}
                </Tag>
                {agentState.status !== 'idle' && (
                  <Tag color="purple">
                    {agentState.status === 'thinking' ? '思考中...' : 
                     agentState.status === 'executing' ? '执行中...' : '等待输入'}
                  </Tag>
                )}
              </div>
              <Space>
                <Dropdown
                  menu={{
                    items: industryMenuItems.map(item => ({
                      key: item.key,
                      label: (
                        <Space>
                          <span>{item.icon}</span>
                          <span>{item.label}</span>
                        </Space>
                      ),
                      onClick: () => handleIndustrySelect(item.key)
                    }))
                  }}
                >
                  <Button icon={<AppstoreOutlined />}>
                    行业任务
                  </Button>
                </Dropdown>
                <Select
                  value={selectedModel}
                  onChange={setSelectedModel}
                  style={{ width: 120 }}
                  options={[
                    { value: 'deepseek', label: 'DeepSeek' },
                    { value: 'doubao', label: '豆包' },
                    { value: 'kimi', label: 'Kimi' },
                    { value: 'qianwen', label: '千问' },
                    { value: 'gemini', label: 'Gemini' },
                  ]}
                />
                <Button
                  icon={<ThunderboltOutlined />}
                  onClick={() => setShowTaskPanel(!showTaskPanel)}
                  type={showTaskPanel ? 'primary' : 'default'}
                >
                  任务
                </Button>
                <Button
                  icon={<MessageOutlined />}
                  onClick={() => setShowConversationPanel(!showConversationPanel)}
                  type={showConversationPanel ? 'primary' : 'default'}
                >
                  对话
                </Button>
                <Popover
                  content={
                    <div className="w-64">
                      <MusicPlayer
                        playlist={defaultPlaylist}
                        onClose={() => setShowMusicPlayer(false)}
                      />
                    </div>
                  }
                  title={null}
                  trigger="click"
                  open={showMusicPlayer}
                  onOpenChange={setShowMusicPlayer}
                >
                  <Button
                    icon={<SoundOutlined />}
                    type={isPlaying ? 'primary' : 'default'}
                  >
                    音乐
                  </Button>
                </Popover>
              </Space>
            </div>

            <div className="space-y-4 mb-4">
              {messages.map((msg) => (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div className={`flex gap-3 max-w-[80%] ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                    <Avatar 
                      className="flex-shrink-0"
                      style={{ 
                        backgroundColor: msg.role === 'user' ? '#5A67D8' : '#F687B3',
                      }}
                    >
                      {msg.role === 'user' ? '我' : '智'}
                    </Avatar>
                    <div className={`p-4 rounded-2xl ${
                      msg.role === 'user' 
                        ? 'bg-[#5A67D8] text-white' 
                        : 'bg-white shadow-sm'
                    }`}>
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                      
                      {msg.files && msg.files.length > 0 && (
                        <div className="mt-2 space-y-1">
                          {msg.files.map(file => (
                            <Tag key={file.uid} icon={<PaperClipOutlined />} color="blue">
                              {file.name}
                            </Tag>
                          ))}
                        </div>
                      )}
                      
                      {msg.suggestedActions && msg.suggestedActions.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {msg.suggestedActions.map((action, idx) => (
                            <Button
                              key={idx}
                              size="small"
                              onClick={() => setInput(action)}
                            >
                              {action}
                            </Button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </motion.div>
              ))}
              
              {loading && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex justify-start"
                >
                  <div className="flex gap-3">
                    <Avatar style={{ backgroundColor: '#F687B3' }}>智</Avatar>
                    <div className="bg-white p-4 rounded-2xl shadow-sm">
                      <Spin />
                      <Text type="secondary" className="ml-2">思考中...</Text>
                    </div>
                  </div>
                </motion.div>
              )}
              
              <div ref={messagesEndRef} />
            </div>
          </div>
        </div>

        <div className="border-t border-gray-200 p-4 bg-white">
          <div className="max-w-4xl mx-auto">
            {uploadedFiles.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {uploadedFiles.map(file => (
                  <Tag
                    key={file.uid}
                    closable
                    onClose={() => setUploadedFiles(prev => prev.filter(f => f.uid !== file.uid))}
                    icon={<PaperClipOutlined />}
                    color="blue"
                  >
                    {file.name}
                  </Tag>
                ))}
              </div>
            )}
            
            <div className="flex gap-2">
              <Button
                icon={<AudioOutlined />}
                onClick={toggleListening}
                type={isListening ? 'primary' : 'default'}
                danger={isListening}
              />
              <Button
                icon={<UploadOutlined />}
                onClick={() => setShowFileUpload(true)}
              />
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onPressEnter={handleSend}
                placeholder="输入消息... (支持语音输入、文件上传)"
                size="large"
                className="flex-1"
              />
              <Button
                icon={<SoundOutlined />}
                onClick={() => setShowSpeechSettings(true)}
              />
              <Button
                type="primary"
                icon={<SendOutlined />}
                onClick={handleSend}
                loading={loading}
                size="large"
              >
                发送
              </Button>
            </div>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {showTaskPanel && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 320, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="border-l border-gray-200 pl-4 overflow-hidden bg-white"
          >
            <TaskOrchestrator />
          </motion.div>
        )}
      </AnimatePresence>

      <Modal
        title="语音设置"
        open={showSpeechSettings}
        onCancel={() => setShowSpeechSettings(false)}
        footer={null}
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">语速: {speechRate.toFixed(1)}x</label>
            <Slider
              min={0.5}
              max={2}
              step={0.1}
              value={speechRate}
              onChange={setSpeechRate}
            />
          </div>
          <div className="flex items-center justify-between">
            <span>自动朗读回复</span>
            <Switch checked={autoSpeak} onChange={setAutoSpeak} />
          </div>
        </div>
      </Modal>

      <SkillDetail
        skill={selectedSkill}
        visible={skillDetailVisible}
        onClose={() => setSkillDetailVisible(false)}
        onExecute={handleSkillExecute}
      />

      <FileUpload
        visible={showFileUpload}
        onClose={() => setShowFileUpload(false)}
        onUpload={handleFileUpload}
      />

      <GuidanceCollector
        visible={showGuidance}
        config={guidanceConfig}
        onClose={() => {
          setShowGuidance(false)
          setGuidanceConfig(null)
        }}
        onComplete={handleGuidanceComplete}
      />

      <ConversationPanel
        visible={showConversationPanel}
        onSelectConversation={handleSelectConversation}
        onNewConversation={handleNewConversation}
        onDeleteConversation={handleDeleteConversation}
      />
    </div>
  )
}
