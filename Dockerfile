# Stage 1: Build the TypeScript app
FROM node:18 AS build

# Set working directory inside the container
WORKDIR /usr/src/app

# Install FFmpeg
RUN apt-get update && apt-get install -y ffmpeg

# Copy package.json and package-lock.json
COPY package*.json ./

# Install all dependencies, including devDependencies
RUN npm install

# Copy the project files into the container
COPY . .

# Compile TypeScript to JavaScript
RUN npm run build

# Stage 2: Run the application
FROM node:18

# Set working directory for the second stage
WORKDIR /usr/src/app

# Install FFmpeg
RUN apt-get update && apt-get install -y ffmpeg

# Copy only the necessary files from the build stage
COPY --from=build /usr/src/app/package*.json ./
COPY --from=build /usr/src/app/dist ./dist
COPY --from=build /usr/src/app/media ./media

# Install production dependencies
RUN npm install --only=production

# Expose ports
EXPOSE 4000 4001

# Run the application
CMD ["node", "dist/index.js"]
