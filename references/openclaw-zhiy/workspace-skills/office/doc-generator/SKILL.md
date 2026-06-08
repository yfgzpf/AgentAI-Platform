---
name: doc-generator
version: 1.0.0
author: ZhiY Team
category: office
tags: [word, document, 合同, 报告]
---

# Word文档生成技能

## 功能描述
生成各类Word文档，支持模板填充、格式化、图表插入。支持流式追加写入。

## 参数说明
| 参数名 | 类型 | 必需 | 说明 |
|--------|------|------|------|
| --template | string | 否 | 模板文件路径 |
| --output | string | 是 | 输出文件路径 |
| --content | string | 否 | 文档内容（JSON格式） |
| --append | boolean | 否 | 是否追加模式 |
| --text | string | 否 | 追加的文本内容 |

## 调用示例

### 从模板生成
```bash
python main.py --template templates/contract.docx --output output/contract_001.docx --content '{"customerName":"张三","area":120}'
```

### 流式追加
```bash
python main.py --append --output output/report.docx --text "新增段落内容"
```

### 创建新文档
```bash
python main.py --output output/report.docx --content '{"title":"工作报告","sections":[...]}'
```

## 返回格式
```json
{
  "status": "success",
  "data": {
    "file_path": "/path/to/output.docx",
    "file_size": 12345,
    "pages": 5
  },
  "message": "文档生成成功"
}
```

## 依赖
- python-docx >= 0.8.11
- jinja2 >= 3.0.0

## 支持的文档类型
- 合同文档
- 报告文档
- 通知文档
- 备忘录
- 自定义模板文档

## 注意事项
- 模板变量使用 `{{variableName}}` 格式
- 支持表格、图片、图表插入
- 流式追加时自动添加分页符
