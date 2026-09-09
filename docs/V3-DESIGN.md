# v3 design notes

Why the v3 code is shaped the way it is. Read `docs/V2-ASSESSMENT.md` first for the inherited
behaviour this builds on.

## Layout

```
src/
  config.ts              environment variables, one place
  index.ts               bootstrap: db → creator account → RTMP → HTTP
  store/
    types.ts             User, ApiKey, Settings, Database
    db.ts                JSON file, atomic writes, coalesced flushes
  services/
    users.ts             accounts, roles, permission predicates
    apiKeys.ts           key issue / rotate / pause / resolve
    webSessions.ts       signed login cookies
    restart.ts           the restart button
  rtmp/
    server.ts            node-media-server wiring, auth hook, live registry
    relay.ts             ffmpeg child processes that push to the destination
  web/
    routes.ts            every HTTP route
    views.ts             server-rendered dashboard
    html.ts              escaping template tag
    styles.ts            one stylesheet
    flash.ts             one-shot messages across redirects
```

No new runtime dependencies: still just `express` and `node-media-server`. Password hashing, HMAC
cookies and key generation all come from node's `crypto`.

## Authentication on the RTMP connection

RTMP has no header to put a credential in. Every practical RTMP auth scheme therefore rides in the
stream name's query string, which is what node-media-server's own signed-URL support does. v3 uses
the same channel:

```
Server:     rtmp://host:4001/live
Stream Key: <stream-name>?key=<api-key>
```

The check lives in a `prePublish` listener (`src/rtmp/server.ts`). node-media-server emits
`prePublish` and then immediately returns if the session is no longer starting, so calling
`session.reject()` from the listener aborts the publish before a relay or any player is wired up.
This is the library's supported extension point, not a workaround.

Rejected reasons are logged and distinguished internally (missing / unknown / paused key / disabled
account) but the client only ever sees the connection close — RTMP has no useful error channel and
telling a prober which of those it hit would be a gift.

Key comparison is `sha256(presented)` against stored hashes, with `timingSafeEqual`. The plaintext
key is never stored.

### Why the credential is stripped from `args`

node-media-server's static relay task appends the publisher's query string to the outbound URL
verbatim. Left alone, `?key=<api-key>` would be forwarded to YouTube. The `prePublish` listener
deletes the credential fields from the `args` object — the same object the library holds — before
anything downstream can read it.

## Relaying

v3 does not use node-media-server's `relay` config at all. Three reasons:

1. A static push task has one hard-coded `edge`, so every key would forward to the same destination.
2. It appends the publisher's query string to the outbound URL (see above).
3. Its dynamic `relayPush` event registers the ffmpeg session under a fresh id, so `donePublish`
   never finds it and the ffmpeg process outlives the stream. Killing a session from the dashboard
   could not stop the forward.

`src/rtmp/relay.ts` spawns ffmpeg directly instead:

```
ffmpeg -i rtmp://127.0.0.1:4001/live/<name> -c copy -f flv <destination>
```

`-c copy` means no transcoding — the same passthrough behaviour as before, at negligible CPU cost.
Each relay is keyed by the publisher's RTMP session id, so stopping a stream stops its relay. If
ffmpeg exits while the publisher is still connected the relay is restarted with exponential backoff
(1s doubling to 15s, ten attempts), which covers a destination that drops the connection briefly.

Destination resolution, per API key:

| `destinationUrl` | `destinationKey` | Result |
| --- | --- | --- |
| unset | unset | `DEFAULT_RELAY_EDGE/<published name>` — the v1/v2 passthrough contract |
| unset | set | `DEFAULT_RELAY_EDGE/<destinationKey>` |
| set | set | `<destinationUrl>/<destinationKey>` |
| set | unset | `<destinationUrl>/<published name>` |

## Liveness

v2 reaped sessions that had not seen a `postPlay` event in 60 seconds, which fired on *viewers*, not
publishers — so a healthy publisher with no viewers vanished from the status page after a minute.

v3 reconciles its registry against node-media-server's real session table every 5 seconds: a tracked
stream whose RTMP session is gone (or has `isStarting === false`) is dropped and its relay stopped.
That is the actual signal, so there is no timeout to tune and no phantom entries.

## Roles

Three roles, and the permission logic lives in predicates in `services/users.ts`
(`canSeeEverything`, `canManageUsers`, `canManageRoles`, `canRestartServer`) rather than being
spelled out at each route. Routes call the predicates.

The important asymmetries:

- An admin may act on plain users, never on another admin, the creator, or themselves. `mayAdminister()`
  in `routes.ts` enforces this in one place.
- Only the creator hands out roles, key quotas and the restart permission.
- The creator cannot be demoted, disabled or deleted, so the server can never end up with nobody able
  to administer it.

Admins can pause and resume anyone's key — the incident-response action — but cannot rotate or
delete someone else's key, which would be a silent lockout rather than a visible one.

## Restarting

The button exits the process with a non-zero code after flushing the database and killing the
relays; Docker's restart policy starts it again. Mounting the Docker socket to restart the container
"properly" would hand the app root-equivalent control of the host, which is a bad trade for a button.

The consequence is documented in the README: the container needs a restart policy, or the button
stops the server rather than restarting it.

## Login sessions

Stateless signed cookies — `base64url(payload).hmac`, HttpOnly, SameSite=Lax — with the HMAC secret
stored in `db.json` (or supplied via `SESSION_SECRET`). Sessions therefore survive the restart
button, which matters because a restart with in-memory sessions would sign everyone out.

Each cookie carries the user's `tokenVersion`. Changing a password or disabling an account bumps it,
retiring every outstanding cookie for that user without any server-side session table.

POSTs additionally verify that `Origin`, when present, matches `Host`; `SameSite=Lax` already blocks
cross-site form posts, so this is defence in depth rather than the primary control.

## Dashboard

Server-rendered HTML, no build step, no client framework. State-changing actions are ordinary form
POSTs that redirect back — so they work without JavaScript — and the only script on the page polls
`/api/streams/rows` every three seconds to refresh the live-streams table.

All interpolation goes through the `html` tagged template in `web/html.ts`, which escapes by
default; `raw()` marks the few places that intentionally embed markup.

Freshly created key secrets are passed across the redirect through a short-lived server-side map
(`web/flash.ts`) keyed by an opaque token, so a secret never appears in the URL bar, browser history
or a `Referer` header.

## What is deliberately not here

- **No key recovery.** Keys are hashed; lost keys are rotated, not recovered.
- **No self-registration.** Accounts are created by an admin or the creator.
- **No transcoding, HLS or recording.** This is a forwarder. node-media-server's HTTP-FLV server is
  still on 4002 but playback from non-loopback clients is refused by default.
- **No external database.** One JSON file, atomically written. If this ever needs multi-instance
  deployment, that is the piece to replace.
