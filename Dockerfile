FROM oven/bun:1.1-slim

WORKDIR /app

# Copy only what the signal service needs
COPY package.json bun.lock* ./
RUN bun install --production --frozen-lockfile

COPY server/ ./server/

# PORT is injected by the host (Render: 10000, HF: 7860, local: 3001)
EXPOSE 10000

CMD ["bun", "run", "server/index.ts"]
