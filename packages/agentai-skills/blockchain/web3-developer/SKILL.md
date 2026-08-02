---
name: web3-developer
description: Web3 全栈开发工具: Solidity 智能合约、ERC20/721/1155 标准、DApp 前端、Hardhat/Foundry 测试、IPFS 存储、合约审计
description_zh: "Web3 全栈开发: Solidity 智能合约/ERC20/ERC721/ERC1155/DApp 前端/Hardhat/Foundry/IPFS/审计"
description_en: "Web3 full-stack: Solidity smart contracts, ERC20/721/1155, DApp frontend, Hardhat/Foundry, IPFS, audit"
version: 1.0.0
metadata:
  category: blockchain
  tags:
    - web3
    - solidity
    - smart-contract
    - ethereum
    - dapp
    - 区块链
    - 智能合约
    - 以太坊
  author: AgentAI Team
  parallelSafe: true
  riskLevel: high
  triggers:
    - "[Ss]olidity"
    - "智能合约"
    - "ERC20"
    - "ERC721"
    - "NFT.*合约"
    - "DApp"
    - "Web3.*开发"
    - "Hardhat"
    - "Foundry"
    - "合约.*审计"
    - "DeFi.*协议"
---

# Web3 全栈开发 ⛓️

专业的 Web3 / 区块链 / 智能合约开发工具。

## ⚠️ 安全提示

- 智能合约**不可篡改**, 部署前必须审计
- 私钥 / 助记词**永不联网**
- 钓鱼网站损失**不可逆**
- 测试网 (Sepolia / Goerli) 先验证

## 核心功能

### 1. 智能合约 (Solidity)

**开发环境**:
- Hardhat (推荐, JS/TS 生态)
- Foundry (Solidity 原生, 速度快)
- Truffle (经典)
- Remix (在线 IDE)

**Solidity 模板**:

#### ERC20 (代币)
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MyToken is ERC20 {
    constructor(uint256 initialSupply) ERC20("MyToken", "MTK") {
        _mint(msg.sender, initialSupply);
    }
}
```

#### ERC721 (NFT)
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";

contract MyNFT is ERC721URIStorage {
    uint256 private _nextTokenId;
    
    constructor() ERC721("MyNFT", "MNFT") {}
    
    function mint(string memory uri) public {
        uint256 tokenId = _nextTokenId++;
        _safeMint(msg.sender, tokenId);
        _setTokenURI(tokenId, uri);
    }
}
```

#### ERC1155 (多标准)
```solidity
contract MyMultiToken is ERC1155 {
    constructor() ERC1155("https://api.example.com/{id}.json") {}
    
    function mint(address to, uint256 id, uint256 amount, bytes memory data) public {
        _mint(to, id, amount, data);
    }
}
```

### 2. DeFi 协议开发

#### 常见 DeFi 模式

**AMM (自动做市商) - Uniswap V2 风格**:
```solidity
contract SimpleAMM {
    function addLiquidity(uint256 amountA, uint256 amountB) external {
        // 按比例存入, 给 LP token
    }
    
    function swap(uint256 amountIn, address tokenIn) external returns (uint256) {
        // x * y = k 恒定乘积
    }
}
```

**Lending (借贷) - Aave 风格**:
- 抵押借款
- 利率模型 (利用率)
- 清算机制
- 健康因子

**Staking (质押)**:
- 质押挖矿
- 收益分配
- 锁仓期
- 惩罚机制

**Vault (金库)**:
- 策略路由
- 自动复投
- 收益聚合 (Yearn 风格)

### 3. DApp 前端

**技术栈**:
- React / Vue / Svelte
- ethers.js / viem / web3.js
- wagmi (React Hooks)
- RainbowKit / Web3Modal (钱包连接)
- The Graph (链上数据索引)

**连接钱包**:
```typescript
import { useAccount, useConnect, useDisconnect } from 'wagmi';
import { InjectedConnector } from 'wagmi/connectors/injected';

function WalletConnect() {
  const { address, isConnected } = useAccount();
  const { connect } = useConnect({
    connector: new InjectedConnector(),
  });
  const { disconnect } = useDisconnect();
  
  if (isConnected) {
    return <div>Connected: {address} <button onClick={() => disconnect()}>Disconnect</button></div>;
  }
  return <button onClick={() => connect()}>Connect Wallet</button>;
}
```

**调用合约**:
```typescript
import { useContractRead, useContractWrite } from 'wagmi';

function MintNFT() {
  const { write: mint } = useContractWrite({
    address: '0x...',
    abi: nftAbi,
    functionName: 'mint',
    args: ['ipfs://...'],
  });
  
  return <button onClick={() => mint()}>Mint NFT</button>;
}
```

### 4. 测试 (Hardhat)

```typescript
import { expect } from "chai";
import { ethers } from "hardhat";

describe("MyToken", function () {
  it("Should mint tokens", async function () {
    const [owner] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("MyToken");
    const token = await Token.deploy(1000);
    
    const balance = await token.balanceOf(owner.address);
    expect(balance).to.equal(1000);
  });
});
```

**Foundry 测试**:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/MyToken.sol";

