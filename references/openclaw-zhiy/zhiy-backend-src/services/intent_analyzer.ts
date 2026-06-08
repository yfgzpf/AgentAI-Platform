export interface IntentResult {
  intent: string
  confidence: number
  entities: Record<string, any>
  parameters: Record<string, any>
  domain?: string
  skillName?: string
  needsMoreInfo: boolean
  missingFields: string[]
}

interface IntentPattern {
  patterns: RegExp[]
  skill: string
  fields: string[]
  domain: string
}

const INTENT_PATTERNS: Record<string, IntentPattern> = {
  'generate_word': {
    patterns: [
      /写.*文档|生成.*文档|创建.*文档|word|docx|写入.*word/i,
      /写.*合同|生成.*合同|创建.*合同|装修合同/i,
      /写.*报告|生成.*报告|创建.*报告/i,
      /流式.*写入|追加.*文档|打开.*word|打开.*文档/i,
      /帮我写|帮我生成|帮我创建.*文档/i
    ],
    skill: 'doc-generator',
    fields: ['title', 'content', 'template'],
    domain: 'office'
  },
  'generate_excel': {
    patterns: [
      /生成.*表格|创建.*表格|excel|xlsx|报表/i,
      /生成.*报价|创建.*报价|报价单|报价表/i,
      /数据.*表格|表格.*数据/i
    ],
    skill: 'excel-generator',
    fields: ['data', 'template', 'outputPath'],
    domain: 'office'
  },
  'generate_ppt': {
    patterns: [
      /生成.*ppt|创建.*ppt|演示文稿|幻灯片/i,
      /制作.*演示|创建.*演示|ppt/i
    ],
    skill: 'ppt-generator',
    fields: ['title', 'slides', 'template'],
    domain: 'office'
  },
  'generate_video': {
    patterns: [
      /生成.*视频|创建.*视频|seedance|豆包.*视频|短剧/i,
      /制作.*视频|视频.*生成|ai.*视频/i
    ],
    skill: 'seedance-video',
    fields: ['prompt', 'duration', 'style'],
    domain: 'video'
  },
  'generate_image': {
    patterns: [
      /生成.*图片|创建.*图片|画.*图|图像.*生成/i,
      /文生图|AI.*绘画|ai.*画|画一张/i,
      /生成.*效果图|制作.*效果图/i
    ],
    skill: 'image-generator',
    fields: ['prompt', 'size', 'style'],
    domain: 'image'
  },
  'web_automation': {
    patterns: [
      /打开.*网页|访问.*网站|浏览器.*自动化/i,
      /抓取.*网页|爬取.*数据|网页.*数据/i,
      /自动.*浏览|网页.*操作/i,
      /打开.*淘宝|打开.*京东|打开.*酷家乐|打开.*网站/i
    ],
    skill: 'browser-automation',
    fields: ['url', 'action', 'selector'],
    domain: 'web'
  },
  'desktop_automation': {
    patterns: [
      /打开.*应用|打开.*程序|打开.*软件|启动.*应用/i,
      /桌面.*操作|桌面.*控制|鼠标.*点击|键盘.*输入/i,
      /打开.*文件夹|打开.*目录|打开.*盘|打开.*文件/i,
      /截图|截屏|屏幕.*截图/i
    ],
    skill: 'desktop-control',
    fields: ['action', 'params'],
    domain: 'desktop'
  },
  'wechat_send': {
    patterns: [
      /发送.*微信|微信.*消息|微信.*发送/i,
      /给.*发微信|微信.*通知/i
    ],
    skill: 'wechat-bot',
    fields: ['contact', 'message'],
    domain: 'communication'
  },
  'email_send': {
    patterns: [
      /发送.*邮件|发邮件|email.*send/i,
      /给.*发邮件|邮件.*通知/i
    ],
    skill: 'email-sender',
    fields: ['to', 'subject', 'body'],
    domain: 'communication'
  },
  'streaming_write': {
    patterns: [
      /流式.*写|实时.*写|边.*边写/i,
      /打字.*效果|逐字.*写入/i
    ],
    skill: 'streaming-writer',
    fields: ['appType', 'content', 'position'],
    domain: 'office'
  },
  'search_web': {
    patterns: [
      /搜索|查找|寻找|查询|检索/i,
      /帮我找|帮我搜|帮我查/i,
      /找出.*最好|找出.*最优|找出.*最便宜/i
    ],
    skill: 'web-scraper',
    fields: ['query', 'platform', 'output'],
    domain: 'web'
  }
}

