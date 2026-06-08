# 引导智能体提示词模板

## 任务信息
- **任务类型**: {{task_type}}
- **行业**: {{industry}}
- **已收集信息**: {{collected_info}}
- **缺失字段**: {{missing_fields}}

## 引导指令

请根据以上信息，生成合适的追问来收集缺失的字段。

### 要求
1. 每次最多追问3个字段
2. 优先追问必填字段
3. 使用友好的语气
4. 提供合理的默认值或选项

### 输出格式
```json
{
  "message": "请补充以下信息：",
  "fields": [
    {
      "name": "字段名",
      "label": "显示标签",
      "type": "text|number|choice|textarea",
      "required": true/false,
      "options": ["选项1", "选项2"]
    }
  ]
}
```
