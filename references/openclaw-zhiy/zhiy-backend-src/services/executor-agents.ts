/**
 * 智 Y.Ai 执行智能体系统
 * 
 * 核心概念：
 * - 主控智能体（DeepSeek）负责理解意图、分解任务、发送指令
 * - 执行智能体负责实际执行操作（浏览器、文件、代码等）
 * - 视觉智能体负责"看"网页内容（多模态模型）
 * 
 * 这解决了用户提出的核心问题：
 * "LLM有调用工具，但是谁来执行呢？打开网页了又有什么用呢？"
 */

import { EventEmitter } from 'events'
import { spawn, ChildProcess } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'

export interface ExecutorResult {
  success: boolean
  data?: any
  output?: string
  error?: string
  screenshots?: string[]
  elements?: PageElement[]
}

export interface PageElement {
  tag: string
  text: string
  attributes: Record<string, string>
  selector: string
  visible: boolean
  clickable: boolean
}

export interface BrowserState {
  url: string
  title: string
  content: string
  screenshot?: string
  elements: PageElement[]
}

export interface VisionResult {
  description: string
  text: string
  elements: Array<{
    type: string
    content: string
    position: { x: number; y: number; width: number; height: number }
  }>
  actions: string[]
}

export abstract class BaseExecutor extends EventEmitter {
  abstract name: string
  abstract description: string
  
  abstract execute(task: string, params: any): Promise<ExecutorResult>
  
  protected runCommand(command: string, args: string[], options?: { cwd?: string; timeout?: number }): Promise<{ stdout: string; stderr: string; code: number }> {
    return new Promise((resolve, reject) => {
      const proc = spawn(command, args, {
        cwd: options?.cwd || process.cwd(),
        shell: true
      })
      
      let stdout = ''
      let stderr = ''
      const timeout = options?.timeout || 60000
      
      const timer = setTimeout(() => {
        proc.kill()
        resolve({ stdout, stderr, code: -1 })
      }, timeout)
      
      proc.stdout.on('data', (data) => stdout += data.toString())
      proc.stderr.on('data', (data) => stderr += data.toString())
      
      proc.on('close', (code) => {
        clearTimeout(timer)
        resolve({ stdout, stderr, code: code || 0 })
      })
      
      proc.on('error', (err) => {
        clearTimeout(timer)
        resolve({ stdout, stderr, code: -1 })
      })
    })
  }
}

export class BrowserExecutor extends BaseExecutor {
  name = 'browser'
  description = '浏览器自动化执行者 - 控制浏览器进行网页操作'
  
  private browserPath: string
  private userDataDir: string
  
  constructor(config?: { browserPath?: string; userDataDir?: string }) {
    super()
    this.browserPath = config?.browserPath || 'chrome'
    this.userDataDir = config?.userDataDir || path.join(process.cwd(), '.browser-data')
  }
  
  async execute(task: string, params: any): Promise<ExecutorResult> {
    this.emit('start', { task, params })
    
    switch (task) {
      case 'navigate':
        return this.navigate(params.url)
      case 'click':
        return this.click(params.selector)
      case 'type':
        return this.type(params.selector, params.text)
      case 'screenshot':
        return this.screenshot(params.fullPage)
      case 'getContent':
        return this.getContent()
      case 'getElements':
        return this.getElements(params.selector)
      case 'scroll':
        return this.scroll(params.direction, params.amount)
      case 'wait':
        return this.wait(params.selector, params.timeout)
      case 'execute':
        return this.executeScript(params.script)
      default:
        return { success: false, error: `未知任务: ${task}` }
    }
  }
  
