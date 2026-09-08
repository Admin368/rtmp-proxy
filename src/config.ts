import os from "os";
import path from "path";

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return /^(1|true|yes|on)$/i.test(raw);
}

const isWindows = os.platform() === "win32";

export const config = {
  webPort: envInt("WEB_PORT", 4000),
  rtmpPort: envInt("RTMP_PORT", 4001),
  mediaHttpPort: envInt("MEDIA_HTTP_PORT", 4002),

  /** Directory holding db.json. Mount this as a volume or every restart wipes the accounts. */
  dataDir: process.env.DATA_DIR || path.join(process.cwd(), "data"),
  mediaRoot: process.env.MEDIA_ROOT || path.join(process.cwd(), "media"),

  ffmpegPath: process.env.FFMPEG_PATH || (isWindows ? "./ffmpeg.exe" : "/usr/bin/ffmpeg"),

  /** Where a stream is forwarded when an API key does not name its own destination. */
  defaultRelayEdge: process.env.DEFAULT_RELAY_EDGE || "rtmp://a.rtmp.youtube.com/live2",

  /** RTMP application name publishers use: rtmp://host:4001/<app>/<stream> */
  rtmpApp: process.env.RTMP_APP || "live",

  defaultKeyQuota: envInt("DEFAULT_KEY_QUOTA", 2),

  /** Bootstrap credentials for the single `creator` account, used only on first run. */
  creatorUsername: process.env.CREATOR_USERNAME || "creator",
  creatorPassword: process.env.CREATOR_PASSWORD || "",

  sessionSecret: process.env.SESSION_SECRET || "",
  sessionTtlHours: envInt("SESSION_TTL_HOURS", 12),
  /** Set when the dashboard is served over HTTPS so the cookie gets the Secure flag. */
  secureCookies: envBool("SECURE_COOKIES", false),

  /** Allow non-loopback clients to *play* streams back off this server. Off by default: this is a
   *  forwarding proxy, not a CDN, and playback would expose the incoming feed to anyone. */
  allowRemotePlayback: envBool("ALLOW_REMOTE_PLAYBACK", false),

  /** How often the live-stream registry is reconciled against real RTMP sessions, in ms. */
  sessionSweepIntervalMs: envInt("SESSION_SWEEP_INTERVAL_MS", 5000),
} as const;

export type AppConfig = typeof config;
