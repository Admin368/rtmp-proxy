import express from "express";
import fs from "fs";
import http from "http";
import { config } from "./config";
import { startRtmpServer, shutdownRtmp } from "./rtmp/server";
import { ensureCreatorAccount } from "./services/users";
import { databasePath, saveSync } from "./store/db";
import { createRouter, getServerAddresses } from "./web/routes";

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
    const addresses = getServerAddresses();
    console.log("RTMP proxy is running.");
    console.log(`  accounts database: ${databasePath}`);
    for (const addr of addresses.length ? addresses : ["localhost"]) {
      console.log(`  dashboard:     http://${addr}:${config.webPort}`);
      console.log(`  rtmp ingest:   rtmp://${addr}:${config.rtmpPort}/${config.rtmpApp}`);
    }
    console.log("  stream key:    <stream-name>?key=<api-key>");
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
