import { useState } from 'react'
import { Form, Input, Button, Checkbox, Divider, message } from 'antd'
import { UserOutlined, LockOutlined, WechatOutlined, GithubOutlined } from '@ant-design/icons'
import { motion } from 'framer-motion'

interface LoginPageProps {
  onLogin: (user: { username: string }) => void
}

export default function LoginPage({ onLogin }: LoginPageProps) {
  const [loading, setLoading] = useState(false)
  const [isRegister, setIsRegister] = useState(false)
  const [form] = Form.useForm()

  const handleSubmit = async (values: any) => {
    setLoading(true)
    
    try {
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      message.success(isRegister ? '注册成功！' : '登录成功！')
      onLogin({ username: values.username })
    } catch (error) {
      message.error('操作失败，请重试')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#1a1a2e] via-[#16213e] to-[#0f3460] flex items-center justify-center p-4">
      <div className="absolute inset-0 overflow-hidden">
        {[...Array(30)].map((_, i) => (
          <motion.div
            key={i}
            initial={{
              x: Math.random() * (typeof window !== 'undefined' ? window.innerWidth : 1000),
              y: -20,
              opacity: 0.1,
            }}
            animate={{
              y: (typeof window !== 'undefined' ? window.innerHeight : 800) + 50,
              opacity: [0.1, 0.3, 0.1],
            }}
            transition={{
              duration: 10 + Math.random() * 10,
              repeat: Infinity,
              delay: Math.random() * 5,
              ease: 'linear',
            }}
            className="absolute w-1 h-1 rounded-full"
            style={{
              backgroundColor: i % 2 === 0 ? '#5A67D8' : '#F687B3',
            }}
          />
        ))}
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative z-10 w-full max-w-md"
      >
        <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-8 shadow-2xl border border-white/20">
          <div className="text-center mb-8">
            <div className="flex items-center justify-center gap-2 mb-4">
              <svg
                width="40"
                height="40"
                viewBox="0 0 120 120"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <defs>
                  <linearGradient id="featherGradient3" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#5A67D8" />
                    <stop offset="100%" stopColor="#F687B3" />
                  </linearGradient>
                </defs>
                <path
                  d="M60 10 C30 30, 20 60, 25 90 C30 100, 50 110, 60 110 C70 110, 90 100, 95 90 C100 60, 90 30, 60 10 Z"
                  fill="url(#featherGradient3)"
                />
              </svg>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-[#5A67D8] to-[#F687B3] bg-clip-text text-transparent">
                智 Y.Ai
              </h1>
            </div>
            <p className="text-white/60">
              {isRegister ? '创建您的账户' : '欢迎回来'}
            </p>
          </div>

          <Form
            form={form}
            onFinish={handleSubmit}
            layout="vertical"
            initialValues={{ remember: true }}
          >
            <Form.Item
              name="username"
              rules={[{ required: true, message: '请输入用户名' }]}
            >
              <Input
                prefix={<UserOutlined className="text-white/40" />}
                placeholder="用户名"
                size="large"
                className="bg-white/5 border-white/20 text-white placeholder-white/40"
              />
            </Form.Item>

            <Form.Item
              name="password"
              rules={[{ required: true, message: '请输入密码' }]}
            >
              <Input.Password
                prefix={<LockOutlined className="text-white/40" />}
                placeholder="密码"
                size="large"
                className="bg-white/5 border-white/20 text-white placeholder-white/40"
              />
            </Form.Item>

            {isRegister && (
              <Form.Item
                name="confirmPassword"
                dependencies={['password']}
                rules={[
                  { required: true, message: '请确认密码' },
                  ({ getFieldValue }) => ({
                    validator(_, value) {
                      if (!value || getFieldValue('password') === value) {
                        return Promise.resolve()
                      }
                      return Promise.reject(new Error('两次输入的密码不一致'))
                    },
                  }),
                ]}
              >
                <Input.Password
                  prefix={<LockOutlined className="text-white/40" />}
                  placeholder="确认密码"
                  size="large"
                  className="bg-white/5 border-white/20 text-white placeholder-white/40"
                />
              </Form.Item>
            )}

            {!isRegister && (
              <Form.Item name="remember" valuePropName="checked" noStyle>
                <Checkbox className="text-white/60">记住我</Checkbox>
              </Form.Item>
            )}

            <Form.Item className="mt-6">
              <Button
                type="primary"
                htmlType="submit"
                size="large"
                block
                loading={loading}
                className="bg-gradient-to-r from-[#5A67D8] to-[#F687B3] border-none h-12 text-lg font-medium"
              >
                {isRegister ? '注册' : '登录'}
              </Button>
            </Form.Item>
          </Form>

          <div className="text-center">
            <button
              onClick={() => setIsRegister(!isRegister)}
              className="text-white/60 hover:text-white transition-colors"
            >
              {isRegister ? '已有账户？立即登录' : '没有账户？立即注册'}
            </button>
          </div>

          <Divider className="!border-white/20 !text-white/40">或</Divider>

          <div className="flex justify-center gap-4">
            <Button
              icon={<WechatOutlined />}
              size="large"
              className="bg-green-500 border-none text-white hover:bg-green-600"
            />
            <Button
              icon={<GithubOutlined />}
              size="large"
              className="bg-gray-800 border-none text-white hover:bg-gray-700"
            />
          </div>
        </div>

        <p className="text-center text-white/40 text-sm mt-6">
          登录即表示您同意我们的服务条款和隐私政策
        </p>
      </motion.div>
    </div>
  )
}