  private async navigate(url: string): Promise<ExecutorResult> {
    const script = `
      const { chromium } = require('playwright');
      (async () => {
        const browser = await chromium.launch({ headless: false });
        const page = await browser.newPage();
        await page.goto('${url}');
        console.log(JSON.stringify({ url: page.url(), title: await page.title() }));
      })().catch(console.error);
    `
    
    const result = await this.runPlaywrightScript(script)
    
    if (result.code === 0) {
      try {
        const data = JSON.parse(result.stdout)
        this.emit('navigated', data)
        return { success: true, data }
      } catch {
        return { success: true, output: result.stdout }
      }
    }
    
    return { success: false, error: result.stderr }
  }
  
  private async click(selector: string): Promise<ExecutorResult> {
    const script = `
      await page.click('${selector}');
      console.log('Clicked: ${selector}');
    `
    const result = await this.runPlaywrightScript(script)
    return { success: result.code === 0, output: result.stdout, error: result.stderr }
  }
  
  private async type(selector: string, text: string): Promise<ExecutorResult> {
    const script = `
      await page.fill('${selector}', '${text}');
      console.log('Typed into: ${selector}');
    `
    const result = await this.runPlaywrightScript(script)
    return { success: result.code === 0, output: result.stdout, error: result.stderr }
  }
  
  private async screenshot(fullPage: boolean = false): Promise<ExecutorResult> {
    const screenshotPath = path.join(this.userDataDir, `screenshot-${Date.now()}.png`)
    const script = `
      const screenshot = await page.screenshot({ path: '${screenshotPath}', fullPage: ${fullPage} });
      console.log('${screenshotPath}');
    `
    const result = await this.runPlaywrightScript(script)
    
    if (result.code === 0 && fs.existsSync(screenshotPath)) {
      const imageBuffer = fs.readFileSync(screenshotPath)
      const base64 = imageBuffer.toString('base64')
      return { 
        success: true, 
        data: { path: screenshotPath, base64 },
        screenshots: [base64]
      }
    }
    
    return { success: false, error: result.stderr }
  }
  
  private async getContent(): Promise<ExecutorResult> {
    const script = `
      const content = await page.content();
      const title = await page.title();
      const url = page.url();
      console.log(JSON.stringify({ url, title, content: content.substring(0, 10000) }));
    `
    const result = await this.runPlaywrightScript(script)
    
    if (result.code === 0) {
      try {
        const data = JSON.parse(result.stdout)
        return { success: true, data }
      } catch {
        return { success: true, output: result.stdout }
      }
    }
    
    return { success: false, error: result.stderr }
  }
  
  private async getElements(selector: string = 'body'): Promise<ExecutorResult> {
    const script = `
      const elements = await page.$$eval('${selector} *', els => 
        els.map(el => ({
          tag: el.tagName,
          text: el.textContent?.substring(0, 100),
          id: el.id,
          className: el.className,
          visible: el.offsetParent !== null
        }))
      );
      console.log(JSON.stringify(elements));
    `
    const result = await this.runPlaywrightScript(script)
    
    if (result.code === 0) {
      try {
        const elements = JSON.parse(result.stdout)
        return { success: true, elements }
      } catch {
        return { success: true, output: result.stdout }
      }
    }
    
    return { success: false, error: result.stderr }
  }
  
  private async scroll(direction: 'up' | 'down', amount: number): Promise<ExecutorResult> {
    const deltaY = direction === 'down' ? amount : -amount
    const script = `
      await page.mouse.wheel(0, ${deltaY});
      console.log('Scrolled ${direction} ${amount}px');
    `
    const result = await this.runPlaywrightScript(script)
    return { success: result.code === 0, output: result.stdout }
  }
  
  private async wait(selector: string, timeout: number = 30000): Promise<ExecutorResult> {
    const script = `
      await page.waitForSelector('${selector}', { timeout: ${timeout} });
      console.log('Element found: ${selector}');
    `
    const result = await this.runPlaywrightScript(script)
    return { success: result.code === 0, output: result.stdout, error: result.stderr }
  }
  
  private async executeScript(script: string): Promise<ExecutorResult> {
    const result = await this.runPlaywrightScript(script)
    return { success: result.code === 0, output: result.stdout, error: result.stderr }
  }
  
