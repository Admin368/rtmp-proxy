# Assessment: what changed in `v2`, and where `v3` should branch from

Written while starting the v3 work. Compares commit `a189e12` (tip of `v2`) with `84abbb6` (tip of `main`).

## TL;DR

**`v2` is finished, coherent, and strictly better than `main`. v3 was branched from `v2`.**

`v2` is not an abandoned experiment. It is five commits of small, self-contained hardening — richer
session tracking, a readable status page, and a modern Docker build. Nothing in it is half-written:
no TODOs, no dead code paths, no partially-migrated abstractions. Every change on `v2` is something
v3 would have had to redo anyway.

---

## The diff in numbers

```
 .dockerignore |   1 -
 Dockerfile    |  42 ++++--
 dist/index.js | 159 +++++++++++++++---   (build output, tracked in git)
 package.json  |  10 +-
 src/index.ts  | 185 ++++++++++++++++----
 yarn.lock     | 418 +++++++++++++++++++++++++++-----------------------
```

Only three files matter: `src/index.ts`, `Dockerfile`, `package.json`. `dist/index.js` is compiled
output that happens to be committed, and `yarn.lock` is churn from the dependency pinning.

## Commit by commit

| Commit | What it actually did |
| --- | --- |
| `cb5574d` … `87d60e9` | Housekeeping only: pin Node, node-media-server and TypeScript versions so builds stop drifting. |
| `e4aa1fc` "Enhance Node Media Server with session management and improved web interface" | The real change. See below. |
| `696df4e` "Refine server status page and add network interface discovery" | Adds `getServerAddresses()`, prints every non-internal IPv4 interface at boot and on the status page. Binds the web server to `0.0.0.0` instead of the default. |
| `c460a61` / `aa7967e` / `a189e12` | Dockerfile rewrite (see below). |

### 1. Session tracking (`src/index.ts`)

`main` tracked sessions as `{ id, streamPath, args }` and never expired them. `v2` extends the record
with `startTime` and `lastPing`, and adds a reaper on a 30 s interval that drops any session idle for
more than 60 s.

```ts
interface Session { id; streamPath; args; startTime: Date; lastPing: Date }
```

This exists because `donePublish` is not guaranteed to fire when a publisher disappears rudely
(cable pulled, laptop sleeps). Without the reaper the status page accumulates phantom streams
forever. It is a genuine bug fix.

Caveat worth knowing: `lastPing` is only refreshed from the **`postPlay`** event, which fires when a
*viewer* starts playing — not from the publisher's own traffic. So a publisher that streams for two
hours with nobody watching is still reaped after 60 s of wall clock, and disappears from the status
list while the stream is very much alive. **v3 fixes this** by driving liveness from the actual RTMP
session state rather than from a guess.

### 2. Status page

`main` served a bare `<ul>` with the stream path truncated to 10 characters (`slice(0, 10) + '***'`)
because the stream name *is* the YouTube stream key in this design, and it is a secret. `v2` replaced
it with a styled card layout showing per-stream start time, last activity and computed duration —
and, notably, **stopped truncating the stream path**, so the page now prints full YouTube stream keys
to anyone who can reach port 4000. That is the one regression in `v2`, and it is precisely the
problem the v3 login/roles work removes.

`v2` also adds `GET /health` returning `{ status, activeStreams, uptime }`.

### 3. Dockerfile

`main` built on `node:16`, ran `npm install --production`, `apt-get install ffmpeg`, and copied a
**pre-built `dist/`** from the developer's machine — so the image only matched the source if you
remembered to run `tsc` and commit the output.

`v2` replaced it with a two-stage build:

- **builder**: `node:20-alpine`, `yarn install --frozen-lockfile`, `yarn build` from `src/`
- **runtime**: `node:20-alpine`, `apk add ffmpeg`, production deps only, `yarn cache clean`

Source is now compiled inside the image, ffmpeg comes from Alpine's package index instead of a large
apt layer, and the image is much smaller. `a189e12` adds `COPY media ./media` because `mediaroot`
points there and node-media-server expects the directory to exist.

