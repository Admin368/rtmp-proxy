# Build stage
FROM node:20-alpine AS builder

# Set the working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install ALL dependencies (including devDependencies)
RUN yarn install --frozen-lockfile

# Copy source files and config files
COPY tsconfig.json .
COPY src ./src

# Build the application
RUN yarn build

# Production stage
FROM node:20-alpine

# Install FFmpeg using alpine package manager
RUN apk add --no-cache ffmpeg

WORKDIR /app

# Copy only the necessary files from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./
COPY media ./media

# Install only production dependencies
RUN yarn install --production --frozen-lockfile && \
    yarn cache clean

# Set the default command
CMD ["node", "dist/index.js"]
