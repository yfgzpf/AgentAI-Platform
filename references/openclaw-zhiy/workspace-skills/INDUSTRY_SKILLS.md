# 行业技能配置

## 装饰建材行业

### 合同生成技能
- **技能路径**: `skills/construction/contract/`
- **功能**: 根据客户信息生成装修合同
- **参数**:
  - `customerName`: 宵户姓名
  - `area`: 装修面积（平方米）
  - `style`: 户型风格（现代/欧式/中式/美式）
  - `budget`: 预算范围（可选）

### 报价单生成技能
- **技能路径**: `skills/construction/quote/`
- **功能**: 生成材料报价单
- **参数**:
  - `products`: 产品清单
  - `discount`: 折扣（%）

## 汽修行业

### 维修报价技能
- **技能路径**: `skills/auto/repair-quote/`
- **功能**: 生成维修报价单
- **参数**:
  - `vehicleInfo`: 车辆信息
  - `issues`: 故障描述
  - `parts`: 配件清单

### 保养计划技能
- **技能路径**: `skills/auto/maintenance-plan/`
- **功能**: 生成保养计划
- **参数**:
  - `vehicleInfo`: 车辆信息
  - `mileage`: 里程数

## 美容行业

### 预约管理技能
- **技能路径**: `skills/beauty/appointment/`
- **功能**: 管理客户预约
- **参数**:
  - `customerName`: 客户姓名
  - `service`: 服务项目
  - `datetime`: 预约时间

### 价格表生成技能
- **技能路径**: `skills/beauty/price-list/`
- **功能**: 生成服务价格表
- **参数**:
  - `services`: 服务项目列表
  - `category`: 分类（护肤/美发/美甲等）

---

## 使用方式

在对话中提及行业任务时，智能体会自动识别并调用相应的技能。

示例：
- "帮我生成一份装修合同" → 调用 construction/contract
- "生成维修报价单" → 调用 auto/repair-quote
- "创建美容价格表" → 调用 beauty/price-list
