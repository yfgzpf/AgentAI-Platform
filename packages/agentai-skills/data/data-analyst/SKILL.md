---
name: data-analyst
description: 数据分析全流程: SQL 生成、Python 数据处理、统计方法、可视化、报告撰写、AB 测试、业务洞察
description_zh: "数据分析全流程: SQL/Python/统计/可视化/报告/AB 测试/业务洞察"
description_en: "Data analyst: SQL generation, Python data processing, statistics, visualization, reporting, AB testing"
version: 1.0.0
metadata:
  category: data
  tags:
    - data
    - analytics
    - sql
    - python
    - bi
    - 数据
    - 分析
    - 商业智能
  author: AgentAI Team
  parallelSafe: true
  riskLevel: low
  triggers:
    - "数据分析"
    - "SQL.*生成"
    - "[Pp]andas"
    - "可视化"
    - "[Aa]/[Bb].*测试"
    - "BI.*报表"
    - "[Dd]ata.*[Aa]nalyst"
    - "数据洞察"
    - "[Hh]ypothesis.*test"
    - "用户.*画像"
---

# 数据分析师 📊

专业的数据分析、SQL 生成、Python 数据处理、统计建模、报告撰写工具。

## 核心能力

### 1. SQL 生成

**基础语法**:
```sql
-- SELECT
SELECT col1, col2, COUNT(*)
FROM table
WHERE date >= '2024-01-01'
GROUP BY col1, col2
HAVING COUNT(*) > 10
ORDER BY col1 DESC
LIMIT 100;

-- JOIN
SELECT o.order_id, u.user_name, o.amount
FROM orders o
LEFT JOIN users u ON o.user_id = u.id
WHERE o.status = 'paid';

-- 窗口函数
SELECT 
  user_id,
  order_date,
  amount,
  SUM(amount) OVER (PARTITION BY user_id ORDER BY order_date) AS cumulative
FROM orders;

-- CTE
WITH user_orders AS (
  SELECT user_id, COUNT(*) AS cnt, SUM(amount) AS total
  FROM orders
  GROUP BY user_id
)
SELECT 
  CASE 
    WHEN cnt = 1 THEN '新客'
    WHEN cnt BETWEEN 2 AND 5 THEN '回头客'
    ELSE '忠诚客'
  END AS segment,
  COUNT(*) AS user_count,
  AVG(total) AS avg_revenue
FROM user_orders
GROUP BY segment;
```

**性能优化**:
- 索引使用
- 避免 SELECT *
- 大表分页 (id > last_id)
- 避免子查询 (用 JOIN)
- EXPLAIN 分析

**方言支持**:
- MySQL / MariaDB
- PostgreSQL
- SQL Server (T-SQL)
- Oracle (PL/SQL)
- Hive / Spark SQL
- ClickHouse
- BigQuery

### 2. Python 数据处理

**Pandas 速查**:
```python
import pandas as pd

# 读取
df = pd.read_csv('data.csv')
df = pd.read_excel('data.xlsx', sheet_name='Sheet1')
df = pd.read_sql(query, conn)

# 探索
df.head()
df.info()
df.describe()
df.dtypes
df.isnull().sum()

# 清洗
df.dropna(subset=['col'])
df.fillna({'col1': 0, 'col2': 'unknown'})
df.drop_duplicates()
df['col'] = df['col'].str.strip().str.lower()
df['date'] = pd.to_datetime(df['date'])

# 变换
df['new_col'] = df['a'] + df['b']
df['category'] = df['value'].apply(lambda x: 'high' if x > 100 else 'low')
df = df.groupby('user_id').agg({'amount': 'sum', 'order_id': 'count'})

# 合并
result = pd.merge(df1, df2, on='key', how='left')
result = pd.concat([df1, df2])

# 透视
pivot = df.pivot_table(
  index='category', 
  columns='month', 
  values='amount', 
  aggfunc='sum'
)

# 时间序列
df.set_index('date', inplace=True)
df.resample('D').sum()  # 按日
df.rolling(7).mean()    # 7 天移动平均
```

**NumPy**:
```python
import numpy as np

arr = np.array([1, 2, 3])
arr.mean(), arr.std(), arr.median()
np.percentile(arr, [25, 50, 75])
np.where(arr > 5, 'high', 'low')
```

### 3. 统计方法

#### 描述统计

| 指标 | 公式 | 用途 |
|------|------|------|
| 均值 (Mean) | Σx / n | 中心趋势 |
| 中位数 (Median) | 排序后中间值 | 抗异常值 |
| 众数 (Mode) | 频次最高 | 类别数据 |
| 标准差 (Std) | sqrt(方差) | 离散程度 |
| 方差 (Var) | Σ(x-μ)² / n | 离散程度 |
| 偏度 (Skew) | - | 分布对称 |
| 峰度 (Kurt) | - | 尾部厚度 |

