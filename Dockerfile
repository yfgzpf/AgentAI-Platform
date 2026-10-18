# ============================================
# Dockerfile — AgentAI Platform 容器化部署
# ============================================
# 多阶段构建:
#   Stage 1: 安装 Python 技能依赖
#   Stage 2: 构建前端 GUI
#   Stage 3: 最终运行镜像
#
# 用法:
#   docker build -t agentai-platform .
#   docker run -p 3200:3200 --env-file .env agentai-platform
# ============================================

# ── Stage 1: Python 技能环境 ────────────────
FROM python:3.11-slim AS python-builder

WORKDIR /opt/agentai/skills

# 复制技能文件
COPY packages/agentai-skills/ ./agentai-skills/
COPY SkillOpt/skillopt_sleep/ ./skillopt_sleep/

# 安装依赖 (分层缓存优化)
COPY packages/agentai-skills/requirements.txt ./req-skills.txt 2>/dev/null || true
COPY SkillOpt/requirements.txt ./req-skillopt.txt 2>/dev/null || true

RUN pip install --no-cache-dir \
    fastapi uvicorn pydantic httpx websockets \
    Pillow openpyxl python-docx python-pptx \
    beautifulsoup4 lxml aiofiles \
    openai anthropic tiktoken \
    pandas numpy rich click jinja2 \
    playwright && \
    playwright install chromium --with-deps || true

# ── Stage 2: 前端构建 ─────────────────────
FROM node:22-alpine AS gui-builder

WORKDIR /opt/agentai

# 先复制依赖定义文件 (利用Docker缓存)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/agentai-gateway/package.json ./packages/agentai-gateway/
COPY packages/agentai-gui/package.json ./packages/agentai-gui/

RUN corepack enable && corepack prepare pnpm@latest --activate && \
    pnpm install --frozen-lockfile || pnpm install

# 复制源码并构建
COPY packages/agentai-gateway/ ./packages/agentai-gateway/
COPY packages/agentai-gui/ ./packages/agentai-gui/

RUN pnpm --filter @agentai/gateway build && \
    pnpm --filter @agentai/gui build

# ── Stage 3: 运行时镜像 ────────────────────
FROM node:22-slim AS runtime

LABEL maintainer="AgentAI Team"
LABEL description="AgentAI Platform — AI Agent Framework with Skills Ecosystem"
LABEL version="0.1.0-alpha.1"

# 安装基础工具
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl git python3 python3-pip sqlite3 \
    && rm -rf /var/lib/apt/lists/*

# 创建非root用户
RUN groupadd -r agentai && useradd -r -g agentai -d /app agentai

WORKDIR /app

# 从 Stage 1 复制 Python 环境
COPY --from=python-builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=python-builder /opt/agentai/skills ./skills/

# 从 Stage 2 复制构建产物
COPY --from=gui-builder /opt/agentai/packages/agentai-gateway/dist ./gateway/dist/
COPY --from=gui-builder /opt/agentai/packages/agentai-gui/dist ./gui-dist/

# 复制运行时配置
COPY package.json ./
COPY packages/agentai-gateway/rules.json ./gateway/rules.json

# 数据持久化目录
# 2026-10-16 部署加固: 补全 AgentAI_HOME 下的全部标准子目录。
# 此前只建了 memory，而 checkpoints / tasks / worktrees / config / cache
# 靠各模块首次写入时自行 mkdir —— 目录不存在 + 非 root 用户 = 首次写入 EACCES。
# 显式预建并 chown，避免能力在容器里静默失效。
# 说明: 这些目录已由 docker-compose.yml 挂载为命名卷，镜像内建目录只为
# 保证单容器 `docker run` 场景（无 compose）同样可用。
RUN mkdir -p /app/data /app/logs \
      /app/.agentai/memory \
      /app/.agentai/checkpoints \
      /app/.agentai/tasks \
      /app/.agentai/worktrees \
      /app/.agentai/config \
      /app/.agentai/cache \
      /app/.agentai/sessions \
      /app/.agentai/skills \
    && chown -R agentai:agentai /app

# ⚠️ 关于 Git worktree 隔离能力在容器内的可用性:
# 镜像已装 git（第 63 行），但**镜像内不含 .git 目录**（只 COPY 了 dist 产物），
# 因此 worktreeCapability() 会返回 NOT_A_GIT_REPO —— 这是预期行为，不是 bug。
# 若需要容器内 worktree 隔离，两种方式:
#   1. 挂载宿主仓库: -v /host/repo:/workspace/repo 挂载进容器（容器内即为 git 仓库）
#   2. 把 .git 一并 COPY 进镜像（仅适合 CI 内的临时仓库，不适合生产）
# 前端/CLI 可通过 GET /v1/system/capabilities 查当前环境的实际可用性。

USER agentai

EXPOSE 18789

ENV NODE_ENV=production \
    PORT=18789 \
    HOST=0.0.0.0 \
    AGENTAI_HOME=/app/.agentai

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:18789/v1/health || exit 1

CMD ["node", "gateway/dist/index.js"]
