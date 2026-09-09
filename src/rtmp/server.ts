import fs from "fs";
import NodeMediaServer from "node-media-server";
import { config } from "../config";
import { markKeyUsed, resolveKey } from "../services/apiKeys";
import { db } from "../store/db";
import { relayStatus, RelayStatus, startRelay, stopAllRelays, stopRelay } from "./relay";

/** The parts of node-media-server's internal session object this file relies on. */
interface RtmpSessionLike {
  id: string;
  ip?: string;
  isLocal?: boolean;
  isStarting?: boolean;
  isPublishing?: boolean;
  bitrate?: number;
  videoCodecName?: string;
  videoWidth?: number;
  videoHeight?: number;
  videoFps?: number;
  audioCodecName?: string;
  audioSamplerate?: number;
  reject(): void;
}

export interface LiveStream {
  id: string;
  app: string;
  /** Raw publish name. In passthrough mode this is the destination stream key, so never render it. */
  name: string;
  streamPath: string;
  userId: string;
  username: string;
  apiKeyId: string;
  keyLabel: string;
  startedAt: Date;
  remoteAddress: string;
  destination: string;
}

export interface LiveStreamView {
  id: string;
  app: string;
  maskedName: string;
  username: string;
  userId: string;
  keyLabel: string;
  keyId: string;
  startedAt: string;
  durationSeconds: number;
  remoteAddress: string;
  bitrateKbps: number;
  video: string;
  audio: string;
  relay: (Omit<RelayStatus, "startedAt"> & { startedAt: string }) | null;
}

const streams = new Map<string, LiveStream>();

/** Query fields an API key is accepted under, on the server URL or the stream key. */
const CREDENTIAL_FIELDS = ["key", "token", "apikey", "api_key"];

/** API keys captured from the connect command, by session id, until that session ends. */
const connectCredentials = new Map<string, string>();

let nms: NodeMediaServer | null = null;

/**
 * node-media-server's bundled types declare every event as (id, streamPath, args), but the
 * connect-lifecycle events deliver (id, cmdObj). Subscribe to those through here rather than
 * casting at each call site.
 */
function onConnectEvent(
  server: NodeMediaServer,
  event: "preConnect" | "postConnect" | "doneConnect",
  listener: (id: string, cmdObj: Record<string, unknown>) => void
): void {
  type Loose = (event: string, listener: (...args: never[]) => void) => void;
  (server.on as unknown as Loose)(event, listener as (...args: never[]) => void);
}

function session(id: string): RtmpSessionLike | undefined {
  if (!nms) return undefined;
  return nms.getSession(id) as unknown as RtmpSessionLike | undefined;
}

/** Shows enough of a stream key to recognise it without disclosing it. */
export function maskName(name: string): string {
  if (name.length <= 4) return "*".repeat(name.length);
  return `${name.slice(0, 4)}${"*".repeat(Math.min(12, name.length - 4))}`;
}

function destinationFor(
  key: { destinationUrl: string | null; destinationKey: string | null },
  publishName: string
): string {
  const base = key.destinationUrl ?? db.settings.defaultRelayEdge;
  // No explicit destination key means the legacy passthrough contract: whatever the client
  // published under is the stream key at the far end.
  const streamKey = key.destinationKey ?? publishName;
  return `${base.replace(/\/+$/, "")}/${streamKey}`;
}

/**
 * Resolves the TLS config for rtmps:// ingest, or null when it is off or unusable.
 * Checks the files here rather than letting node-media-server swallow the read error, so a
 * misconfigured certificate is a loud startup warning instead of a silently missing listener.
 */
function resolveTlsConfig(): { key: string; cert: string; port: number } | null {
  if (config.rtmpsPort <= 0) return null;
  if (!config.rtmpsKeyPath || !config.rtmpsCertPath) {
    console.warn("[rtmp] RTMPS_PORT is set but RTMPS_KEY/RTMPS_CERT are not; rtmps is off");
    return null;
  }
  for (const file of [config.rtmpsKeyPath, config.rtmpsCertPath]) {
    try {
      fs.accessSync(file, fs.constants.R_OK);
    } catch {
      console.warn(`[rtmp] cannot read ${file}; rtmps is off`);
      return null;
    }
  }
  return { key: config.rtmpsKeyPath, cert: config.rtmpsCertPath, port: config.rtmpsPort };
}

