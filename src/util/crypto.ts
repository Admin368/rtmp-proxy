import crypto from "crypto";

const SCRYPT_KEYLEN = 64;

export function randomId(bytes = 12): string {
  return crypto.randomBytes(bytes).toString("hex");
}

export function randomSecret(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function hashPassword(password: string): { hash: string; salt: string } {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString("hex");
  return { hash, salt };
}

export function verifyPassword(password: string, hash: string, salt: string): boolean {
  let derived: Buffer;
  try {
    derived = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
  } catch {
    return false;
  }
  const expected = Buffer.from(hash, "hex");
  if (expected.length !== derived.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

/** Constant-time compare of two hex digests of equal expected length. */
export function safeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length === 0 || bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function hmac(secret: string, value: string): string {
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

/**
 * Stream keys are shown to the user once and pasted into OBS, so they need to survive a
 * copy/paste round trip: base32-ish alphabet, no look-alike characters, grouped for readability.
 */
export function generateApiKey(): string {
  // 32 characters exactly, so `byte % length` is unbiased. I/L/O omitted as look-alikes.
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ0123456789";
  const groups: string[] = [];
  for (let g = 0; g < 6; g++) {
    let group = "";
    const bytes = crypto.randomBytes(5);
    for (const byte of bytes) group += alphabet[byte % alphabet.length];
    groups.push(group);
  }
  return groups.join("-");
}
