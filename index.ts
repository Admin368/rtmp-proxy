import NodeMediaServer from "node-media-server";
import express, { Request, Response } from "express";
import http from "http";
import path from "path"; // Required for setting the mediaroot path

// Define RTMP server configuration
const config = {
  rtmp: {
    port: 4001, // RTMP runs on port 4001
    chunk_size: 60000,
    gop_cache: true,
    ping: 30,
    ping_timeout: 60,
  },
  http: {
    port: 8000, // HTTP server for HLS and stats (remains on port 8000)
    allow_origin: "*",
    mediaroot: path.join(__dirname, "media"), // Set a valid media root directory
  },
  relay: {
    ffmpeg: "./ffmpeg.exe", // Path to FFmpeg
    tasks: [
      {
        app: "live", // This app receives the stream from OBS
        mode: "push", // Push the stream to YouTube
        edge: `rtmp://a.rtmp.youtube.com/live2`, // Push to YouTube RTMP endpoint
        name: "proxy", // Name of the stream (used in OBS)
      },
    ],
  },
};

// Create the NodeMediaServer instance
const nms = new NodeMediaServer(config);

// Define the type for a session
interface Session {
  id: string;
  streamPath: string;
  args: object;
}

// Store sessions in a global array
const sessions: Session[] = [];

// Listen for events to track active sessions
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
    sessions.splice(index, 1); // Remove the session when done
  }
});

// Start the RTMP server
nms.run();

// Set up Express server to serve the landing page on port 4000
const app = express();
const server = http.createServer(app);

// Define the landing page route to show server status
app.get("/", (req: Request, res: Response) => {
  // HTML template displaying server stats and active streams
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

  // If there are active sessions, display them
  if (sessions.length > 0) {
    sessions.forEach((session) => {
      html += `<li>Stream ID: ${session.id}, Stream Path: ${
        session.streamPath
      }, Args: ${JSON.stringify(session.args)}</li>`;
    });
  } else {
    html += "<li>No active streams</li>";
  }

  html += `
        </ul>
      </body>
    </html>
  `;

  // Send the HTML response
  res.send(html);
});

// Start the Express server to listen on port 4000
server.listen(4000, () => {
  console.log("Landing page is available at http://localhost:4000");
});
