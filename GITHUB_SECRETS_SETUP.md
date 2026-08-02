# GitHub Secrets 配置指南

请在 GitHub 仓库配置以下 Secrets：

## 访问路径
```
https://github.com/PulseFlowAI/pulseflow-platform/settings/secrets/actions
```

## 需要配置的 Secrets

| Secret 名称 | 值 | 说明 |
|------------|-----|------|
| `TAURI_SIGNING_PRIVATE_KEY` | （见下方） | 替换下方的私钥内容 |
| `TAURI_SIGNING_PUBLIC_KEY` | （见下方） | 替换下方的公钥内容 |
| `TAURI_KEY_PASSWORD` | （留空） | 私钥无密码 |

## 当前密钥值

**私钥**（填入 `TAURI_SIGNING_PRIVATE_KEY`）：
```
dW50cnVzdGVkIGNvbW1lbnQ6IHJzaWduIGVuY3J5cHRlZCBzZWNyZXQga2V5ClJXUlRZMEl5TkJ3cm5xYkMzWXBid3dLVU5WUU0wNm5sWVNmVEtCN3VNOXFhYzJ6eTZnZ0FBQkFBQUFBQUFBQUFBQUlBQUFBQTVvQ1lDSGZWNUp6MVJxdXhCcXdaRmw5QWF6dWNyU3BEK0F2bUxsWE5ILzBEWGFTTkU1S3p6ak1OQmdGazVoK085N1lXUjNlS0Fqb1ZpSVUxSFJXOFR3c3ZTMTdzTi9wejQ4dU12WmdzaWlVNVFDNlBCY0labGg3RzQvenkxenVrQXpSZWpEc2dmV1U9Cg==
```

**公钥**（填入 `TAURI_SIGNING_PUBLIC_KEY`，可选）：
```
dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEIwMTBDODFFNzk4QjdGQjUKUldTMWY0dDVIc2dRc05DRzdJVEhpbzhjWWgzR2RiZStKdFQ5eUFNY2dvZ3c0SkFIZ25ZWklqc1AK
```

## ⚠️ 安全提醒
- 私钥已配置在本地 `.env` 文件中
- **不要将私钥提交到 Git 仓库**
- `.gitignore` 应已排除 `.env` 文件

