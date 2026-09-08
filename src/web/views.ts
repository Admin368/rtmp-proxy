import { config } from "../config";
import { db } from "../store/db";
import type { ApiKey, User } from "../store/types";
import type { LiveStreamView } from "../rtmp/server";
import {
  canManageRoles,
  canManageUsers,
  canRestartServer,
  canSeeEverything,
  effectiveKeyQuota,
} from "../services/users";
import { escapeHtml, html, joinHtml, raw } from "./html";
import { styles } from "./styles";

export interface Flash {
  kind: "ok" | "error" | "secret";
  message: string;
  secret?: { key: string; ingestUrl: string; streamKey: string };
}

function layout(title: string, body: string, script = ""): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>${escapeHtml(title)}</title>
<style>${styles}</style>
</head>
<body>${body}${script}</body>
</html>`;
}

function brand(): string {
  return html`<div class="brand"><span class="mark"></span>RTMP Proxy</div>`;
}

/** A read-only value with a copy button. The single biggest usability win on this page. */
function copyField(label: string, value: string): string {
  return html`
    <div class="copyfield">
      <div class="label">${label}</div>
      <div class="row">
        <div class="value" data-copy>${value}</div>
        <button type="button" class="copy" aria-label="Copy ${label}">Copy</button>
      </div>
    </div>
  `;
}

// ------------------------------------------------------------------- login

export function renderLogin(options: { error?: string; username?: string } = {}): string {
  const body = html`
    <div class="login">
      ${raw(brand())}
      <div class="card">
        <div class="body">
          ${options.error ? raw(html`<div class="notice error">${options.error}</div>`) : raw("")}
          <form method="post" action="/login">
            <label class="field"><span>Username</span>
              <input name="username" autocomplete="username" autofocus required
                     value="${options.username ?? ""}">
            </label>
            <label class="field"><span>Password</span>
              <input name="password" type="password" autocomplete="current-password" required>
            </label>
            <button class="primary" type="submit">Sign in</button>
          </form>
        </div>
      </div>
    </div>
  `;
  return layout("Sign in — RTMP Proxy", body);
}

// --------------------------------------------------------------- dashboard

export interface DashboardData {
  user: User;
  flash: Flash | null;
  streams: LiveStreamView[];
  keys: ApiKey[];
  users: User[];
  allKeys: ApiKey[];
  serverAddresses: string[];
  uptimeSeconds: number;
}

export function renderDashboard(data: DashboardData): string {
  const { user } = data;
  const cards = [connectionCard(data), streamsCard(data), keysCard(data)];
  if (canManageUsers(user)) cards.push(usersCard(data));
  if (canSeeEverything(user)) cards.push(allKeysCard(data));
  cards.push(metaCard(data));

  const body = html`
    <div class="topbar">
      <div class="inner">
        ${raw(brand())}
        <div class="who">
          <span class="name">${user.username}</span>
          <span class="chip">${user.role}</span>
          <form class="inline" method="post" action="/logout">
            <button class="ghost small" type="submit">Sign out</button>
          </form>
        </div>
      </div>
    </div>
    <div class="wrap">
      <h1 class="page">${greeting(data)}</h1>
      <p class="lede">${summary(data)}</p>
      ${raw(flashBanner(data.flash))}
      ${joinHtml(cards)}
    </div>
  `;
  return layout("Dashboard — RTMP Proxy", body, pageScript());
}

function greeting(data: DashboardData): string {
  return data.streams.length ? "Streaming" : "Idle";
}

function summary(data: DashboardData): string {
  const n = data.streams.length;
  const scope = canSeeEverything(data.user) ? "across all accounts" : "on your account";
  const live = n === 0 ? "No streams live" : n === 1 ? "1 stream live" : `${n} streams live`;
  return `${live} ${scope} · up ${formatDuration(data.uptimeSeconds)}`;
}

function flashBanner(flash: Flash | null): string {
  if (!flash) return "";
  if (flash.kind !== "secret" || !flash.secret) {
    return html`<div class="notice ${flash.kind}">${flash.message}</div>`;
  }
  return html`
    <div class="notice secret">
      <strong>${flash.message}</strong>
      <p class="hint">Copy the key now — it is stored hashed and cannot be shown again.</p>
      ${raw(copyField("API key", flash.secret.key))}
      <p class="hint">Paste these two into OBS &rarr; Settings &rarr; Stream &rarr; Custom&hellip;</p>
      ${raw(copyField("Server", flash.secret.ingestUrl))}
      ${raw(copyField("Stream key", flash.secret.streamKey))}
    </div>
  `;
}

function connectionCard(data: DashboardData): string {
  const addresses = data.serverAddresses.length ? data.serverAddresses : ["<server-address>"];
  const fields = addresses.map((addr) =>
    copyField(
      addresses.length > 1 ? `Server (${addr})` : "Server",
      `rtmp://${addr}:${config.rtmpPort}/${config.rtmpApp}`
    )
  );

  const restart = canRestartServer(data.user)
    ? html`
        <form class="inline" method="post" action="/server/restart"
              onsubmit="return confirm('Restart the server? Every live stream will be dropped.')">
          <button class="small" type="submit">Restart server</button>
        </form>
      `
    : "";

  return html`
    <section class="card">
      <header>
        <h2>Connect</h2>
        ${raw(restart)}
      </header>
      <div class="body">
        ${joinHtml(fields)}
        ${raw(copyField("Stream key format", `<stream-name>?key=<your-api-key>`))}
        <p class="hint">
          If the API key has its own destination, <code>&lt;stream-name&gt;</code> can be anything.
          Otherwise it must be the destination's stream key, and the feed is forwarded to
          <code>${db.settings.defaultRelayEdge}</code>.
        </p>
      </div>
    </section>
  `;
}

