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

let nms: NodeMediaServer | null = null;

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

export function startRtmpServer(): NodeMediaServer {
  const nmsConfig = {
    logType: 2,
    rtmp: {
      port: config.rtmpPort,
      chunk_size: 60000,
      gop_cache: true,
      ping: 30,
      ping_timeout: 60,
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

    const presented = firstString(args, ["key", "token", "apikey", "api_key"]);
    const lookup = resolveKey(presented);

    if (lookup === "missing") return reject("no API key supplied");
    if (lookup === "unknown") return reject("API key not recognised");
    if (lookup === "key-disabled") return reject("API key is paused");
    if (lookup === "user-disabled") return reject("account is disabled");
    if (lookup === "orphaned") return reject("API key has no owner");

    const { key, user } = lookup;

    // Strip the credential so it cannot leak into logs or any downstream URL built from args.
    for (const field of ["key", "token", "apikey", "api_key"]) delete args[field];

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

function firstString(args: Record<string, unknown>, fields: string[]): string | undefined {
  for (const field of fields) {
    const value = args[field];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (Array.isArray(value) && typeof value[0] === "string") return String(value[0]).trim();
  }
  return undefined;
}
