import { ChildProcess, spawn } from "child_process";
import { config } from "../config";

export type RelayState = "starting" | "running" | "retrying" | "stopped" | "failed";

export interface RelayStatus {
  state: RelayState;
  /** Destination with the stream key masked — safe to render in the dashboard. */
  target: string;
  restarts: number;
  startedAt: Date;
  lastError: string | null;
}

interface Relay {
  sessionId: string;
  source: string;
  destination: string;
  maskedDestination: string;
  child: ChildProcess | null;
  state: RelayState;
  restarts: number;
  startedAt: Date;
  lastError: string | null;
  retryTimer: NodeJS.Timeout | null;
  stopping: boolean;
}

const MAX_RESTARTS = 10;
const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 15000;

const relays = new Map<string, Relay>();

/** Hides everything after the last path segment, which is where stream keys live. */
export function maskDestination(url: string): string {
  return url.replace(/\/([^/?#]{5,})(\?[^#]*)?$/, (_m, key: string) => {
    return `/${key.slice(0, 4)}${"*".repeat(Math.max(4, key.length - 4))}`;
  });
}

export function startRelay(sessionId: string, sourcePath: string, destination: string): void {
  stopRelay(sessionId);

  const relay: Relay = {
    sessionId,
    source: `rtmp://127.0.0.1:${config.rtmpPort}${sourcePath}`,
    destination,
    maskedDestination: maskDestination(destination),
    child: null,
    state: "starting",
    restarts: 0,
    startedAt: new Date(),
    lastError: null,
    retryTimer: null,
    stopping: false,
  };
  relays.set(sessionId, relay);
  spawnFfmpeg(relay);
}

export function stopRelay(sessionId: string): void {
  const relay = relays.get(sessionId);
  if (!relay) return;

  relay.stopping = true;
  relay.state = "stopped";
  if (relay.retryTimer) {
    clearTimeout(relay.retryTimer);
    relay.retryTimer = null;
  }
  if (relay.child && relay.child.exitCode === null) {
    relay.child.kill("SIGTERM");
    // ffmpeg occasionally ignores SIGTERM while flushing; make sure it goes away.
    const child = relay.child;
    const hardKill = setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
    }, 3000);
    hardKill.unref?.();
  }
  relays.delete(sessionId);
}

export function relayStatus(sessionId: string): RelayStatus | null {
  const relay = relays.get(sessionId);
  if (!relay) return null;
  return {
    state: relay.state,
    target: relay.maskedDestination,
    restarts: relay.restarts,
    startedAt: relay.startedAt,
    lastError: relay.lastError,
  };
}

export function stopAllRelays(): void {
  for (const sessionId of [...relays.keys()]) stopRelay(sessionId);
}

function spawnFfmpeg(relay: Relay): void {
  const args = [
    "-hide_banner",
    "-nostdin",
    "-loglevel",
    "warning",
    "-i",
    relay.source,
    "-c",
    "copy",
    "-f",
    "flv",
    relay.destination,
  ];

  let child: ChildProcess;
  try {
    child = spawn(config.ffmpegPath, args, { stdio: ["ignore", "ignore", "pipe"] });
  } catch (err) {
    relay.state = "failed";
    relay.lastError = `could not start ffmpeg: ${(err as Error).message}`;
    console.error(`[relay ${relay.sessionId}] ${relay.lastError}`);
    return;
  }

  relay.child = child;
  relay.state = "running";
  console.log(`[relay ${relay.sessionId}] ${relay.source} -> ${relay.maskedDestination}`);

  child.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString().trim();
    if (!text) return;
    relay.lastError = text.split("\n").slice(-1)[0].slice(0, 300);
    console.warn(`[relay ${relay.sessionId}] ${relay.lastError}`);
  });

  child.on("error", (err) => {
    relay.lastError = err.message;
    console.error(`[relay ${relay.sessionId}] ffmpeg error: ${err.message}`);
  });

  child.on("exit", (code, signal) => {
    if (relay.stopping || !relays.has(relay.sessionId)) return;

    if (relay.restarts >= MAX_RESTARTS) {
      relay.state = "failed";
      relay.lastError = relay.lastError ?? `ffmpeg exited (${code ?? signal})`;
      console.error(`[relay ${relay.sessionId}] giving up after ${MAX_RESTARTS} restarts`);
      return;
    }

    relay.restarts += 1;
    relay.state = "retrying";
    const delay = Math.min(RETRY_BASE_MS * 2 ** (relay.restarts - 1), RETRY_MAX_MS);
    console.warn(
      `[relay ${relay.sessionId}] ffmpeg exited (${code ?? signal}); retry ${relay.restarts} in ${delay}ms`
    );
    relay.retryTimer = setTimeout(() => {
      relay.retryTimer = null;
      if (!relay.stopping && relays.has(relay.sessionId)) spawnFfmpeg(relay);
    }, delay);
  });
}