const DOMAIN_KEYWORDS: Record<string, string[]> = {
  'decoration': ['装修', '建材', '报价', '设计', '材料', '风格', '客厅', '卧室', '厨房', '卫生间', '地板', '瓷砖', '涂料', '效果图', '户型'],
  'office': ['文档', 'word', 'excel', 'ppt', '表格', '报告', '合同', '演示', '幻灯片'],
  'video': ['视频', '短剧', '电影', '动画', '剪辑'],
  'image': ['图片', '图像', '画', '绘画', '设计', '海报'],
  'communication': ['微信', '邮件', '发送', '通知', '消息']
}

const FIELD_QUESTIONS: Record<string, { label: string, question: string, type: string, options?: string[], required: boolean }> = {
  'title': { label: '标题', question: '请提供文档标题：', type: 'text', required: true },
  'content': { label: '内容', question: '请提供文档内容：', type: 'textarea', required: true },
  'template': { label: '模板', question: '请选择模板类型：', type: 'choice', options: ['标准', '简约', '商务', '创意'], required: false },
  'prompt': { label: '描述', question: '请描述您想要生成的内容：', type: 'textarea', required: true },
  'duration': { label: '时长', question: '请指定时长（秒）：', type: 'number', required: false },
  'style': { label: '风格', question: '请选择风格：', type: 'choice', options: ['现代', '古典', '简约', '华丽'], required: false },
  'size': { label: '尺寸', question: '请选择图片尺寸：', type: 'choice', options: ['1024x1024', '1920x1080', '1080x1920', '512x512'], required: false },
  'url': { label: '网址', question: '请提供网址：', type: 'text', required: true },
  'action': { label: '操作', question: '请选择操作类型：', type: 'choice', options: ['打开', '截图', '提取文本', '点击'], required: true },
  'contact': { label: '联系人', question: '请提供联系人姓名或ID：', type: 'text', required: true },
  'message': { label: '消息', question: '请输入要发送的消息：', type: 'textarea', required: true },
  'to': { label: '收件人', question: '请提供收件人邮箱：', type: 'text', required: true },
  'subject': { label: '主题', question: '请输入邮件主题：', type: 'text', required: true },
  'body': { label: '正文', question: '请输入邮件正文：', type: 'textarea', required: true },
  'data': { label: '数据', question: '请提供表格数据：', type: 'textarea', required: true },
  'outputPath': { label: '保存路径', question: '请指定保存路径：', type: 'text', required: false },
  'appType': { label: '应用类型', question: '请选择应用类型：', type: 'choice', options: ['Word', 'WPS', 'Excel'], required: true },
  'position': { label: '写入位置', question: '请选择写入位置：', type: 'choice', options: ['末尾追加', '开头插入', '替换全部'], required: true }
}

export class IntentAnalyzer {
  
  analyze(userInput: string, domainHint?: string): IntentResult {
    const processedInput = this.preprocessInput(userInput)
    const detectedDomain = this.detectDomain(processedInput, domainHint)
    const intentResult = this.identifyIntent(processedInput, detectedDomain)
    const entities = this.extractEntities(processedInput, detectedDomain)
    const parameters = this.extractParameters(userInput, entities)
    
    const result: IntentResult = {
      intent: intentResult.intent,
      confidence: intentResult.confidence,
      entities,
      parameters,
      domain: detectedDomain,
      needsMoreInfo: false,
      missingFields: []
    }
    
    if (intentResult.skillName) {
      result.skillName = intentResult.skillName
      result.missingFields = this.findMissingFields(intentResult.skillName, parameters)
      result.needsMoreInfo = result.missingFields.length > 0
    }
    
    return result
  }
  
  private preprocessInput(input: string): string {
    return input.toLowerCase().trim().replace(/\s+/g, ' ')
  }
  
  private detectDomain(processedInput: string, hint?: string): string {
    if (hint) return hint
    
    const domainScores: Record<string, number> = {}
    
    for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
      let score = 0
      for (const keyword of keywords) {
        if (processedInput.includes(keyword.toLowerCase())) {
          score++
        }
      }
      if (score > 0) {
        domainScores[domain] = score
      }
    }
    
