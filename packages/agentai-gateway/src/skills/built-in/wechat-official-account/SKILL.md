---
name: wechat-official-account
description: AI-powered WeChat Official Account automation pipeline. Complete workflow: benchmark analysis → topic selection → AI article generation → personality distillation → deAI fingerprint removal → quality gate → image generation → draft publishing.
version: 1.0.0
riskLevel: medium
parallelSafe: false
dependencies: deepseek-api, wechat-api, image-gen
tags: [wechat, official-account, content-automation, ai-writing]
---

# WeChat Official Account Automation Skill

Complete AI-driven workflow for WeChat Official Account (公众号) content creation and publishing.

## Workflow

1. **Benchmark Analysis** — Analyze top accounts in your niche
2. **Topic Selection** — Determine what content to write
3. **AI Article Generation** — Generate articles based on benchmarks + style guide
4. **Personality Distillation** — Make writing sound human-like
5. **DeAI Fingerprint Removal** — Remove AI writing patterns
6. **Quality Gate** — Validate article meets quality standards
7. **Image Generation** — Generate cover and inline images
8. **Draft Publishing** — Push to WeChat draft box

## Prerequisites

- DeepSeek API Key (for article generation)
- WeChat Official Account credentials (AppID, AppSecret)
- Image generation API (Runware/Douyin)
