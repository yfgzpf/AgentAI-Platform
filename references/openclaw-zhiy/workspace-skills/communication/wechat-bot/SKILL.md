---
name: wechat-bot
version: 1.0.0
author: ZhiY Team
category: communication
tags: [微信, 自动化, 机器人]
---

# 微信机器人技能

## 功能描述
微信自动化操作，支持发送消息、群管理、自动回复等功能。

## 参数说明
| 参数名 | 类型 | 必需 | 说明 |
|--------|------|------|------|
| --action | string | 是 | 操作：send/reply/list |
| --target | string | 否 | 目标用户/群ID |
| --message | string | 否 | 消息内容 |
| --file | string | 否 | 文件路径 |

## 调用示例
```bash
python main.py --action send --target "张三" --message "你好"
python main.py --action list
```

## 返回格式
```json
{
  "status": "success",
  "data": {
    "message_id": "xxx",
    "sent_at": "2026-03-08T10:00:00Z"
  }
}
```

## 注意事项
- 需要先启动微信客户端
- 首次使用需要扫码登录
