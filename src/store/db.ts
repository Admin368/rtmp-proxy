import fs from "fs";
import path from "path";
import { config } from "../config";
import { randomSecret } from "../util/crypto";
import type { Database } from "./types";

const DB_VERSION = 3;

const dbPath = path.join(config.dataDir, "db.json");
const tmpPath = `${dbPath}.tmp`;

function emptyDatabase(): Database {
  return {
    version: DB_VERSION,
    secret: config.sessionSecret || randomSecret(),
    settings: {
      defaultKeyQuota: config.defaultKeyQuota,
      defaultRelayEdge: config.defaultRelayEdge,
    },
    users: [],
    apiKeys: [],
  };
}

function load(): Database {
  fs.mkdirSync(config.dataDir, { recursive: true });
  if (!fs.existsSync(dbPath)) return emptyDatabase();

  let parsed: Partial<Database>;
  try {
    parsed = JSON.parse(fs.readFileSync(dbPath, "utf8")) as Partial<Database>;
  } catch (err) {
    // Refuse to start rather than silently handing out a blank database and re-bootstrapping
    // a creator account with a fresh password.
    throw new Error(`Could not parse ${dbPath}: ${(err as Error).message}`);
  }

  const base = emptyDatabase();
  // Stored settings normally win, because they can be changed at runtime. An environment
  // variable given explicitly wins over the stored value, though — otherwise changing
  // DEFAULT_RELAY_EDGE on an existing deployment does nothing and says nothing about why.
  const settings = { ...base.settings, ...(parsed.settings ?? {}) };
  if (config.explicitlySet.defaultRelayEdge) {
    if (settings.defaultRelayEdge !== config.defaultRelayEdge) {
      console.log(
        `[db] DEFAULT_RELAY_EDGE overrides the stored default: ` +
          `${settings.defaultRelayEdge} -> ${config.defaultRelayEdge}`
      );
    }
    settings.defaultRelayEdge = config.defaultRelayEdge;
  }
  if (config.explicitlySet.defaultKeyQuota) {
    settings.defaultKeyQuota = config.defaultKeyQuota;
  }

  return {
    version: DB_VERSION,
    secret: config.sessionSecret || parsed.secret || base.secret,
    settings,
    users: parsed.users ?? [],
    apiKeys: parsed.apiKeys ?? [],
  };
}

export const db: Database = load();

let pending: NodeJS.Timeout | null = null;

function writeNow(): void {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.writeFileSync(tmpPath, JSON.stringify(db, null, 2), "utf8");
  fs.renameSync(tmpPath, dbPath); // atomic, so a crash mid-write cannot truncate the database
}

/** Coalesces bursts of writes (e.g. lastUsedAt updates) into one flush. */
export function save(): void {
  if (pending) return;
  pending = setTimeout(() => {
    pending = null;
    try {
      writeNow();
    } catch (err) {
      console.error("[db] write failed:", (err as Error).message);
    }
  }, 50);
  pending.unref?.();
}

/** Flush synchronously — used before an intentional process exit. */
export function saveSync(): void {
  if (pending) {
    clearTimeout(pending);
    pending = null;
  }
  writeNow();
}

export const databasePath = dbPath;