#### 推断统计

**t 检验 (两组均值比较)**:
```python
from scipy import stats
t, p = stats.ttest_ind(group_a, group_b)
# p < 0.05 拒绝原假设, 差异显著
```

**方差分析 (ANOVA, 多组比较)**:
```python
f, p = stats.f_oneway(group_a, group_b, group_c)
```

**卡方检验 (类别变量)**:
```python
chi2, p, dof, expected = stats.chi2_contingency(table)
```

**相关性**:
```python
# Pearson (线性)
corr, p = stats.pearsonr(x, y)

# Spearman (单调)
corr, p = stats.spearmanr(x, y)

# Kendall (顺序)
corr, p = stats.kendalltau(x, y)
```

**相关强度**:
| |r| | 解释 |
|---|------|
| 0.0-0.2 | 极弱 |
| 0.2-0.4 | 弱 |
| 0.4-0.6 | 中 |
| 0.6-0.8 | 强 |
| 0.8-1.0 | 极强 |

#### 回归

**线性回归**:
```python
from sklearn.linear_model import LinearRegression

model = LinearRegression()
model.fit(X_train, y_train)
y_pred = model.predict(X_test)

# 评估
from sklearn.metrics import r2_score, mean_squared_error
print(f'R²: {r2_score(y_test, y_pred):.3f}')
print(f'RMSE: {mean_squared_error(y_test, y_pred, squared=False):.3f}')
```

**逻辑回归 (分类)**:
```python
from sklearn.linear_model import LogisticRegression

model = LogisticRegression()
model.fit(X_train, y_train)
proba = model.predict_proba(X_test)[:, 1]
```

**决策树 / 随机森林**:
```python
from sklearn.ensemble import RandomForestClassifier

model = RandomForestClassifier(n_estimators=100, max_depth=10)
model.fit(X_train, y_train)
importance = model.feature_importances_
```

### 4. A/B 测试

**流程**:
```
1. 假设: H0 (无差异) vs H1 (有差异)
2. 指标: 主指标 + 辅助指标 + 反向指标
3. 流量: 随机分流 (用户/会话/事件)
4. 样本量: 功效分析
5. 周期: 至少 1-2 个完整周期
6. 检验: 统计显著性
7. 决策: 上线 / 继续 / 放弃
```

**样本量计算**:
```python
from statsmodels.stats.power import TTestIndPower

analysis = TTestIndPower()
n = analysis.solve_power(
  effect_size=0.05,    # 最小可检测差异 (Cohen's d)
  alpha=0.05,          # 显著性水平
  power=0.8,           # 统计功效
  ratio=1              # 1:1 分流
)
print(f'每组需要: {n:.0f} 样本')
```

**检验结果解读**:
```
p < 0.05: 统计显著
CI 95%: 真实差异在 [a, b] 区间
效应量: 实际差异多大
```

**A/B 测试陷阱**:
- ❌ 一看到差异就停
- ❌ 频繁查看 (Peeking problem)
- ❌ 样本量不足
- ❌ 分流不均
- ❌ SRM (Sample Ratio Mismatch)
- ❌ 新奇效应 (Novelty)
- ❌ 季节性干扰

### 5. 用户画像 / 分群

**RFM 模型**:
```
R (Recency): 最近购买
F (Frequency): 购买频次  
M (Monetary): 购买金额

R: 1-5 (5 最久)
F: 1-5 (5 最高)
M: 1-5 (5 最高)

8 类用户:
- 重要价值客户 (555)
- 重要发展客户 (155)
- 重要保持客户 (551)
- 重要挽留客户 (115)
- 一般价值客户 (353)
- 一般发展客户 (134)
- 一般保持客户 (344)
- 流失客户 (111)
```

**用户生命周期**:
```
拉新 → 激活 → 留存 → 收入 → 推荐
```

**LTV (Life Time Value)**:
```
LTV = ARPU × 毛利率 / 流失率
例: ARPU 50, 毛利率 60%, 流失率 5%
LTV = 50 × 0.6 / 0.05 = 600
```

**CAC (Customer Acquisition Cost)**:
```
CAC = 营销总成本 / 新增客户数
LTV / CAC > 3 健康
```

### 6. 留存分析

**N-day 留存**:
```
Day 1: 100 用户
Day 2: 70 用户 (70%)
Day 7: 50 用户 (50%)
Day 30: 30 用户 (30%)
```

**同期群 (Cohort)**:
```
用户注册月 vs 后续留存

        M1  M2  M3  M4
2024-01 100 60  40  30
2024-02 120 70  45  ...
2024-03 150 80  ...
```

**漏斗分析**:
```
浏览 1000
加购 500 (50%)
下单 200 (20%)
付款 180 (18%)
复购 50 (5%)
```