function streamsCard(data: DashboardData): string {
  return html`
    <section class="card">
      <header>
        <h2>Live <span class="count" id="stream-count">${data.streams.length}</span></h2>
        <span class="chip quiet">auto-refresh 3s</span>
      </header>
      <div class="body tight">
        <div class="scroll">
          <table>
            <thead>
              <tr>
                <th>Stream</th><th>Owner</th><th>Uptime</th><th>Bitrate</th>
                <th>Video</th><th>Forwarding to</th><th></th>
              </tr>
            </thead>
            <tbody id="streams">${raw(streamRows(data.streams))}</tbody>
          </table>
        </div>
      </div>
    </section>
  `;
}

export function streamRows(streams: LiveStreamView[]): string {
  if (!streams.length) {
    return html`<tr><td class="empty-row" colspan="7">Nothing is streaming right now.</td></tr>`;
  }
  return streams
    .map(
      (s) => html`
        <tr>
          <td data-label="Stream">
            <span class="dot live"></span><span class="mono">${s.maskedName}</span>
            <span class="sub">from ${s.remoteAddress}</span>
          </td>
          <td data-label="Owner">
            ${s.username}<span class="sub">${s.keyLabel}</span>
          </td>
          <td data-label="Uptime" class="num">${formatDuration(s.durationSeconds)}</td>
          <td data-label="Bitrate" class="num">${s.bitrateKbps ? `${s.bitrateKbps} kbps` : "—"}</td>
          <td data-label="Video"><span class="sub" style="margin:0">${s.video}</span></td>
          <td data-label="Forwarding to">${raw(relayCell(s))}</td>
          <td>
            <div class="actions">
              <form class="inline" method="post" action="/streams/${s.id}/kill"
                    onsubmit="return confirm('Drop this stream?')">
                <button class="small danger" type="submit">Kill</button>
              </form>
            </div>
          </td>
        </tr>
      `
    )
    .join("");
}

function relayCell(s: LiveStreamView): string {
  if (!s.relay) return html`<span class="empty">not forwarding</span>`;
  const dot =
    s.relay.state === "running" ? "on" : s.relay.state === "failed" ? "off" : "warn";
  const retries = s.relay.restarts ? ` · ${s.relay.restarts} retries` : "";
  return html`
    <span class="dot ${dot}"></span><span class="mono">${s.relay.target}</span>
    <span class="sub">${s.relay.state}${retries}</span>
  `;
}

