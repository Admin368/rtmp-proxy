import { config } from "../config";
import { db } from "../store/db";
import type { User } from "../store/types";
import { hmac } from "../util/crypto";
import { findUserById } from "./users";

export const COOKIE_NAME = "rtmp_sid";

interface TokenPayload {
  uid: string;
  tv: number;
  exp: number;
}

export function issueToken(user: User): string {
  const payload: TokenPayload = {
    uid: user.id,
    tv: user.tokenVersion,
    exp: Date.now() + config.sessionTtlHours * 3600_000,
  };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${hmac(db.secret, body)}`;
}

export function readToken(token: string | undefined): User | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;

  const body = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (hmac(db.secret, body) !== signature) return null;

  let payload: TokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as TokenPayload;
  } catch {
    return null;
  }

  if (!payload || typeof payload.uid !== "string") return null;
  if (!payload.exp || payload.exp < Date.now()) return null;

  const user = findUserById(payload.uid);
  if (!user || user.disabled) return null;
  // A password change or an account being disabled bumps tokenVersion, retiring old cookies.
  if (user.tokenVersion !== payload.tv) return null;

  return user;
}

export function cookieHeader(token: string): string {
  const maxAge = config.sessionTtlHours * 3600;
  const parts = [
    `${COOKIE_NAME}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  if (config.secureCookies) parts.push("Secure");
  return parts.join("; ");
}

export function clearCookieHeader(): string {
  const parts = [`${COOKIE_NAME}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (config.secureCookies) parts.push("Secure");
  return parts.join("; ");
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (!name) continue;
    const value = part.slice(eq + 1).trim();
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      out[name] = value; // a malformed cookie is not worth a 500
    }
  }
  return out;
}
