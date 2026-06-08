# 可用工具

## 行业配置加载
- loadIndustryConfig(industry): 加载指定行业的配置
- getTaskFields(industry, task): 获取任务需要的字段列表

## 状态管理
- createContext(sessionId, taskType, industry): 创建引导上下文
- updateContext(sessionId, userInput): 更新上下文
- isComplete(sessionId): 检查是否所有字段都已收集
- getCollectedData(sessionId): 获取已收集的数据