function keysCard(data: DashboardData): string {
  const { user, keys } = data;
  const quota = effectiveKeyQuota(user);
  const unlimited = !Number.isFinite(quota);
  const quotaLabel = unlimited ? "unlimited" : String(quota);
  const atLimit = keys.length >= quota;

  const rows = keys.length
    ? keys.map((key) => keyRow(key, true)).join("")
    : html`<tr><td class="empty-row" colspan="5">No API keys yet — create one below to start streaming.</td></tr>`;

  const createForm = atLimit
    ? html`<p class="hint">All ${quotaLabel} of your API keys are in use. Delete one, or ask an administrator to raise your quota.</p>`
    : html`
        <form class="grid" method="post" action="/keys">
          <label class="field"><span>Label</span>
            <input name="label" placeholder="Main PC" maxlength="60">
          </label>
          <label class="field"><span>Destination URL — optional</span>
            <input name="destinationUrl" placeholder="${db.settings.defaultRelayEdge}">
          </label>
          <label class="field"><span>Destination stream key — optional</span>
            <input name="destinationKey" placeholder="uses the published name">
          </label>
          <button class="primary" type="submit">Create key</button>
        </form>
      `;

  return html`
    <section class="card">
      <header>
        <h2>Your keys <span class="count">${keys.length}${raw(unlimited ? "" : ` / ${quotaLabel}`)}</span></h2>
      </header>
      <div class="body tight">
        <div class="scroll">
          <table>
            <thead>
              <tr><th>Label</th><th>Key</th><th>Forwards to</th><th>Last used</th><th></th></tr>
            </thead>
            <tbody>${raw(rows)}</tbody>
          </table>
        </div>
      </div>
      <footer>${raw(createForm)}</footer>
    </section>
  `;
}

function keyRow(key: ApiKey, owned: boolean): string {
  const destination =
    key.destinationUrl || key.destinationKey
      ? html`<span class="mono">${key.destinationUrl ?? db.settings.defaultRelayEdge}/${key.destinationKey ?? "<published name>"}</span>`
      : html`<span class="empty">default — published name is the stream key</span>`;

  const state = key.disabled
    ? html`<span class="dot off"></span>paused`
    : html`<span class="dot on"></span>active`;

  const toggle = key.disabled
    ? html`<form class="inline" method="post" action="/keys/${key.id}/resume"><button class="small" type="submit">Resume</button></form>`
    : html`<form class="inline" method="post" action="/keys/${key.id}/pause"
             onsubmit="return confirm('Pause this key? Any stream using it is dropped immediately.')">
             <button class="small" type="submit">Pause</button></form>`;

  const ownerActions = owned
    ? html`
        <form class="inline" method="post" action="/keys/${key.id}/rotate"
              onsubmit="return confirm('Generate a new secret? The current one stops working at once.')">
          <button class="small" type="submit">Rotate</button>
        </form>
        <form class="inline" method="post" action="/keys/${key.id}/delete"
              onsubmit="return confirm('Delete this key permanently?')">
          <button class="small danger" type="submit">Delete</button>
        </form>
      `
    : "";

  return html`
    <tr>
      <td data-label="Label">${key.label}<span class="sub">${raw(state)}</span></td>
      <td data-label="Key" class="mono">${key.prefix}&hellip;</td>
      <td data-label="Forwards to">${raw(destination)}</td>
      <td data-label="Last used">${key.lastUsedAt ? formatRelative(key.lastUsedAt) : raw(html`<span class="empty">never</span>`)}</td>
      <td><div class="actions">${raw(toggle)}${raw(ownerActions)}</div></td>
    </tr>
  `;
}

