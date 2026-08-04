# Git 打包与发布工作流 (公开版本)

> **完整技能文件位置**: `.agentai/skills/git-release-workflow/SKILL.md`
> 
> 本文档是公开副本，可安全提交到 Git 仓库。

---

## 📚 快速参考

### 一键发布命令

```powershell
# 发布新版本
.\scripts\release.ps1 -Version "v0.2.0" -Message "新功能描述"

# 本地打包
.\scripts\build-local.ps1

# 清理后重新构建
.\scripts\build-local.ps1 -Clean

# 调试模式（详细日志）
.\scripts\build-local.ps1 -Debug

# 密钥管理
.\scripts\manage-tauri-keys.ps1 -Action generate    # 生成新密钥
.\scripts\manage-tauri-keys.ps1 -Action show-pubkey # 显示公钥
.\scripts\manage-tauri-keys.ps1 -Action backup      # 备份密钥
.\scripts\manage-tauri-keys.ps1 -Action verify      # 验证配置
.\scripts\manage-tauri-keys.ps1 -Action check-secrets # 查看 Secrets 清单
```

---

## 🔑 GitHub Secrets 配置清单

| Secret 名称 | 值 | 设置位置 |
|------------|-----|---------|
| `TAURI_SIGNING_PRIVATE_KEY` | `PulseFlow` 文件内容 | [GitHub Secrets 页面](https://github.com/yfgzpf/AgentAI-Platform/settings/secrets/actions) |
| `TAURI_KEY_PASSWORD` | 你的密码 | 同上 |

---

## 🚀 发布流程（标准步骤）

```
1. 更新版本号 → tauri.conf.json + package.json
2. 提交代码   → git commit + git push
3. 创建标签   → .\scripts\release.ps1 -Version "v0.2.0"
4. 等待构建   → 10-15 分钟
5. 发布 Release → GitHub Releases 页面点击 Publish
6. 下载测试   → Assets 区域下载 .exe 安装包
```

---

## ❓ 常见问题

### Q: 打包失败 "Resource not accessible"
**A**: 检查 workflow 文件是否有 `permissions: contents: write`

### Q: Release 没有 .exe 文件，只有源码
**A**: 缺少 "Upload Release Asset" 步骤，检查 `.github/workflows/release-desktop.yml`

### Q: 签名失败 "passwords don't match"
**A**: 重新生成密钥，确保两次输入相同密码

### Q: 本地打包环境问题
**A**: 运行 `.\scripts\build-local.ps1 -Clean` 清理缓存后重试

---

*详细文档请查看 `.agentai/skills/git-release-workflow/SKILL.md`*
