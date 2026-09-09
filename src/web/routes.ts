import express, { NextFunction, Request, Response, Router } from "express";
import { config } from "../config";
import {
  createKeyForUser,
  deleteKey,
  findKeyById,
  listKeys,
  listKeysForUser,
  rotateKey,
  setKeyDisabled,
} from "../services/apiKeys";
import { requestRestart } from "../services/restart";
import {
  canManageRoles,
  canManageUsers,
  canRestartServer,
  canSeeEverything,
  createUser,
  deleteUser,
  findUserById,
  listUsers,
  authenticate,
  setDisabled,
  setKeyQuota,
  setPassword,
  setRestartPermission,
  setRole,
} from "../services/users";
import {
  COOKIE_NAME,
  clearCookieHeader,
  cookieHeader,
  issueToken,
  parseCookies,
  readToken,
} from "../services/webSessions";
import { describeStreams, findStream, killStream, killStreamsForKey, killStreamsForUser } from "../rtmp/server";
import type { Role, User } from "../store/types";
import { stashFlash, takeFlash } from "./flash";
import { renderDashboard, renderLogin, streamRows } from "./views";
import { getServerAddresses, ingestHosts, serverUrlWithKey, u } from "./urls";

export { getServerAddresses };

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

export function createRouter(): Router {
  const router = Router();
  router.use(express.urlencoded({ extended: false, limit: "32kb" }));
  router.use(attachUser);
  router.use(rejectCrossSiteWrites);

  // ---------------------------------------------------------------- public

  router.get("/health", (_req, res) => {
    res.json({ status: "healthy", activeStreams: describeStreams().length, uptime: process.uptime() });
  });

  router.get("/login", (req, res) => {
    if (req.user) return res.redirect(u("/"));
    res.type("html").send(renderLogin());
  });

  router.post("/login", (req, res) => {
    const username = String(req.body?.username ?? "");
    const password = String(req.body?.password ?? "");
    const user = authenticate(username, password);
    if (!user) {
      res.status(401).type("html").send(renderLogin({ error: "Wrong username or password.", username }));
      return;
    }
    res.setHeader("Set-Cookie", cookieHeader(issueToken(user)));
    res.redirect(u("/"));
  });

  router.post("/logout", (_req, res) => {
    res.setHeader("Set-Cookie", clearCookieHeader());
    res.redirect(u("/login"));
  });

  // -------------------------------------------------------------- dashboard

  router.get("/", requireAuth, (req, res) => {
    const user = req.user!;
    const everything = canSeeEverything(user);
    res.type("html").send(
      renderDashboard({
        user,
        flash: takeFlash(req.query.m),
        streams: describeStreams(everything ? undefined : user.id),
        keys: listKeysForUser(user.id),
        users: canManageUsers(user) ? listUsers() : [],
        allKeys: everything ? listKeys() : [],
        serverAddresses: ingestHosts(),
        uptimeSeconds: process.uptime(),
      })
    );
  });

  router.get("/api/streams/rows", requireAuth, (req, res) => {
    const user = req.user!;
    const streams = describeStreams(canSeeEverything(user) ? undefined : user.id);
    res.json({ rows: streamRows(streams), count: streams.length });
  });

  router.get("/api/status", requireAuth, (req, res) => {
    const user = req.user!;
    res.json({
      uptime: process.uptime(),
      rtmpPort: config.rtmpPort,
      app: config.rtmpApp,
      streams: describeStreams(canSeeEverything(user) ? undefined : user.id),
    });
  });

  // ---------------------------------------------------------------- streams

  router.post("/streams/:id/kill", requireAuth, (req, res) => {
    const user = req.user!;
    const stream = findStream(req.params.id);
    if (!stream) return done(res, "error", "That stream is no longer active.");
    if (stream.userId !== user.id && !canSeeEverything(user)) {
      return done(res, "error", "You can only stop your own streams.");
    }
    killStream(stream.id);
    done(res, "ok", "Stream stopped.");
  });

  // ------------------------------------------------------------------- keys

  router.post("/keys", requireAuth, (req, res) => {
    const user = req.user!;
    try {
      const created = createKeyForUser(user, {
        label: str(req.body?.label),
        destinationUrl: str(req.body?.destinationUrl) || null,
        destinationKey: str(req.body?.destinationKey) || null,
      });
      const token = stashFlash({
        kind: "secret",
        message: `API key "${created.record.label}" created.`,
        secret: {
          key: created.secret,
          serverUrl: serverUrlWithKey(ingestHosts()[0], created.secret),
          streamKey: created.record.destinationKey ? "any name you like" : "<your destination stream key>",
          streamKeyIsFixed: !!created.record.destinationKey,
        },
      });
      res.redirect(u(`/?m=${token}`));
    } catch (err) {
      done(res, "error", (err as Error).message);
    }
  });

  router.post("/keys/:id/pause", requireAuth, (req, res) => {
    withKey(req, res, { adminMayAct: true }, (key) => {
      setKeyDisabled(key, true);
      const dropped = killStreamsForKey(key.id);
      done(res, "ok", dropped ? `Key paused; ${dropped} stream(s) dropped.` : "Key paused.");
    });
  });

  router.post("/keys/:id/resume", requireAuth, (req, res) => {
    withKey(req, res, { adminMayAct: true }, (key) => {
      setKeyDisabled(key, false);
      done(res, "ok", "Key resumed.");
    });
  });

  router.post("/keys/:id/rotate", requireAuth, (req, res) => {
    withKey(req, res, { adminMayAct: false }, (key) => {
      const secret = rotateKey(key);
      killStreamsForKey(key.id);
      const token = stashFlash({
        kind: "secret",
        message: `API key "${key.label}" rotated.`,
        secret: {
          key: secret,
          serverUrl: serverUrlWithKey(ingestHosts()[0], secret),
          streamKey: key.destinationKey ? "any name you like" : "<your destination stream key>",
          streamKeyIsFixed: !!key.destinationKey,
        },
      });
      res.redirect(u(`/?m=${token}`));
    });
  });

  router.post("/keys/:id/delete", requireAuth, (req, res) => {
    withKey(req, res, { adminMayAct: false }, (key) => {
      killStreamsForKey(key.id);
      deleteKey(key);
      done(res, "ok", "Key deleted.");
    });
  });

  // ------------------------------------------------------------------ users

  router.post("/users", requireAuth, (req, res) => {
    const actor = req.user!;
    if (!canManageUsers(actor)) return done(res, "error", "Not allowed.");
    const requested = str(req.body?.role) as Role;
    // Admins can only mint plain users; handing out the admin role is the creator's call.
    const role: Role = canManageRoles(actor) && (requested === "admin" || requested === "user")
      ? requested
      : "user";
    try {
      const created = createUser({ username: str(req.body?.username), password: str(req.body?.password), role });
      done(res, "ok", `Account "${created.username}" created.`);
    } catch (err) {
      done(res, "error", (err as Error).message);
    }
  });

  router.post("/users/:id/role", requireAuth, (req, res) => {
    withUser(req, res, { creatorOnly: true }, (target) => {
      const role = str(req.body?.role) as Role;
      if (role !== "admin" && role !== "user") return done(res, "error", "Unknown role.");
      setRole(target, role);
      done(res, "ok", `${target.username} is now ${role}.`);
    });
  });

  router.post("/users/:id/quota", requireAuth, (req, res) => {
    withUser(req, res, { creatorOnly: true }, (target) => {
      const raw = str(req.body?.quota);
      const quota = raw === "" ? null : Number.parseInt(raw, 10);
      if (quota !== null && Number.isNaN(quota)) return done(res, "error", "Quota must be a number.");
      setKeyQuota(target, quota);
      done(res, "ok", `${target.username} may hold ${quota ?? "the default number of"} API keys.`);
    });
  });

  router.post("/users/:id/restart-permission", requireAuth, (req, res) => {
    withUser(req, res, { creatorOnly: true }, (target) => {
      const allowed = str(req.body?.allowed) === "1";
      setRestartPermission(target, allowed);
      done(res, "ok", `${target.username} ${allowed ? "may" : "may no longer"} restart the server.`);
    });
  });

  router.post("/users/:id/disable", requireAuth, (req, res) => {
    withUser(req, res, {}, (target) => {
      setDisabled(target, true);
      const dropped = killStreamsForUser(target.id);
      done(res, "ok", dropped ? `${target.username} disabled; ${dropped} stream(s) dropped.` : `${target.username} disabled.`);
    });
  });

  router.post("/users/:id/enable", requireAuth, (req, res) => {
    withUser(req, res, {}, (target) => {
      setDisabled(target, false);
      done(res, "ok", `${target.username} enabled.`);
    });
  });

  router.post("/users/:id/delete", requireAuth, (req, res) => {
    withUser(req, res, { creatorOnly: true }, (target) => {
      killStreamsForUser(target.id);
      deleteUser(target);
      done(res, "ok", `${target.username} deleted.`);
    });
  });

  router.post("/users/:id/password", requireAuth, (req, res) => {
    const actor = req.user!;
    const target = findUserById(req.params.id);
    if (!target) return done(res, "error", "No such account.");
    const isSelf = target.id === actor.id;
    if (!isSelf && !mayAdminister(actor, target)) return done(res, "error", "Not allowed.");
    try {
      setPassword(target, str(req.body?.password));
      if (isSelf) {
        // The password change retired this cookie; hand out a fresh one so the user stays signed in.
        res.setHeader("Set-Cookie", cookieHeader(issueToken(target)));
      }
      done(res, "ok", `Password updated for ${target.username}.`);
    } catch (err) {
      done(res, "error", (err as Error).message);
    }
  });

  // ----------------------------------------------------------------- server

  router.post("/server/restart", requireAuth, (req, res) => {
    const user = req.user!;
    if (!canRestartServer(user)) return done(res, "error", "You are not allowed to restart the server.");
    const token = stashFlash({
      kind: "ok",
      message: "Restarting. This page will come back in a few seconds.",
    });
    res.redirect(u(`/?m=${token}`));
    requestRestart(user.username);
  });

  return router;
}