**One likely-broken detail.** Both stages run `yarn install --frozen-lockfile`, but the only copy
step before it is `COPY package*.json ./`, which does not match `yarn.lock`. With no lockfile in the
build context, `--frozen-lockfile` is an error ("Your lockfile needs to be updated"), so `docker
build` on `v2` should fail at that step. Nothing else in `v2` depends on it, and the last three
commits are all Dockerfile edits, which is consistent with the image never having been rebuilt
successfully after the final change. v3 copies `yarn.lock` explicitly in both stages. This was
reasoned from the Dockerfile and yarn's documented behaviour — Docker was not available on the
machine where this was written, so it has not been confirmed by an actual build.

### 4. Dependency pinning

`package.json` moved from `^4.21.0` style ranges to exact versions for `express`,
`node-media-server` and the `@types/*` packages. Combined with `--frozen-lockfile` in the Dockerfile
this makes the build reproducible. Deliberate and correct.

---

## Was `v2` stable, and was the work finished?

Yes on both counts, with one asterisk.

- **Finished**: every commit is a complete thought. No stubs, no commented-out blocks, no
  `throw new Error("not implemented")`, no config keys read but never written.
- **Stable**: the RTMP path, the relay push to YouTube and the ffmpeg discovery logic are
  byte-for-byte identical to `main`. `v2` only touched observability and packaging, so it cannot have
  broken streaming relative to `main`.
- **Asterisk**: the two flaws above — the idle reaper keyed off the wrong event, and the status page
  leaking full stream keys. Neither is a "the work wasn't done" signal; they are ordinary bugs, and
  both are fixed in v3.

## Why v3 branches from `v2`, not `main`

1. `main`'s Dockerfile ships a stale `dist/` that is never rebuilt from source. Basing v3 on it would
   mean redoing the multi-stage build as step one.
2. `main` is on Node 16, which is long past end of life.
3. `main`'s dependency ranges are unpinned; `v2` already fixed that.
4. The session-expiry idea in `v2` is the right one — v3 keeps the concept and corrects its trigger.
5. There is no divergence to untangle: `v2` is a linear fast-forward from `main`, so there are no
   conflicting decisions to reconcile and nothing on `main` that `v2` lacks.

Merging `v2` into `main`, before or after v3 lands, is safe and is recommended.

---

## Inherited behaviour v3 has to respect

Notes for anyone reading the v3 code, because these are non-obvious and were never written down.

### The stream name is the YouTube stream key

The relay config declares a **static push task**:

```ts
relay: { tasks: [{ app: "live", mode: "push", edge: "rtmp://a.rtmp.youtube.com/live2", name: "proxy" }] }
```

Inside node-media-server, `NodeRelayServer.onPostPublish()` finds a push task whose `app` matches and
builds the outbound URL as `` `${conf.edge}/${stream}` ``, where `stream` is the name the client
published under. So publishing to `rtmp://your-server:4001/live/ABCD-1234-EFGH` forwards to
`rtmp://a.rtmp.youtube.com/live2/ABCD-1234-EFGH`. The `name: "proxy"` field is ignored for `push`
mode; it only applies to `static` pulls.

**Consequence:** in v1/v2 the stream key is both the destination *and* the only thing resembling a
credential — and anyone who knows your server address can publish to it with any key they like, or
read yours off the unauthenticated status page. That is the hole v3's API keys close.

### Query arguments leak into the outbound URL

Same function, a few lines later:

```js
if (Object.keys(args).length > 0) { conf.ouPath += '?' + querystring.encode(args); }
```

Anything after `?` in the OBS stream key is appended verbatim to the URL handed to YouTube. This is a
trap for the obvious v3 design (`live/<name>?key=<apikey>`): the API key would be forwarded straight
to YouTube's ingest. v3 therefore **does not use the static relay task at all**, and manages its own
ffmpeg relay processes instead — which also buys per-key destinations and the ability to actually
stop a relay when an operator kills a session.

### `reject()` inside `prePublish` is the supported auth hook

`NodeRtmpSession.onPublish()` emits `prePublish` and then immediately checks
`if (!this.isStarting) return;`. `session.reject()` calls `stop()`, which clears `isStarting`. So
rejecting inside a `prePublish` listener aborts the publish before any relay or player is wired up.
v3's API-key check is exactly this.

### Ports

`4000` web/dashboard, `4001` RTMP ingest, `4002` node-media-server's own HTTP-FLV server. All three
are published in `docker-compose.yml`.
