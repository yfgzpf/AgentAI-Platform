# Image Generator (图像生成)

对接 Agnes Image 2.1 Flash API，支持文生图、图生图。

## 参数
- `prompt` (string, required): 图像描述
- `size` (string): 1K / 2K / 3K / 4K (档位式尺寸，默认 2K)
- `ratio` (string): 1:1 / 16:9 / 9:16 / 4:3 / 3:4 / 3:2 / 2:3 / 21:9 (宽高比，默认 1:1)
- `style` (string): realistic / anime / oil-painting

## 档位与像素对照
| 档位 | 1:1 | 16:9 | 9:16 | 4:3 |
|------|-----|------|------|-----|
| 1K | 1024x1024 | 1312x736 | 736x1312 | 1152x864 |
| 2K | 2048x2048 | 2624x1472 | 1472x2624 | 2304x1728 |
| 3K | 3072x3072 | 3936x2208 | 2208x3936 | 3456x2592 |
| 4K | 4096x4096 | 5248x2944 | 2944x5248 | 4608x3456 |

## 执行
Docker 沙箱 512MB / 1 核 / 无网（仅 API 调用）

## 环境变量
- `AGNES_API_KEY` 或 `AGENTAI_API_KEY`: Agnes AI API 密钥
- `AGNES_BASE_URL`: 可选，默认 https://apihub.agnes-ai.com
