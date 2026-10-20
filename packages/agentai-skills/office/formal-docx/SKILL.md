---
name: formal-docx
description: 正式 Word 文档生成器。把结构化内容生成排版规范的 .docx：封面、目录、章节标题、正文、表格、图片自适应插图、引文块、占位框、页脚页码，生成后自动版面自检。适用于生成合同、协议、研报、汇报材料、公文、说明书、标书等任何正式 Word 文档，也适用于把草稿内容整理成规范排版的文档。输入为 JSON 规格（标题/章节/段落/表格/图片），输出带封面目录页码的正式文档。
description_zh: "正式 Word 文档生成：合同协议、研报汇报、公文说明书，封面目录表格图片页码齐全，自动版面自检"
description_en: "Formal Word document generator: contracts, reports, official documents with cover, TOC, tables, figures, page numbers, and layout self-audit"
version: 1.0.0
metadata:
  category: office
  tags:
    - Word
    - 文档
    - 文档生成
    - 生成文档
    - 正式文档
    - 合同
    - 协议
    - 研报
    - 汇报
    - 汇报材料
    - 公文
    - 说明书
    - 标书
    - 排版
    - 封面
    - 目录
    - 表格
    - docx
    - 报告
    - 方案文档
  author: AgentAI Team
  requires:
    bins:
      - python3
    python_packages:
      - python-docx
      - Pillow
  parallelSafe: false
  riskLevel: low
  triggers:
    - "生成.*Word"
    - "生成.*文档"
    - "写.*合同"
    - "起草.*协议"
    - "做.*研报"
    - "写.*汇报"
    - "出.*正式.*文件"
    - "整理成.*文档"
    - "排版.*文档"
    - "docx"
    - "Word 文档"
    - "正式文件"
    - "合同.*生成"
    - "协议.*文档"
    - "报告.*文档"
    - "汇报.*文档"
    - "方案.*文档"
    - "公文"
    - "标书"
    - "说明书"
---

# 正式 Word 文档生成器

把结构化内容变成**排版规范、可直接分发**的 .docx。不是模板填充玩具——
产出带封面、目录、黑体标题、宋体正文、规范表格、自适应插图、页脚页码的正式文档，
生成后自动做版面自检。

## 何时使用

- 要生成合同、协议、研报、汇报材料、公文、说明书、标书等正式 Word 文档
- 手上有一堆草稿内容，要整理成规范排版的文档
- 要的文档需要封面 / 目录 / 页码 / 表格 / 插图等正式要素
- 轻量模板填充（改几个变量那种）用 `doc-generator`；**要正式交付物用本技能**

## 输入规格（build 动作）

```json
{
  "out": "输出.docx",
  "title": "文档大标题",
  "subtitle": "副标题（可选）",
  "meta": [["项目地点", "……"], ["编制日期", "……"]],
  "footer": "页脚左侧文字（可选）",
  "toc": true,
  "chapters": [
    {
      "title": "第一章　……",
      "sections": [
        {
          "h2": "1.1　……",
          "paras": ["正文段落……"],
          "quotes": ["引文块内容……"],
          "tables": [{"headers": ["列1", "列2"], "rows": [["a", "b"]], "widths": [3, 7]}],
          "figures": [{"path": "figs/x.png", "caption": "图 1　……", "max_h_cm": 14}],
          "slots": ["效果图占位说明"],
          "notes": ["注释文字"]
        }
      ]
    }
  ],
  "signature": [["甲方：＿＿＿＿", "日期：＿＿＿＿"], ["乙方：＿＿＿＿", "日期：＿＿＿＿"]]
}
```

## 动作

| 动作 | 说明 |
|---|---|
| `build` | 按规格生成 docx，返回统计 + 版面自检结果 |
| `audit` | 对已生成 docx 做版面体检（空段比例 / 表头 / 结构统计） |

## 排版规则（内置，调用方无需关心）

- 章首分页用 `page_break_before` 属性，不用分页符（避免夹空白页）
- 表格行 `cantSplit` 不断行，表头浅灰底纹
- 图片读真实像素算纵横比，宽高双约束（长图不溢出）
- 引文块用全角「」楷体棕色（`❝` 楷体无字形会渲染成方块，已禁用）
- 页脚「第 X 页 / 共 Y 页」用 PAGE/NUMPAGES 域代码
- 生成后自检：空段比例 > 35% 告警、空表头检测、结构统计

## 依赖

`python-docx` + `Pillow`（沙箱均已预装）。图片路径相对技能执行目录解析。

**图片格式边界**：python-docx 只支持位图插入（PNG / JPEG / GIF / BMP / TIFF），
**不支持 SVG**。SVG 图纸需先转 PNG 再传入（可用 `shot` 类技能转换）。
文件缺失时自动出占位框并在自检中列出缺失清单。
