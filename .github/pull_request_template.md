# Pull Request 模板

## 📋 变更说明

<!-- 简述这个 PR 做什么 -->

## 🎯 关联 Issue

Closes #
Refs #

## 🧪 测试

- [ ] 单元测试通过 (`pnpm test`)
- [ ] 集成测试通过 (`pnpm test:integration`)
- [ ] 手动测试通过 (Tauri 桌面 + Web + QQ + VSCode 至少 1 渠道)
- [ ] 文档已更新 (README / docs/)
- [ ] CHANGELOG.md 已更新

## 📸 截图 / 日志 (可选)

<!-- 贴截图或关键日志 -->

## ⚠️ Breaking Change

- [ ] 否
- [ ] 是 → footer 已说明

## ✅ Checklist

- [ ] 代码风格: `pnpm lint` 通过
- [ ] 类型检查: `pnpm typecheck` 通过
- [ ] 已自审 (diff 完整看过)
- [ ] 至少 1 位 Reviewer 批准
- [ ] 分支与 base 无冲突
- [ ] `.env` / `keys.enc` / `.salt` 未提交
