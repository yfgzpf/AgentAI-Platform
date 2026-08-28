---
name: sketch-to-cad
description: 手绘图纸智能识别转CAD工具。通过Vision API识别手绘图中的墙体、门窗、尺寸标注等元素，自动转换为标准DXF CAD文件，并生成工程量清单和报价表。支持现场测绘草图、客户手绘需求图等多种输入。
description_zh: "手绘图纸智能识别转CAD，自动生成工程量清单和报价"
description_en: "Intelligent sketch recognition to CAD conversion with automatic quantity takeoff"
version: 1.0.0
status: deprecated
deprecated_reason: "依赖OpenCV但环境缺失时mock降级返回硬编码假数据，识别能力虚假。"
metadata:
  category: decoration
  tags:
    - sketch
    - cad
    - dxf
    - vision
    - recognition
    - 手绘图
    - 识别
    - 转CAD
    - 工程量
    - 测绘
  author: AgentAI Team
  requires:
    bins:
      - python3
    python_packages:
      - ezdxf
      - opencv-python
      - numpy
      - pillow
  parallelSafe: true
  riskLevel: low
  triggers:
    - "手绘.*CAD"
    - "识别.*图纸"
    - "图纸.*转CAD"
    - "手绘图.*识别"
    - "测绘.*图"
    - "草图.*CAD"
    - "现场.*图"
    - "手绘.*报价"
    - "图纸.*报价"
---

# 手绘图转CAD识别器 ✏️

AI驱动的手绘图纸识别工具，让现场测绘草图秒变专业CAD。

## 核心能力

### 1. 手绘图智能识别
```
输入：现场手绘户型图照片
输出：
- 墙体位置和尺寸
- 门洞/窗户位置
- 房间分区识别
- 尺寸标注提取
- 家具/设施标记
```

### 2. CAD自动生成
- 标准DXF格式输出
- 分层显示（墙体、门窗、标注）
- 精确尺寸还原
- 比例尺自动校准

### 3. 工程量计算
- 墙面面积
- 地面面积
- 门窗洞口扣除
- 材料用量估算

### 4. 报价单生成
- 关联材料价格库
- 自动套用历史报价模板
- 生成专业报价表

## 识别元素类型

### 墙体 (WALL)
- 实线墙体
- 厚度识别
- 墙体长度测量

### 门 (DOOR)
- 单开门
- 双开门
- 推拉门
- 门洞尺寸

### 窗 (WINDOW)
- 普通窗
- 落地窗
- 飘窗
- 窗洞尺寸

### 房间 (ROOM)
- 客厅
- 卧室
- 厨房
- 卫生间
- 阳台

### 尺寸标注 (DIMENSION)
- 数字识别
- 单位提取
- 比例计算

## 输入参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| image_path | string | 是 | 手绘图文件路径 |
| scale_reference | object | 否 | 比例尺参考（已知尺寸） |
| room_type | string | 否 | 户型类型：apartment/villa/office |
| output_formats | array | 否 | 输出格式：dxf/svg/pdf |
| generate_quote | boolean | 否 | 是否生成报价单 |

## 输出结果

```json
{
  "success": true,
  "recognition": {
    "walls": [
      {"x1": 0, "y1": 0, "x2": 5000, "y2": 0, "thickness": 200}
    ],
    "doors": [
      {"x": 2000, "y": 0, "width": 900, "type": "single"}
    ],
    "windows": [
      {"x": 1500, "y": 0, "width": 1200, "height": 1500}
    ],
    "rooms": [
      {"name": "客厅", "area": 25.5, "vertices": [...]}
    ]
  },
  "files": {
    "dxf": "output/sketch_001.dxf",
    "svg": "output/sketch_001.svg"
  },
  "quantities": {
    "total_area": 89.5,
    "wall_area": 156.3,
    "floor_area": 89.5,
    "ceiling_area": 89.5
  },
  "quote": {
    "total": 158000,
    "breakdown": {...}
  }
}
```

## 使用流程

### 步骤1: 上传手绘图
用户上传现场测绘草图照片

### 步骤2: AI识别分析
- Vision API识别墙体、门窗
- OCR提取尺寸标注
- 比例尺校准

### 步骤3: 人工确认
AI展示识别结果，用户确认或修正：
```
识别到以下信息：
- 客厅：5.2m × 4.1m
- 主卧：3.8m × 3.5m
- 厨房：2.5m × 2.2m
- 卫生间：2m × 1.8m

确认无误？
```

### 步骤4: 生成CAD
导出标准DXF文件

### 步骤5: 生成报价（可选）
基于识别的工程量自动生成报价

## 使用示例

### 示例 1: 基本识别
```
识别这张手绘户型图，转成CAD
```

### 示例 2: 带比例尺
```
识别手绘图，已知客厅宽度是4.5米，生成CAD和报价
```

### 示例 3: 批量处理
```
识别这5张手绘图，分别是客厅、主卧、厨房、卫生间、阳台，统一生成CAD
```

## 技术说明

### 识别算法
1. **线条检测**：霍夫变换识别直线（墙体）
2. **形状识别**：检测矩形（门窗洞口）
3. **OCR识别**：提取数字标注
4. **语义理解**：识别房间功能分区

### 比例校准
- 用户提供一个已知尺寸作为参考
- AI自动计算图纸比例尺
- 所有尺寸按比例换算

### CAD分层
- 0层：轮廓线
- WALL层：墙体（线宽0.5）
- DOOR层：门（线宽0.3，虚线）
- WINDOW层：窗（线宽0.3）
- DIM层：尺寸标注
- TEXT层：文字标注

## 注意事项

1. **图纸质量**：建议拍照时保持光线充足、图纸平整
2. **比例尺**：务必提供一个已知尺寸作为参考，否则尺寸可能不准确
3. **复杂图形**：过于复杂的装饰线条可能识别不准确
4. **文字标注**：手写体识别率约85%，建议关键尺寸用印刷体
