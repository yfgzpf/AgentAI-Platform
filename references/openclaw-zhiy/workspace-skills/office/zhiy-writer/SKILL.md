---
name: zhiy-writer
version: 1.0.0
author: ZhiY Team
category: office
tags: [写作, AI, 文档]
---

# 智 Y 写作技能

## 功能描述
智能写作助手，支持多种文档类型的生成和编辑，包括文章、报告、合同、剧本等。

## 参数说明
| 参数名 | 类型 | 必需 | 说明 |
|--------|------|------|------|
| --type | string | 是 | 文档类型：article/report/contract/script |
| --topic | string | 是 | 主题/标题 |
| --content | string | 否 | 内容大纲或要求 |
| --style | string | 否 | 写作风格：formal/casual/creative |
| --output | string | 是 | 输出文件路径 |

## 调用示例
```bash
python main.py --type article --topic "人工智能发展趋势" --style formal --output article.md
```

## 返回格式
```json
{
  "status": "success",
  "data": {
    "file_path": "/path/to/output.md",
    "word_count": 1500
  }
}
```

## 依赖
- openai >= 1.0.0
- python-docx >= 0.8.11
