import React, { useState, useEffect, useCallback } from 'react'
import {
  Modal,
  Form,
  Input,
  InputNumber,
  Select,
  Button,
  Space,
  Typography,
  Card,
  Steps,
  Result,
  Spin,
  message,
  Divider,
  Tag,
  Radio,
  Checkbox,
  Descriptions,
  Alert
} from 'antd'
import {
  RobotOutlined,
  CheckCircleOutlined,
  LoadingOutlined,
  ArrowRightOutlined,
  ArrowLeftOutlined,
  SendOutlined,
  FileTextOutlined,
  EditOutlined
} from '@ant-design/icons'
import { motion, AnimatePresence } from 'framer-motion'

const { Text, Title, Paragraph } = Typography
const { TextArea } = Input

export interface GuidanceField {
  name: string
  label: string
  type: 'text' | 'number' | 'choice' | 'textarea' | 'date' | 'multi_choice'
  required: boolean
  options?: string[]
  default?: any
  placeholder?: string
  description?: string
  validation?: {
    min?: number
    max?: number
    pattern?: string
    message?: string
  }
}

export interface GuidanceConfig {
  taskType: string
  taskName: string
  industry?: string
  description: string
  fields: GuidanceField[]
  skill?: string
}

interface GuidanceCollectorProps {
  visible: boolean
  config: GuidanceConfig | null
  onClose: () => void
  onComplete: (data: Record<string, any>) => void
  initialData?: Record<string, any>
}