export function startRtmpServer(): NodeMediaServer {
  const ssl = resolveTlsConfig();
  const nmsConfig = {
    logType: 2,
    rtmp: {
      port: config.rtmpPort,
      chunk_size: 60000,
      gop_cache: true,
      ping: 30,
      ping_timeout: 60,
      ...(ssl ? { ssl } : {}),
    },
    http: {
      port: config.mediaHttpPort,
      allow_origin: "*",
      mediaroot: config.mediaRoot,
    },
    // No `relay` block on purpose. node-media-server's static push task appends the publisher's
    // query string to the outbound URL, which would forward the API key to YouTube, and it cannot
    // pick a destination per key. relay.ts drives ffmpeg directly instead.
  };

  nms = new NodeMediaServer(nmsConfig);

  /**
   * v4: the API key arrives on the Server URL, i.e. the `app` of the connect command —
   * `rtmp://host:4001/live?key=ABC`. That frees the stream key field to hold the
   * destination's own key, which a streamer can then change without a dashboard visit.
   *
   * This runs before node-media-server reads `cmdObj.app` into `appname`, so it is also the
   * only chance to strip the credential out. That matters twice over: `appname` is used to
   * build every stream path, and node-media-server logs the entire connect object.
   */
  onConnectEvent(nms, "preConnect", (id, cmdObj) => {
    const app = typeof cmdObj.app === "string" ? cmdObj.app : "";
    const queryAt = app.indexOf("?");
    if (queryAt < 0) return;

    const params = new URLSearchParams(app.slice(queryAt + 1));
    const secret = firstParam(params, CREDENTIAL_FIELDS);
    if (secret) connectCredentials.set(id, secret);

    // Scrub every field the credential could have reached. Do this whether or not we found a
    // recognised field, so a stray query never ends up in a stream path or a log line.
    cmdObj.app = app.slice(0, queryAt);
    for (const field of ["tcUrl", "swfUrl", "pageUrl"]) {
      const value = cmdObj[field];
      if (typeof value === "string") cmdObj[field] = stripQuery(value);
    }
  });

  onConnectEvent(nms, "doneConnect", (id) => {
    connectCredentials.delete(id);
  });

  nms.on("prePublish", (id: string, streamPath: string, rawArgs: object) => {
    const args = rawArgs as Record<string, unknown>;
    const rtmpSession = session(id);
    const reject = (reason: string) => {
      console.warn(`[rtmp] refused publish id=${id} path=${maskPath(streamPath)} — ${reason}`);
      rtmpSession?.reject();
    };

    const { app, name } = splitStreamPath(streamPath);
    if (!name) return reject("no stream name");
    if (app !== config.rtmpApp) return reject(`unknown application "${app}"`);

    // Server URL first (v4), stream key second (the v1-v3 form, still accepted).
    const fromConnect = connectCredentials.get(id);
    const presented = fromConnect ?? firstString(args, CREDENTIAL_FIELDS);
    const lookup = resolveKey(presented);

    if (lookup === "missing") {
      return reject("no API key supplied on the server URL or the stream key");
    }
    if (lookup === "unknown") return reject("API key not recognised");
    if (lookup === "key-disabled") return reject("API key is paused");
    if (lookup === "user-disabled") return reject("account is disabled");
    if (lookup === "orphaned") return reject("API key has no owner");

    const { key, user } = lookup;

    // Strip the credential so it cannot leak into logs or any downstream URL built from args.
    for (const field of CREDENTIAL_FIELDS) delete args[field];

    markKeyUsed(key);
    streams.set(id, {
      id,
      app,
      name,
      streamPath,
      userId: user.id,
      username: user.username,
      apiKeyId: key.id,
      keyLabel: key.label,
      startedAt: new Date(),
      remoteAddress: rtmpSession?.ip ?? "unknown",
      destination: destinationFor(key, name),
    });
    console.log(
      `[rtmp] accepted publish id=${id} user=${user.username} key=${key.label} path=${maskPath(streamPath)}`
    );
  });

  nms.on("postPublish", (id: string) => {
    const stream = streams.get(id);
    if (!stream) return;
    startRelay(id, stream.streamPath, stream.destination);
  });

  nms.on("donePublish", (id: string) => {
    if (!streams.has(id)) return;
    console.log(`[rtmp] publish ended id=${id}`);
    stopRelay(id);
    streams.delete(id);
  });

  nms.on("prePlay", (id: string, streamPath: string) => {
    const rtmpSession = session(id);
    if (config.allowRemotePlayback || rtmpSession?.isLocal) return;
    console.warn(`[rtmp] refused playback id=${id} path=${maskPath(streamPath)} — remote playback is off`);
    rtmpSession?.reject();
  });

  nms.run();

  // node-media-server installs its own SIGINT handler inside run() that calls process.exit()
  // immediately. Drop it so index.ts can flush the database and stop relays first.
  process.removeAllListeners("SIGINT");

  // v2 expired sessions on a timer keyed off `postPlay`, which meant a publisher with no viewers
  // vanished from the dashboard after 60s. Reconcile against the real RTMP sessions instead.
  const sweep = setInterval(() => {
    for (const [id] of streams) {
      const live = session(id);
      if (!live || live.isStarting === false) {
        console.log(`[rtmp] reaping dead session id=${id}`);
        stopRelay(id);
        streams.delete(id);
      }
    }
  }, config.sessionSweepIntervalMs);
  sweep.unref?.();

  return nms;
}

