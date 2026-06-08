---
name: seedance-video
version: 1.0.0
author: ZhiY Team
category: video
tags: [视频, AI生成, 豆包]
requires:
  env: [DOUBAO_API_KEY]
---

# 豆包 Seedance 视频生成技能

## 功能描述
使用豆包 Seedance API 生成高质量AI视频，支持多种风格和分辨率。

## 参数说明
| 参数名 | 类型 | 必需 | 说明 |
|--------|------|------|------|
| --prompt | string | 是 | 视频描述/提示词 |
| --duration | number | 否 | 视频时长（秒），默认5秒 |
| --style | string | 否 | 风格：cinematic/anime/realistic |
| --resolution | string | 否 | 分辨率：720p/1080p |
| --output | string | 是 | 输出文件路径 |

## 调用示例
```bash
python main.py --prompt "夕阳下的古城，侠客独行" --duration 5 --style cinematic --output video.mp4
```

## 返回格式
```json
{
  "status": "success",
  "data": {
    "file_path": "/path/to/video.mp4",
    "duration": 5,
    "resolution": "1080p"
  }
}
```

## 依赖
- requests >= 2.28.0
