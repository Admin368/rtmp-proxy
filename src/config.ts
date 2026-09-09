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

/**
 * Normalises a mount point into "" or "/prefix" — no trailing slash, one leading slash.
 * "/4000/", "4000" and "/4000" all become "/4000".
 */
function normaliseBasePath(raw: string | undefined): string {
  const trimmed = (raw ?? "").trim().replace(/\/+$/, "");
  if (!trimmed || trimmed === "/") return "";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
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

  /**
   * Where a stream is forwarded when an API key does not name its own destination.
   * Defaults to YouTube over TLS: the outbound leg carries the destination's stream key, and
   * plain rtmp:// would send it in the clear across the public internet.
   */
  defaultRelayEdge: process.env.DEFAULT_RELAY_EDGE || "rtmps://a.rtmp.youtube.com/live2",

  /** RTMP application name publishers use: rtmp://host:4001/<app>/<stream> */
  rtmpApp: process.env.RTMP_APP || "live",

  /**
   * RTMPS (RTMP over TLS) ingest. Plain RTMP sends the whole connect handshake in the clear,
   * including the API key on the Server URL, so anyone on the network path can read it.
   * Set all three to also listen for rtmps://; 0 or blank leaves it off.
   * node-media-server reads the certificate once at startup, so renewals need a restart.
   */
  rtmpsPort: envInt("RTMPS_PORT", 0),
  rtmpsKeyPath: (process.env.RTMPS_KEY || "").trim(),
  rtmpsCertPath: (process.env.RTMPS_CERT || "").trim(),

  /**
   * Path the dashboard is mounted under by a reverse proxy, e.g. "/4000" for an nginx
   *   location /4000/ { proxy_pass http://localhost:4000/; }
   * The trailing slash on proxy_pass strips the prefix before it reaches us, so the app
   * would otherwise emit root-absolute links ("/login") that escape the mount point.
   * Empty means mounted at the root, which is the default.
   */
  basePath: normaliseBasePath(process.env.BASE_PATH),

  /**
   * Hostname encoders should use to reach the RTMP port, e.g. "stream.example.com".
   * Needed because the interfaces this process can see are the container's, not the ones
   * clients can route to. Empty falls back to discovering local addresses.
   */
  publicHost: (process.env.PUBLIC_HOST || "").trim().replace(/^\w+:\/\//, "").replace(/\/.*$/, ""),

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

  /**
   * Which of the persisted settings were given explicitly in the environment.
   *
   * settings.* is written to db.json on first run and then read back in preference to the
   * environment, so without this an operator changing DEFAULT_RELAY_EDGE on an existing
   * deployment would see no effect at all and no explanation why.
   */
  explicitlySet: {
    defaultRelayEdge: isProvided("DEFAULT_RELAY_EDGE"),
    defaultKeyQuota: isProvided("DEFAULT_KEY_QUOTA"),
  },
} as const;

function isProvided(name: string): boolean {
  const raw = process.env[name];
  return typeof raw === "string" && raw.trim() !== "";
}

export type AppConfig = typeof config;
