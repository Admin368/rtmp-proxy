# Build stage
FROM node:24-alpine AS builder

# pnpm ships with the image via corepack; the version comes from package.json's packageManager field.
RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json .
COPY src ./src
RUN pnpm build

# Production stage
FROM node:24-alpine

RUN apk add --no-cache ffmpeg
RUN corepack enable

WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY media ./media

RUN pnpm install --prod --frozen-lockfile && \
    pnpm store prune

# Accounts and API keys live here. Mount it, or every restart forgets them.
RUN mkdir -p /app/data
VOLUME ["/app/data"]
ENV DATA_DIR=/app/data

EXPOSE 4000 4001 4002

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.WEB_PORT||4000)+'/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "dist/index.js"]
