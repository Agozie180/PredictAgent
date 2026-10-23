FROM oven/bun:1.2-slim

WORKDIR /app

# Copy lockfile first so Docker layer cache invalidates only when deps change
COPY bun.lock ./
COPY package.json ./

# Reproducible install — exact versions from lockfile, no devDependencies
RUN bun install --frozen-lockfile --production

# Copy server source
COPY server/ ./server/

# PORT is injected by Render at runtime
EXPOSE 10000

CMD ["bun", "run", "server/index.ts"]