export function listStreams(): LiveStream[] {
  return [...streams.values()];
}

export function findStream(id: string): LiveStream | undefined {
  return streams.get(id);
}

export function describeStreams(filterUserId?: string): LiveStreamView[] {
  const now = Date.now();
  return [...streams.values()]
    .filter((stream) => !filterUserId || stream.userId === filterUserId)
    .map((stream) => {
      const live = session(stream.id);
      const status = relayStatus(stream.id);
      return {
        id: stream.id,
        app: stream.app,
        maskedName: maskName(stream.name),
        username: stream.username,
        userId: stream.userId,
        keyLabel: stream.keyLabel,
        keyId: stream.apiKeyId,
        startedAt: stream.startedAt.toISOString(),
        durationSeconds: Math.round((now - stream.startedAt.getTime()) / 1000),
        remoteAddress: stream.remoteAddress,
        // node-media-server computes bits/millisecond, which is already kbps.
        bitrateKbps: Math.round(live?.bitrate ?? 0),
        video: live?.videoCodecName
          ? `${live.videoCodecName} ${live.videoWidth ?? 0}x${live.videoHeight ?? 0} @ ${live.videoFps ?? 0}fps`
          : "—",
        audio: live?.audioCodecName
          ? `${live.audioCodecName} ${live.audioSamplerate ?? 0}Hz`
          : "—",
        relay: status ? { ...status, startedAt: status.startedAt.toISOString() } : null,
      };
    })
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

/** Drops a live publisher and its relay. Returns false if the stream had already ended. */
export function killStream(id: string): boolean {
  const stream = streams.get(id);
  if (!stream) return false;
  stopRelay(id);
  streams.delete(id);
  session(id)?.reject();
  console.log(`[rtmp] killed session id=${id} user=${stream.username}`);
  return true;
}

/** Used when a key is paused or deleted: nothing streaming on it should survive. */
export function killStreamsForKey(keyId: string): number {
  let killed = 0;
  for (const stream of [...streams.values()]) {
    if (stream.apiKeyId === keyId && killStream(stream.id)) killed += 1;
  }
  return killed;
}

export function killStreamsForUser(userId: string): number {
  let killed = 0;
  for (const stream of [...streams.values()]) {
    if (stream.userId === userId && killStream(stream.id)) killed += 1;
  }
  return killed;
}

export function shutdownRtmp(): void {
  stopAllRelays();
  nms?.stop();
}

function splitStreamPath(streamPath: string): { app: string; name: string } {
  const parts = streamPath.split("/").filter(Boolean);
  return { app: parts[0] ?? "", name: parts.slice(1).join("/") };
}

function maskPath(streamPath: string): string {
  const { app, name } = splitStreamPath(streamPath);
  return `/${app}/${maskName(name)}`;
}

function stripQuery(value: string): string {
  const at = value.indexOf("?");
  return at < 0 ? value : value.slice(0, at);
}

function firstParam(params: URLSearchParams, fields: string[]): string | undefined {
  for (const field of fields) {
    const value = params.get(field);
    if (value && value.trim()) return value.trim();
  }
  return undefined;
}

function firstString(args: Record<string, unknown>, fields: string[]): string | undefined {
  for (const field of fields) {
    const value = args[field];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (Array.isArray(value) && typeof value[0] === "string") return String(value[0]).trim();
  }
  return undefined;
}
