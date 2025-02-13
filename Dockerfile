# Build stage
FROM node:20-alpine AS builder

# Set the working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN yarn install

# Copy source files
COPY . .

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
COPY --from=builder /app/media ./media

# Install only production dependencies
RUN yarn install --production && \
    yarn cache clean

# Set the default command
CMD ["node", "dist/index.js"]
