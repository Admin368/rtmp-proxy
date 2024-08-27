import NodeMediaServer from "node-media-server";
import express, { Request, Response } from "express";
import http from "http";
import path from "path";
import os from "os"; // Required for platform detection

// Detect platform to set FFmpeg path
const isWindows = os.platform() === "win32";
const ffmpegPath = isWindows ? "./ffmpeg.exe" : "/usr/bin/ffmpeg"; // Adjust path based on the platform

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
    ffmpeg: ffmpegPath, // Use dynamic path
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

// Same session handling code as before...
interface Session {
  id: string;
  streamPath: string;
  args: object;
}

const sessions: Session[] = [];

nms.on("prePublish", (id: string, streamPath: string, args: object) => {
  console.log(
    `[NodeEvent on prePublish] id=${id} StreamPath=${streamPath} args=${JSON.stringify(
      args
    )}`
  );
  sessions.push({ id, streamPath, args });
});

nms.on("donePublish", (id: string, streamPath: string, args: object) => {
  console.log(`[NodeEvent on donePublish] id=${id} StreamPath=${streamPath}`);
  const index = sessions.findIndex((session) => session.id === id);
  if (index > -1) {
    sessions.splice(index, 1);
  }
});

nms.run();

const app = express();
const server = http.createServer(app);

app.get("/", (req: Request, res: Response) => {
  let html = `
    <html>
      <head>
        <title>Node Media Server Status</title>
      </head>
      <body>
        <h1>Node Media Server Status</h1>
        <p><strong>RTMP Port:</strong> ${config.rtmp.port}</p>
        <p><strong>Active Streams:</strong> ${sessions.length}</p>
        <h2>Stream Details:</h2>
        <ul>
  `;

  if (sessions.length > 0) {
    sessions.forEach((session) => {
      html += `<li>Stream ID: ${
        session.id
      }, Stream Path: ${session.streamPath.slice(
        0,
        10
      )}***, Args: ${JSON.stringify(session.args)}</li>`;
    });
  } else {
    html += "<li>No active streams</li>";
  }

  html += `
        </ul>
      </body>
    </html>
  `;
  res.send(html);
});

server.listen(4000, () => {
  console.log("Landing page is available at http://localhost:4000");
});
