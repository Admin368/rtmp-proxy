import { config } from "../config";
import { db, save } from "../store/db";
import type { Role, User } from "../store/types";
import { generateApiKey, hashPassword, randomId, verifyPassword } from "../util/crypto";

export const ROLES: Role[] = ["creator", "admin", "user"];

export function listUsers(): User[] {
  return db.users;
}

export function findUserById(id: string): User | undefined {
  return db.users.find((u) => u.id === id);
}

export function findUserByName(username: string): User | undefined {
  const needle = username.trim().toLowerCase();
  return db.users.find((u) => u.username.toLowerCase() === needle);
}

export function creatorAccount(): User | undefined {
  return db.users.find((u) => u.role === "creator");
}

export interface CreateUserInput {
  username: string;
  password: string;
  role: Role;
  keyQuota?: number | null;
  canRestartServer?: boolean;
}

export function createUser(input: CreateUserInput): User {
  const username = input.username.trim();
  if (!/^[a-zA-Z0-9._-]{3,32}$/.test(username)) {
    throw new Error("Username must be 3-32 characters: letters, digits, dot, underscore or hyphen.");
  }
  if (findUserByName(username)) throw new Error("That username is already taken.");
  assertPasswordAcceptable(input.password);

  const { hash, salt } = hashPassword(input.password);
  const user: User = {
    id: randomId(),
    username,
    passwordHash: hash,
    passwordSalt: salt,
    role: input.role,
    keyQuota: input.keyQuota ?? null,
    canRestartServer: input.canRestartServer ?? false,
    disabled: false,
    tokenVersion: 1,
    createdAt: new Date().toISOString(),
    lastLoginAt: null,
  };
  db.users.push(user);
  save();
  return user;
}

export function assertPasswordAcceptable(password: string): void {
  if (typeof password !== "string" || password.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }
}

export function authenticate(username: string, password: string): User | null {
  const user = findUserByName(username);
  if (!user) {
    // Spend comparable time on a miss so the response time does not reveal which names exist.
    verifyPassword(password, "00".repeat(64), "0".repeat(32));
    return null;
  }
  if (user.disabled) return null;
  if (!verifyPassword(password, user.passwordHash, user.passwordSalt)) return null;
  user.lastLoginAt = new Date().toISOString();
  save();
  return user;
}

export function setPassword(user: User, password: string): void {
  assertPasswordAcceptable(password);
  const { hash, salt } = hashPassword(password);
  user.passwordHash = hash;
  user.passwordSalt = salt;
  user.tokenVersion += 1; // invalidate existing login cookies
  save();
}

export function setRole(user: User, role: Role): void {
  if (user.role === "creator") throw new Error("The creator account's role cannot be changed.");
  if (role === "creator") throw new Error("There can only be one creator account.");
  user.role = role;
  save();
}

export function setDisabled(user: User, disabled: boolean): void {
  if (user.role === "creator") throw new Error("The creator account cannot be disabled.");
  user.disabled = disabled;
  if (disabled) user.tokenVersion += 1;
  save();
}

export function setKeyQuota(user: User, quota: number | null): void {
  if (quota !== null && (!Number.isInteger(quota) || quota < 0 || quota > 100)) {
    throw new Error("Key quota must be a whole number between 0 and 100, or blank to inherit.");
  }
  user.keyQuota = quota;
  save();
}

export function setRestartPermission(user: User, allowed: boolean): void {
  user.canRestartServer = allowed;
  save();
}

export function effectiveKeyQuota(user: User): number {
  if (user.role === "creator") return Number.POSITIVE_INFINITY;
  return user.keyQuota ?? db.settings.defaultKeyQuota;
}

export function canRestartServer(user: User): boolean {
  return user.role === "creator" || user.role === "admin" || user.canRestartServer;
}

/** Admins and the creator see every stream and every key; plain users see only their own. */
export function canSeeEverything(user: User): boolean {
  return user.role === "creator" || user.role === "admin";
}

export function canManageUsers(user: User): boolean {
  return user.role === "creator" || user.role === "admin";
}

/** Only the creator hands out roles, quotas and the restart permission. */
export function canManageRoles(user: User): boolean {
  return user.role === "creator";
}

export function deleteUser(user: User): void {
  if (user.role === "creator") throw new Error("The creator account cannot be deleted.");
  db.users = db.users.filter((u) => u.id !== user.id);
  db.apiKeys = db.apiKeys.filter((k) => k.userId !== user.id);
  save();
}

/**
 * First run: make sure a creator account exists. Uses CREATOR_PASSWORD when supplied, otherwise
 * generates one and prints it — once — to the container log.
 */
export function ensureCreatorAccount(): void {
  if (creatorAccount()) return;

  const password = config.creatorPassword || generateApiKey();
  const user = createUser({
    username: config.creatorUsername,
    password,
    role: "creator",
    keyQuota: null,
    canRestartServer: true,
  });

  console.log("");
  console.log("  ┌──────────────────────────────────────────────────────────┐");
  console.log("  │  Created the initial creator account                     │");
  console.log("  └──────────────────────────────────────────────────────────┘");
  console.log(`     username: ${user.username}`);
  if (config.creatorPassword) {
    console.log("     password: (from CREATOR_PASSWORD)");
  } else {
    console.log(`     password: ${password}`);
    console.log("     This is shown only once. Sign in and change it.");
  }
  console.log("");
}
