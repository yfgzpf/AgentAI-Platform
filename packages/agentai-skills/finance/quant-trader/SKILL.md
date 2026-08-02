---
name: quant-trader
description: A股/港股/美股量化交易策略生成、回测与信号分析。支持均线交叉、海龟交易法、动量反转、均值回归等策略
description_zh: "A 股/港股/美股量化交易策略生成、回测与信号分析, 支持均线交叉/海龟/动量/均值回归等策略"
description_en: "A-share/HK/US stock quant strategies, backtesting, signal analysis (MA cross, turtle, momentum, mean-reversion)"
version: 1.0.0
metadata:
  category: finance
  tags:
    - quant
    - trading
    - backtest
    - stock
    - 量化
    - 股票
    - 交易
    - 回测
  author: AgentAI Team
  parallelSafe: true
  riskLevel: high
  triggers:
    - "量化.*交易"
    - "股票.*策略"
    - "[Bb]acktest"
    - "[Tt]rading.*strategy"
    - "均线.*交叉"
    - "海龟.*交易"
    - "动量.*策略"
    - "均值.*回归"
    - "[Aa]-股.*分析"
    - "[Hh]K.*股"
    - "[Uu]S.*股"
---

# 量化交易策略生成器 📈

专业的量化交易策略生成、回测、信号分析工具。**所有输出仅供学习研究，不构成投资建议**。

## ⚠️ 风险声明

- 本工具不构成投资建议
- 量化策略存在过拟合风险
- 历史回测不代表未来表现
- 实盘前请充分验证

## 核心策略

### 1. 均线交叉 (MA Cross)
```
短期均线上穿长期均线 → 买入信号
短期均线下穿长期均线 → 卖出信号
```

**示例**:
```python
strategy = {
  "name": "MA5-MA20 金叉死叉",
  "short_window": 5,
  "long_window": 20,
  "stop_loss": 0.05,    # 5% 止损
  "take_profit": 0.15,  # 15% 止盈
  "position_size": 0.1, # 单笔 10% 仓位
}
```

### 2. 海龟交易法 (Turtle)
```
20日突破最高价 → 买入
10日突破最低价 → 卖出
```

### 3. 动量策略 (Momentum)
```
N日涨幅 > 阈值 → 买入 (追涨)
N日跌幅 > 阈值 → 卖出 (杀跌)
```

### 4. 均值回归 (Mean Reversion)
```
价格偏离均线 > 2σ → 卖出 (回归)
价格偏离均线 < -2σ → 买入 (反弹)
```

### 5. 网格交易 (Grid)
```
价格区间 [P_low, P_high] 分 N 档
每跌一档买一档, 每涨一档卖一档
```

## 支持的标的

| 市场 | 标的 | 数据源 | 延迟 |
|------|------|--------|------|
| A 股 | 600xxx, 000xxx, 300xxx | akshare / tushare | 实时 / 日 K |
| 港股 | 00700, 09988 | yfinance | 15min 延迟 |
| 美股 | AAPL, TSLA, NVDA | yfinance / alpha vantage | 实时 |
| 加密 | BTC, ETH | ccxt | 实时 |

## 回测流程

```
1. 获取历史数据 (OHLCV)
2. 计算指标 (MA, RSI, MACD, BOLL)
3. 生成信号 (买入/卖出点)
4. 模拟交易 (考虑手续费、滑点)
5. 统计指标 (夏普/最大回撤/胜率)
6. 生成报告
```

**示例输出**:
```
策略: MA5-MA20 金叉死叉
标的: 600519 贵州茅台
回测区间: 2020-01-01 ~ 2024-12-31
初始资金: 100,000
最终资金: 285,430
总收益: 185.43%
年化: 30.2%
夏普比率: 1.85
最大回撤: -12.3%
胜率: 58.2%
交易次数: 47
盈亏比: 2.1
```

## 技术指标

| 指标 | 用途 | 默认参数 |
|------|------|----------|
| MA | 趋势 | 5/10/20/60 |
| EMA | 趋势 (更敏感) | 12/26 |
| MACD | 趋势 + 动能 | (12, 26, 9) |
| RSI | 超买超卖 | 14, 阈值 70/30 |
| BOLL | 波动 | 20, 2σ |
| KDJ | 短线 | (9, 3, 3) |
| ATR | 波动率 | 14 |
| OBV | 资金流 | - |

## 风险控制

```python
risk_config = {
  "max_position_pct": 0.2,      # 单标的最多 20% 仓位
  "max_drawdown": 0.15,         # 最大回撤 15% 触发清仓
  "stop_loss": 0.05,            # 5% 止损
  "take_profit": 0.20,          # 20% 止盈
  "max_daily_loss": 0.03,       # 日亏损超 3% 停止交易
  "max_open_positions": 5,      # 同时持仓不超过 5 个
}
```

## 触发场景

用户说以下内容时自动激活:
- "回测 XXX 策略" / "[Bb]acktest XXX"
- "MA5 上穿 MA20 买入"
- "海龟交易法回测"
- "XX 股票技术分析"
- "推荐一个量化策略"
- "网格交易 BTC"

## 工具方法

```python
# 1. 获取数据
data = await stock_data("600519.SH", "2020-01-01", "2024-12-31")

# 2. 计算指标
df = calc_ma(data, 5, 20)
df = calc_macd(data)
df = calc_rsi(data, 14)

# 3. 生成信号
signals = ma_cross_strategy(df, 5, 20)

# 4. 回测
result = backtest(data, signals, initial_capital=100000, commission=0.001)

# 5. 报告
report = generate_report(result, "MA5-MA20")
```

## 常见策略模板

| 策略 | 适合 | 周期 |
|------|------|------|
| MA Cross | 趋势市 | 日线 |
| Turtle | 突破市 | 日线 |
| RSI 反转 | 震荡市 | 日线 |
| 网格 | 震荡市 | 小时线 |
| 动量 | 牛市 | 周线 |
| 双均线 + MACD | 通用 | 日线 |

## 注意事项

⚠️ **请勿用于真实交易**：所有策略仅供学习研究
⚠️ **数据准确性**：实盘前请交叉验证多个数据源
⚠️ **过拟合风险**：参数优化容易过拟合历史数据
⚠️ **滑点冲击**：回测未考虑流动性影响