  private async runPlaywrightScript(script: string): Promise<{ stdout: string; stderr: string; code: number }> {
    const fullScript = `
      const { chromium } = require('playwright');
      (async () => {
        const browser = await chromium.launch({ headless: false });
        global.page = await browser.newPage();
        ${script}
      })().catch(console.error);
    `
    
    const scriptPath = path.join(this.userDataDir, `script-${Date.now()}.js`)
    const dir = path.dirname(scriptPath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(scriptPath, fullScript)
    
    const result = await this.runCommand('node', [scriptPath], { timeout: 60000 })
    
    try {
      fs.unlinkSync(scriptPath)
    } catch {}
    
    return result
  }
}

export class VisionExecutor extends BaseExecutor {
  name = 'vision'
  description = '视觉智能体 - 使用多模态模型识别网页内容'
  
  private apiKey: string
  private apiEndpoint: string
  private model: string
  
  constructor(config: { apiKey?: string; apiEndpoint?: string; model?: string }) {
    super()
    this.apiKey = config.apiKey || process.env.DEEPSEEK_API_KEY || ''
    this.apiEndpoint = config.apiEndpoint || 'https://api.deepseek.com/v1'
    this.model = config.model || 'deepseek-vision'
  }
  
  async execute(task: string, params: any): Promise<ExecutorResult> {
    this.emit('start', { task, params })
    
    switch (task) {
      case 'analyze':
        return this.analyzeImage(params.image, params.prompt)
      case 'readPage':
        return this.readPage(params.screenshot, params.url)
      case 'findElement':
        return this.findElement(params.screenshot, params.description)
      case 'extractText':
        return this.extractText(params.image)
      case 'understand':
        return this.understandContent(params.screenshot, params.question)
      default:
        return { success: false, error: `未知任务: ${task}` }
    }
  }
  
