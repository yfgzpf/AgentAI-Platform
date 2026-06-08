# 技能规范 (Skill Specification)

## 技能目录结构
```
skill-name/
├── SKILL.md          # 技能描述文件（必需）
├── main.py           # 主执行脚本
├── requirements.txt  # Python依赖（可选）
├── config.json       # 技能配置（可选）
├── templates/        # 模板文件（可选）
└── tests/            # 测试用例（可选）
```

## SKILL.md 模板

```markdown
---
name: skill-name
version: 1.0.0
author: ZhiY Team
category: office|web|video|image|communication|memory
tags: [tag1, tag2]
---

# 技能名称

## 功能描述
详细描述技能的功能和用途。

## 参数说明
| 参数名 | 类型 | 必需 | 说明 |
|--------|------|------|------|
| --param1 | string | 是 | 参数说明 |
| --param2 | number | 否 | 参数说明 |

## 调用示例
```bash
python main.py --param1 value1 --param2 value2
```

## 返回格式
```json
{
  "status": "success|error",
  "data": {...},
  "message": "执行结果说明"
}
```

## 依赖
- Python 3.9+
- 第三方库列表

## 注意事项
- 安全相关提醒
- 使用限制
```

## 技能分类

### 1. 办公技能 (office)
| 技能名 | 功能 | 状态 |
|--------|------|------|
| doc-generator | Word文档生成 | ✅ |
| excel-generator | Excel表格生成 | ✅ |
| ppt-generator | PPT演示生成 | ✅ |
| pdf-converter | PDF转换处理 | ✅ |

### 2. 网页技能 (web)
| 技能名 | 功能 | 状态 |
|--------|------|------|
| browser-auto | 浏览器自动化 | ✅ |
| web-scraper | 网页数据抓取 | ✅ |
| social-publisher | 社交媒体发布 | ✅ |

### 3. 视频技能 (video)
| 技能名 | 功能 | 状态 |
|--------|------|------|
| seedance-video | 豆包视频生成 | ✅ |
| video-composer | 视频合成 | ✅ |
| video-editor | 视频编辑 | ✅ |

### 4. 图像技能 (image)
| 技能名 | 功能 | 状态 |
|--------|------|------|
| image-gen | 图像生成 | ✅ |
| image-edit | 图像编辑 | ✅ |
| image-ocr | 图像识别 | ✅ |

### 5. 通信技能 (communication)
| 技能名 | 功能 | 状态 |
|--------|------|------|
| wechat-bot | 微信机器人 | ✅ |
| email-sender | 邮件发送 | ✅ |
| telegram-bot | Telegram机器人 | ✅ |
| sms-sender | 短信发送 | ✅ |

### 6. 记忆技能 (memory)
| 技能名 | 功能 | 状态 |
|--------|------|------|
| memory-keeper | 记忆写入 | ✅ |
| memory-search | 记忆搜索 | ✅ |

## 技能执行环境

### 沙箱配置
```json
{
  "sandbox": {
    "enabled": true,
    "type": "docker",
    "image": "python:3.9-slim",
    "memory": "512M",
    "cpu": 1,
    "timeout": 300,
    "network": "none"
  }
}
```

### 权限配置
```json
{
  "permissions": {
    "fs": {
      "read": ["/data", "/workspace"],
      "write": ["/output"]
    },
    "network": {
      "allowed_hosts": ["api.deepseek.com", "api.doubao.com"]
    },
    "exec": {
      "allowed_commands": ["python", "node"]
    }
  }
}
```

## 技能安装

### 从本地安装
```bash
zhiy skill install --local /path/to/skill
```

### 从ClawHub安装
```bash
zhiy skill install skill-name
```

### 查看已安装技能
```bash
zhiy skill list
```

## 技能热加载
技能支持热加载，修改SKILL.md后自动重新加载：
```javascript
const chokidar = require('chokidar');
const watcher = chokidar.watch(skillDir, { depth: 1 });
watcher.on('change', (path) => {
  if (path.endsWith('SKILL.md')) {
    skillManager.reloadSkill(path);
  }
});
```
