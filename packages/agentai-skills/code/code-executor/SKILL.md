---
name: code-executor
version: 1.2.0
description: Python/JS 代码沙箱执行，支持 pip/npm 安装依赖，自动捕获输出与异常
category: code
tags: [python, javascript, sandbox, execute, run, 代码执行, 运行]
riskLevel: medium
author: AgentAI
testCommand: echo "code-executor skill loaded"
---

# Code Executor — 代码沙箱执行

在隔离环境中安全执行 Python 或 JavaScript 代码，自动捕获 stdout/stderr，支持依赖安装。

## 参数说明

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| language | string | ✅ | `python` 或 `javascript` |
| code | string | ✅ | 源代码字符串 |
| timeout | int | ❌ | 超时秒数，默认 30s，最大 120s |
| packages | string[] | ❌ | 需要预安装的包，如 `["numpy","pandas"]` |
| env | object | ❌ | 额外环境变量 |

## 使用规则

1. **Python 执行路径**: 使用系统托管 Python `C:\Users\Administrator\.workbuddy\binaries\python\versions\3.13.12\python.exe`
2. **JS 执行路径**: 使用 Node.js `C:\Users\Administrator\.workbuddy\binaries\node\versions\22.22.2\node.exe`
3. **包安装**: 必须安装到隔离 venv，禁止全局安装
4. **危险操作**: 禁止执行 `rm -rf`、`del /f`、注册表修改等危险命令
5. **超时处理**: 超时后立即终止进程并返回已输出内容

## 调用示例

```
用户: 帮我运行这段 Python 代码，统计词频
→ AI: 使用 code-executor 工具执行，language=python, code=<代码>
```

## 输出格式

```json
{
  "success": true,
  "stdout": "输出内容",
  "stderr": "错误信息（如有）",
  "exitCode": 0,
  "executionTime": 1.23
}
```
