---
name: cad-control
version: 1.0.0
description: AutoCAD CLI 控制技能，支持生成 .scr 脚本、执行 CAD 命令、DXF 文件读写
author: AgentAI
tags: [desktop, cad, autocad, dxf]
dependencies: [ezdxf]
testCommand: python main.py --test
riskLevel: medium
---

# CAD Control (AutoCAD CLI 控制)

AutoCAD 命令行控制技能，支持：
- 生成 AutoCAD .scr 脚本文件
- 执行 AutoCAD 命令行操作
- DXF 文件读写（墙体/门窗/房间）
- CAD 图纸解析（提取尺寸/标注）

## 参数

### 生成脚本
- `action`: `generate_script`
- `commands`: CAD 命令列表（LINE/CIRCLE/TEXT 等）
- `output_path`: 脚本输出路径

### 执行命令
- `action`: `execute`
- `script_path`: .scr 脚本路径
- `acad_path`: AutoCAD 安装路径（可选，默认自动查找）

### DXF 操作
- `action`: `parse_dxf` / `write_dxf`
- `file_path`: DXF 文件路径
- `entities`: 要写入的实体列表（可选）

## 示例

### 生成脚本
```json
{
  "action": "generate_script",
  "commands": [
    { "cmd": "LINE", "args": ["0,0", "100,100"] },
    { "cmd": "CIRCLE", "args": ["50,50", "25"] },
    { "cmd": "TEXT", "args": ["50,50", "5", "0", "Room Name"] }
  ],
  "output_path": "output.scr"
}
```

### 执行脚本
```json
{
  "action": "execute",
  "script_path": "output.scr"
}
```

### 解析 DXF
```json
{
  "action": "parse_dxf",
  "file_path": "drawing.dxf"
}
```

## 执行环境

- Windows: AutoCAD 2020+ 或 ODA File Converter
- Python: ezdxf 库（DXF 读写）
- 权限: 需要管理员权限（执行 AutoCAD）

## 支持的 CAD 软件

| 软件 | CLI 接口 | 支持度 |
|------|----------|--------|
| AutoCAD | .scr + COM API | ✅ 完全支持 |
| ODA File Converter | 命令行转换 | ✅ DWG→DXF |
| SketchUp | Ruby API | 🔶 计划支持 |
| Revit | Dynamo | 🔶 计划支持 |