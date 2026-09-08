# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json yarn.lock ./
RUN yarn install --frozen-lockfile

COPY tsconfig.json .
COPY src ./src
RUN yarn build

# Production stage
FROM node:20-alpine

RUN apk add --no-cache ffmpeg

WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json /app/yarn.lock ./
COPY media ./media

RUN yarn install --production --frozen-lockfile && \
    yarn cache clean

# Accounts and API keys live here. Mount it, or every restart forgets them.
RUN mkdir -p /app/data
VOLUME ["/app/data"]
ENV DATA_DIR=/app/data

EXPOSE 4000 4001 4002

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.WEB_PORT||4000)+'/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "dist/index.js"]
