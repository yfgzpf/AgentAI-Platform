import React, { useState } from 'react'
import {
  Modal,
  Descriptions,
  Tag,
  Button,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Divider,
  Typography,
  Alert,
  Spin,
  Result,
  Collapse,
  Tooltip
} from 'antd'
import {
  PlayCircleOutlined,
  CloseOutlined,
  InfoCircleOutlined,
  CheckCircleOutlined,
  LoadingOutlined,
  HistoryOutlined,
  CodeOutlined,
  FileTextOutlined
} from '@ant-design/icons'
import { motion, AnimatePresence } from 'framer-motion'
import type { Skill, SkillParam } from './SkillCard'

const { Text, Title, Paragraph } = Typography
const { Panel } = Collapse
const { TextArea } = Input

interface SkillDetailProps {
  skill: Skill | null
  visible: boolean
  onClose: () => void
  onExecute?: (skill: Skill, params: Record<string, any>) => Promise<void>
}

const getParamTypeComponent = (param: SkillParam) => {
  switch (param.type) {
    case 'number':
      return (
        <InputNumber
          placeholder={`请输入${param.label}`}
          style={{ width: '100%' }}
          min={0}
        />
      )
    case 'choice':
      return (
        <Select placeholder={`请选择${param.label}`}>
          {param.options?.map(opt => (
            <Select.Option key={opt} value={opt}>{opt}</Select.Option>
          ))}
        </Select>
      )
    case 'textarea':
      return <TextArea rows={4} placeholder={`请输入${param.label}`} />
    case 'file':
      return (
        <Input
          placeholder="输入文件路径或拖拽文件"
          suffix={<FileTextOutlined />}
        />
      )
    default:
      return <Input placeholder={`请输入${param.label}`} />
  }
}

const SkillDetail: React.FC<SkillDetailProps> = ({
  skill,
  visible,
  onClose,
  onExecute
}) => {
  const [form] = Form.useForm()
  const [executing, setExecuting] = useState(false)
  const [result, setResult] = useState<{ success: boolean; message: string; data?: any } | null>(null)

  const handleExecute = async () => {
    if (!skill) return

    try {
      const values = await form.validateFields()
      setExecuting(true)
      setResult(null)

      await onExecute?.(skill, values)

      setResult({
        success: true,
        message: '技能执行成功！'
      })
    } catch (error: any) {
      setResult({
        success: false,
        message: error.message || '技能执行失败'
      })
    } finally {
      setExecuting(false)
    }
  }

  const handleClose = () => {
    form.resetFields()
    setResult(null)
    onClose()
  }

  if (!skill) return null

  const categoryColors: Record<string, string> = {
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

  const categoryColor = categoryColors[skill.category] || '#5A67D8'

  return (
    <Modal
      open={visible}
      onCancel={handleClose}
      footer={null}
      width={720}
      centered
      destroyOnClose
      closeIcon={<CloseOutlined />}
      title={
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: `${categoryColor}20` }}
          >
            <ThunderboltOutlined style={{ color: categoryColor, fontSize: '20px' }} />
          </div>
          <div>
            <Title level={4} style={{ margin: 0 }}>{skill.displayName}</Title>
            <Space size={4}>
              <Tag color={categoryColor}>{skill.category}</Tag>
              {skill.industry && <Tag color="blue">{skill.industry}</Tag>}
              {skill.version && <Tag>v{skill.version}</Tag>}
            </Space>
          </div>
        </div>
      }
    >
      <AnimatePresence mode="wait">
        {executing ? (
          <motion.div
            key="executing"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center justify-center py-12"
          >
            <Spin size="large" />
            <Text className="mt-4">正在执行技能...</Text>
          </motion.div>
        ) : result ? (
          <motion.div
            key="result"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
          >
            <Result
              status={result.success ? 'success' : 'error'}
              title={result.success ? '执行成功' : '执行失败'}
              subTitle={result.message}
              extra={[
                <Button key="close" onClick={handleClose}>
                  关闭
                </Button>,
                <Button
                  key="retry"
                  type="primary"
                  onClick={() => setResult(null)}
                  style={{ backgroundColor: categoryColor, borderColor: categoryColor }}
                >
                  重新执行
                </Button>
              ]}
            />
            {result.data && (
              <Collapse className="mt-4">
                <Panel header="执行结果详情" key="1">
                  <pre className="bg-gray-50 p-4 rounded overflow-auto max-h-60">
                    {JSON.stringify(result.data, null, 2)}
                  </pre>
                </Panel>
              </Collapse>
            )}
          </motion.div>
        ) : (
          <motion.div
            key="form"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <Alert
              message={skill.description}
              type="info"
              showIcon
              className="mb-4"
            />

            <Collapse defaultActiveKey={['params']} className="mb-4">
              <Panel
                header={
                  <Space>
                    <InfoCircleOutlined />
                    <span>技能信息</span>
                  </Space>
                }
                key="info"
              >
                <Descriptions column={2} size="small">
                  <Descriptions.Item label="技能名称">{skill.name}</Descriptions.Item>
                  <Descriptions.Item label="显示名称">{skill.displayName}</Descriptions.Item>
                  <Descriptions.Item label="分类">{skill.category}</Descriptions.Item>
                  <Descriptions.Item label="行业">{skill.industry || '通用'}</Descriptions.Item>
                  <Descriptions.Item label="作者">{skill.author || '智 Y.Ai Team'}</Descriptions.Item>
                  <Descriptions.Item label="版本">{skill.version || '1.0.0'}</Descriptions.Item>
                  {skill.lastUsed && (
                    <Descriptions.Item label="最近使用">{skill.lastUsed}</Descriptions.Item>
                  )}
                </Descriptions>
              </Panel>
            </Collapse>

            {skill.params && skill.params.length > 0 && (
              <Form
                form={form}
                layout="vertical"
                initialValues={skill.params.reduce((acc, p) => {
                  if (p.default) acc[p.name] = p.default
                  return acc
                }, {} as Record<string, any>)}
              >
                <Divider orientation="left">
                  <Space>
                    <CodeOutlined />
                    <span>参数配置</span>
                  </Space>
                </Divider>

                {skill.params.map(param => (
                  <Form.Item
                    key={param.name}
                    name={param.name}
                    label={
                      <Space>
                        <span>{param.label}</span>
                        {param.required && <Tag color="red">必填</Tag>}
                        {param.description && (
                          <Tooltip title={param.description}>
                            <InfoCircleOutlined className="text-gray-400" />
                          </Tooltip>
                        )}
                      </Space>
                    }
                    rules={param.required ? [{ required: true, message: `请输入${param.label}` }] : []}
                  >
                    {getParamTypeComponent(param)}
                  </Form.Item>
                ))}
              </Form>
            )}

            <div className="flex justify-end gap-2 mt-6">
              <Button onClick={handleClose}>取消</Button>
              <Button
                type="primary"
                icon={<PlayCircleOutlined />}
                onClick={handleExecute}
                style={{ backgroundColor: categoryColor, borderColor: categoryColor }}
              >
                执行技能
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Modal>
  )
}

function ThunderboltOutlined(props: any) {
  return <span {...props}>⚡</span>
}

export default SkillDetail