    const domains = Object.entries(domainScores)
    if (domains.length > 0) {
      domains.sort((a, b) => b[1] - a[1])
      return domains[0][0]
    }
    
    return 'general'
  }
  
  private identifyIntent(processedInput: string, domain: string): { intent: string, confidence: number, skillName?: string } {
    let bestMatch: { intent: string, confidence: number, skillName?: string } = { intent: 'chat', confidence: 0 }
    
    for (const [intentName, config] of Object.entries(INTENT_PATTERNS)) {
      if (domain !== 'general' && config.domain !== domain && config.domain !== 'office') {
        continue
      }
      
      for (const pattern of config.patterns) {
        if (pattern.test(processedInput)) {
          const confidence = 0.85
          if (confidence > bestMatch.confidence) {
            bestMatch = {
              intent: intentName,
              confidence,
              skillName: config.skill
            }
          }
        }
      }
    }
    
    return bestMatch
  }
  
  private extractEntities(text: string, domain: string): Record<string, any> {
    const entities: Record<string, any> = {}
    
    const numberPattern = /\d+(?:\.\d+)?/g
    const numbers = text.match(numberPattern)
    if (numbers) {
      entities.numbers = numbers.map(n => parseFloat(n))
    }
    
    const datePattern = /(\d{4})年(\d{1,2})月(\d{1,2})日?/
    const dateMatch = text.match(datePattern)
    if (dateMatch) {
      entities.date = `${dateMatch[1]}-${dateMatch[2].padStart(2, '0')}-${dateMatch[3].padStart(2, '0')}`
    }
    
    const timePattern = /(\d{1,2}):(\d{2})/
    const timeMatch = text.match(timePattern)
    if (timeMatch) {
      entities.time = `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}`
    }
    
    if (domain === 'decoration') {
      const areaPattern = /(\d+(?:\.\d+)?)\s*(平米|平方米|m²)/i
      const areaMatch = text.match(areaPattern)
      if (areaMatch) {
        entities.area = parseFloat(areaMatch[1])
      }
      
      const styles = ['现代简约', '中式', '欧式', '美式', '北欧', '日式', '工业风']
      for (const style of styles) {
        if (text.includes(style)) {
          entities.style = style
          break
        }
      }
    }
    
    return entities
  }
  
  private extractParameters(originalText: string, entities: Record<string, any>): Record<string, any> {
    const parameters: Record<string, any> = {}
    
    if (entities.area) parameters.area = entities.area
    if (entities.style) parameters.style = entities.style
    if (entities.date) parameters.date = entities.date
    if (entities.time) parameters.time = entities.time
    
    const contentPatterns = [
      /写[一篇]?关于["「『]?(.+?)["」』]?的/i,
      /内容[是为]["「『]?(.+?)["」』]?/i,
      /主题[是为]["「『]?(.+?)["」』]?/i
    ]
    
    for (const pattern of contentPatterns) {
      const match = originalText.match(pattern)
      if (match) {
        parameters.content = match[1]
        break
      }
    }
    
    return parameters
  }
  
  private findMissingFields(skillName: string, parameters: Record<string, any>): string[] {
    const missing: string[] = []
    
    for (const [intentName, config] of Object.entries(INTENT_PATTERNS)) {
      if (config.skill === skillName) {
        for (const field of config.fields) {
          const fieldInfo = FIELD_QUESTIONS[field]
          if (fieldInfo?.required && !parameters[field]) {
            missing.push(field)
          }
        }
        break
      }
    }
    
    return missing
  }
  
  getFieldQuestion(fieldName: string): { label: string, question: string, type: string, options?: string[] } | null {
    return FIELD_QUESTIONS[fieldName] || null
  }
  
  getIntentDescription(intent: string): string {
    const descriptions: Record<string, string> = {
      'generate_word': '生成Word文档',
      'generate_excel': '生成Excel表格',
      'generate_ppt': '生成PPT演示文稿',
      'generate_video': '生成视频',
      'generate_image': '生成图片',
      'web_automation': '执行网页自动化',
      'wechat_send': '发送微信消息',
      'email_send': '发送邮件',
      'streaming_write': '流式写入文档'
    }
    return descriptions[intent] || '执行任务'
  }
}

export const intentAnalyzer = new IntentAnalyzer()
