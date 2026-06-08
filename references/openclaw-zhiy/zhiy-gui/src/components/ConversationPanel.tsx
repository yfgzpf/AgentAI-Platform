import { useState, useEffect } from 'react'
import { 
  Button,
  Typography,
  Tag,
  Input,
  Modal,
  Empty,
  Spin,
  message as antMessage
} from 'antd'
import {
  PlusOutlined,
  DeleteOutlined,
  MessageOutlined,
  SearchOutlined,
  EditOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons'
import { motion } from 'framer-motion'
import dayjs from 'dayjs'

const { Text } = Typography

interface Conversation {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messageCount: number
  preview: string
  tags?: string[]
}

interface ConversationPanelProps {
  visible?: boolean
  onClose?: () => void
  onSelectConversation?: (conversation: Conversation) => void
  onNewConversation?: () => void
  onDeleteConversation?: (id: string) => void
}

const STORAGE_KEY = 'zhiy_conversations'
const MAX_DAYS = 30

const ConversationPanel: React.FC<ConversationPanelProps> = ({
  visible = true,
  onClose,
  onSelectConversation,
  onNewConversation,
  onDeleteConversation
}) => {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')

  useEffect(() => {
    loadConversations()
  }, [])

  const loadConversations = async () => {
    setLoading(true)
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const parsed: Conversation[] = JSON.parse(stored)
        const thirtyDaysAgo = dayjs().subtract(MAX_DAYS, 'day')
        const filtered = parsed.filter((conv: Conversation) => 
          dayjs(conv.updatedAt).isAfter(thirtyDaysAgo)
        )
        setConversations(filtered)
        saveConversations(filtered)
      } else {
        setConversations([])
      }
    } catch (error) {
      console.error('Failed to load conversations:', error)
      antMessage.error('加载对话失败')
    } finally {
      setLoading(false)
    }
  }

  const saveConversations = (convs: Conversation[]) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(convs))
    } catch (error) {
      console.error('Failed to save conversations:', error)
    }
  }

  const createNewConversation = () => {
    const newConversation: Conversation = {
      id: `conv_${Date.now()}`,
      title: `新对话 ${dayjs().format('HH:mm')}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messageCount: 0,
      preview: '',
      tags: [],
    }
    
    const newConversations = [newConversation, ...conversations]
    setConversations(newConversations)
    setSelectedId(newConversation.id)
    saveConversations(newConversations)
    
    if (onNewConversation) {
      onNewConversation()
    }
  }

  const handleDeleteConversation = (id: string) => {
    Modal.confirm({
      title: '删除对话',
      content: '确定要删除这个对话吗？此操作无法恢复。',
      okText: '删除',
      cancelText: '取消',
      onOk() {
        const newConversations = conversations.filter(c => c.id !== id)
        setConversations(newConversations)
        saveConversations(newConversations)
        if (selectedId === id) {
          setSelectedId(null)
        }
        if (onDeleteConversation) {
          onDeleteConversation(id)
        }
        antMessage.success('对话已删除')
      }
    })
  }

  const handleEditTitle = (id: string) => {
    if (!editTitle.trim()) return
    
    const newConversations = conversations.map(conv => {
      if (conv.id === id) {
        return {
          ...conv,
          title: editTitle,
          updatedAt: new Date().toISOString()
        }
      }
      return conv
    })
    
    setConversations(newConversations)
    saveConversations(newConversations)
    setEditingId(null)
    setEditTitle('')
    antMessage.success('标题已更新')
  }

  const handleSelectConv = (conv: Conversation) => {
    setSelectedId(conv.id)
    if (onSelectConversation) {
      onSelectConversation(conv)
    }
  }

  const filteredConversations = conversations.filter(conv => {
    const matchesSearch = conv.title.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesPreview = conv.preview?.toLowerCase().includes(searchQuery.toLowerCase()) || false
    const matchesTags = conv.tags?.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase())) || false
    return matchesSearch || matchesPreview || matchesTags
  })

  const groupedConversations = filteredConversations.reduce((groups, conv) => {
    const date = dayjs(conv.updatedAt).format('YYYY-MM-DD')
    if (!groups[date]) {
      groups[date] = []
    }
    groups[date].push(conv)
    return groups
  }, {} as Record<string, Conversation[]>)

  const sortedDates = Object.keys(groupedConversations).sort((a, b) => 
    new Date(b).getTime() - new Date(a).getTime()
  )

  if (!visible) return null

  return (
    <div className="w-80 border-l border-gray-200 bg-white flex flex-col h-full">
      <div className="p-4 border-b">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-bold flex items-center gap-2">
            <MessageOutlined className="text-purple-500" />
            <span>对话历史</span>
          </h3>
          <Text type="secondary" className="text-xs">保留30天内对话</Text>
        </div>
        
        <div className="flex items-center gap-2 mb-3">
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={createNewConversation}
            size="small"
          >
            新建对话
          </Button>
          <Input
            placeholder="搜索对话..."
            prefix={<SearchOutlined />}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            allowClear
            size="small"
            className="flex-1"
          />
        </div>
      </div>

      <Spin spinning={loading} tip="加载中...">
        <div className="flex-1 overflow-y-auto p-2">
          {filteredConversations.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="暂无对话记录"
              style={{ marginTop: 60 }}
            />
          ) : (
            sortedDates.map((date) => (
              <div key={date} className="mb-4">
                <div className="flex items-center mb-2 px-2">
                  <Text type="secondary" className="text-xs font-medium">
                    {dayjs(date).format('MM月DD日')}
                  </Text>
                </div>
                <div className="space-y-2">
                  {groupedConversations[date].map((conv) => (
                    <motion.div
                      key={conv.id}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      className={`p-3 rounded-lg cursor-pointer transition-all hover:bg-gray-50 group ${
                        selectedId === conv.id ? 'bg-purple-50 border border-purple-200' : 'border border-transparent'
                      }`}
                      onClick={() => handleSelectConv(conv)}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex-1 min-w-0 flex items-center gap-2">
                          {selectedId === conv.id && (
                            <CheckCircleOutlined className="text-green-500 text-sm" />
                          )}
                          {editingId === conv.id ? (
                            <Input
                              value={editTitle}
                              onChange={(e) => setEditTitle(e.target.value)}
                              onPressEnter={() => handleEditTitle(conv.id)}
                              onBlur={() => handleEditTitle(conv.id)}
                              size="small"
                              className="flex-1"
                              autoFocus
                              onClick={(e) => e.stopPropagation()}
                            />
                          ) : (
                            <Text className="font-medium truncate text-sm">{conv.title}</Text>
                          )}
                        </div>
                        <div className="flex items-center gap-1 ml-2 opacity-0 group-hover:opacity-100">
                          <Button
                            type="text"
                            size="small"
                            icon={<EditOutlined />}
                            onClick={(e) => {
                              e.stopPropagation()
                              setEditingId(conv.id)
                              setEditTitle(conv.title)
                            }}
                          />
                          <Button
                            type="text"
                            size="small"
                            danger
                            icon={<DeleteOutlined />}
                            onClick={(e) => {
                              e.stopPropagation()
                              handleDeleteConversation(conv.id)
                            }}
                          />
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        <span>{dayjs(conv.updatedAt).format('HH:mm')}</span>
                        <span className="text-gray-300">|</span>
                        <span>{conv.messageCount} 条消息</span>
                      </div>
                      
                      {conv.preview && (
                        <Text type="secondary" className="text-xs line-clamp-2 mt-1 block">
                          {conv.preview}
                        </Text>
                      )}
                      
                      {conv.tags && conv.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {conv.tags.map((tag, index) => (
                            <Tag key={index} color="blue" className="text-xs m-0">
                              {tag}
                            </Tag>
                          ))}
                        </div>
                      )}
                    </motion.div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </Spin>
    </div>
  )
}

export default ConversationPanel
