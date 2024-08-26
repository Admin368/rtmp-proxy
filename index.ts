const STREAM_KEY = "x561-ms4r-2j50-k84r-2fzk";
const NodeMediaServer = require("node-media-server");

// RTMP Server Configuration
const config = {
  rtmp: {
    port: 1935, // The RTMP port
    chunk_size: 60000,
    gop_cache: true,
    ping: 30,
    ping_timeout: 60,
  },
  http: {
    port: 8000, // HTTP port for HLS and stats
    allow_origin: "*",
  },
  relay: {
    ffmpeg: "./ffmpeg.exe", // Make sure to have FFmpeg installed
    tasks: [
      {
        app: "live",
        mode: "static", // Forward to YouTube
        edge: `rtmp://a.rtmp.youtube.com/live2/${STREAM_KEY}`,
        name: "proxy", // Stream name to use in the source
      },
    ],
  },
};

// Create the server
try {
  const nms = new NodeMediaServer(config);
  nms.run();
} catch (e) {
  console.log("Failed to start");
  console.error(e);
}
