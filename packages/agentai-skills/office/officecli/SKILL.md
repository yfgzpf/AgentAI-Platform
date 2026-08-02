---
name: officecli
description: OfficeCLI — 零依赖 Office 文档处理工具，支持 Word(.docx)/Excel(.xlsx)/PowerPoint(.pptx) 的创建、读取、修改和批量生成。AI 友好，JSON 输出，实时预览。
category: data
tools:
  - run_code
triggers:
  - "生成 Word"
  - "创建 PPT"
  - "处理 Excel"
  - "批量生成文档"
  - "写报告"
  - "做演示文稿"
  - "修改 Word"
  - "修改 PPT"
  - "修改 Excel"
  - "文档排版"
---

# OfficeCLI 技能

## 简介

OfficeCLI 是一个零依赖的命令行工具，让 AI Agent 能够轻松创建、读取和修改 Word、Excel 和 PowerPoint 文档。

## 安装

### Windows (PowerShell)
```powershell
irm https://raw.githubusercontent.com/iOfficeAI/OfficeCLI/main/install.ps1 | iex
```

### macOS / Linux
```bash
curl -fsSL https://raw.githubusercontent.com/iOfficeAI/OfficeCLI/main/install.sh | bash
```

### 验证安装
```bash
officecli --version
```

## 核心命令

### 创建文档
```bash
officecli create report.docx          # 创建 Word
officecli create data.xlsx            # 创建 Excel
officecli create deck.pptx            # 创建 PPT
```

### Word 操作
```bash
# 添加标题
officecli add report.docx /body --type paragraph --prop text="标题" --prop style=Heading1

# 添加正文
officecli add report.docx /body --type paragraph --prop text="正文内容"

# 全局替换
officecli set report.docx /body --prop find="旧" --prop replace="新"

# 添加表格
officecli add report.docx /body --type table --prop rows=3 --prop cols=4
```

### Excel 操作
```bash
# 写入单元格
officecli set data.xlsx /Sheet1/A1 --prop value="姓名" --prop bold=true
officecli set data.xlsx /Sheet1/A2 --prop value="张三"

# 批量更新 (从 JSON)
officecli batch data.xlsx --input updates.json --json

# 创建数据透视表
officecli add data.xlsx /Sheet1 --type pivottable --prop source="Sheet1!A1:C100" --prop rows=部门 --prop values="销售额:sum"
```

### PowerPoint 操作
```bash
# 添加幻灯片
officecli add deck.pptx / --type slide --prop title="标题"

# 添加形状
officecli add deck.pptx '/slide[1]' --type shape --prop text="内容" --prop x=2cm --prop y=5cm

# 添加图表
officecli add deck.pptx '/slide[2]' --type chart --prop type=column --prop categories="Q1,Q2,Q3,Q4" --prop series="营收:100,120,150,180"

# 实时预览
officecli watch deck.pptx  # 浏览器访问 http://localhost:26315
```

### 模板批量生成
```bash
# 设计模板 (含 {{client}}, {{total}} 等占位符)
officecli merge template.docx out-001.docx '{"client":"Acme公司","total":"¥52,000"}'

# 批量生成 100 份
for i in $(seq 1 100); do
  officecli merge template.docx "out-$i.docx" "$(cat data-$i.json)"
done
```

### 查看和导出
```bash
officecli view report.docx outline --json     # 查看结构
officecli view deck.pptx screenshot -o slide.png  # 导出图片
officecli view report.docx html -o report.html    # 导出 HTML
```

## AI 使用指南

### 1. 创建文档
告诉 AI 你想要什么文档，让它自动生成：
```
用户：帮我生成一份 2024 年度总结报告，包含标题、正文和表格
AI：使用 officecli 创建 Word 文档...
```

### 2. 修改文档
```
用户：把报告里的"待定"改成"已完成"
AI：使用 officecli set 命令修改...
```

### 3. 批量生成
```
用户：用这个模板批量生成 100 份合同
AI：使用 officecli merge + batch 命令...
```

### 4. 实时预览
生成 PPT 后，AI 可以启动 watch 模式让你预览效果。

## 注意事项

1. **安装后无需重启**：OfficeCLI 是单二进制文件，安装即可用
2. **零依赖**：不需要安装 Office、.NET 或 Python
3. **跨平台**：Windows/macOS/Linux 均支持
4. **JSON 输出**：所有命令支持 `--json` 参数，方便 AI 解析
5. **实时预览**：PPT 的 watch 模式可以实时看到修改效果