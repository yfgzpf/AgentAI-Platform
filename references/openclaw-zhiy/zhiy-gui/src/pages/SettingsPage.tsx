import { Card, Form, Input, Button, message, Divider, Typography } from 'antd'

const { Title, Text } = Typography

export default function SettingsPage() {
  const [form] = Form.useForm()

  const handleSave = async (values: any) => {
    try {
      message.success('设置已保存（演示版本）')
    } catch (error) {
      message.error('保存失败')
    }
  }

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">系统设置</h2>
      
      <Card title="API 配置" className="mb-4">
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSave}
          initialValues={{}}
        >
          <Title level={4}>DeepSeek</Title>
          <Form.Item
            label="API Key"
            name="deepseekApiKey"
          >
            <Input.Password placeholder="sk-..." />
          </Form.Item>
          
          <Divider />
          
          <Title level={4}>豆包</Title>
          <Form.Item
            label="API Key"
            name="doubaoApiKey"
          >
            <Input.Password placeholder="输入豆包 API Key" />
          </Form.Item>
          
          <Divider />
          
          <Title level={4}>Kimi</Title>
          <Form.Item
            label="API Key"
            name="kimiApiKey"
          >
            <Input.Password placeholder="输入 Kimi API Key" />
          </Form.Item>
          
          <Divider />
          
          <Title level={4}>千问</Title>
          <Form.Item
            label="API Key"
            name="qianwenApiKey"
          >
            <Input.Password placeholder="输入千问 API Key" />
          </Form.Item>
          
          <Divider />
          
          <Title level={4}>Gemini</Title>
          <Form.Item
            label="API Key"
            name="geminiApiKey"
          >
            <Input.Password placeholder="输入 Gemini API Key" />
          </Form.Item>
          
          <Form.Item>
            <Button type="primary" htmlType="submit">
              保存设置
            </Button>
          </Form.Item>
        </Form>
      </Card>

      <Card title="关于">
        <div className="space-y-2">
          <Text strong>智 Y.Ai</Text>
          <br />
          <Text type="secondary">版本: 2.0.0</Text>
          <br />
          <Text type="secondary">企业级AI自动化系统</Text>
          <br />
          <Text type="secondary">品牌口号: 智 Y.Ai · 羽你同行</Text>
        </div>
      </Card>
    </div>
  )
}
