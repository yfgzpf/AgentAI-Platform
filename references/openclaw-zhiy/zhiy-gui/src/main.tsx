import React, { useState, useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, useNavigate } from 'react-router-dom'
import { ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { motion, AnimatePresence } from 'framer-motion'
import App from './App.tsx'
import MainLayout from './components/MainLayout'
import HomePage from './pages/HomePage'
import ChatPage from './pages/ChatPage'
import SkillsPage from './pages/SkillsPage'
import AgentsPage from './pages/AgentsPage'
import SettingsPage from './pages/SettingsPage'
import './index.css'

function SplashScreen({ onComplete }: { onComplete: () => void }) {
  const [phase, setPhase] = useState<'feather' | 'logo' | 'slogan' | 'complete'>('feather')

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase('logo'), 1500),
      setTimeout(() => setPhase('slogan'), 2500),
      setTimeout(() => setPhase('complete'), 4000),
      setTimeout(() => onComplete(), 4500),
    ]
    return () => timers.forEach(clearTimeout)
  }, [onComplete])

  const featherVariants = {
    initial: { y: -100, opacity: 0, rotate: -30 },
    animate: {
      y: 0,
      opacity: 1,
      rotate: 0,
      transition: { duration: 1.5, ease: 'easeOut' },
    },
    exit: { scale: 0.8, opacity: 0, transition: { duration: 0.5 } },
  }

  const logoVariants = {
    initial: { scale: 0.8, opacity: 0 },
    animate: {
      scale: 1,
      opacity: 1,
      transition: { duration: 0.8, ease: 'easeOut' },
    },
  }

  const sloganVariants = {
    initial: { y: 20, opacity: 0 },
    animate: {
      y: 0,
      opacity: 1,
      transition: { duration: 0.6, ease: 'easeOut' },
    },
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-gradient-to-br from-[#1a1a2e] via-[#16213e] to-[#0f3460] flex flex-col items-center justify-center overflow-hidden"
    >
      <div className="absolute inset-0 overflow-hidden">
        {[...Array(20)].map((_, i) => (
          <motion.div
            key={i}
            initial={{
              x: Math.random() * window.innerWidth,
              y: -50,
              rotate: Math.random() * 360,
              opacity: 0.3,
            }}
            animate={{
              y: window.innerHeight + 100,
              x: `+=${Math.random() * 200 - 100}`,
              rotate: `+=${Math.random() * 720}`,
              opacity: [0.3, 0.5, 0.3],
            }}
            transition={{
              duration: 5 + Math.random() * 5,
              repeat: Infinity,
              delay: Math.random() * 3,
              ease: 'linear',
            }}
            className="absolute text-2xl"
            style={{ color: i % 2 === 0 ? '#5A67D8' : '#F687B3' }}
          >
            ✦
          </motion.div>
        ))}
      </div>

      <div className="relative z-10 flex flex-col items-center">
        <AnimatePresence mode="wait">
          {phase === 'feather' && (
            <motion.div
              key="feather"
              variants={featherVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              className="relative"
            >
              <svg
                width="120"
                height="120"
                viewBox="0 0 120 120"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <defs>
                  <linearGradient id="featherGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#5A67D8" />
                    <stop offset="100%" stopColor="#F687B3" />
                  </linearGradient>
                </defs>
                <path
                  d="M60 10 C30 30, 20 60, 25 90 C30 100, 50 110, 60 110 C70 110, 90 100, 95 90 C100 60, 90 30, 60 10 Z"
                  fill="url(#featherGradient)"
                  opacity="0.9"
                />
                <path d="M60 10 L60 110" stroke="white" strokeWidth="2" opacity="0.5" />
                <path d="M40 40 C50 50, 55 70, 60 90" stroke="white" strokeWidth="1" opacity="0.3" fill="none" />
                <path d="M80 40 C70 50, 65 70, 60 90" stroke="white" strokeWidth="1" opacity="0.3" fill="none" />
              </svg>
            </motion.div>
          )}

          {(phase === 'logo' || phase === 'slogan' || phase === 'complete') && (
            <motion.div
              key="logo"
              variants={logoVariants}
              initial="initial"
              animate="animate"
              className="flex flex-col items-center"
            >
              <div className="flex items-center gap-2 mb-4">
                <svg
                  width="60"
                  height="60"
                  viewBox="0 0 120 120"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <defs>
                    <linearGradient id="featherGradient2" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#5A67D8" />
                      <stop offset="100%" stopColor="#F687B3" />
                    </linearGradient>
                  </defs>
                  <path
                    d="M60 10 C30 30, 20 60, 25 90 C30 100, 50 110, 60 110 C70 110, 90 100, 95 90 C100 60, 90 30, 60 10 Z"
                    fill="url(#featherGradient2)"
                    opacity="0.9"
                  />
                  <path d="M60 10 L60 110" stroke="white" strokeWidth="2" opacity="0.5" />
                </svg>
                <h1 className="text-5xl font-bold bg-gradient-to-r from-[#5A67D8] to-[#F687B3] bg-clip-text text-transparent">
                  智 Y.Ai
                </h1>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {phase === 'slogan' && (
            <motion.p
              key="slogan"
              variants={sloganVariants}
              initial="initial"
              animate="animate"
              className="text-white/80 text-xl mt-4 tracking-widest"
            >
              羽你同行
            </motion.p>
          )}
        </AnimatePresence>

        {phase === 'complete' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-8">
            <div className="w-48 h-1 bg-white/20 rounded-full overflow-hidden">
              <motion.div
                initial={{ width: '0%' }}
                animate={{ width: '100%' }}
                transition={{ duration: 0.5 }}
                className="h-full bg-gradient-to-r from-[#5A67D8] to-[#F687B3]"
              />
            </div>
          </motion.div>
        )}
      </div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1 }}
        className="absolute bottom-8 text-white/50 text-sm"
      >
        © 2026 智 Y.Ai · Your AI, Your Power
      </motion.div>
    </motion.div>
  )
}