  async analyzeImage(imageBase64: string, prompt: string): Promise<ExecutorResult> {
    try {
      const response = await fetch(`${this.apiEndpoint}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                { type: 'image_url', image_url: { url: `data:image/png;base64,${imageBase64}` } }
              ]
            }
          ],
          max_tokens: 2000
        })
      })
      
      if (!response.ok) {
        return { success: false, error: `API 错误: ${response.status}` }
      }
      
      const data = await response.json() as any
      const content = data.choices[0].message.content
      
      this.emit('analyzed', { prompt, result: content })
      
      return { success: true, output: content, data: { analysis: content } }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  }
  
  async readPage(screenshotBase64: string, url: string): Promise<ExecutorResult> {
    const prompt = `你是一个网页内容分析专家。请分析这个网页截图，提取以下信息：

1. 页面标题和主要内容
2. 所有可见的文本内容
3. 可交互元素（按钮、链接、输入框等）及其位置
4. 页面布局结构

网页URL: ${url}

请以JSON格式返回结果。`
    
    const result = await this.analyzeImage(screenshotBase64, prompt)
    
    if (result.success && result.output) {
      try {
        const jsonMatch = result.output.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0])
          return { ...result, data: parsed }
        }
      } catch {}
    }
    
    return result
  }
  
  async findElement(screenshotBase64: string, description: string): Promise<ExecutorResult> {
    const prompt = `在网页截图中找到符合以下描述的元素："${description}"

请返回：
1. 元素类型
2. 元素上的文本
3. 元素的大致位置（描述相对于页面的位置）
4. 建议的CSS选择器或XPath

以JSON格式返回。`
    
    return this.analyzeImage(screenshotBase64, prompt)
  }
  
  async extractText(imageBase64: string): Promise<ExecutorResult> {
    const prompt = '请提取图片中的所有文字内容，保持原有的排版结构。'
    return this.analyzeImage(imageBase64, prompt)
  }
  
  async understandContent(screenshotBase64: string, question: string): Promise<ExecutorResult> {
    const prompt = `基于网页截图内容，回答以下问题：

${question}

请提供详细、准确的回答。`
    
    return this.analyzeImage(screenshotBase64, prompt)
  }
}

export class FileExecutor extends BaseExecutor {
  name = 'file'
  description = '文件操作执行者 - 处理文件读写、编辑等操作'
  
  private workspace: string
  
  constructor(config?: { workspace?: string }) {
    super()
    this.workspace = config?.workspace || process.cwd()
  }
  
  async execute(task: string, params: any): Promise<ExecutorResult> {
    this.emit('start', { task, params })
    
    switch (task) {
      case 'read':
        return this.readFile(params.path)
      case 'write':
        return this.writeFile(params.path, params.content)
      case 'edit':
        return this.editFile(params.path, params.oldContent, params.newContent)
      case 'delete':
        return this.deleteFile(params.path)
      case 'list':
        return this.listDir(params.path)
      case 'mkdir':
        return this.mkdir(params.path)
      case 'copy':
        return this.copy(params.source, params.destination)
      case 'move':
        return this.move(params.source, params.destination)
      default:
        return { success: false, error: `未知任务: ${task}` }
    }
  }
  
  private resolvePath(p: string): string {
    return path.isAbsolute(p) ? p : path.join(this.workspace, p)
  }
  
  private async readFile(filePath: string): Promise<ExecutorResult> {
    const absolutePath = this.resolvePath(filePath)
    
    if (!fs.existsSync(absolutePath)) {
      return { success: false, error: `文件不存在: ${absolutePath}` }
    }
    
    try {
      const content = fs.readFileSync(absolutePath, 'utf-8')
      return { success: true, output: content, data: { path: absolutePath, content } }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  }
  
  private async writeFile(filePath: string, content: string): Promise<ExecutorResult> {
    const absolutePath = this.resolvePath(filePath)
    
    try {
      const dir = path.dirname(absolutePath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      
      fs.writeFileSync(absolutePath, content, 'utf-8')
      return { success: true, output: `文件已写入: ${absolutePath}` }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  }
  
  private async editFile(filePath: string, oldContent: string, newContent: string): Promise<ExecutorResult> {
    const absolutePath = this.resolvePath(filePath)
    
    if (!fs.existsSync(absolutePath)) {
      return { success: false, error: `文件不存在: ${absolutePath}` }
    }
    
    try {
      const content = fs.readFileSync(absolutePath, 'utf-8')
      
      if (!content.includes(oldContent)) {
        return { success: false, error: '未找到要替换的内容' }
      }
      
      const newFileContent = content.replace(oldContent, newContent)
      fs.writeFileSync(absolutePath, newFileContent, 'utf-8')
      
      return { success: true, output: `文件已编辑: ${absolutePath}` }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  }
  
  private async deleteFile(filePath: string): Promise<ExecutorResult> {
    const absolutePath = this.resolvePath(filePath)
    
    if (!fs.existsSync(absolutePath)) {
      return { success: false, error: `文件不存在: ${absolutePath}` }
    }
    
    try {
      fs.unlinkSync(absolutePath)
      return { success: true, output: `文件已删除: ${absolutePath}` }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  }
  
  private async listDir(dirPath: string): Promise<ExecutorResult> {
    const absolutePath = this.resolvePath(dirPath)
    
    if (!fs.existsSync(absolutePath)) {
      return { success: false, error: `目录不存在: ${absolutePath}` }
    }
    
    try {
      const entries = fs.readdirSync(absolutePath, { withFileTypes: true })
      const items = entries.map(e => ({
        name: e.name,
        type: e.isDirectory() ? 'directory' : 'file'
      }))
      
      return { success: true, data: { path: absolutePath, items }, output: items.map(i => `${i.type === 'directory' ? 'd' : '-'} ${i.name}`).join('\n') }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  }
  
  private async mkdir(dirPath: string): Promise<ExecutorResult> {
    const absolutePath = this.resolvePath(dirPath)
    
    try {
      fs.mkdirSync(absolutePath, { recursive: true })
      return { success: true, output: `目录已创建: ${absolutePath}` }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  }
  
  private async copy(source: string, destination: string): Promise<ExecutorResult> {
    const sourcePath = this.resolvePath(source)
    const destPath = this.resolvePath(destination)
    
    if (!fs.existsSync(sourcePath)) {
      return { success: false, error: `源文件不存在: ${sourcePath}` }
    }
    
    try {
      fs.copyFileSync(sourcePath, destPath)
      return { success: true, output: `文件已复制: ${sourcePath} -> ${destPath}` }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  }
  
  private async move(source: string, destination: string): Promise<ExecutorResult> {
    const sourcePath = this.resolvePath(source)
    const destPath = this.resolvePath(destination)
    
    if (!fs.existsSync(sourcePath)) {
      return { success: false, error: `源文件不存在: ${sourcePath}` }
    }
    
    try {
      fs.renameSync(sourcePath, destPath)
      return { success: true, output: `文件已移动: ${sourcePath} -> ${destPath}` }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  }
}

export class CodeExecutor extends BaseExecutor {
  name = 'code'
  description = '代码执行者 - 在沙箱中执行代码'
  
  private timeout: number
  
  constructor(config?: { timeout?: number }) {
    super()
    this.timeout = config?.timeout || 60000
  }
  
  async execute(task: string, params: any): Promise<ExecutorResult> {
    this.emit('start', { task, params })
    
    switch (task) {
      case 'run':
        return this.runCode(params.code, params.language)
      case 'runFile':
        return this.runFile(params.path, params.args)
      case 'shell':
        return this.runShell(params.command)
      default:
        return { success: false, error: `未知任务: ${task}` }
    }
  }
  
  private async runCode(code: string, language: string = 'python'): Promise<ExecutorResult> {
    const tempFile = path.join(process.cwd(), `.temp-${Date.now()}.${language === 'python' ? 'py' : 'js'}`)
    
    try {
      fs.writeFileSync(tempFile, code, 'utf-8')
      
      const command = language === 'python' ? 'python' : 'node'
      const result = await this.runCommand(command, [tempFile], { timeout: this.timeout })
      
      return {
        success: result.code === 0,
        output: result.stdout,
        error: result.stderr
      }
    } finally {
      try {
        fs.unlinkSync(tempFile)
      } catch {}
    }
  }
  
  private async runFile(filePath: string, args: string[] = []): Promise<ExecutorResult> {
    const ext = path.extname(filePath)
    const command = ext === '.py' ? 'python' : ext === '.js' ? 'node' : ext === '.sh' ? 'bash' : 'python'
    
    const result = await this.runCommand(command, [filePath, ...args], { timeout: this.timeout })
    
    return {
      success: result.code === 0,
      output: result.stdout,
      error: result.stderr
    }
  }
  
  private async runShell(command: string): Promise<ExecutorResult> {
    const result = await this.runCommand('powershell', ['-Command', command], { timeout: this.timeout })
    
    return {
      success: result.code === 0,
      output: result.stdout,
      error: result.stderr
    }
  }
}

export class ExecutorRegistry {
  private executors: Map<string, BaseExecutor> = new Map()
  
  constructor() {
    this.register(new BrowserExecutor())
    this.register(new VisionExecutor({}))
    this.register(new FileExecutor())
    this.register(new CodeExecutor())
  }
  
  register(executor: BaseExecutor): void {
    this.executors.set(executor.name, executor)
    console.log(`[ExecutorRegistry] 注册执行者: ${executor.name} - ${executor.description}`)
  }
  
  get(name: string): BaseExecutor | undefined {
    return this.executors.get(name)
  }
  
  getAll(): BaseExecutor[] {
    return Array.from(this.executors.values())
  }
  
  getDescriptions(): Record<string, string> {
    const descs: Record<string, string> = {}
    for (const [name, executor] of this.executors) {
      descs[name] = executor.description
    }
    return descs
  }
}
