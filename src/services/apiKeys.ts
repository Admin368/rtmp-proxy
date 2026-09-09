import { db, save } from "../store/db";
import type { ApiKey, User } from "../store/types";
import { generateApiKey, randomId, safeEqualHex, sha256 } from "../util/crypto";
import { effectiveKeyQuota, findUserById } from "./users";

export function listKeys(): ApiKey[] {
  return db.apiKeys;
}

export function listKeysForUser(userId: string): ApiKey[] {
  return db.apiKeys.filter((k) => k.userId === userId);
}

export function findKeyById(id: string): ApiKey | undefined {
  return db.apiKeys.find((k) => k.id === id);
}

export interface CreateKeyInput {
  label?: string;
  destinationUrl?: string | null;
  destinationKey?: string | null;
}

export interface CreatedKey {
  record: ApiKey;
  /** The plaintext key. Returned once, never stored. */
  secret: string;
}

export function createKeyForUser(user: User, input: CreateKeyInput = {}): CreatedKey {
  const existing = listKeysForUser(user.id).length;
  const quota = effectiveKeyQuota(user);
  if (existing >= quota) {
    throw new Error(
      `Key limit reached (${existing}/${quota}). Ask an administrator to raise your quota.`
    );
  }

  const secret = generateApiKey();
  const record: ApiKey = {
    id: randomId(),
    userId: user.id,
    label: (input.label || "").trim().slice(0, 60) || `key-${existing + 1}`,
    prefix: secret.slice(0, 5),
    hash: sha256(secret),
    disabled: false,
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
    destinationUrl: normaliseDestinationUrl(input.destinationUrl),
    destinationKey: normaliseDestinationKey(input.destinationKey),
  };
  db.apiKeys.push(record);
  save();
  return { record, secret };
}

/** Replaces the secret behind an existing key record, keeping its label and destination. */
export function rotateKey(record: ApiKey): string {
  const secret = generateApiKey();
  record.prefix = secret.slice(0, 5);
  record.hash = sha256(secret);
  record.lastUsedAt = null;
  save();
  return secret;
}

export function setKeyDisabled(record: ApiKey, disabled: boolean): void {
  record.disabled = disabled;
  save();
}

export function updateKeyDestination(
  record: ApiKey,
  destinationUrl: string | null | undefined,
  destinationKey: string | null | undefined
): void {
  record.destinationUrl = normaliseDestinationUrl(destinationUrl);
  record.destinationKey = normaliseDestinationKey(destinationKey);
  save();
}

export function renameKey(record: ApiKey, label: string): void {
  const trimmed = label.trim().slice(0, 60);
  if (!trimmed) throw new Error("A key needs a label.");
  record.label = trimmed;
  save();
}

export function deleteKey(record: ApiKey): void {
  db.apiKeys = db.apiKeys.filter((k) => k.id !== record.id);
  save();
}

export interface KeyLookup {
  key: ApiKey;
  user: User;
}

export type KeyRejection =
  | "missing"
  | "unknown"
  | "key-disabled"
  | "user-disabled"
  | "orphaned";

/**
 * Resolves the secret an RTMP client presented. Compares hashes in constant time so a caller
 * cannot learn a valid prefix by timing repeated attempts.
 */
export function resolveKey(secret: string | undefined): KeyLookup | KeyRejection {
  if (!secret || typeof secret !== "string") return "missing";

  const candidate = sha256(secret.trim());
  const key = db.apiKeys.find((k) => safeEqualHex(k.hash, candidate));
  if (!key) return "unknown";
  if (key.disabled) return "key-disabled";

  const user = findUserById(key.userId);
  if (!user) return "orphaned";
  if (user.disabled) return "user-disabled";

  return { key, user };
}

export function markKeyUsed(record: ApiKey): void {
  record.lastUsedAt = new Date().toISOString();
  save();
}

function normaliseDestinationUrl(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  if (!/^rtmps?:\/\/[^\s/]+\/\S*$/i.test(trimmed)) {
    throw new Error("Destination must look like rtmp://host/app (or rtmps://).");
  }
  return trimmed;
}

function normaliseDestinationKey(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/[\s?#]/.test(trimmed)) {
    throw new Error("Destination stream key cannot contain spaces, '?' or '#'.");
  }
  return trimmed;
}
