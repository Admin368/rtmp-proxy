import { randomId } from "../util/crypto";
import type { Flash } from "./views";

/**
 * One-shot messages handed across a redirect. Kept server-side and keyed by an opaque token so a
 * freshly minted API key never lands in the URL bar, browser history or a referrer header.
 */
const pending = new Map<string, { flash: Flash; expires: number }>();
const TTL_MS = 60_000;

export function stashFlash(flash: Flash): string {
  sweep();
  const token = randomId(8);
  pending.set(token, { flash, expires: Date.now() + TTL_MS });
  return token;
}

export function takeFlash(token: unknown): Flash | null {
  sweep();
  if (typeof token !== "string") return null;
  const entry = pending.get(token);
  if (!entry) return null;
  pending.delete(token);
  return entry.flash;
}

function sweep(): void {
  const now = Date.now();
  for (const [token, entry] of pending) {
    if (entry.expires < now) pending.delete(token);
  }
}
