import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { Layout, Menu, theme } from 'antd'
import {
  HomeOutlined,
  MessageOutlined,
  AppstoreOutlined,
  RobotOutlined,
  SettingOutlined,
} from '@ant-design/icons'

const { Header, Sider, Content } = Layout

const menuItems = [
  { key: '/', icon: <HomeOutlined />, label: '首页' },
  { key: '/chat', icon: <MessageOutlined />, label: '对话' },
  { key: '/skills', icon: <AppstoreOutlined />, label: '技能' },
  { key: '/agents', icon: <RobotOutlined />, label: '智能体' },
  { key: '/settings', icon: <SettingOutlined />, label: '设置' },
]

function Logo() {
  return (
    <div className="flex items-center gap-2 px-4 py-3">
      <svg
        width="32"
        height="32"
        viewBox="0 0 120 120"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id="featherGradientLogo" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#5A67D8" />
            <stop offset="100%" stopColor="#F687B3" />
          </linearGradient>
        </defs>
        <path
          d="M60 10 C30 30, 20 60, 25 90 C30 100, 50 110, 60 110 C70 110, 90 100, 95 90 C100 60, 90 30, 60 10 Z"
          fill="url(#featherGradientLogo)"
        />
        <path d="M60 10 L60 110" stroke="white" strokeWidth="2" opacity="0.5" />
      </svg>
      <span className="text-lg font-bold bg-gradient-to-r from-[#5A67D8] to-[#F687B3] bg-clip-text text-transparent">
        智 Y.Ai
      </span>
    </div>
  )
}

export default function MainLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const {
    token: { colorBgContainer, borderRadiusLG },
  } = theme.useToken()

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        theme="light"
        width={240}
        style={{
          overflow: 'auto',
          height: '100vh',
          position: 'fixed',
          left: 0,
          top: 0,
          bottom: 0,
        }}
      >
        <Logo />
        <Menu
          mode="inline"
          selectedKeys={[location.pathname]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
          style={{ border: 'none', marginTop: 16 }}
        />
      </Sider>
      <Layout style={{ marginLeft: 240 }}>
        <Header
          style={{
            padding: '0 24px',
            background: colorBgContainer,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div className="flex items-center gap-2">
            <svg
              width="24"
              height="24"
              viewBox="0 0 120 120"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <defs>
                <linearGradient id="featherGradientHeader" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#5A67D8" />
                  <stop offset="100%" stopColor="#F687B3" />
                </linearGradient>
              </defs>
              <path
                d="M60 10 C30 30, 20 60, 25 90 C30 100, 50 110, 60 110 C70 110, 90 100, 95 90 C100 60, 90 30, 60 10 Z"
                fill="url(#featherGradientHeader)"
              />
            </svg>
            <span className="text-lg font-medium">智 Y.Ai · 羽你同行</span>
          </div>
        </Header>
        <Content
          style={{
            margin: '24px',
            padding: 24,
            minHeight: 280,
            background: colorBgContainer,
            borderRadius: borderRadiusLG,
          }}
        >
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  )
}
