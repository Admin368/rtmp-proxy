import NodeMediaServer from "node-media-server";
import express, { Request, Response } from "express";
import http from "http";
import path from "path";
import os from "os"; // Required for platform detection

// Detect platform to set FFmpeg path
const isWindows = os.platform() === "win32";
const ffmpegPath = isWindows ? "./ffmpeg.exe" : "/usr/bin/ffmpeg";

// Get server IP addresses
function getServerAddresses(): string[] {
  const interfaces = os.networkInterfaces();
  const addresses: string[] = [];

  for (const iface of Object.values(interfaces)) {
    if (iface) {
      for (const addr of iface) {
        if (addr.family === "IPv4" && !addr.internal) {
          addresses.push(addr.address);
        }
      }
    }
  }
  return addresses;
}

// Define RTMP server configuration
const config = {
  rtmp: {
    port: 4001,
    chunk_size: 60000,
    gop_cache: true,
    ping: 30,
    ping_timeout: 60,
  },
  http: {
    port: 4002,
    allow_origin: "*",
    mediaroot: path.join(__dirname, "media"),
  },
  relay: {
    ffmpeg: ffmpegPath,
    tasks: [
      {
        app: "live",
        mode: "push",
        edge: `rtmp://a.rtmp.youtube.com/live2`,
        name: "proxy",
      },
    ],
  },
};

const nms = new NodeMediaServer(config);

// Enhanced session interface
interface Session {
  id: string;
  streamPath: string;
  args: object;
  startTime: Date;
  lastPing: Date;
}

const sessions: Session[] = [];

// Cleanup inactive sessions periodically
setInterval(() => {
  const now = new Date();
  const inactivePeriod = 60000; // 60 seconds

  const initialCount = sessions.length;
  for (let i = sessions.length - 1; i >= 0; i--) {
    const session = sessions[i];
    if (now.getTime() - session.lastPing.getTime() > inactivePeriod) {
      console.log(`[Cleanup] Removing inactive session: ${session.id}`);
      sessions.splice(i, 1);
    }
  }

  if (initialCount !== sessions.length) {
    console.log(
      `[Cleanup] Removed ${initialCount - sessions.length} inactive sessions`
    );
  }
}, 30000); // Run cleanup every 30 seconds

nms.on("prePublish", (id: string, streamPath: string, args: object) => {
  console.log(
    `[NodeEvent on prePublish] id=${id} StreamPath=${streamPath} args=${JSON.stringify(
      args
    )}`
  );
  sessions.push({
    id,
    streamPath,
    args,
    startTime: new Date(),
    lastPing: new Date(),
  });
});

nms.on("donePublish", (id: string, streamPath: string, args: object) => {
  console.log(`[NodeEvent on donePublish] id=${id} StreamPath=${streamPath}`);
  const index = sessions.findIndex((session) => session.id === id);
  if (index > -1) {
    sessions.splice(index, 1);
  }
});

// Add ping event handler to update session last ping time
nms.on("postPlay", (id: string, streamPath: string, args: object) => {
  const session = sessions.find((s) => s.id === id);
  if (session) {
    session.lastPing = new Date();
  }
});

nms.run();

const app = express();
const server = http.createServer(app);

app.get("/", (req: Request, res: Response) => {
  const serverAddresses = getServerAddresses();

  let html = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Node Media Server Status</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f5f5f5;
          }
          .container {
            background-color: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          }
          .server-info {
            margin-bottom: 20px;
            padding: 15px;
            background-color: #f8f9fa;
            border-radius: 4px;
          }
          .stream-item {
            margin: 10px 0;
            padding: 10px;
            background-color: #e9ecef;
            border-radius: 4px;
          }
          .status-good {
            color: #28a745;
          }
          .status-warning {
            color: #ffc107;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Node Media Server Status</h1>
          
          <div class="server-info">
            <h2>Server Information</h2>
            <p><strong>RTMP Port:</strong> ${config.rtmp.port}</p>
            <p><strong>HTTP Port:</strong> ${config.http.port}</p>
            <p><strong>Server Addresses:</strong></p>
            <ul>
              ${serverAddresses
                .map(
                  (addr) => `
                <li>http://${addr}:4000 (Web Interface)</li>
                <li>rtmp://${addr}:${config.rtmp.port}/live (RTMP Endpoint)</li>
              `
                )
                .join("")}
            </ul>
          </div>

          <div class="server-info">
            <h2>Active Streams (${sessions.length})</h2>
            ${
              sessions.length > 0
                ? `
              <div class="streams-list">
                ${sessions
                  .map(
                    (session) => `
                  <div class="stream-item">
                    <p><strong>Stream ID:</strong> ${session.id}</p>
                    <p><strong>Path:</strong> ${session.streamPath}</p>
                    <p><strong>Started:</strong> ${session.startTime.toLocaleString()}</p>
                    <p><strong>Last Activity:</strong> ${session.lastPing.toLocaleString()}</p>
                    <p><strong>Duration:</strong> ${Math.round(
                      (new Date().getTime() - session.startTime.getTime()) /
                        1000
                    )} seconds</p>
                  </div>
                `
                  )
                  .join("")}
              </div>
            `
                : "<p>No active streams</p>"
            }
          </div>
        </div>
      </body>
    </html>
  `;
  res.send(html);
});

// Add a health check endpoint
app.get("/health", (req: Request, res: Response) => {
  res.json({
    status: "healthy",
    activeStreams: sessions.length,
    uptime: process.uptime(),
  });
});

server.listen(4000, "0.0.0.0", () => {
  const addresses = getServerAddresses();
  console.log("Server is running!");
  console.log("Available interfaces:");
  addresses.forEach((addr) => {
    console.log(`- Web interface: http://${addr}:4000`);
    console.log(`- RTMP endpoint: rtmp://${addr}:${config.rtmp.port}/live`);
  });
});