function LoginPage({ onLogin }: { onLogin: () => void }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-[#1a1a2e] via-[#16213e] to-[#0f3460] flex items-center justify-center p-4">
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
                width="50"
                height="50"
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
              <h1 className="text-4xl font-bold bg-gradient-to-r from-[#5A67D8] to-[#F687B3] bg-clip-text text-transparent">
                智 Y.Ai
              </h1>
            </div>
            <p className="text-white/60">你的智慧伙伴，与你同行</p>
          </div>

          <div className="space-y-4">
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={onLogin}
              className="w-full h-14 bg-gradient-to-r from-[#5A67D8] to-[#F687B3] text-white text-lg font-medium rounded-lg shadow-lg"
            >
              开始使用
            </motion.button>
          </div>

          <p className="text-center text-white/40 text-sm mt-6">
            登录即表示您同意我们的服务条款和隐私政策
          </p>
        </div>
      </motion.div>
    </div>
  )
}

function AppContent() {
  const [showSplash, setShowSplash] = useState(true)
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const navigate = useNavigate()

  const handleSplashComplete = () => {
    setShowSplash(false)
  }

  const handleLogin = () => {
    setIsLoggedIn(true)
  }

  return (
    <>
      <AnimatePresence>
        {showSplash && <SplashScreen onComplete={handleSplashComplete} />}
      </AnimatePresence>
      
      {!showSplash && !isLoggedIn && (
        <LoginPage onLogin={handleLogin} />
      )}
      
      {!showSplash && isLoggedIn && (
        <Routes>
          <Route path="/" element={<MainLayout />}>
            <Route index element={<HomePage />} />
            <Route path="chat" element={<ChatPage />} />
            <Route path="skills" element={<SkillsPage />} />
            <Route path="agents" element={<AgentsPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
        </Routes>
      )}
    </>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: '#5A67D8',
          colorInfo: '#5A67D8',
          borderRadius: 8,
        },
      }}
    >
      <AppContent />
    </ConfigProvider>
  </BrowserRouter>,
)
