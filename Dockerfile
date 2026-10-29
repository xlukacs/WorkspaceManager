FROM node:22-bookworm-slim

WORKDIR /app

# The container runs as the host user (see docker-compose.yml), which may have
# no home directory here, so keep corepack and npm state in shared locations.
ENV COREPACK_HOME=/opt/corepack \
  COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
  NPM_CONFIG_CACHE=/tmp/.npm

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable \
  && corepack prepare pnpm@10.27.0 --activate \
  && chmod -R a+rwX /opt/corepack

COPY out/cli/index.js /app/index.js
COPY package.json /app/package.json

ENV MCP_HOST=0.0.0.0
ENV MCP_PORT=3847
ENV WORKSPACE_MANAGER_STORE=/data/workspace-manager.json

EXPOSE 3847

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3847/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "/app/index.js", "mcp", "--http"]
