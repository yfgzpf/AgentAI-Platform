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
RUN mkdir -p /app/data /app/logs /app/.agentai/memory && \
    chown -R agentai:agentai /app

USER agentai

EXPOSE 18789

ENV NODE_ENV=production \
    PORT=18789 \
    HOST=0.0.0.0

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:18789/v1/health || exit 1

CMD ["node", "gateway/dist/index.js"]
