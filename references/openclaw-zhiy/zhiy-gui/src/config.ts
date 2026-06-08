export const config = {
  gateway: {
    url: import.meta.env.VITE_GATEWAY_URL || 'http://127.0.0.1:18789',
    wsUrl: import.meta.env.VITE_GATEWAY_WS_URL || 'ws://127.0.0.1:18789',
    token: import.meta.env.VITE_GATEWAY_TOKEN || '',
    controlUi: 'http://127.0.0.1:18789/__openclaw__/canvas/',
  },
  api: {
    baseUrl: import.meta.env.VITE_API_URL || 'http://127.0.0.1:18789',
    timeout: 30000,
  },
  models: {
    default: 'deepseek-chat',
    available: [
      { id: 'deepseek-chat', name: 'DeepSeek Chat', provider: 'deepseek' },
      { id: 'deepseek-coder', name: 'DeepSeek Coder', provider: 'deepseek' },
      { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner', provider: 'deepseek' },
    ]
  },
  features: {
    voiceInput: true,
    textToSpeech: true,
    fileUpload: true,
    musicPlayer: true,
  },
  brand: {
    name: '智 Y.Ai',
    slogan: '羽你同行',
    logo: '/logo.svg',
  }
}
