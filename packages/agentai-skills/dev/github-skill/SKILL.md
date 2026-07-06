---
name: github-skill
description: GitHub automation and repository management. Create issues, review PRs, manage releases, and automate GitHub workflows without leaving the chat.
description_zh: "GitHub 自动化与仓库管理，自动创建 Issue、审查 PR、发布 Release，无需手动操作 GitHub 网页"
description_en: "GitHub automation for issues, PRs, releases, and repository management"
version: 1.0.0
metadata:
  category: dev
  tags:
    - github
    - git
    - issue
    - pr
    - release
    - automation
    - devops
  author: AgentAI Team
  requires:
    bins:
      - python3
    env:
      - GITHUB_TOKEN
  parallelSafe: true
  riskLevel: medium
  triggers:
    - "创建.*[Ii]ssue"
    - "[Bb]ug.*报告"
    - "[Ff]eature.*请求"
    - "[Pp][Rr].*审查"
    - "[Rr]elease.*发布"
    - "[Cc]hangelog.*生成"
    - "[Gg]ithub.*操作"
    - "提交.*[Cc]ommit"
    - "[Bb]ranch.*创建"
---

# GitHub Skill 🐙

Automate GitHub workflows directly from chat. The AI will automatically detect when you need GitHub operations and trigger this skill.

## Auto-Trigger Scenarios

The AI will **automatically** use this skill when you:

### 1. Report a Bug
```
User: "发现登录功能有 bug，用户无法登录"
→ AI automatically creates GitHub Issue with bug template
```

### 2. Request a Feature
```
User: "希望能添加暗黑模式"
→ AI automatically creates feature request Issue
```

### 3. Review Code
```
User: "帮我看看这个 PR"
→ AI fetches PR details and provides review comments
```

### 4. Generate Release Notes
```
User: "准备发布 v1.2.0"
→ AI generates changelog from commits and creates Release
```

### 5. Manage Branches
```
User: "创建 feature/login 分支"
→ AI creates branch and sets up PR template
```

## Features

- **Smart Issue Creation**: Auto-categorizes bugs vs features, applies templates
- **PR Review Assistant**: Summarizes changes, checks for common issues
- **Release Automation**: Generates changelog, creates GitHub Release
- **Commit Analysis**: Explains what changed in recent commits
- **Branch Management**: Creates branches with proper naming conventions

## Actions

| Action | Description | Auto-Trigger Example |
|--------|-------------|---------------------|
| `create_issue` | Create GitHub Issue | "有个 bug..." |
| `list_issues` | List open issues | "看看有哪些 issue" |
| `get_pr` | Get PR details | "审查这个 PR" |
| `list_prs` | List open PRs | "有哪些 PR 待审查" |
| `create_release` | Create Release | "发布新版本" |
| `get_commits` | Get recent commits | "最近提交了什么" |
| `create_branch` | Create branch | "创建 feature 分支" |

## Configuration

Requires `GITHUB_TOKEN` environment variable with repo access.

## Safety

- Issues created as draft by default
- Releases require confirmation before publishing
- No destructive operations (delete/force push)