function usersCard(data: DashboardData): string {
  const { user } = data;
  const manageRoles = canManageRoles(user);

  const rows = data.users.map((target) => userRow(target, user, manageRoles)).join("");

  const roleField = manageRoles
    ? html`
        <label class="field"><span>Role</span>
          <select name="role"><option value="user">user</option><option value="admin">admin</option></select>
        </label>
      `
    : "";

  return html`
    <section class="card">
      <header>
        <h2>Accounts <span class="count">${data.users.length}</span></h2>
        <span class="chip quiet">${manageRoles ? "creator" : "admin"} view</span>
      </header>
      <div class="body tight">
        <div class="scroll">
          <table>
            <thead>
              <tr><th>User</th><th>Role</th><th>Key quota</th><th>Restart</th><th>Last sign-in</th><th></th></tr>
            </thead>
            <tbody>${raw(rows)}</tbody>
          </table>
        </div>
      </div>
      <footer>
        <form class="grid" method="post" action="/users">
          <label class="field"><span>Username</span>
            <input name="username" required minlength="3" maxlength="32" placeholder="jordan">
          </label>
          <label class="field"><span>Password</span>
            <input name="password" type="password" required minlength="8" placeholder="at least 8 characters">
          </label>
          ${raw(roleField)}
          <button class="primary" type="submit">Add account</button>
        </form>
        <p class="hint">
          ${manageRoles
            ? "As the creator you set roles, key quotas and who may restart the server."
            : "Admins add and disable plain users. Roles, quotas and the restart permission are the creator's to set."}
        </p>
      </footer>
    </section>
  `;
}

function userRow(target: User, actor: User, manageRoles: boolean): string {
  const isSelf = target.id === actor.id;
  const isCreator = target.role === "creator";

  const roleCell =
    manageRoles && !isCreator
      ? html`
          <form class="inline" method="post" action="/users/${target.id}/role">
            <select name="role" onchange="this.form.submit()" aria-label="Role for ${target.username}">
              <option value="user" ${raw(target.role === "user" ? "selected" : "")}>user</option>
              <option value="admin" ${raw(target.role === "admin" ? "selected" : "")}>admin</option>
            </select>
          </form>
        `
      : html`<span class="chip">${target.role}</span>`;

  const quotaCell =
    manageRoles && !isCreator
      ? html`
          <form class="tiny" method="post" action="/users/${target.id}/quota">
            <input name="quota" value="${target.keyQuota ?? ""}" placeholder="${db.settings.defaultKeyQuota}"
                   inputmode="numeric" aria-label="Key quota for ${target.username}">
            <button class="small ghost" type="submit">Set</button>
          </form>
        `
      : html`<span>${isCreator ? "unlimited" : target.keyQuota ?? `${db.settings.defaultKeyQuota} (default)`}</span>`;

  const restartCell =
    isCreator || target.role === "admin"
      ? html`<span class="dot on"></span>by role`
      : manageRoles
      ? html`
          <form class="tiny" method="post" action="/users/${target.id}/restart-permission">
            <input type="hidden" name="allowed" value="${target.canRestartServer ? "0" : "1"}">
            <button class="small" type="submit">${target.canRestartServer ? "Revoke" : "Grant"}</button>
          </form>
        `
      : html`<span class="dot ${target.canRestartServer ? "on" : "off"}"></span>${target.canRestartServer ? "granted" : "no"}`;

  const actions: string[] = [];
  if (!isCreator && !isSelf) {
    actions.push(html`
      <form class="inline" method="post" action="/users/${target.id}/${target.disabled ? "enable" : "disable"}">
        <button class="small" type="submit">${target.disabled ? "Enable" : "Disable"}</button>
      </form>
    `);
    if (manageRoles) {
      actions.push(html`
        <form class="inline" method="post" action="/users/${target.id}/delete"
              onsubmit="return confirm('Delete this account and all of its API keys?')">
          <button class="small danger" type="submit">Delete</button>
        </form>
      `);
    }
  }
  if (isSelf || manageRoles) {
    actions.push(html`
      <form class="tiny" method="post" action="/users/${target.id}/password">
        <input name="password" type="password" placeholder="new password" minlength="8" required
               aria-label="New password for ${target.username}">
        <button class="small ghost" type="submit">Set</button>
      </form>
    `);
  }

  const status = target.disabled
    ? html`<span class="sub"><span class="dot off"></span>disabled</span>`
    : "";

  return html`
    <tr>
      <td data-label="User">
        ${target.username}${raw(isSelf ? html` <span class="chip solid">you</span>` : "")}
        ${raw(status)}
      </td>
      <td data-label="Role">${raw(roleCell)}</td>
      <td data-label="Key quota">${raw(quotaCell)}</td>
      <td data-label="Restart">${raw(restartCell)}</td>
      <td data-label="Last sign-in">${target.lastLoginAt ? formatRelative(target.lastLoginAt) : raw(html`<span class="empty">never</span>`)}</td>
      <td><div class="actions">${joinHtml(actions)}</div></td>
    </tr>
  `;
}