// ------------------------------------------------------------------ helpers

function attachUser(req: Request, _res: Response, next: NextFunction): void {
  const cookies = parseCookies(req.headers.cookie);
  const user = readToken(cookies[COOKIE_NAME]);
  if (user) req.user = user;
  next();
}

/**
 * SameSite=Lax already blocks the cookie on cross-site POSTs; this is the belt to SameSite's braces,
 * and it also covers same-site-but-different-origin cases.
 */
function rejectCrossSiteWrites(req: Request, res: Response, next: NextFunction): void {
  if (req.method !== "POST") return next();
  const origin = req.headers.origin;
  if (!origin) return next(); // form posts from the same origin often omit it
  try {
    if (new URL(origin).host !== req.headers.host) {
      res.status(403).send("Cross-origin request refused.");
      return;
    }
  } catch {
    res.status(403).send("Cross-origin request refused.");
    return;
  }
  next();
}

function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.user) return next();
  if (req.method === "GET") return void res.redirect(u("/login"));
  res.status(401).send("Sign in first.");
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function done(res: Response, kind: "ok" | "error", message: string): void {
  res.redirect(u(`/?m=${stashFlash({ kind, message })}`));
}

function withKey(
  req: Request,
  res: Response,
  options: { adminMayAct: boolean },
  action: (key: NonNullable<ReturnType<typeof findKeyById>>) => void
): void {
  const actor = req.user!;
  const key = findKeyById(req.params.id);
  if (!key) return done(res, "error", "No such API key.");
  const owned = key.userId === actor.id;
  if (!owned && !(options.adminMayAct && canSeeEverything(actor))) {
    return done(res, "error", "That API key belongs to another account.");
  }
  try {
    action(key);
  } catch (err) {
    done(res, "error", (err as Error).message);
  }
}

function withUser(
  req: Request,
  res: Response,
  options: { creatorOnly?: boolean },
  action: (target: User) => void
): void {
  const actor = req.user!;
  const target = findUserById(req.params.id);
  if (!target) return done(res, "error", "No such account.");
  if (options.creatorOnly && !canManageRoles(actor)) {
    return done(res, "error", "Only the creator account can do that.");
  }
  if (!options.creatorOnly && !mayAdminister(actor, target)) {
    return done(res, "error", "Not allowed.");
  }
  try {
    action(target);
  } catch (err) {
    done(res, "error", (err as Error).message);
  }
}

/** The creator may act on anyone; an admin only on plain users, never on themselves. */
function mayAdminister(actor: User, target: User): boolean {
  if (actor.id === target.id) return false;
  if (actor.role === "creator") return true;
  return actor.role === "admin" && target.role === "user";
}