contract MyTokenTest is Test {
    MyToken token;
    
    function setUp() public {
        token = new MyToken(1000);
    }
    
    function testMint() public {
        assertEq(token.totalSupply(), 1000);
    }
}
```

### 5. 合约审计

**常见漏洞**:

| 漏洞 | 描述 | 防护 |
|------|------|------|
| 重入 (Reentrancy) | 回调中再调用 | ReentrancyGuard, Checks-Effects-Interactions |
| 整数溢出 | uint256 溢出 | Solidity 0.8+ 自带 SafeMath |
| 访问控制 | 未授权调用 | Ownable, AccessControl |
| 前置交易 (Front-running) | mempool 抢跑 | 提交-揭示方案 |
| 时间戳依赖 | block.timestamp 可操控 | 避免用作随机源 |
| 委托调用 | delegatecall 风险 | 谨慎使用 |
| 未检查返回值 | 低级 call 失败 | 检查返回值 |
| 拒绝服务 | 循环 gas 超限 | 拉取模式 |
| 闪电贷攻击 | 套利操纵 | 预言机 TWAP |

**审计清单**:
```
✅ 重入保护
✅ 整数溢出 (使用 0.8+)
✅ 权限控制 (最小权限)
✅ 输入验证
✅ 事件日志 (重要操作)
✅ 紧急暂停 (Pausable)
✅ 升级机制 (透明代理)
✅ Gas 优化
✅ 已知攻击 (SWC Registry)
```

**工具**:
- Slither (静态分析)
- Mythril (符号执行)
- Echidna (模糊测试)
- Manticore
- Certora (形式化验证)

### 6. IPFS 存储

```typescript
import { create } from 'ipfs-http-client';

const ipfs = create({ host: 'ipfs.infura.io', port: 5001 });

// 上传文件
const result = await ipfs.add(fileBuffer);
const cid = result.cid.toString();  // QmXxx...
const url = `https://ipfs.io/ipfs/${cid}`;
```

**NFT 元数据标准**:
```json
{
  "name": "My NFT #1",
  "description": "...",
  "image": "ipfs://QmXxx...",
  "attributes": [
    {"trait_type": "Background", "value": "Blue"},
    {"trait_type": "Eyes", "value": "Laser"}
  ]
}
```

### 7. 索引 (The Graph)

```graphql
type NFT @entity {
  id: ID!
  owner: Bytes!
  tokenURI: String!
  mintedAt: BigInt!
}
```

### 8. 多链开发

| 链 | 语言 | 特点 |
|----|------|------|
| Ethereum | Solidity | L1, 安全 |
| Polygon | Solidity | L2, 便宜 |
| Arbitrum | Solidity | L2, Optimistic |
| Optimism | Solidity | L2, Optimistic |
| Base | Solidity | L2, Coinbase |
| BNB Chain | Solidity | 便宜 |
| Avalanche | Solidity | 子网 |
| Solana | Rust | 高性能 |
| TON | Tact / FunC | Telegram 集成 |
| Aptos | Move | 平行链 |
| Sui | Move | 对象模型 |

### 9. Gas 优化

```solidity
// ❌ 多次 SSTORE
function bad() external {
    for (uint i = 0; i < 10; i++) {
        counter++;  // 每次 SSTORE 2100 gas
    }
}

// ✅ 内存累加 + 一次 SSTORE
function good() external {
    uint256 total = 10;
    counter += total;  // 一次 SSTORE
}

// ✅ 自定义错误 (节省 gas)
error InsufficientBalance();
function withdraw() external {
    if (balance < amount) revert InsufficientBalance();
}

// ✅ 不可变量用 immutable / constant
uint256 public constant MAX_SUPPLY = 10000;  // 比 state variable 省 gas
address public immutable OWNER;
```

### 10. 部署

**Hardhat 部署脚本**:
```typescript
async function main() {
  const Token = await ethers.getContractFactory("MyToken");
  const token = await Token.deploy(1000000);
  await token.deployed();
  console.log("Deployed to:", token.address);
}

main().catch(console.error);
```

**多链部署配置 (hardhat.config.ts)**:
```typescript
networks: {
  mainnet: { url: MAINNET_RPC, accounts: [PRIVATE_KEY] },
  polygon: { url: POLYGON_RPC, accounts: [PRIVATE_KEY] },
  arbitrum: { url: ARBITRUM_RPC, accounts: [PRIVATE_KEY] },
  sepolia: { url: SEPOLIA_RPC, accounts: [PRIVATE_KEY] },
}
```

## 主流协议参考

| 协议 | 类别 | 地址模式 |
|------|------|----------|
| Uniswap | DEX | x*y=k |
| Aave | Lending | 池化 |
| Compound | Lending | cToken |
| MakerDAO | CDP | Vault |
| Curve | StableSwap | 专为稳定币 |
| Yearn | Yield | 策略聚合 |
| Lido | Staking | stETH |
| GMX | 永续 | GLP |
| Frax | 稳定币 | 部分储备 |
| Pendle | 收益 | PT/YT |

## 触发场景

- "写一个 ERC20 合约"
- "NFT 怎么 mint"
- "DApp 怎么连接钱包"
- "如何防重入"
- "AMM 怎么实现"
- "Gas 怎么优化"
- "合约审计"
- "部署到 Polygon"

## 工具方法

```python
# 合约生成
await generate_contract(standard="ERC721", name="MyNFT", symbol="MNFT")

# 审计
await audit_contract(contract_code, severity="high")

# Gas 估算
await estimate_gas(function_name, args)

# ABI 编码
await encode_function_call(abi, function_name, args)

# 测试生成
await generate_tests(contract_code, framework="hardhat")
```

## 最佳实践

✅ **使用 OpenZeppelin**: 经过审计的标准实现
✅ **先测试网**: Sepolia / Mumbai / Fuji
✅ **找审计公司**: Trail of Bits / OpenZeppelin / Spearbit
✅ **Bug Bounty**: Immunefi 上悬赏
✅ **时间锁**: 关键操作 48h 延迟
✅ **多签钱包**: Gnosis Safe 管理合约所有权
✅ **监控**: Tenderly / Forta 实时监控
✅ **保险**: Nexus Mutual 保险
