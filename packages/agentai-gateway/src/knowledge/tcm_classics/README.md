# 中医经典知识库

## 目录结构

| 文件 | 内容 | 格式 |
|------|------|------|
| `shanghanlun.jsonl` | 《伤寒论》六经辨证条文 | JSONL (每行一条) |
| `jinkuiyaolue.jsonl` | 《金匮要略》杂病辨证 | JSONL |
| `huangdineijing.jsonl` | 《黄帝内经》基础理论 | JSONL |
| `wenbingtiaobian.jsonl` | 《温病条辨》温病学 | JSONL |

## JSONL 条目格式

```json
{
  "id": "SHL-001",
  "classic": "伤寒论",
  "chapter": "辨太阳病脉证并治",
  "original": "太阳之为病，脉浮，头项强痛而恶寒。",
  "translation": "太阳病的主要特征是：脉象浮、头项部僵硬疼痛且怕冷。",
  "syndrome": "太阳病表证",
  "application": "外感风寒初期，病邪在表",
  "related_formulas": ["桂枝汤", "麻黄汤"],
  "tags": ["太阳病", "表证", "脉浮"]
}
```

## 使用方式

由 `tcm_classic` 子智能体通过 `read_file` + `search_content` 检索。
后续可接入向量数据库 (如 Milvus/Qdrant) 实现语义检索。

## 数据来源

- [中医世家](https://www.zysj.com.cn/) — 公开条文
- 中国中医药出版社电子版
- 后续: zy-agent 项目知识库迁移
