# Stage 1: Build the TypeScript app
FROM node:18 AS build

# Set the working directory inside the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the entire project to the container
COPY . .

# Compile TypeScript to JavaScript
RUN npm run build

# Stage 2: Run the application
FROM node:18

# Set the working directory for the second stage
WORKDIR /usr/src/app

# Copy only the compiled JavaScript files and other necessary files from the build stage
COPY --from=build /usr/src/app/package*.json ./
COPY --from=build /usr/src/app/dist ./dist
COPY --from=build /usr/src/app/media ./media
COPY --from=build /usr/src/app/ffmpeg.exe ./ffmpeg.exe

# Install only production dependencies
RUN npm install --only=production

# Expose the ports
EXPOSE 4000 4001

# Run the application
CMD ["node", "dist/index.js"]
