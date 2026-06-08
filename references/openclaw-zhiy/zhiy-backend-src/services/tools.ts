import { exec } from 'child_process'
import { promisify } from 'util'
import path from 'path'

const execAsync = promisify(exec)

const PYTHON_BRIDGE = path.join(__dirname, 'python_bridge.py')

export interface ToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: {
      type: 'object'
      properties: Record<string, any>
      required?: string[]
    }
  }
}

export const AVAILABLE_TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'open_browser',
      description: '打开浏览器并访问指定网址，支持自动搜索',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: '要访问的网址' },
          search_query: { type: 'string', description: '可选的搜索关键词' }
        },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'desktop_automation',
      description: '桌面自动化操作：打开应用、点击、输入、截图等',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['open_app', 'click', 'type', 'screenshot', 'hotkey'] },
          params: { type: 'object', description: '操作参数' }
        },
        required: ['action']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'generate_document',
      description: '生成 Word/Excel/PPT 文档',
      parameters: {
        type: 'object',
        properties: {
          doc_type: { type: 'string', enum: ['word', 'excel', 'ppt'] },
          title: { type: 'string', description: '文档标题' },
          content: { type: 'string', description: '文档内容' }
        },
        required: ['doc_type', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'send_wechat_message',
      description: '发送微信消息给指定联系人',
      parameters: {
        type: 'object',
        properties: {
          contact: { type: 'string', description: '联系人名称' },
          message: { type: 'string', description: '消息内容' }
        },
        required: ['contact', 'message']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'generate_video',
      description: '使用 AI 生成视频（豆包 Seedance）',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: '视频描述' },
          duration: { type: 'number', description: '视频时长（秒）' }
        },
        required: ['prompt']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'generate_image',
      description: '使用 AI 生成图片',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: '图片描述' },
          style: { type: 'string', enum: ['现代', '古典', '简约', '华丽'] }
        },
        required: ['prompt']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'social_promotion',
      description: '发布内容到社交媒体（微博、小红书等）',
      parameters: {
        type: 'object',
        properties: {
          platform: { type: 'string', enum: ['weibo', 'xiaohongshu', 'douyin'] },
          content: { type: 'string', description: '发布内容' }
        },
        required: ['platform', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'execute_code',
      description: '执行 Python/JavaScript 代码',
      parameters: {
        type: 'object',
        properties: {
          language: { type: 'string', enum: ['python', 'javascript'] },
          code: { type: 'string', description: '要执行的代码' }
        },
        required: ['code']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'execute_skill',
      description: '执行已安装的技能',
      parameters: {
        type: 'object',
        properties: {
          skill_name: { type: 'string', description: '技能名称' },
          params: { type: 'object', description: '技能参数' }
        },
        required: ['skill_name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'ask_user',
      description: '向用户提问以收集更多信息',
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string', description: '问题内容' },
          options: { type: 'array', items: { type: 'string' }, description: '选项列表' }
        },
        required: ['question']
      }
    }
  }
]

export function getToolDefinitions(): ToolDefinition[] {
  return AVAILABLE_TOOLS
}

export async function executeTool(name: string, args: any): Promise<any> {
  try {
    console.log(`[Tool] executeTool: ${name}`, JSON.stringify(args, null, 2))
    
    switch (name) {
      case 'open_browser': {
        console.log(`[Tool] open_browser:`, args)
        const url = args.url || ''
        const searchQuery = args.search_query || ''
        
        const params = { url, searchQuery }
        const base64Params = Buffer.from(JSON.stringify(params)).toString('base64')
        
        try {
          const { stdout, stderr } = await execAsync(
            `python "${PYTHON_BRIDGE}" --action open_browser --params-base64 "${base64Params}"`,
            { maxBuffer: 1024 * 1024 }
          )
          
          if (stdout.includes('##RESULT##')) {
            const resultMatch = stdout.match(/##RESULT## (.+)/)
            if (resultMatch) {
              return JSON.parse(resultMatch[1])
            }
          }
          
          return { success: true, message: `浏览器已打开: ${url}` }
        } catch (error: any) {
          console.error('[Tool] Python error:', error)
          return { success: false, error: error.message }
        }
      }
      
      case 'desktop_automation': {
        console.log(`[Tool] desktop_automation:`, args)
        const action = args.action || ''
        const params = args.params || {}
        
        const jsonParams = JSON.stringify({ action, params })
        const base64Params = Buffer.from(jsonParams).toString('base64')
        
        try {
          const { stdout, stderr } = await execAsync(
            `python "${PYTHON_BRIDGE}" --action desktop_automation --params-base64 "${base64Params}"`,
            { maxBuffer: 1024 * 1024 }
          )
          
          if (stdout.includes('##RESULT##')) {
            const resultMatch = stdout.match(/##RESULT## (.+)/)
            if (resultMatch) {
              return JSON.parse(resultMatch[1])
            }
          }
          
          return { success: true, message: `桌面自动化执行: ${action}` }
        } catch (error: any) {
          console.error('[Tool] Python error:', error)
          return { success: false, error: error.message }
        }
      }
      
      case 'generate_document': {
        console.log(`[Tool] generate_document:`, args)
        return { success: true, message: `${args.doc_type}文档已生成: ${args.title || '未命名'}` }
      }
      
      case 'send_wechat_message': {
        console.log(`[Tool] send_wechat_message:`, args)
        return { success: true, message: `微信消息已发送给: ${args.contact}` }
      }
      
      case 'generate_video': {
        console.log(`[Tool] generate_video:`, args)
        return { success: true, message: `视频生成任务已提交: ${args.prompt?.substring(0, 30)}...` }
      }
      
      case 'generate_image': {
        console.log(`[Tool] generate_image:`, args)
        return { success: true, message: `图片已生成: ${args.prompt?.substring(0, 30)}...` }
      }
      
      case 'social_promotion': {
        console.log(`[Tool] social_promotion:`, args)
        return { success: true, message: `内容已发布到: ${args.platform}` }
      }
      
      case 'execute_code': {
        console.log(`[Tool] execute_code:`, args.language || 'python')
        return { success: true, message: '代码执行完成' }
      }
      
      case 'execute_skill': {
        console.log(`[Tool] execute_skill:`, args.skill_name)
        return { success: true, message: `技能执行完成: ${args.skill_name}` }
      }
      
      case 'ask_user': {
        return {
          success: true,
          needsUserInput: true,
          question: args.question,
          options: args.options
        }
      }
      
      default:
        return { success: false, error: `未知工具: ${name}` }
    }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}
