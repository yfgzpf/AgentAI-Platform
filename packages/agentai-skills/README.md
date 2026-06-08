# @agentai/skills

AgentAI 多模态技能集合（37 个，从 ZhiY.AI 迁移）。

## 分类

| 分类 | 技能数 | 状态 |
|------|--------|------|
| office (doc/excel/ppt) | 3 | 阶段 3 |
| web (browser/scraper) | 3 | 阶段 3 |
| image (generator/editor) | 3 | 阶段 3 |
| video (seedance/wan2.6) | 2 | 阶段 3 |
| voice (TTS/STT) | 2 | 阶段 3 |
| desktop (auto-gui/control) | 2 | 阶段 3 |
| code (executor/writer) | 2 | 阶段 3 |
| meta (skill-creator/evolution) | 2 | 阶段 3 |
| 其他 (15 个) | 15 | 阶段 3 |
| **合计** | **37** | — |

## SkillSpec

每个技能是独立目录:

```
skills/
├── <skill-name>/
│   ├── SKILL.md          # 描述
│   ├── main.py           # 入口
│   ├── requirements.txt
│   └── tests/
```

## 执行

技能在 Docker 沙箱中执行（512M / 1 核 / 无网）。

## 状态

🚧 阶段 1 占位。阶段 3 开始实质迁移。
