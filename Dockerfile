# Use an official Node.js runtime as the base image
FROM node:16

# Set the working directory in the container to /app
WORKDIR /app

# Copy package.json and package-lock.json (if available)
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy the dist folder containing the pre-built index.js and the media folder
COPY *dist/ ./dist/
COPY *media/ ./media/

# Install FFmpeg on Ubuntu
RUN apt-get update && apt-get install -y ffmpeg

# Ensure that ffmpeg is installed at /usr/bin/ffmpeg (the path used in index.ts)
RUN which ffmpeg

# Set the default command to run the dist/index.js file
CMD ["node", "dist/index.js"]
