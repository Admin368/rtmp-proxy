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
    ffmpeg: "./ffmpeg.exe", // Path to FFmpeg
    tasks: [
      {
        app: "live", // This is the app receiving the stream from OBS
        mode: "push", // Push the stream to YouTube
        edge: `rtmp://a.rtmp.youtube.com/live2`, // Push to YouTube
        name: "proxy", // The stream name (from OBS)
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
