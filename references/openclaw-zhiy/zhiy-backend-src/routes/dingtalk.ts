import { Router, Request, Response } from 'express'
import { spawn } from 'child_process'
import path from 'path'

const router = Router()

const pythonScriptPath = path.join(__dirname, '..', 'services', 'python_bridge.py')

async function callPythonService(method: string, args: any = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const pythonProcess = spawn('python', [pythonScriptPath, 'dingtalk_service', method, JSON.stringify(args)])
    
    let stdout = ''
    let stderr = ''
    
    pythonProcess.stdout.on('data', (data) => {
      stdout += data.toString()
    })
    
    pythonProcess.stderr.on('data', (data) => {
      stderr += data.toString()
    })
    
    pythonProcess.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Python process exited with code ${code}: ${stderr}`))
      } else {
        try {
          const result = JSON.parse(stdout)
          resolve(result)
        } catch (e) {
          resolve({ success: true, data: stdout })
        }
      }
    })
    
    pythonProcess.on('error', (err) => {
      reject(err)
    })
  })
}

router.post('/webhook', async (req: Request, res: Response) => {
  try {
    const data = req.body
    
    console.log('[DingTalk] 收到Webhook消息:', JSON.stringify(data).substring(0, 200))
    
    if (data.msgtype === 'verification') {
      const challenge = data.challenge
      console.log('[DingTalk] 验证请求:', challenge)
      return res.json({ challenge })
    }
    
    const result = await callPythonService('handle_webhook', { data })
    
    res.json(result)
  } catch (error: any) {
    console.error('[DingTalk] Webhook处理失败:', error)
    res.status(500).json({
      success: false,
      message: error.message || '处理失败'
    })
  }
})

router.post('/config', async (req: Request, res: Response) => {
  try {
    const config = req.body
    
    console.log('[DingTalk] 配置钉钉机器人:', config)
    
    const result = await callPythonService('configure', { config })
    
    res.json(result)
  } catch (error: any) {
    console.error('[DingTalk] 配置失败:', error)
    res.status(500).json({
      success: false,
      message: error.message || '配置失败'
    })
  }
})

router.get('/status', async (req: Request, res: Response) => {
  try {
    const result = await callPythonService('get_status', {})
    res.json(result)
  } catch (error: any) {
    console.error('[DingTalk] 获取状态失败:', error)
    res.status(500).json({
      success: false,
      message: error.message || '获取状态失败'
    })
  }
})

router.post('/send', async (req: Request, res: Response) => {
  try {
    const { conversation_id, content, msg_type } = req.body
    
    if (!content) {
      return res.status(400).json({
        success: false,
        message: '消息内容不能为空'
      })
    }
    
    console.log('[DingTalk] 发送消息:', { conversation_id, content: content.substring(0, 50), msg_type })
    
    const result = await callPythonService('send_message', { 
      conversation_id: conversation_id || '', 
      content, 
      msg_type: msg_type || 'text' 
    })
    
    res.json(result)
  } catch (error: any) {
    console.error('[DingTalk] 发送消息失败:', error)
    res.status(500).json({
      success: false,
      message: error.message || '发送失败'
    })
  }
})

router.post('/send/markdown', async (req: Request, res: Response) => {
  try {
    const { title, text } = req.body
    
    if (!title || !text) {
      return res.status(400).json({
        success: false,
        message: '标题和内容不能为空'
      })
    }
    
    console.log('[DingTalk] 发送Markdown消息:', { title })
    
    const result = await callPythonService('send_markdown', { title, text })
    
    res.json(result)
  } catch (error: any) {
    console.error('[DingTalk] 发送Markdown消息失败:', error)
    res.status(500).json({
      success: false,
      message: error.message || '发送失败'
    })
  }
})

router.post('/send/link', async (req: Request, res: Response) => {
  try {
    const { title, text, pic_url, message_url } = req.body
    
    if (!title || !text || !message_url) {
      return res.status(400).json({
        success: false,
        message: '标题、内容和链接URL不能为空'
      })
    }
    
    console.log('[DingTalk] 发送链接消息:', { title, message_url })
    
    const result = await callPythonService('send_link', { title, text, pic_url, message_url })
    
    res.json(result)
  } catch (error: any) {
    console.error('[DingTalk] 发送链接消息失败:', error)
    res.status(500).json({
      success: false,
      message: error.message || '发送失败'
    })
  }
})

router.get('/messages', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 10
    
    const result = await callPythonService('get_messages', { limit })
    
    res.json(result)
  } catch (error: any) {
    console.error('[DingTalk] 获取消息列表失败:', error)
    res.status(500).json({
      success: false,
      message: error.message || '获取失败'
    })
  }
})

router.delete('/messages', async (req: Request, res: Response) => {
  try {
    const result = await callPythonService('clear_messages', {})
    
    res.json(result)
  } catch (error: any) {
    console.error('[DingTalk] 清空消息队列失败:', error)
    res.status(500).json({
      success: false,
      message: error.message || '清空失败'
    })
  }
})

router.post('/auto-reply/rules', async (req: Request, res: Response) => {
  try {
    const { pattern, reply } = req.body
    
    if (!pattern || !reply) {
      return res.status(400).json({
        success: false,
        message: '匹配模式和回复内容不能为空'
      })
    }
    
    const result = await callPythonService('add_auto_reply_rule', { pattern, reply })
    
    res.json(result)
  } catch (error: any) {
    console.error('[DingTalk] 添加自动回复规则失败:', error)
    res.status(500).json({
      success: false,
      message: error.message || '添加失败'
    })
  }
})

router.delete('/auto-reply/rules/:pattern', async (req: Request, res: Response) => {
  try {
    const { pattern } = req.params
    
    const result = await callPythonService('remove_auto_reply_rule', { pattern })
    
    res.json(result)
  } catch (error: any) {
    console.error('[DingTalk] 删除自动回复规则失败:', error)
    res.status(500).json({
      success: false,
      message: error.message || '删除失败'
    })
  }
})

router.get('/auto-reply/rules', async (req: Request, res: Response) => {
  try {
    const result = await callPythonService('get_auto_reply_rules', {})
    
    res.json(result)
  } catch (error: any) {
    console.error('[DingTalk] 获取自动回复规则失败:', error)
    res.status(500).json({
      success: false,
      message: error.message || '获取失败'
    })
  }
})

router.post('/auto-reply/enable', async (req: Request, res: Response) => {
  try {
    const result = await callPythonService('enable_auto_reply', {})
    
    res.json(result)
  } catch (error: any) {
    console.error('[DingTalk] 启用自动回复失败:', error)
    res.status(500).json({
      success: false,
      message: error.message || '启用失败'
    })
  }
})

router.post('/auto-reply/disable', async (req: Request, res: Response) => {
  try {
    const result = await callPythonService('disable_auto_reply', {})
    
    res.json(result)
  } catch (error: any) {
    console.error('[DingTalk] 禁用自动回复失败:', error)
    res.status(500).json({
      success: false,
      message: error.message || '禁用失败'
    })
  }
})

export default router
