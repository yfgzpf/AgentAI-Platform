# @agentai/skills

AgentAI 多模态技能集合（25 技能目录 / 12 可执行 / 24 SKILL.md 定义）

## 分类

| 分类 | 技能 | 可执行 |
|------|------|--------|
| **office** | ai-writer, doc-generator, decoration-quotation, excel-generator, ppt-generator | 3 |
| **web** | browser-auto, scraper, social-media, api-gateway | 1 |
| **image** | image-gen, image-editor | 1 |
| **video** | video-gen | 1 |
| **voice** | tts, stt | 0 |
| **desktop** | desktop-control | 1 |
| **code** | code-executor, code-reviewer | 0 |
| **communication** | wechat-bot, wechat-smart-assistant | 2 |
| **meta** | skill-creator, evolution | 0 |
| **projects** | git-manager, deploy | 0 |
| **agents** | agent-coordinator | 0 |
| **合计** | **25** | **12** |

## 结构

```
skills/
├── office/
│   ├── ai-writer/SKILL.md + main.py
│   ├── doc-generator/SKILL.md + main.py
│   └── ...
├── web/
│   ├── browser-auto/SKILL.md + main.py
│   └── ...
├── image/image-gen/SKILL.md + main.py
├── video/video-gen/SKILL.md + main.py
├── scripts/ (兼容旧引用: skills_bridge.py, agns_image.py)
└── ...
```

## 执行

有 `main.py` 的技能通过 `python-bridge.ts` 调用，Docker 沙箱中执行 (512MB / 1 核)。

## 来源

12 个可执行技能从 ZhiY.AI 项目 (`F:\openclaw迭代源码存放\智Y.AI\zhiy-ai\skills\`) 迁移。
