import React from 'react'

interface ModelIconProps {
  provider: string
  size?: number
  className?: string
}

export const ModelIcon: React.FC<ModelIconProps> = ({ provider, size = 24, className = '' }) => {
  const providerLower = provider.toLowerCase()
  
  const icons: Record<string, React.ReactNode> = {
    deepseek: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="deepseek-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#4F46E5"/>
            <stop offset="100%" stopColor="#7C3AED"/>
          </linearGradient>
        </defs>
        <circle cx="12" cy="12" r="10" fill="url(#deepseek-grad)"/>
        <path d="M8 8L12 12L16 8M8 16L12 12L16 16" stroke="white" strokeWidth="2" strokeLinecap="round"/>
      </svg>
    ),
    qianwen: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="qianwen-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#FF6A00"/>
            <stop offset="100%" stopColor="#FF9500"/>
          </linearGradient>
        </defs>
        <circle cx="12" cy="12" r="10" fill="url(#qianwen-grad)"/>
        <path d="M7 12C7 9.23858 9.23858 7 12 7C14.7614 7 17 9.23858 17 12" stroke="white" strokeWidth="2" strokeLinecap="round"/>
        <circle cx="12" cy="15" r="2" fill="white"/>
      </svg>
    ),
    doubao: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="doubao-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#00D4AA"/>
            <stop offset="100%" stopColor="#00B4D8"/>
          </linearGradient>
        </defs>
        <circle cx="12" cy="12" r="10" fill="url(#doubao-grad)"/>
        <path d="M8 14C8.5 15.5 10 17 12 17C14 17 15.5 15.5 16 14" stroke="white" strokeWidth="2" strokeLinecap="round"/>
        <circle cx="9" cy="10" r="1.5" fill="white"/>
        <circle cx="15" cy="10" r="1.5" fill="white"/>
      </svg>
    ),
    kimi: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="kimi-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#6366F1"/>
            <stop offset="100%" stopColor="#8B5CF6"/>
          </linearGradient>
        </defs>
        <circle cx="12" cy="12" r="10" fill="url(#kimi-grad)"/>
        <path d="M12 7V12L15 15" stroke="white" strokeWidth="2" strokeLinecap="round"/>
        <circle cx="12" cy="12" r="2" fill="white"/>
      </svg>
    ),
    openai: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" r="10" fill="#10A37F"/>
        <path d="M12 6L16 9V15L12 18L8 15V9L12 6Z" stroke="white" strokeWidth="1.5" fill="none"/>
      </svg>
    ),
    gemini: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="gemini-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#4285F4"/>
            <stop offset="50%" stopColor="#9B72CB"/>
            <stop offset="100%" stopColor="#D96570"/>
          </linearGradient>
        </defs>
        <circle cx="12" cy="12" r="10" fill="url(#gemini-grad)"/>
        <path d="M12 6L14 10H18L15 13L16 17L12 14L8 17L9 13L6 10H10L12 6Z" fill="white"/>
      </svg>
    ),
    zhiy: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="zhiy-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#5A67D8"/>
            <stop offset="100%" stopColor="#F687B3"/>
          </linearGradient>
        </defs>
        <circle cx="12" cy="12" r="10" fill="url(#zhiy-grad)"/>
        <path d="M8 7L12 12L16 7M8 17L12 12L16 17" stroke="white" strokeWidth="2" strokeLinecap="round"/>
      </svg>
    ),
  }
  
  return (
    <span className={`inline-flex items-center justify-center ${className}`}>
      {icons[providerLower] || icons.zhiy}
    </span>
  )
}

export const getModelDisplayName = (modelId: string): string => {
  const names: Record<string, string> = {
    'deepseek-chat': 'DeepSeek Chat',
    'deepseek-coder': 'DeepSeek Coder',
    'qwen-turbo': '千问 Turbo',
    'qwen-plus': '千问 Plus',
    'qwen-max': '千问 Max',
    'doubao-pro': '豆包 Pro',
    'kimi': 'Kimi',
    'gpt-4': 'GPT-4',
    'gpt-3.5-turbo': 'GPT-3.5',
    'gemini-pro': 'Gemini Pro',
  }
  return names[modelId] || modelId
}

export const getProviderFromModel = (modelId: string): string => {
  if (modelId.startsWith('deepseek')) return 'deepseek'
  if (modelId.startsWith('qwen')) return 'qianwen'
  if (modelId.startsWith('doubao')) return 'doubao'
  if (modelId.startsWith('kimi')) return 'kimi'
  if (modelId.startsWith('gpt')) return 'openai'
  if (modelId.startsWith('gemini')) return 'gemini'
  return 'zhiy'
}
