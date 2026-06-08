# 引导智能体配置

## 任务类型映射
### 建材行业
- **contract**: 装修合同生成
  - 字段：customerName, area, style, budget

- **quote**: 装修报价生成
  - 字段：customerName, products, discount

### 通用任务
- **writing**: 写作任务
  - 字段：topic, type, style, length

- **image**: 图像生成
  - 字段：prompt, style, size

## 行业配置路径
- 建材行业：skills/construction/industry.config.json
- 汽修行业：skills/auto/industry.config.json
- 美容行业：skills/beauty/industry.config.json
