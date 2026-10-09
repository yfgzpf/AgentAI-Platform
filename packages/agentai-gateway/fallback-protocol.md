# 文件读取失败容错处理规范

## 🎯 核心原则

**先诊断, 后治疗 — 像中医"望闻问切"一样理解系统状态**

## 📋 失败处理流程

### 1️⃣ 识别失败类型

| 失败类型 | 典型错误 | 处理方式 |
|---------|---------|---------|
| **依赖缺失** | `Cannot find module 'xxx'` | 安装依赖 |
| **路径错误** | `ENOENT: no such file or directory` | 换路径/用 glob |
| **权限不足** | `EACCES: permission denied` | 检查权限 |
| **网络问题** | `ETIMEDOUT`, `ECONNRESET` | 重试/切换源 |
| **资源不存在** | `resource does not exist` | 创建或搜索 |

### 2️⃣ 自动容错策略

#### 策略 A: 替换错误参数
```javascript
// ❌ 错误: 路径不存在
list_directory('packages/agentai-gateway')

// ✅ 正确: 使用当前工作区
list_directory('.')
```

#### 策略 B: 降级到替代工具
```javascript
// ❌ 失败: list_directory
list_directory('nonexistent/path')

// ✅ 替代: 使用 read_file 读取已知文件
read_file('src/app.ts')

// ✅ 替代: 使用 glob 搜索
glob('*.ts')
```

#### 策略 C: 智能路径推导
```javascript
// 用户说 "packages/agentai-gateway/src/app.ts"
// 但实际在 "src/app.ts"
// → 自动检测到工作区根目录, 简化路径
```

### 3️⃣ 禁止事项

❌ **绝对禁止**的失败响应:
- "工具不可用"（没说清是依赖、路径还是权限）
- "我放弃"（没尝试任何替代方案）
- 重复相同参数重试（导致无限循环）
- 谎报成功（假装读取成功）

✅ **必须执行**的容错动作:
- 分析失败根因（分类错误类型）
- 提供明确的修复建议
- 尝试替代方案（至少 2 种）
- 如实报告失败状态和已尝试的方案

## 🔧 推荐工具链

### 文件读取失败时

```javascript
// 1. 先诊断: 检查路径是否存在
list_directory('.')  // 列出当前目录

// 2. 如果路径错误, 换方案
read_file('src/app.ts')  // 读取已知存在的文件

// 3. 如果文件列表, 用 glob
glob('*.ts')  // 搜索所有 TypeScript 文件

// 4. 如果需要递归, 用 directory_tree
directory_tree({ path: '.', maxDepth: 2 })
```

### 依赖安装失败时

```javascript
// 1. 检测包管理器
// - 有 pnpm-lock.yaml → pnpm
// - 有 yarn.lock → yarn  
// - 有 package-lock.json → npm
// - 有 requirements.txt → pip

// 2. 尝试安装
npm_install({ package: 'xxx', manager: 'auto' })

// 3. 如果失败, 换源重试
npm_install({ package: 'xxx --registry=https://registry.npmmirror.com' })

// 4. 如果还是失败, 告知用户
// 提供: 已尝试的方案 + 失败原因 + 建议替代方案
```

## 📊 错误分类与处理矩阵

| 错误代码 | 错误类型 | 处理方案 | 重试策略 |
|---------|---------|---------|---------|
| `ENOENT` | 文件/目录不存在 | 检查路径, 使用 glob 搜索 | ✅ 换方案 |
| `EACCES` | 权限不足 | 检查文件权限, 以管理员运行 | ❌ 不重试 |
| `EISDIR` | 期望文件但提供目录 | 读取目录下的具体文件 | ✅ 换方案 |
| `ELOOP` | 符号链接循环 | 使用绝对路径, 解析 symlink | ❌ 不重试 |
| `EMFILE` | 打开文件数太多 | 关闭不用的文件, 增加限制 | ✅ 稍后重试 |
| `ENOSPC` | 磁盘空间不足 | 清理空间, 使用临时目录 | ❌ 不重试 |
| `ETIMEDOUT` | 网络超时 | 切换镜像源, 增加超时时间 | ✅ 重试 3 次 |
| `ECONNRESET` | 连接被重置 | 检查网络连接, 重试 | ✅ 重试 3 次 |

## 🎓 最佳实践示例

### 示例 1: 读取配置文件

```javascript
// ❌ 不好的做法
const config = read_file('config/settings.json');  // 如果路径错误就失败

// ✅ 好的做法
async function getConfig() {
  const candidates = [
    'config/settings.json',
    'settings.json',
    '.agentai/config.json'
  ];
  
  for (const candidate of candidates) {
    try {
      const content = await read_file(candidate);
      return JSON.parse(content);
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;  // 非文件不存在错误直接抛出
    }
  }
  
  throw new Error('未找到配置文件, 已尝试: ' + candidates.join(', '));
}
```

### 示例 2: 搜索项目文件

```javascript
// ❌ 不好的做法
const file = list_directory('src/utils/helpers');  // 路径可能不存在

// ✅ 好的做法
const files = await glob('**/utils/helpers/*.ts');
if (files.length === 0) {
  // 备选方案: 搜索所有 ts 文件
  const allTs = await glob('src/**/*.ts');
  console.log('未找到目标目录, 可用文件:', allTs.slice(0, 10));
}
```

## 🚨 何时停止重试

**以下情况必须停止重试, 转向人工干预:**

1. ❌ **权限错误** (`EACCES`) — 需要用户手动修改权限
2. ❌ **磁盘空间不足** (`ENOSPC`) — 需要用户清理空间
3. ❌ **3 次不同方案都失败** — 需要用户确认需求
4. ❌ **敏感操作**（删除/覆盖/生产环境）— 需要二次确认

## 📝 错误报告格式

当所有容错方案失败时, 必须提供结构化报告:

```markdown
## ❌ 操作失败

### 失败详情
- **操作**: read_file('src/app.ts')
- **错误**: ENOENT: no such file or directory
- **根因**: 路径不存在

### 已尝试的方案
1. ✅ 直接读取 → 失败
2. ✅ 使用 glob 搜索 → 未找到匹配文件
3. ✅ 检查目录结构 → 目录为空

### 建议替代方案
- 确认文件是否在其他位置
- 使用 list_directory('.') 查看当前目录
- 创建文件后重试
```

---

**最后更新**: 2026-10-02
**版本**: 1.0.0
**维护者**: AI Assistant