const GuidanceCollector: React.FC<GuidanceCollectorProps> = ({
  visible,
  config,
  onClose,
  onComplete,
  initialData = {}
}) => {
  const [form] = Form.useForm()
  const [currentStep, setCurrentStep] = useState(0)
  const [collectedData, setCollectedData] = useState<Record<string, any>>(initialData)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showConfirmation, setShowConfirmation] = useState(false)

  useEffect(() => {
    if (visible && config) {
      setCurrentStep(0)
      setCollectedData(initialData)
      setShowConfirmation(false)
      form.resetFields()
      
      const defaults: Record<string, any> = {}
      config.fields.forEach(field => {
        if (field.default !== undefined) {
          defaults[field.name] = field.default
        }
      })
      form.setFieldsValue({ ...defaults, ...initialData })
    }
  }, [visible, config, initialData, form])

  const requiredFields = config?.fields.filter(f => f.required) || []
  const optionalFields = config?.fields.filter(f => !f.required) || []

  const getCurrentStepFields = () => {
    if (currentStep === 0) return requiredFields
    return optionalFields
  }

  const handleNext = async () => {
    try {
      const values = await form.validateFields()
      setCollectedData(prev => ({ ...prev, ...values }))
      
      if (currentStep === 0 && optionalFields.length > 0) {
        setCurrentStep(1)
        form.resetFields()
        form.setFieldsValue({ ...collectedData, ...values })
      } else {
        setShowConfirmation(true)
      }
    } catch (error) {
      message.error('请填写所有必填项')
    }
  }

  const handlePrev = () => {
    setCurrentStep(0)
    form.setFieldsValue(collectedData)
    setShowConfirmation(false)
  }

  const handleConfirm = async () => {
    setIsSubmitting(true)
    
    try {
      await new Promise(resolve => setTimeout(resolve, 500))
      onComplete(collectedData)
      message.success('需求已确认，正在处理...')
      onClose()
    } catch (error) {
      message.error('提交失败，请重试')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleEdit = () => {
    setShowConfirmation(false)
    setCurrentStep(0)
    form.setFieldsValue(collectedData)
  }

  const renderField = (field: GuidanceField) => {
    const commonProps = {
      name: field.name,
      label: field.label,
      rules: [
        { required: field.required, message: `请${field.type === 'choice' ? '选择' : '输入'}${field.label}` },
        field.validation?.pattern && {
          pattern: new RegExp(field.validation.pattern),
          message: field.validation.message || '格式不正确'
        }
      ].filter(Boolean),
      extra: field.description,
      tooltip: field.description,
    }

    switch (field.type) {
      case 'number':
        return (
          <Form.Item {...commonProps} key={field.name}>
            <InputNumber
              style={{ width: '100%' }}
              placeholder={field.placeholder || `请输入${field.label}`}
              min={field.validation?.min}
              max={field.validation?.max}
            />
          </Form.Item>
        )
      
      case 'choice':
        return (
          <Form.Item {...commonProps} key={field.name}>
            <Select
              placeholder={field.placeholder || `请选择${field.label}`}
              options={field.options?.map(opt => ({ label: opt, value: opt }))}
            />
          </Form.Item>
        )
      
      case 'multi_choice':
        return (
          <Form.Item {...commonProps} key={field.name}>
            <Checkbox.Group
              options={field.options}
            />
          </Form.Item>
        )
      
      case 'textarea':
        return (
          <Form.Item {...commonProps} key={field.name}>
            <TextArea
              rows={4}
              placeholder={field.placeholder || `请输入${field.label}`}
              showCount
            />
          </Form.Item>
        )
      
      case 'date':
        return (
          <Form.Item {...commonProps} key={field.name}>
            <Input type="date" style={{ width: '100%' }} />
          </Form.Item>
        )
      
      default:
        return (
          <Form.Item {...commonProps} key={field.name}>
            <Input placeholder={field.placeholder || `请输入${field.label}`} />
          </Form.Item>
        )
    }
  }

  if (!config) return null

  if (showConfirmation) {
    return (
      <Modal
        open={visible}
        onCancel={onClose}
        width={600}
        footer={null}
        title={
          <Space>
            <CheckCircleOutlined className="text-green-500" />
            <span>确认信息</span>
          </Space>
        }
      >
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <Alert
            message="请确认以下信息是否正确"
            type="info"
            showIcon
            className="mb-4"
          />

          <Card size="small" className="mb-4">
            <Descriptions column={1} size="small">
              <Descriptions.Item label="任务类型">
                <Tag color="blue">{config.taskName}</Tag>
              </Descriptions.Item>
              {config.industry && (
                <Descriptions.Item label="所属行业">
                  <Tag color="purple">{config.industry}</Tag>
                </Descriptions.Item>
              )}
            </Descriptions>
          </Card>

          <Card size="small" title="填写信息" className="mb-4">
            <Descriptions column={1} size="small">
              {config.fields.map(field => (
                <Descriptions.Item key={field.name} label={field.label}>
                  {Array.isArray(collectedData[field.name]) 
                    ? collectedData[field.name].join(', ')
                    : collectedData[field.name] || <Text type="secondary">未填写</Text>
                  }
                </Descriptions.Item>
              ))}
            </Descriptions>
          </Card>

          <div className="flex justify-between">
            <Button icon={<EditOutlined />} onClick={handleEdit}>
              修改信息
            </Button>
            <Space>
              <Button onClick={onClose}>取消</Button>
              <Button
                type="primary"
                icon={<SendOutlined />}
                loading={isSubmitting}
                onClick={handleConfirm}
              >
                确认并执行
              </Button>
            </Space>
          </div>
        </motion.div>
      </Modal>
    )
  }

  return (
    <Modal
      open={visible}
      onCancel={onClose}
      width={600}
      footer={null}
      title={
        <Space>
          <RobotOutlined className="text-primary" />
          <span>需求收集</span>
        </Space>
      }
    >
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
      >
        <Card size="small" className="mb-4 bg-gradient-to-r from-purple-50 to-pink-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-400 to-pink-400 flex items-center justify-center">
              <RobotOutlined className="text-white" />
            </div>
            <div>
              <Text strong>{config.taskName}</Text>
              <br />
              <Text type="secondary" className="text-sm">{config.description}</Text>
            </div>
          </div>
        </Card>

        <Steps
          current={currentStep}
          size="small"
          className="mb-4"
          items={[
            { title: '必填信息', icon: <FileTextOutlined /> },
            { title: '补充信息', icon: <EditOutlined /> },
          ]}
        />

        <Form
          form={form}
          layout="vertical"
          initialValues={collectedData}
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={currentStep}
              initial={{ opacity: 0, x: currentStep === 0 ? -20 : 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: currentStep === 0 ? 20 : -20 }}
              transition={{ duration: 0.2 }}
            >
              {getCurrentStepFields().map(renderField)}
            </motion.div>
          </AnimatePresence>
        </Form>

        <Divider />

        <div className="flex justify-between">
          {currentStep > 0 ? (
            <Button icon={<ArrowLeftOutlined />} onClick={handlePrev}>
              上一步
            </Button>
          ) : (
            <div />
          )}
          
          <Button
            type="primary"
            icon={<ArrowRightOutlined />}
            onClick={handleNext}
          >
            {currentStep === 0 && optionalFields.length > 0 ? '下一步' : '确认'}
          </Button>
        </div>
      </motion.div>
    </Modal>
  )
}

export default GuidanceCollector
