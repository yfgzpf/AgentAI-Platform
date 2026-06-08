import fs from 'fs'
import path from 'path'
import os from 'os'

export interface FieldConfig {
  name: string
  label: string
  type: 'text' | 'number' | 'textarea' | 'choice' | 'multiselect'
  options?: string[]
  required: boolean
  placeholder?: string
  default?: any
}

export interface TaskConfig {
  fields: FieldConfig[]
  skill: string
  description?: string
}

export interface IndustryConfig {
  industry: string
  displayName: string
  description?: string
  tasks: Record<string, TaskConfig>
}

export class IndustryManager {
  private skillsDir: string
  private configCache: Map<string, IndustryConfig> = new Map()
  
  constructor() {
    this.skillsDir = path.join(process.cwd(), 'skills')
    this.ensureSkillsDir()
    this.loadAllConfigs()
  }
  
  private ensureSkillsDir() {
    try {
      if (!fs.existsSync(this.skillsDir)) {
        fs.mkdirSync(this.skillsDir, { recursive: true })
      }
    } catch (error) {
      console.error('[IndustryManager] Failed to create skills dir:', error)
    }
  }
  
  private loadAllConfigs() {
    if (!fs.existsSync(this.skillsDir)) return
    
    const industries = fs.readdirSync(this.skillsDir).filter(f => {
      const configPath = path.join(this.skillsDir, f, 'industry.config.json')
      return fs.existsSync(configPath)
    })
    
    for (const industry of industries) {
      try {
        const configPath = path.join(this.skillsDir, industry, 'industry.config.json')
        const content = fs.readFileSync(configPath, 'utf8')
        const config: IndustryConfig = JSON.parse(content)
        this.configCache.set(industry, config)
      } catch (error) {
        console.error(`[IndustryManager] Failed to load config for ${industry}:`, error)
      }
    }
  }
  
  getIndustries(): { id: string; name: string; description?: string }[] {
    return Array.from(this.configCache.entries()).map(([id, config]) => ({
      id,
      name: config.displayName,
      description: config.description
    }))
  }
  
  getIndustryConfig(industry: string): IndustryConfig | null {
    return this.configCache.get(industry) || null
  }
  
  getTaskConfig(industry: string, task: string): TaskConfig | null {
    const config = this.configCache.get(industry)
    if (!config) return null
    return config.tasks[task] || null
  }
  
  getTaskFields(industry: string, task: string): FieldConfig[] {
    const taskConfig = this.getTaskConfig(industry, task)
    return taskConfig?.fields || []
  }
  
  getRequiredFields(industry: string, task: string): FieldConfig[] {
    return this.getTaskFields(industry, task).filter(f => f.required)
  }
  
  getMissingFields(
    industry: string, 
    task: string, 
    collected: Record<string, any>
  ): FieldConfig[] {
    const requiredFields = this.getRequiredFields(industry, task)
    return requiredFields.filter(f => {
      const value = collected[f.name]
      return value === undefined || value === null || value === ''
    })
  }
  
  createDefaultIndustryConfig() {
    const defaultConfig: IndustryConfig = {
      industry: 'construction',
      displayName: '装饰建材',
      description: '装修合同、报价单、效果图生成',
      tasks: {
        contract: {
          fields: [
            { name: 'customerName', label: '客户姓名', type: 'text', required: true, placeholder: '请输入客户姓名' },
            { name: 'area', label: '装修面积（平方米）', type: 'number', required: true, placeholder: '请输入面积' },
            { name: 'style', label: '户型风格', type: 'choice', options: ['现代', '欧式', '中式', '美式', '北欧', '日式'], required: true },
            { name: 'budget', label: '预算范围', type: 'text', required: false, placeholder: '例如：10-15万' }
          ],
          skill: 'construction/contract',
          description: '生成装修合同'
        },
        quote: {
          fields: [
            { name: 'products', label: '产品清单', type: 'textarea', required: true, placeholder: '每行一个产品' },
            { name: 'discount', label: '折扣（%）', type: 'number', required: false, default: 100 }
          ],
          skill: 'construction/quote',
          description: '生成报价单'
        }
      }
    }
    
    const industryDir = path.join(this.skillsDir, 'construction')
    if (!fs.existsSync(industryDir)) {
      fs.mkdirSync(industryDir, { recursive: true })
    }
    
    const configPath = path.join(industryDir, 'industry.config.json')
    if (!fs.existsSync(configPath)) {
      fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2), 'utf8')
      this.configCache.set('construction', defaultConfig)
      console.log('[IndustryManager] Created default industry config')
    }
    
    return defaultConfig
  }
}

export const industryManager = new IndustryManager()
