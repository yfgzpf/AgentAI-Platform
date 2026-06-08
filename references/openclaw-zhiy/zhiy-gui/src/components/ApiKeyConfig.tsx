import { useState } from 'react'
import { Modal, Form, Input, Button, message, Card, Space, Tag, Divider } from 'antd'
import { KeyOutlined, CheckCircleOutlined, CloseCircleOutlined, EyeOutlined, EyeInvisibleOutlined } from '@ant-design/icons'
import { ModelIcon, getModelDisplayName } from '../components/ModelIcon'

interface ApiKeyConfigProps {
  visible: boolean
  onClose: () => void
  onConfigured?: () => void
}

interface ApiKeyItem {
  provider: string
  name: string
  description: string
  placeholder: string
  configured: boolean
}

export default function ApiKeyConfig({ visible, onClose, onConfigured }: ApiKeyConfigProps) {
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const [configuredKeys, setConfiguredKeys] = useState<Record<string, boolean>>({})
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({})

  const providers: ApiKeyItem[] = [
    {
      provider: 'deepseek',
      name: 'DeepSeek',
      description: 'DeepSeek大模型，适用于日常对话和代码生成',
      placeholder: 'sk-xxxxxxxxxxxxxxxx',
      configured: configuredKeys['deepseek'] || false
    },
    {
      provider: 'qianwen',
      name: '千问 (Qwen)',
      description: '阿里千问大模型，适用于多模态任务和图像生成',
      placeholder: 'sk-xxxxxxxxxxxxxxxx',
      configured: configuredKeys['qianwen'] || false
    },
    {
      provider: 'doubao',
      name: '豆包 (Doubao)',
      description: '字节豆包大模型，适用于视频生成',
      placeholder: 'xxxxxxxxxxxxxxxx',
      configured: configuredKeys['doubao'] || false
    },
    {
      provider: 'kimi',
      name: 'Kimi',
      description: '月之暗面大模型，适用于长文本处理',
      placeholder: 'sk-xxxxxxxxxxxxxxxx',
      configured: configuredKeys['kimi'] || false
    },
    {
      provider: 'openai',
      name: 'OpenAI',
      description: 'GPT系列模型',
      placeholder: 'sk-xxxxxxxxxxxxxxxx',
      configured: configuredKeys['openai'] || false
    },
    {
      provider: 'gemini',
      name: 'Gemini',
      description: 'Google Gemini模型',
      placeholder: 'xxxxxxxxxxxxxxxx',
      configured: configuredKeys['gemini'] || false
    }
  ]

  const handleSubmit = async (values: any) => {
    setLoading(true)
    
    try {
      const response = await fetch('http://localhost:3001/api/config/apikey', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values)
      })
      
      const data = await response.json()
      
      if (data.success) {
        message.success('API密钥配置成功')
        setConfiguredKeys(prev => ({
          ...prev,
          [values.provider]: true
        }))
        form.resetFields()
        onConfigured?.()
      } else {
        message.error(data.error || '配置失败')
      }
    } catch (error) {
      message.error('网络错误，请检查后端服务')
    } finally {
      setLoading(false)
    }
  }

  const toggleShowKey = (provider: string) => {
    setShowKeys(prev => ({
      ...prev,
      [provider]: !prev[provider]
    }))
  }

  return (
    <Modal
      title={
        <div className="flex items-center gap-2">
          <KeyOutlined className="text-[#5A67D8]" />
          <span>API 密钥配置</span>
        </div>
      }
      open={visible}
      onCancel={onClose}
      footer={null}
      width={600}
    >
      <div className="mb-4">
        <p className="text-gray-500 text-sm">
          配置您的API密钥以使用各个AI模型服务。密钥将被安全保存在本地，不会上传到服务器。
        </p>
      </div>

      <div className="space-y-3 mb-6">
        {providers.map(provider => (
          <Card 
            key={provider.provider}
            size="small"
            className={`cursor-pointer hover:shadow-md transition-shadow ${configuredKeys[provider.provider] ? 'border-green-300' : ''}`}
            onClick={() => form.setFieldsValue({ provider: provider.provider })}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <ModelIcon provider={provider.provider} size={32} />
                <div>
                  <div className="font-medium">{provider.name}</div>
                  <div className="text-xs text-gray-500">{provider.description}</div>
                </div>
              </div>
              <Tag color={configuredKeys[provider.provider] ? 'green' : 'default'}>
                {configuredKeys[provider.provider] ? '已配置' : '未配置'}
              </Tag>
            </div>
          </Card>
        ))}
      </div>

      <Divider>配置密钥</Divider>

      <Form
        form={form}
        layout="vertical"
        onFinish={handleSubmit}
        initialValues={{ provider: 'deepseek' }}
      >
        <Form.Item
          name="provider"
          label="选择服务商"
        >
          <Select>
            {providers.map(p => (
              <Select.Option key={p.provider} value={p.provider}>
                <div className="flex items-center gap-2">
                  <ModelIcon provider={p.provider} size={20} />
                  <span>{p.name}</span>
                </div>
              </Select.Option>
            ))}
          </Select>
        </Form.Item>

        <Form.Item
          name="apiKey"
          label="API 密钥"
          rules={[{ required: true, message: '请输入API密钥' }]}
        >
          <Input.Password
            placeholder="请输入API密钥"
            iconRender={(visible) => visible ? <EyeOutlined /> : <EyeInvisibleOutlined />}
          />
        </Form.Item>

        <Form.Item>
          <Space>
            <Button type="primary" htmlType="submit" loading={loading}>
              保存配置
            </Button>
            <Button onClick={onClose}>关闭</Button>
          </Space>
        </Form.Item>
      </Form>

      <div className="mt-4 p-3 bg-gray-50 rounded-lg">
        <p className="text-xs text-gray-500">
          <strong>安全提示：</strong>
        </p>
        <ul className="text-xs text-gray-500 mt-1 list-disc list-inside">
          <li>API密钥仅保存在本地，不会上传到任何服务器</li>
          <li>请勿将密钥分享给他人</li>
          <li>如果密钥泄露，请立即在对应平台重新生成</li>
        </ul>
      </div>
    </Modal>
  )
}

import { Select } from 'antd'
