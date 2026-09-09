import express from "express";
import fs from "fs";
import http from "http";
import { config } from "./config";
import { startRtmpServer, shutdownRtmp } from "./rtmp/server";
import { ensureCreatorAccount } from "./services/users";
import { databasePath, saveSync } from "./store/db";
import { createRouter } from "./web/routes";
import { getServerAddresses, ingestHosts, ingestUrl, ingestUrlSecure, rtmpsEnabled } from "./web/urls";

function main(): void {
  fs.mkdirSync(config.mediaRoot, { recursive: true });

  ensureCreatorAccount();
  startRtmpServer();

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", true);
  app.use(createRouter());

  const server = http.createServer(app);
  server.listen(config.webPort, "0.0.0.0", () => {
    console.log("RTMP proxy is running.");
    console.log(`  accounts database: ${databasePath}`);
    if (config.basePath) {
      console.log(`  mounted under:     ${config.basePath} (BASE_PATH)`);
    }
    // Discovered interfaces are the container's when containerised, so only claim them as
    // reachable when PUBLIC_HOST has not told us the address clients actually use.
    const dashboardHosts = config.publicHost
      ? [config.publicHost]
      : getServerAddresses().length
      ? getServerAddresses()
      : ["localhost"];
    for (const host of dashboardHosts) {
      console.log(`  dashboard:     http://${host}:${config.webPort}${config.basePath}`);
    }
    for (const host of ingestHosts()) {
      console.log(`  rtmp ingest:   ${ingestUrl(host)}?key=<api-key>`);
      if (rtmpsEnabled()) {
        console.log(`  rtmps ingest:  ${ingestUrlSecure(host)}?key=<api-key>  (preferred)`);
      }
    }
    console.log("  stream key:    <destination stream key>");
    if (!rtmpsEnabled()) {
      console.log("  (plain rtmp sends the api key in the clear; see RTMPS_PORT/RTMPS_KEY/RTMPS_CERT)");
    }
    if (!config.publicHost) {
      console.log("  (set PUBLIC_HOST to the address encoders should use, e.g. stream.example.com)");
    }
  });

  const shutdown = (signal: string) => {
    console.log(`[server] ${signal} received, shutting down`);
    try {
      saveSync();
    } catch (err) {
      console.error("[server] final database flush failed:", (err as Error).message);
    }
    shutdownRtmp();
    server.close(() => process.exit(0));
    const force = setTimeout(() => process.exit(0), 5000);
    force.unref?.();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main();
