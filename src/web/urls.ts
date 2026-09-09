import os from "os";
import { config } from "../config";

/**
 * Prefixes an app-absolute path with the configured mount point.
 *
 * Every link, form action and redirect the app emits has to go through this. A reverse proxy
 * that strips a path prefix (nginx `location /4000/ { proxy_pass http://localhost:4000/; }`)
 * hands us the right path on the way in, but nothing rewrites the paths we hand back:
 * `Location: /login` is path-only, so `proxy_redirect default` leaves it alone and the browser
 * lands outside the mount point entirely.
 */
export function u(path: string): string {
  if (!config.basePath || !path.startsWith("/")) return path;
  return `${config.basePath}${path}`;
}

/** Non-internal IPv4 addresses of this host — the container's, when containerised. */
export function getServerAddresses(): string[] {
  const addresses: string[] = [];
  for (const iface of Object.values(os.networkInterfaces())) {
    for (const addr of iface ?? []) {
      if (addr.family === "IPv4" && !addr.internal) addresses.push(addr.address);
    }
  }
  return addresses;
}

/**
 * Hosts to advertise to encoders. PUBLIC_HOST wins outright: behind Docker or NAT the
 * addresses we can enumerate are ours, not ones a client can reach.
 */
export function ingestHosts(): string[] {
  if (config.publicHost) return [config.publicHost];
  const discovered = getServerAddresses();
  return discovered.length ? discovered : ["<server-address>"];
}

export function ingestUrl(host: string): string {
  return `rtmp://${host}:${config.rtmpPort}/${config.rtmpApp}`;
}

/** True when an rtmps:// listener is configured (see config.rtmpsPort). */
export function rtmpsEnabled(): boolean {
  return config.rtmpsPort > 0 && !!config.rtmpsKeyPath && !!config.rtmpsCertPath;
}

export function ingestUrlSecure(host: string): string {
  return `rtmps://${host}:${config.rtmpsPort}/${config.rtmpApp}`;
}

/**
 * The URL an encoder puts in its "Server" field. From v4 the API key rides here as a query
 * argument rather than on the stream key, so the stream key field is free to hold the
 * destination's own key and can be changed without touching the dashboard.
 */
export function serverUrlWithKey(host: string, secret: string): string {
  const base = rtmpsEnabled() ? ingestUrlSecure(host) : ingestUrl(host);
  return `${base}?key=${secret}`;
}
