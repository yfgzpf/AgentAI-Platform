import { Request, Response } from 'express'
import { LLMService } from './llm'
import { executeTool, getToolDefinitions } from './tools'

export interface StreamMessage {
  type: 'thinking' | 'text' | 'skill' | 'tool_call' | 'tool_result' | 'result' | 'done' | 'error'
  content: string
  metadata?: any
}

export class StreamService {
  private llmService: LLMService

  constructor(llmService: LLMService) {
    this.llmService = llmService
  }

  async streamChat(
    req: Request,
    res: Response,
    message: string,
    history: any[] = [],
    model: string = 'deepseek-chat'
  ) {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')

    const sendEvent = (data: StreamMessage) => {
      res.write(`data: ${JSON.stringify(data, null, 0)}\n\n`)
    }

    try {
      sendEvent({
        type: 'thinking',
        content: '正在思考...'
      })

      const tools = getToolDefinitions()
      const messages = [
        ...history,
        { role: 'user', content: message }
      ]

      let iteration = 0
      const maxIterations = 5
      let currentMessages = [...messages]

      while (iteration < maxIterations) {
        iteration++
        
        const stream = await this.llmService.streamChatWithTools(
          currentMessages,
          model,
          tools
        )

        let fullContent = ''
        let thinkingContent = ''
        let toolCalls: any[] = []

        for await (const chunk of stream) {
          if (chunk.choices?.[0]?.delta?.reasoning_content) {
            thinkingContent += chunk.choices[0].delta.reasoning_content
            sendEvent({
              type: 'thinking',
              content: thinkingContent
            })
          }

          if (chunk.choices?.[0]?.delta?.content) {
            const content = chunk.choices[0].delta.content
            fullContent += content
            sendEvent({
              type: 'text',
              content: content
            })
          }

          if (chunk.choices?.[0]?.delta?.tool_calls) {
            for (const toolCallDelta of chunk.choices[0].delta.tool_calls) {
              const index = toolCallDelta.index
              if (!toolCalls[index]) {
                toolCalls[index] = {
                  id: toolCallDelta.id || `call_${Date.now()}_${index}`,
                  function: { name: '', arguments: '' }
                }
              }
              if (toolCallDelta.function?.name) {
                toolCalls[index].function.name = toolCallDelta.function.name
              }
              if (toolCallDelta.function?.arguments) {
                toolCalls[index].function.arguments += toolCallDelta.function.arguments
              }
            }
          }

          if (chunk.choices?.[0]?.finish_reason === 'stop' || 
              chunk.choices?.[0]?.finish_reason === 'tool_calls') {
            break
          }
        }

        if (toolCalls.length > 0) {
          currentMessages.push({
            role: 'assistant',
            content: fullContent,
            tool_calls: toolCalls
          })

          for (const toolCall of toolCalls) {
            const toolName = toolCall.function.name
            let toolArgs = {}
            
            try {
              toolArgs = JSON.parse(toolCall.function.arguments)
            } catch {
              toolArgs = {}
            }

            sendEvent({
              type: 'tool_call',
              content: `正在执行: ${toolName}`,
              metadata: { tool: toolName, args: toolArgs }
            })

            console.log(`[Tool Call] ${toolName}:`, toolArgs)

            const result = await executeTool(toolName, toolArgs)

            console.log(`[Tool Result] ${toolName}:`, result)

            sendEvent({
              type: 'tool_result',
              content: result.success 
                ? `✅ ${result.message || '执行成功'}`
                : `❌ ${result.error || '执行失败'}`,
              metadata: { tool: toolName, result }
            })

            currentMessages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              name: toolName,
              content: JSON.stringify(result)
            })
          }
        } else {
          const suggestedActions = this.detectSuggestedActions(fullContent, message)
          
          if (suggestedActions.length > 0) {
            sendEvent({
              type: 'result',
              content: fullContent,
              metadata: { suggestedActions }
            })
          }

          sendEvent({
            type: 'done',
            content: ''
          })
          
          return
        }
      }

      sendEvent({
        type: 'done',
        content: '任务完成（达到最大迭代次数）'
      })

    } catch (error: any) {
      console.error('[StreamService] Error:', error)
      sendEvent({
        type: 'error',
        content: error.message || '处理请求时发生错误'
      })
    } finally {
      res.end()
    }
  }

  private detectSuggestedActions(content: string, originalMessage: string): any[] {
    const actions: any[] = []
    const lowerMessage = originalMessage.toLowerCase()

    if (lowerMessage.includes('文档') || lowerMessage.includes('word') || lowerMessage.includes('doc')) {
      actions.push({
        action: 'generate_word',
        prompt: '生成Word文档',
        label: '📄 生成文档',
        color: '#5A67D8'
      })
    }

    if (lowerMessage.includes('图片') || lowerMessage.includes('图像') || lowerMessage.includes('画')) {
      actions.push({
        action: 'generate_image',
        prompt: '生成图片',
        label: '🎨 生成图片',
        color: '#F687B3'
      })
    }

    if (lowerMessage.includes('视频') || lowerMessage.includes('短剧')) {
      actions.push({
        action: 'generate_video',
        prompt: '生成视频',
        label: '🎬 生成视频',
        color: '#00D4AA'
      })
    }

    if (lowerMessage.includes('表格') || lowerMessage.includes('excel') || lowerMessage.includes('报价')) {
      actions.push({
        action: 'generate_excel',
        prompt: '生成表格',
        label: '📊 生成表格',
        color: '#217346'
      })
    }

    if (actions.length === 0) {
      actions.push(
        {
          action: 'generate_doc',
          prompt: '生成文档',
          label: '📄 生成文档',
          color: '#5A67D8'
        },
        {
          action: 'generate_image',
          prompt: '生成图片',
          label: '🎨 生成图片',
          color: '#F687B3'
        }
      )
    }

    return actions
  }
}
