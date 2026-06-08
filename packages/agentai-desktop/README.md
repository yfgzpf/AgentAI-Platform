# @agentai/desktop

AgentAI Desktop — Tauri 2.0 极小桌面壳。

## 安装 Rust 工具链

```bash
# Windows (PowerShell)
winget install Rustlang.Rustup
rustup default stable

# macOS
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Linux
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

## 开发模式

```bash
# 1. 启动 Gateway (终端 1)
pnpm --filter @agentai/gateway dev

# 2. 启动 Tauri 桌面 (终端 2)
pnpm --filter @agentai/desktop tauri dev
```

## 打包

```bash
pnpm --filter @agentai/desktop tauri build
# → 5-10MB 安装包 (NSIS / DMG / AppImage)
```

## 状态

🚧 阶段 1 占位（`tauri.conf.json` + `Cargo.toml` 框架）。
