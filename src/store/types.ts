export type Role = "creator" | "admin" | "user";

export interface User {
  id: string;
  username: string;
  passwordHash: string;
  passwordSalt: string;
  role: Role;
  /** null means "inherit settings.defaultKeyQuota". */
  keyQuota: number | null;
  /** Grants the restart button to a plain user. Creators and admins always have it. */
  canRestartServer: boolean;
  disabled: boolean;
  /** Bumped on password change / disable so existing login cookies stop validating. */
  tokenVersion: number;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface ApiKey {
  id: string;
  userId: string;
  label: string;
  /** First few characters of the key, so the UI can identify it after the secret is gone. */
  prefix: string;
  /** SHA-256 of the full key. The key itself is shown once at creation and never stored. */
  hash: string;
  /** "Paused": the key stays but cannot start streams, and live streams using it are dropped. */
  disabled: boolean;
  createdAt: string;
  lastUsedAt: string | null;
  /** RTMP base URL to forward to, e.g. rtmp://a.rtmp.youtube.com/live2. Null = server default. */
  destinationUrl: string | null;
  /** Stream key at the destination. Null = use the name the client published under. */
  destinationKey: string | null;
}

export interface Settings {
  defaultKeyQuota: number;
  defaultRelayEdge: string;
}

export interface Database {
  version: number;
  /** HMAC secret for login cookies. Generated on first run unless SESSION_SECRET is set. */
  secret: string;
  settings: Settings;
  users: User[];
  apiKeys: ApiKey[];
}
