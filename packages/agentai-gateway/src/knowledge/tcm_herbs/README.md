# 中药材与方剂知识库

## 目录结构

| 文件 | 内容 |
|------|------|
| `herbs.jsonl` | 常用中药材 (性味归经/功效/用法) |
| `formulas.jsonl` | 常用经方/时方 (组成/君臣佐使) |
| `contraindications.jsonl` | 十八反/十九畏/妊娠禁忌 |

## 药材 JSONL 格式

```json
{
  "id": "HERB-001",
  "name": "人参",
  "alias": ["白参", "生晒参"],
  "nature": "微温",
  "taste": "甘、微苦",
  "meridian": ["脾", "肺", "心", "肾"],
  "functions": ["大补元气", "复脉固脱", "补脾益肺", "生津养血", "安神益智"],
  "dosage": "3-9g (煎服)",
  "processing": "生用/炖服/研末吞服",
  "contraindications": [
    "实证、热证忌服",
    "反藜芦 (十八反)"
  ],
  "source": "《神农本草经》上品"
}
```

## 方剂 JSONL 格式

```json
{
  "id": "FORMULA-001",
  "name": "桂枝汤",
  "source": "伤寒论",
  "indication": "太阳中风证: 发热汗出, 恶风脉缓",
  "composition": {
    "君": {"name": "桂枝", "dose": "9g", "function": "解肌发表，调和营卫"},
    "臣": {"name": "芍药", "dose": "9g", "function": "益阴敛营"},
    "佐": {"name": "生姜", "dose": "9g", "function": "助桂解表"},
    "使": {"name": "甘草", "dose": "6g", "function": "调和诸药"}, 
    "使2": {"name": "大枣", "dose": "3枚", "function": "益气和中"}
  },
  "modifications": [
    {"condition": "喘者", "change": "加厚朴、杏仁"},
    {"condition": "项背强几几", "change": "加葛根"}
  ]
}
```

## 使用方式

由 `tcm_herb` 子智能体查询药材信息和方剂分析。
自动检查配伍禁忌 (十八反/十九畏)。

## 数据来源

- 《中国药典》2020 版
- 《本草纲目》— 李时珍
- 《方剂学》教材
