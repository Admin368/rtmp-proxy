# RTMP Proxy (v3)

An authenticated RTMP relay in a Docker container. Point OBS (or anything that speaks RTMP) at this
server, and it forwards the stream on to YouTube — or to any other RTMP ingest you configure.

v3 adds accounts, roles and API keys, so the server is no longer open to anyone who knows its
address.

## What's new in v3

- **API-key authentication on the RTMP connection.** No key, no publish.
- **User accounts with roles** — `creator`, `admin`, `user` — and a dashboard behind a login.
- **Per-account visibility.** Users see and stop their own streams; admins and the creator see all.
- **Pause / rotate / delete keys.** Pausing a key drops the stream using it, immediately.
- **Restart button** that restarts the container without needing the Docker socket.
- **Per-key destinations**, so one server can feed several YouTube channels (or Twitch, or an
  internal ingest).

`docs/V2-ASSESSMENT.md` records what changed on the `v2` branch and why v3 was branched from it.

## Quick start

```bash
docker compose up -d --build
docker compose logs rtmp-proxy | head -20   # prints the generated creator password once
```

Open `http://<server>:4000`, sign in as `creator`, and change the password.

To set the first password yourself instead, uncomment `CREATOR_PASSWORD` in `docker-compose.yml`
before the first run.

## Connecting OBS

In the dashboard, create an API key. You are shown the secret exactly once.

**Settings → Stream → Service: Custom…**

| Field | Value |
| --- | --- |
| Server | `rtmp://<server>:4001/live` |
| Stream Key | `<stream-name>?key=<your-api-key>` |

The API key rides along as a query argument on the stream name. This is the same mechanism
node-media-server itself uses for signed URLs, and every RTMP client that lets you type a stream key
supports it — OBS, ffmpeg, Streamlabs, hardware encoders.

What goes in `<stream-name>` depends on the key:

- **Key with no destination configured** (the default, and how v1/v2 behaved): `<stream-name>` must
  be the *YouTube stream key*. The stream is forwarded to `DEFAULT_RELAY_EDGE/<stream-name>`.
- **Key with a destination configured**: `<stream-name>` can be anything, e.g. `obs`. The stream is
  forwarded to the destination URL and stream key stored on the API key. Prefer this — the YouTube
  key then lives in the database instead of in every encoder's settings.

The server strips `?key=…` before building the outbound URL, so the API key is never forwarded to
YouTube.

## Roles

| | user | admin | creator |
| --- | :-: | :-: | :-: |
| Create / rotate / delete own API keys (within quota) | ✅ | ✅ | ✅ |
| See and stop own streams | ✅ | ✅ | ✅ |
| See and stop **all** streams | | ✅ | ✅ |
| Pause / resume **any** API key | | ✅ | ✅ |
| Add accounts | | ✅ (users only) | ✅ |
| Enable / disable accounts | | ✅ (users only) | ✅ |
| Restart the server | only if granted | ✅ | ✅ |
| Change roles, key quotas, restart permission | | | ✅ |
| Delete accounts | | | ✅ |

There is exactly one `creator`, created on first run. It cannot be demoted, disabled or deleted.

Default key quota is **2** per account (`DEFAULT_KEY_QUOTA`); the creator can override it per
account, and the creator itself is unlimited.

## The restart button

"Restart server" shuts this process down cleanly — flushing the database and stopping every relay —
and lets Docker's restart policy start it again. It does **not** need the Docker socket mounted, so
the container keeps zero host privileges.

It only works if the container has a restart policy. `docker-compose.yml` sets
`restart: unless-stopped`; if you run the image with plain `docker run`, add `--restart unless-stopped`
or the button becomes a stop button.

## Configuration

All optional. Defaults in brackets.

| Variable | Purpose |
| --- | --- |
| `WEB_PORT` [4000] | Dashboard port |
| `RTMP_PORT` [4001] | RTMP ingest port |
| `MEDIA_HTTP_PORT` [4002] | node-media-server's HTTP-FLV port |
| `DATA_DIR` [`/app/data`] | Where `db.json` lives — **mount this** |
| `RTMP_APP` [`live`] | Application segment of the ingest URL |
| `DEFAULT_RELAY_EDGE` [`rtmp://a.rtmp.youtube.com/live2`] | Fallback forwarding destination |
| `DEFAULT_KEY_QUOTA` [2] | API keys a new account may hold |
| `CREATOR_USERNAME` [`creator`] | First-run only |
| `CREATOR_PASSWORD` | First-run only; generated and logged if unset |
| `SESSION_SECRET` | Login-cookie HMAC key; generated and stored in `db.json` if unset |
| `SESSION_TTL_HOURS` [12] | Login lifetime |
| `SECURE_COOKIES` [false] | Set true behind HTTPS |
| `ALLOW_REMOTE_PLAYBACK` [false] | Let non-loopback clients *play* streams back off this server |
| `FFMPEG_PATH` | Defaults to `/usr/bin/ffmpeg`, or `./ffmpeg.exe` on Windows |
| `RESTART_EXIT_CODE` [1] | Exit code used by the restart button |

## Storage

Everything lives in one JSON file, `$DATA_DIR/db.json`, written atomically. There is no external
database to run.

- Passwords are hashed with scrypt and a per-user salt.
- API keys are stored as SHA-256 hashes. The secret is shown once at creation and cannot be
  recovered — rotate the key if it is lost.
- Losing this file means losing every account and key; the creator account is bootstrapped again on
  the next start.

## Ports

| Port | What |
| --- | --- |
| 4000 | Dashboard / `GET /health` |
| 4001 | RTMP ingest (this is the one you point OBS at) |
| 4002 | node-media-server HTTP-FLV |

Only 4000 and 4001 need to be reachable in a normal deployment.

## Local development

```bash
yarn install
yarn build && node dist/index.js
```

On Windows the bundled `ffmpeg.exe` in the repo root is used automatically.

## Security notes

- Playback is refused for non-loopback clients unless `ALLOW_REMOTE_PLAYBACK=true`. The relay's own
  ffmpeg reads from loopback, so it is unaffected.
- Stream names are masked in the dashboard and in logs, because in passthrough mode the stream name
  *is* the destination's stream key.
- Put the dashboard behind HTTPS (a reverse proxy is fine) and set `SECURE_COOKIES=true`. RTMP itself
  is unencrypted; use `rtmps://` destinations where the far end supports it.