### 7. 可视化

**Matplotlib 速查**:
```python
import matplotlib.pyplot as plt

fig, axes = plt.subplots(2, 2, figsize=(12, 8))

# 折线
axes[0, 0].plot(x, y)
axes[0, 0].set_title('Trend')

# 柱状
axes[0, 1].bar(categories, values)

# 散点
axes[1, 0].scatter(x, y, alpha=0.5)

# 直方
axes[1, 1].hist(data, bins=30)

plt.tight_layout()
plt.savefig('output.png', dpi=200)
```

**Seaborn**:
```python
import seaborn as sns

sns.heatmap(corr_matrix, annot=True, cmap='coolwarm')
sns.boxplot(x='category', y='value', data=df)
sns.pairplot(df, hue='target')
sns.distplot(df['value'])
```

**Plotly (交互式)**:
```python
import plotly.express as px

fig = px.line(df, x='date', y='value', color='category')
fig.write_html('interactive.html')
```

**图表选择**:

| 目的 | 图表 |
|------|------|
| 趋势 | 折线图 |
| 比较 | 柱状图 (横向 / 纵向) |
| 占比 | 饼图 (类别少) / 堆叠柱 |
| 分布 | 直方图 / 箱线图 |
| 关系 | 散点图 |
| 相关性 | 热力图 |
| 地理 | 地图 |
| 漏斗 | 漏斗图 |

### 8. 业务指标体系

**北极星指标 (North Star Metric)**:
- 唯一, 反映核心价值
- 例: 抖音 = 日均使用时长
- 例: 微信 = 日活
- 例: 滴滴 = 日完单量

**AARRR 海盗模型**:
```
Acquisition (获取)
Activation (激活)
Retention (留存)
Revenue (收入)
Referral (推荐)
```

**HEART 框架** (Google):
- Happiness
- Engagement
- Adoption
- Retention
- Task Success

### 9. 报告撰写

**数据报告模板**:
```markdown
# 月度经营报告 (2024-12)

## 1. 核心指标
| 指标 | 本月 | 同比 | 环比 | 目标 |
|------|------|------|------|------|
| GMV | 1.2亿 | +15% | +8% | 1.5亿 |
| DAU | 100万 | +5% | -2% | 120万 |
| 转化率 | 3.2% | +0.3pp | +0.1pp | 3.5% |

## 2. 关键洞察
- 新客获取成本同比下降 20%
- 12 月大促拉动 GMV 增长
- 高价值用户占比提升至 25%

## 3. 问题分析
- DAU 下降原因: 春节返乡?
- 转化率仍低于目标, 需优化落地页

## 4. 下月计划
- 上线新会员体系
- 加大内容投放
- 优化商品推荐算法
```

**呈现技巧**:
- 先结论后数据
- 图表胜过文字
- 故事化叙述
- 行动建议清晰

## 工具生态

| 类别 | 工具 |
|------|------|
| 数据库 | MySQL / PostgreSQL / ClickHouse / Doris |
| 数仓 | Hive / Spark / Snowflake / BigQuery |
| 调度 | Airflow / DolphinScheduler / Dagster |
| BI | Tableau / Power BI / Metabase / Superset |
| Notebook | Jupyter / Zeppelin / Deepnote |
| Python | Pandas / NumPy / Scikit-learn / XGBoost |
| 可视化 | Matplotlib / Seaborn / Plotly / ECharts |

## 触发场景

- "SQL 怎么写"
- "查下这周 GMV"
- "A/B 测试分析"
- "用户分群"
- "留存率计算"
- "数据可视化"
- "统计显著性"
- "异常原因分析"

## 工具方法

```python
# SQL 生成
await generate_sql(
  description="查最近 7 天各品类的 GMV",
  dialect="mysql"
)

# Python 数据处理
await data_process(
  task="清洗缺失值并计算 7 天移动平均",
  data=excel_file
)

# 统计检验
await stat_test(
  test_type="t_test",
  group_a=[...],
  group_b=[...],
  alpha=0.05
)

# A/B 测试分析
await ab_test_analysis(
  control_data=[...],
  treatment_data=[...],
  metric="conversion_rate"
)

# 报告生成
await generate_report(
  data=csv_file,
  template="monthly_ops",
  insights=True
)
```

## 注意事项

⚠️ **数据准确**: 先验证数据, 再分析
⚠️ **相关性 ≠ 因果**: 相关不等于因果
⚠️ **样本偏差**: 注意采样是否代表总体
⚠️ **辛普森悖论**: 分组后趋势反转
⚠️ **P-hacking**: 不该反复检验直到显著
⚠️ **业务理解**: 数据脱离业务是无意义的
⚠️ **隐私保护**: 用户数据脱敏