function allKeysCard(data: DashboardData): string {
  const byUser = new Map(data.users.map((u) => [u.id, u.username]));
  const foreign = data.allKeys.filter((k) => k.userId !== data.user.id);

  const rows = foreign.length
    ? foreign
        .map(
          (key) => html`
            <tr>
              <td data-label="Owner">${byUser.get(key.userId) ?? raw(html`<span class="empty">(deleted)</span>`)}</td>
              <td data-label="Label">${key.label}</td>
              <td data-label="Key" class="mono">${key.prefix}&hellip;</td>
              <td data-label="State">
                ${raw(key.disabled ? '<span class="dot off"></span>paused' : '<span class="dot on"></span>active')}
              </td>
              <td data-label="Last used">${key.lastUsedAt ? formatRelative(key.lastUsedAt) : raw(html`<span class="empty">never</span>`)}</td>
              <td>
                <div class="actions">
                  <form class="inline" method="post" action="/keys/${key.id}/${key.disabled ? "resume" : "pause"}">
                    <button class="small" type="submit">${key.disabled ? "Resume" : "Pause"}</button>
                  </form>
                </div>
              </td>
            </tr>
          `
        )
        .join("")
    : html`<tr><td class="empty-row" colspan="6">No keys belong to other accounts.</td></tr>`;

  return html`
    <section class="card">
      <header>
        <h2>All keys <span class="count">${foreign.length} from other accounts</span></h2>
      </header>
      <div class="body tight">
        <div class="scroll">
          <table>
            <thead><tr><th>Owner</th><th>Label</th><th>Key</th><th>State</th><th>Last used</th><th></th></tr></thead>
            <tbody>${raw(rows)}</tbody>
          </table>
        </div>
      </div>
      <footer>
        <p class="hint">Pausing a key drops the stream using it and blocks reconnection until it is resumed.</p>
      </footer>
    </section>
  `;
}

function metaCard(data: DashboardData): string {
  return html`
    <div class="meta">
      <span><b>Uptime</b> ${formatDuration(data.uptimeSeconds)}</span>
      <span><b>RTMP</b> ${config.rtmpPort}</span>
      <span><b>Web</b> ${config.webPort}</span>
      <span><b>App</b> ${config.rtmpApp}</span>
    </div>
  `;
}

// ------------------------------------------------------------------ client

function pageScript(): string {
  return `<script>
(function () {
  // Copy buttons
  document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('.copyfield .copy');
    if (!btn) return;
    var value = btn.parentNode.querySelector('[data-copy]');
    if (!value) return;
    var text = value.textContent;
    var done = function () {
      var original = btn.textContent;
      btn.textContent = 'Copied';
      btn.dataset.copied = '1';
      setTimeout(function () { btn.textContent = original; delete btn.dataset.copied; }, 1400);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, fallback);
    } else { fallback(); }
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', '');
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (err) {}
      document.body.removeChild(ta);
    }
  });

  // Live stream table
  var body = document.getElementById('streams');
  var count = document.getElementById('stream-count');
  if (!body) return;
  setInterval(function () {
    if (document.hidden) return;
    var active = document.activeElement;
    if (active && (active.tagName === 'BUTTON' || active.tagName === 'INPUT')) return;
    fetch('/api/streams/rows', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data) return;
        body.innerHTML = data.rows;
        if (count) count.textContent = data.count;
      })
      .catch(function () {});
  }, 3000);
})();
</script>`;
}

// ------------------------------------------------------------------ format

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diff = Math.max(0, Date.now() - then);
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(then).toISOString().slice(0, 10);
}
