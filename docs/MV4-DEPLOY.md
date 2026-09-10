# Deploying rtmp-proxy to mv4

Handoff for a session that has done work in this repo and now needs to ship it to the server
and verify it. Written 2026-09-09 against the live state of the box.

**Read [Before you deploy anything](#before-you-deploy-anything) first.** There is a real
blocker between this working copy and the server, and `git pull` on mv4 will *silently do
nothing useful* until it is resolved.

---

## 1. Getting SSH access

| | |
|---|---|
| SSH alias | `mv4` (already in `~/.ssh/config`) |
| Real address | `main.maravian.com:2222`, user `root`, reports itself as `live.maravian.com` |
| Key | `C:\Users\SouthPaul\.ssh\mv4-ssh-key` — **passphrase-protected** |
| App directory | `/root/docker/rtmp-proxy` |
| Docker | 28.5.1, Compose v2.40.1 |

The key's passphrase is only ever typed by the user. **Do not ask for the key or the
passphrase, and do not accept them if offered** — anything pasted into a chat is in the
transcript for good. You don't need them: an ssh-agent is already running with the key
unlocked, on a fixed socket any session on this machine can borrow.

```bash
export SSH_AUTH_SOCK=/tmp/mwc-agent.sock && ssh -o BatchMode=yes mv4 'echo ok'
```

Prints `ok` → you're in.

Two things that catch people:

- **Export `SSH_AUTH_SOCK` in the same Bash call as the `ssh`.** Shell state does not persist
  between tool calls, so it has to be on the same line, every time.
- **Keep `-o BatchMode=yes`.** Without it, a dead agent leaves `ssh` sitting at a passphrase
  prompt with nobody to answer, and the call hangs until it times out.

If the check fails, the agent has died (it does not survive a reboot). Ask the user to run this
themselves — they will be prompted for the passphrase:

```bash
eval "$(ssh-agent -a /tmp/mwc-agent.sock)" && ssh-add ~/.ssh/mv4-ssh-key
```

If the socket file exists but is dead, they need `rm -f /tmp/mwc-agent.sock` first.

---

## 2. This is a shared production box

mv4 also runs n8n, portainer, homepage, img-proxy, hbbs/hbbr, watchtower, shadowbox,
maravian-photo-uploader and the Maravian fulfilment server. Scope every command to
`/root/docker/rtmp-proxy`.

- **Never** `docker system prune`, `docker image prune -a`, `docker volume prune`, or any bare
  `docker rm`/`rmi` sweep. Other people's containers are on this daemon.
- **Never** `docker compose down -v`.
- **Do not touch nginx** or any other service's config.
- Ports **4000–4002 are published on 0.0.0.0** — this service is reachable from the internet.
  A broken deploy is publicly broken, so verify before walking away.
- Watchtower runs with `--label-enable` and ignores these containers; they only change when you
  deploy.

Current state: container `rtmp-proxy-rtmp-proxy-1`, image built **9 months ago**, up 2 months,
running `a189e12` on branch **`v2`**.

---

## 3. Before you deploy anything

The obvious plan — "ssh in, `git pull`, rebuild" — **does not work here**, for two independent
reasons. Both need sorting before anything else.

### 3a. The server is on a different remote

| | Repository | Branch | HEAD |
|---|---|---|---|
| This PC | `github.com/Admin368/main.git` | `v3.2` | `6e96b83` |
| mv4 | `github.com/Admin368/rtmp-proxy.git` | `v2` | `a189e12` |

They share history — mv4's `a189e12` is exactly this repo's local `v2` head — so it is the same
project, just two remotes. But a `git pull` on mv4 fetches from `rtmp-proxy.git`, which knows
nothing about the newer work.

### 3b. The new work has never been pushed

Local branch `v3.2` has **no upstream**, and `origin` (`main.git`) only has `main`, `v1` and
`v2`. `v3`, `v3.1` and `v3.2` exist nowhere but this machine. Nothing to pull, from either
remote.

### Resolve it

**This is the user's call — ask, don't assume.** The two sensible routes:

1. **Push `v3.2` to `main.git` and repoint mv4** (recommended — `main.git` is clearly the
   current canonical repo, and `rtmp-proxy.git` has been stale for 9 months):

   ```bash
   git push -u origin v3.2
   ```

   then on the server, change `origin` to `main.git` and check out `v3.2`.

2. **Push `v3.2` to `rtmp-proxy.git`** instead, leaving mv4's remote alone, and check it out
   there. Fewer moving parts on the server, but it leaves the project split across two remotes.

Either way the deploy is a **branch change** (`v2` → `v3.2`), not a fast-forward — say so
plainly when reporting, because it is a much bigger jump than "pull the latest".

Also note: mv4 has an untracked `bun.lock` in the working tree, and `v3.2` moved the project to
**pnpm** (`packageManager: pnpm@11.25.0`, Node 24). Stale `bun.lock` / `yarn.lock` / `node_modules`
will be lying around on the server after the switch. They are inert — the image builds
dependencies inside Docker — but don't let them confuse you into thinking the checkout is dirty
in a meaningful way.

---

## 4. Deploying

Once the branch is actually reachable from the server:

```bash
export SSH_AUTH_SOCK=/tmp/mwc-agent.sock && ssh -o BatchMode=yes mv4 'cd /root/docker/rtmp-proxy && git fetch --all && git checkout v3.2 && git pull && git log --oneline -1'
```

Then rebuild. **`--build` is not optional** — `docker compose up -d` alone will happily restart
the 9-month-old image and look like it worked:

```bash
export SSH_AUTH_SOCK=/tmp/mwc-agent.sock && ssh -o BatchMode=yes mv4 'cd /root/docker/rtmp-proxy && docker compose up -d --build'
```

The Dockerfile is a multi-stage `node:24-alpine` build that `apk add`s ffmpeg into the runtime
stage, so the first build after this jump will be slow and will pull new base layers.

---

## 5. Verifying on the server

```bash
export SSH_AUTH_SOCK=/tmp/mwc-agent.sock && ssh -o BatchMode=yes mv4 'cd /root/docker/rtmp-proxy && docker compose ps && docker compose logs --tail=60'
```

Expect the container `Up` with a fresh `CREATED` time and ports 4000–4002 bound. Then confirm
ffmpeg actually exists in the new image at the path the code expects:

```bash
export SSH_AUTH_SOCK=/tmp/mwc-agent.sock && ssh -o BatchMode=yes mv4 'cd /root/docker/rtmp-proxy && docker compose exec -T rtmp-proxy /usr/bin/ffmpeg -version | head -1'
```

That path is not incidental — see below.

---

## 6. Testing locally against the bundled ffmpeg

`src/config.ts:28` resolves the binary like this:

```ts
ffmpegPath: process.env.FFMPEG_PATH || (isWindows ? "./ffmpeg.exe" : "/usr/bin/ffmpeg"),
```

So there are two different ffmpeg binaries in play, and each environment only ever exercises
one of them:

- **On this PC (Windows):** the 47 MB `ffmpeg.exe` committed at the repo root. This is the
  "existing ffmpeg executable in the local folder" the changes need to keep working with.
- **In the container (Linux):** `/usr/bin/ffmpeg` from `apk add ffmpeg`. `ffmpeg.exe` is a
  Windows binary and is dead weight inside the image.

A change that only works against one of them will pass in one place and fail in the other, and
`relay.ts` respawns ffmpeg on exit, so a bad spawn shows up as a restart loop in the logs rather
than a clean crash.

Local run (Node 24 and pnpm 11.25.0 are both already on PATH here):

```bash
cd C:\_GITHUB\_DOCKER\rtmp && pnpm run typecheck && pnpm run dev
```

`dev` is `tsc && node dist/index.js`. Note `pnpm test` is still the npm placeholder that exits
1 — there is no test suite, so verification here means driving a real relay and watching the
ffmpeg process, not running tests.

---

## 7. Rolling back

The old image is still on the host. Fastest route back:

```bash
export SSH_AUTH_SOCK=/tmp/mwc-agent.sock && ssh -o BatchMode=yes mv4 'cd /root/docker/rtmp-proxy && git checkout v2 && docker compose up -d --build'
```

---

## 8. Reporting back

Say explicitly: which remote and branch the server ended up on, the commit it is running, that
the image was actually rebuilt (not just restarted), and the ffmpeg version inside the new
image. If the branch question in §3 was decided for you rather than by the user, flag that too.
