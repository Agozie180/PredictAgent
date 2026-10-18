FROM oven/bun:1.2-slim

WORKDIR /app

# Copy only what the signal service needs
COPY package.json ./
RUN bun install --production

COPY server/ ./server/

# PORT is injected by the host (Render: 10000, HF: 7860, local: 3001)
EXPOSE 10000

CMD ["bun", "run", "server/index.ts"]
