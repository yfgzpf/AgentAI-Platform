---
name: translator
description: 多语言翻译专家: 中英日韩法德西俄阿, 商务/技术/法律/医学专业翻译, 术语一致性, 本地化 (L10n)
description_zh: "多语言翻译: 中英日韩法德西俄阿, 商务/技术/法律/医学专业翻译, 术语一致, 本地化"
description_en: "Multi-language translator: ZH/EN/JA/KO/FR/DE/ES/RU/AR, professional (business/tech/legal/medical), L10n"
version: 1.0.0
metadata:
  category: language
  tags:
    - translation
    - i18n
    - l10n
    - multilingual
    - 翻译
    - 多语言
    - 本地化
  author: AgentAI Team
  parallelSafe: true
  riskLevel: low
  triggers:
    - "翻译"
    - "[Tt]ranslat"
    - "本地化"
    - "中英.*对照"
    - "日语.*翻译"
    - "韩语.*翻译"
    - "多语言"
    - "国际化"
    - "i18n"
    - "l10n"
---

# 多语言翻译专家 🌐

专业的多语言翻译、本地化、术语管理工具。

## 支持语言 (12 种)

| 代码 | 语言 | 主要地区 |
|------|------|----------|
| zh-CN | 简体中文 | 中国大陆 |
| zh-TW | 繁体中文 | 台湾 |
| en-US | 美式英语 | 美国 |
| en-GB | 英式英语 | 英国 |
| ja | 日语 | 日本 |
| ko | 韩语 | 韩国 |
| fr | 法语 | 法国 |
| de | 德语 | 德国 |
| es | 西班牙语 | 西班牙 |
| pt | 葡萄牙语 | 巴西 |
| ru | 俄语 | 俄罗斯 |
| ar | 阿拉伯语 | 中东 |

## 核心功能

### 1. 翻译模式

**直译 (Literal)**:
- 适合: 技术文档
- 保留原文结构
- 注意: 可能不通顺

**意译 (Free)**:
- 适合: 文案 / 营销
- 重在传达意思
- 更自然

**创译 (Transcreation)**:
- 适合: 品牌 / 广告
- 保留情感, 调整表达
- 最难, 最贵

**本地化 (Localization)**:
- 不止语言, 还有:
  - 货币 (CNY, USD)
  - 日期 (2024-01-01 vs 01/01/2024)
  - 单位 (kg vs lb)
  - 数字格式 (1,000.00 vs 1.000,00)
  - 文化禁忌

### 2. 专业领域

#### 商务翻译
**要点**:
- 正式语气
- 礼貌表达
- 商务术语
- 合同措辞

**模板**:
```
敬启者:

感谢贵司来函, 我们非常重视双方的合作关系...

谨上
[公司名]
```

#### 技术翻译
**要点**:
- 术语准确
- 格式保留 (代码 / 命令)
- 缩写 / 缩略语
- 保留版本号 / 错误码

**示例**:
```
原文: 
The HTTP 404 error indicates that the requested resource was not found on this server.

译文:
HTTP 404 错误表示所请求的资源在此服务器上未找到。
```

#### 法律翻译
**要点**:
- 高度严谨
- 法律术语
- 双语法系差异
- 必须由法律 + 翻译双背景

**示例**:
```
This Agreement shall be governed by and construed in accordance with the laws of [Jurisdiction].

本协议应受 [管辖区] 法律管辖并依其解释。
```

#### 医学翻译
**要点**:
- 拉丁学名
- 药名 / 通用名
- 诊断术语
- 严格准确

**示例**:
```
原文: The patient was diagnosed with acute myocardial infarction.

译文: 患者被诊断为急性心肌梗死 (AMI)。
```

#### 文学翻译
**要点**:
- 信达雅
- 文化意象
- 韵律 / 节奏
- 译者再创作

### 3. 翻译质量控制

**翻译记忆 (TM - Translation Memory)**:
```
保存已翻译句段, 重复利用
术语一致 + 节省成本
工具: SDL Trados / MemoQ / OmegaT
```

**术语库 (Termbase)**:
```
标准术语对照表
例:
- AI: 人工智能
- Machine Learning: 机器学习
- Deep Learning: 深度学习
- Neural Network: 神经网络
```

**质量保证 (QA) 检查**:
- ✅ 术语一致
- ✅ 数字一致
- ✅ 标点正确
- ✅ 格式保留
- ✅ 拼写错误
- ✅ 语法
- ✅ 漏译
- ✅ 错译

### 4. 文化差异

#### 中国 → 英语
| 中文习惯 | 英文调整 |
|----------|----------|
| 您好 | Hello (直接) |
| 请多关照 | Nice to work with you |
| 哪里哪里 | You're too kind |
| 客气客气 | My pleasure |
| 慢慢来 | Take your time |
| 吃饭了吗? | (避免, 太私人) |

#### 英语 → 中文
| 英文 | 中文调整 |
|------|----------|
| I think... | 我认为... (避免 "我觉得", 太随便) |
| Yeah | 是 / 是的 (避免 "嗯") |
| You know | (删除口头禅) |
| Just | 就 / 只需 (避免 "就是") |
| Whatever | (慎用, 易引起反感) |

#### 高低语境文化
| 高语境 | 中/低语境 |
|--------|-----------|
| 中国 | 美国 |
| 日本 | 德国 |
| 韩国 | 北欧 |
| 阿拉伯 | |
| 委婉表达 | 直接表达 |

### 5. 本地化最佳实践

**i18n 字符串提取**:
```json
// 不要硬编码
"submit": "提交"
"submit": "Submit"

// 用 key
"buttons.submit": "提交"
"buttons.submit": "Submit"
"buttons.submit": "送信"  // 日语
```

