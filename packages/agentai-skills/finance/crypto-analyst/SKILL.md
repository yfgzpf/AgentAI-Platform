---
name: crypto-analyst
description: 加密货币行情分析、链上数据监控、DeFi 收益计算、NFT 估值。支持 BTC/ETH/SOL 等 1000+ 代币
description_zh: "加密货币行情分析/链上数据监控/DeFi 收益计算/NFT 估值, 支持 BTC/ETH/SOL 等 1000+ 代币"
description_en: "Crypto market analysis, on-chain monitoring, DeFi yield calculation, NFT valuation (BTC/ETH/SOL)"
version: 1.0.0
metadata:
  category: finance
  tags:
    - crypto
    - bitcoin
    - ethereum
    - defi
    - nft
    - 加密货币
    - 比特币
    - 区块链
  author: AgentAI Team
  parallelSafe: true
  riskLevel: high
  triggers:
    - "[Bb]itcoin|比特币"
    - "[Ee]thereum|以太坊"
    - "[Dd]e[Ff]i"
    - "[Cc]rypto|加密"
    - "[Nn][Ff][Tt]"
    - "链上.*分析"
    - "[Yy]ield.*收益"
    - "流动性.*挖矿"
    - "交易所.*套利"
    - "[Ww]eb3"
---

# 加密货币分析师 🪙

专业的加密货币行情分析、链上数据监控、DeFi 收益计算、NFT 估值工具。

## ⚠️ 风险声明

- 加密资产波动极大, 24h 跌 50% 常见
- DeFi 协议存在智能合约风险
- 钓鱼网站/假合约损失不可逆
- 本工具不构成投资建议

## 核心功能

### 1. 行情分析
- 实时价格 (Binance / OKX / Coinbase / Bybit)
- K 线 (1m / 5m / 1H / 4H / 1D / 1W)
- 深度图 (Order Book)
- 资金费率 (Funding Rate)
- 多空持仓比 (Long/Short Ratio)
- 爆仓数据 (Liquidations)
- 恐慌贪婪指数 (Fear & Greed Index)

### 2. 链上数据 (On-Chain)
- 大户持仓变动 (Whale Alert)
- 交易所流入流出 (Exchange Inflow/Outflow)
- 持币地址数变化 (Holders)
- 活跃地址数 (Active Addresses)
- Gas 费 (Base / Priority)
- Mempool 监控

### 3. DeFi 收益
- Aave / Compound 借贷 APY
- Uniswap V3 LP 收益
- Curve / Convex 流动性挖矿
- Lido / Rocket Pool 质押
- Yearn 收益聚合
- EigenLayer 再质押

### 4. NFT 估值
- 蓝筹 NFT 地板价 (BAYC, Azuki, Pudgy)
- 稀有度排名 (Rarity)
- 历史成交均价
- 持币地址集中度
- Twitter 关注度

## 支持的代币

| 分类 | 代币 | 数量 |
|------|------|------|
| L1 | BTC, ETH, SOL, BNB, ADA, AVAX | 20+ |
| L2 | ARB, OP, MATIC, IMX | 30+ |
| DeFi | UNI, AAVE, CRV, SNX, MKR | 50+ |
| Meme | DOGE, SHIB, PEPE, WIF | 100+ |
| AI | TAO, FET, RENDER, AKT | 30+ |
| GameFi | AXS, MANA, SAND, GALA | 40+ |
| RWA | ONDO, MNT, MATR | 20+ |
| 稳定币 | USDT, USDC, DAI | 10+ |

## 链支持

- Bitcoin
- Ethereum (含 L2: Arbitrum, Optimism, Base, zkSync)
- Solana
- BSC
- Polygon
- Avalanche
- TON

## 常用分析模板

### 模板 1: 大户监控
```python
{
  "chain": "ethereum",
  "token": "USDT",
  "threshold": 1000000,  # 100 万美元
  "window": "24h",
  "alert": "telegram"   # or "discord" / "webhook"
}
```

### 模板 2: 交易所流入预警
```python
{
  "exchanges": ["binance", "okx", "coinbase"],
  "token": "ETH",
  "inflow_threshold": 50000,  # 5 万 ETH
  "signal": "potential_dump"   # 流入 = 可能砸盘
}
```

### 模板 3: DeFi 套利
```python
{
  "token_a": "USDC",
  "token_b": "USDT",
  "venues": ["uniswap-v3", "curve", "balancer"],
  "min_spread": 0.001,  # 0.1% 价差
  "gas_budget": 50      # 50 USD
}
```

## 技术指标

| 指标 | 用途 |
|------|------|
| RSI | 超买超卖 |
| MACD | 趋势 |
| BB | 波动 |
| OBV | 资金流 |
| VWAP | 成交量加权均价 |
| CVD | 累计成交量差 |
| MFI | 资金流量 |
| SOPR | 花费产出利润率 |
| NUPL | 未实现净利 |
| MVRV | 市值与已实现市值比 |

## 链上工具

- **Etherscan API**: 交易查询
- **Glassnode / CryptoQuant**: 链上指标
- **DefiLlama**: TVL / Yield
- **Dune Analytics**: 自定义 SQL 查询
- **Nansen**: 聪明钱地址追踪
- **Arkham**: 实体识别

## 风险提示

⚠️ **私钥安全**: 永远不要把私钥给任何人/工具
⚠️ **合约审计**: 与合约交互前确认审计报告
⚠️ **钓鱼识别**: 检查 URL / 合约地址
⚠️ **税务合规**: 各国加密税收政策不同
⚠️ **冷热分离**: 大额资产放冷钱包

## 触发场景

- "BTC 现在多少钱"
- "ETH 链上大户在干嘛"
- "DeFi 哪里收益最高"
- "BTC 恐慌指数"
- "NFT 地板价"
- "分析下 SOL 走势"
- "套利机会"
