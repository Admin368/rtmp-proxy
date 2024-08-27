"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_media_server_1 = __importDefault(require("node-media-server"));
const express_1 = __importDefault(require("express"));
const http_1 = __importDefault(require("http"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os")); // Required for platform detection
// Detect platform to set FFmpeg path
const isWindows = os_1.default.platform() === "win32";
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
        mediaroot: path_1.default.join(__dirname, "media"),
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
const nms = new node_media_server_1.default(config);
const sessions = [];
nms.on("prePublish", (id, streamPath, args) => {
    console.log(`[NodeEvent on prePublish] id=${id} StreamPath=${streamPath} args=${JSON.stringify(args)}`);
    sessions.push({ id, streamPath, args });
});
nms.on("donePublish", (id, streamPath, args) => {
    console.log(`[NodeEvent on donePublish] id=${id} StreamPath=${streamPath}`);
    const index = sessions.findIndex((session) => session.id === id);
    if (index > -1) {
        sessions.splice(index, 1);
    }
});
nms.run();
const app = (0, express_1.default)();
const server = http_1.default.createServer(app);
app.get("/", (req, res) => {
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
            html += `<li>Stream ID: ${session.id}, Stream Path: ${session.streamPath.slice(0, 10)}***, Args: ${JSON.stringify(session.args)}</li>`;
        });
    }
    else {
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
