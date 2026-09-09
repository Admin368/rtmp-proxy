import { saveSync } from "../store/db";
import { shutdownRtmp } from "../rtmp/server";

/**
 * Non-zero so the exit is treated as a failure by every Docker restart policy, including
 * `on-failure`. With `restart: unless-stopped` (what docker-compose.yml uses) the container comes
 * straight back up. Overridable for environments that need a different signal.
 */
const EXIT_CODE = Number.parseInt(process.env.RESTART_EXIT_CODE || "1", 10) || 1;

let restarting = false;

/**
 * "Restart the server" means restarting this container, not the Docker daemon: we shut down
 * cleanly and let the container's restart policy bring us back. That needs no Docker socket
 * inside the container, so the app keeps zero host privileges.
 */
export function requestRestart(byUsername: string): void {
  if (restarting) return;
  restarting = true;

  console.log(`[server] restart requested by ${byUsername}; shutting down`);
  try {
    saveSync();
  } catch (err) {
    console.error("[server] final database flush failed:", (err as Error).message);
  }
  try {
    shutdownRtmp();
  } catch (err) {
    console.error("[server] rtmp shutdown failed:", (err as Error).message);
  }

  // Give the HTTP response time to reach the browser before the process goes away.
  const timer = setTimeout(() => process.exit(EXIT_CODE), 750);
  timer.unref?.();
}

export function isRestarting(): boolean {
  return restarting;
}
