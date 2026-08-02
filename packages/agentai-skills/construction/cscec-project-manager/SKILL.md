---
name: cscec-project-manager
description: 中建集团专用工程项目管理系统。支持大型建筑工程的项目管理、进度跟踪、成本控制、质量安全管理、BIM协同、分包管理、物资采购等全流程数字化管理。
description_zh: "中建集团专用工程项目管理系统，支持大型建筑工程全流程数字化管理"
description_en: "CSCEC (China State Construction Engineering) Project Management System"
version: 1.0.0
metadata:
  category: construction
  tags:
    - cscec
    - 中建
    - 工程项目
    - BIM
    - 进度管理
    - 成本控制
    - 质量安全
    - 分包管理
    - 物资采购
  author: AgentAI Team
  requires:
    bins:
      - python3
    python_packages:
      - pandas
      - openpyxl
      - matplotlib
  parallelSafe: false
  riskLevel: high
  triggers:
    - "中建.*项目"
    - "工程.*管理"
    - "进度.*跟踪"
    - "成本.*控制"
    - "BIM.*协同"
    - "分包.*管理"
    - "物资.*采购"
    - "质量.*安全"
    - "施工.*计划"
---

# 中建工程项目管理系统 🏗️

专为中建集团及大型建筑企业打造的工程项目管理数字化解决方案。

## 核心模块

### 1. 项目总览 Dashboard
```
项目名称: XXX商业综合体
项目编号: CSCEC-2024-BJ-001
项目状态: 主体结构施工中
完成进度: 65%
合同金额: 5.8亿元
实际成本: 3.2亿元
质量安全: 优良
```

### 2. 进度管理
- **总进度计划**: 甘特图、关键路径
- **月度计划**: 分解到周、日
- **进度预警**: 延期自动提醒
- **进度调整**: 动态优化

### 3. 成本控制
- **预算管理**: 总预算分解
- **成本核算**: 人工/材料/机械
- **成本预警**: 超支预警
- **变更管理**: 签证、索赔

### 4. BIM协同
- **模型管理**: Revit/Navisworks
- **碰撞检查**: 自动检测
- **施工模拟**: 4D/5D BIM
- **协同平台**: 多方协作

### 5. 质量安全管理
- **质量检查**: 分部分项验收
- **安全巡查**: 隐患排查
- **整改跟踪**: 闭环管理
- **事故管理**: 应急预案

### 6. 分包管理
- **分包商库**: 资质管理
- **合同管理**: 分包合同
- **结算管理**: 进度款、结算
- **评价考核**: 绩效评估

### 7. 物资采购
- **需求计划**: 材料计划
- **采购管理**: 招标、合同
- **库存管理**: 出入库
- **供应商管理**: 评价体系

## 数据标准

### 项目编码规则
```
CSCEC-YYYY-XX-NNN
├── 公司代码
├── 年份
├── 地区代码
└── 项目序号

例: CSCEC-2024-BJ-001 = 中建2024年北京第1个项目
```

### WBS 工作分解结构
```
1 工程项目
  1.1 前期工程
    1.1.1 场地平整
    1.1.2 临建搭设
  1.2 基础工程
    1.2.1 土方开挖
    1.2.2 桩基工程
    1.2.3 基础底板
  1.3 主体结构
    1.3.1 钢筋工程
    1.3.2 模板工程
    1.3.3 混凝土工程
  1.4 装饰装修
    1.4.1 抹灰工程
    1.4.2 地面工程
    1.4.3 吊顶工程
  1.5 机电安装
    1.5.1 给排水
    1.5.2 电气
    1.5.3 暖通
```

## 输入参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| project_code | string | 是 | 项目编码 |
| action | string | 是 | 操作类型 |
| data | object | 否 | 操作数据 |

## 操作类型

### 项目初始化
```json
{
  "action": "init_project",
  "data": {
    "project_name": "XXX商业综合体",
    "project_code": "CSCEC-2024-BJ-001",
    "contract_amount": 580000000,
    "start_date": "2024-03-01",
    "end_date": "2026-12-31",
    "project_manager": "张三",
    "location": "北京市朝阳区"
  }
}
```

### 进度更新
```json
{
  "action": "update_progress",
  "data": {
    "wbs_code": "1.3.1",
    "progress": 85,
    "actual_start": "2024-06-01",
    "actual_end": null,
    "remarks": "钢筋绑扎完成85%"
  }
}
```

### 成本录入
```json
{
  "action": "record_cost",
  "data": {
    "cost_type": "material",
    "wbs_code": "1.3.3",
    "amount": 1500000,
    "date": "2024-07-15",
    "description": "C30混凝土采购"
  }
}
```

### 生成报表
```json
{
  "action": "generate_report",
  "data": {
    "report_type": "monthly",
    "month": "2024-07",
    "format": "excel"
  }
}
```

## 输出格式

```json
{
  "success": true,
  "project_code": "CSCEC-2024-BJ-001",
  "data": {
    "overview": {
      "progress": 65,
      "cost_status": "正常",
      "quality_status": "优良",
      "safety_status": "优良"
    },
    "reports": {
      "monthly_report": "output/CSCEC-2024-BJ-001_monthly_202407.xlsx",
      "progress_chart": "output/progress_chart.png"
    }
  }
}
```

## 使用示例

### 示例 1: 创建新项目
```
创建中建项目，名称：北京CBD综合体，合同金额5.8亿，工期2024.3-2026.12
```

### 示例 2: 更新进度
```
项目CSCEC-2024-BJ-001主体结构进度更新到75%
```

### 示例 3: 生成月报
```
生成CSCEC-2024-BJ-001项目2024年7月月报
```

### 示例 4: 成本分析
```
分析项目CSCEC-2024-BJ-001成本偏差，找出超支项
```