**复数处理** (中英差异):
```json
{
  "en": "{count} item | {count} items",
  "zh": "{count} 个项目",
  "ru": "{count} элемент | {count} элемента | {count} элементов",  // 3 种
  "ar": "..."  // 6 种
}
```

**日期 / 时间**:
```
zh: 2024年1月15日 14:30
en-US: 1/15/2024 2:30 PM
en-GB: 15/01/2024 14:30
de: 15.01.2024 14:30
ar: ١٥‏/١‏/٢٠٢٤ ٢:٣٠ م  (阿拉伯数字)
```

**货币**:
```
zh: ¥1,234.56
en-US: $1,234.56
de: 1.234,56 €
ja: ¥1,234
```

**RTL (从右到左) 语言** (阿拉伯语 / 希伯来语):
- 布局镜像
- 文本方向
- 标点位置

### 6. 翻译工作流

```
1. 项目分析
   - 文件格式 (JSON / MD / HTML / PO)
   - 字数
   - 截止日期
   
2. 准备阶段
   - 提取文本
   - 术语库
   - 参考资料
   
3. 翻译阶段
   - 机器翻译初稿
   - 译后编辑 (MTPE)
   - 人工翻译
   
4. 校对阶段
   - 自校
   - 互校
   - 终审
   
5. 交付阶段
   - 格式还原
   - QA 检查
   - 客户验收
```

### 7. 机器翻译 + AI

**主流 MT 引擎**:
| 引擎 | 特点 | 适用 |
|------|------|------|
| DeepL | 欧洲语种好 | 商务 / 一般 |
| Google Translate | 全语种 | 通用 |
| ChatGPT / Claude | 上下文 | 灵活 |
| 百度翻译 | 中英 | 国内 |
| 火山翻译 | 中英 | 国内 |
| 腾讯翻译君 | 中英 | 国内 |

**MTPE (机器翻译 + 译后编辑)**:
```
1. MT 生成初稿 (快, 便宜)
2. 人工编辑 (慢, 准)
3. 节省 30-50% 成本
```

**Prompt 模板**:
```
请将以下内容翻译成 [目标语言]:

要求:
1. 风格: 商务 / 技术 / 口语
2. 术语: 保持一致
3. 格式: 保留 Markdown
4. 文化: 符合 [目标地区] 习惯

原文:
[内容]
```

### 8. 翻译评估

**质量指标**:

| 指标 | 说明 |
|------|------|
| BLEU | n-gram 重合度, 0-1 |
| chrF | 字符级 F1 |
| TER | 编辑距离 |
| COMET | 神经评估, 最先进 |
| 人工评估 | 最准, 最贵 |

**评估维度**:
- 准确性 (Adequacy)
- 流畅性 (Fluency)
- 风格 (Style)
- 术语 (Terminology)
- 格式 (Format)

## 行业速查表

### IT 行业
| EN | ZH |
|----|-----|
| Frontend | 前端 |
| Backend | 后端 |
| Full-stack | 全栈 |
| DevOps | 运维 |
| Microservices | 微服务 |
| Container | 容器 |
| Orchestration | 编排 |
| Load Balancing | 负载均衡 |
| CI/CD | 持续集成/部署 |
| Code Review | 代码审查 |

### 金融行业
| EN | ZH |
|----|-----|
| Asset Under Management (AUM) | 资产管理规模 |
| Initial Public Offering (IPO) | 首次公开募股 |
| Mergers and Acquisitions (M&A) | 并购 |
| Return on Investment (ROI) | 投资回报率 |
| Earnings Per Share (EPS) | 每股收益 |
| Free Cash Flow (FCF) | 自由现金流 |
| Compound Annual Growth Rate (CAGR) | 复合年增长率 |
| Hedge Fund | 对冲基金 |
| Venture Capital (VC) | 风险投资 |
| Private Equity (PE) | 私募股权 |

### 医学行业
| EN | ZH |
|----|-----|
| Hypertension | 高血压 |
| Diabetes Mellitus | 糖尿病 |
| Myocardial Infarction | 心肌梗死 |
| Cerebrovascular Accident | 脑血管意外 (中风) |
| Chronic Obstructive Pulmonary Disease | 慢性阻塞性肺病 |
| Malignant Neoplasm | 恶性肿瘤 |
| Benign | 良性 |
| Acute | 急性 |
| Chronic | 慢性 |
| Intravenous | 静脉注射 |

## 触发场景

- "翻译成英文"
- "中英对照"
- "日语翻译"
- "本地化"
- "术语对照"
- "多语言版本"
- "国际化 i18n"
- "商务邮件翻译"

## 工具方法

```python
# 翻译
await translate(
  text="原文",
  source="zh-CN",
  target="en-US",
  domain="technical",
  style="formal"
)

# 术语提取
await extract_terms(text, existing_termbase)

# 翻译记忆匹配
await tm_lookup(sentence, threshold=0.9)

# 质量评估
await evaluate_translation(
  source="原文",
  target="译文",
  reference="参考译文"
)

# 本地化
await localize(content, target_locale="ja-JP")
```

## 注意事项

⚠️ **机器翻译不完美**: 重要文件必须人工校对
⚠️ **文化差异**: 直译可能冒犯 / 失真
⚠️ **法律严谨**: 法律 / 医疗必须专业人士
⚠️ **术语一致**: 建立并维护术语库
⚠️ **隐私安全**: 敏感内容慎用公共 MT 服务
⚠️ **版权意识**: 翻译版权归属要明确
