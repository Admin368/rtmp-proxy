import { config } from "../config";
import { db } from "../store/db";
import type { ApiKey, User } from "../store/types";
import type { LiveStreamView } from "../rtmp/server";
import { canManageRoles, canManageUsers, canRestartServer, canSeeEverything, effectiveKeyQuota } from "../services/users";
import { escapeHtml, html, joinHtml, raw } from "./html";
import { styles } from "./styles";

export interface Flash {
  kind: "ok" | "error" | "secret";
  message: string;
  secret?: { key: string; ingestUrl: string; streamKey: string };
}

function layout(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${styles}</style>
</head>
<body><div class="wrap">${body}</div></body>
</html>`;
}

export function renderLogin(options: { error?: string; username?: string } = {}): string {
  const body = html`
    <div class="login">
      <header class="top"><h1>RTMP Proxy</h1></header>
      ${options.error ? raw(html`<div class="notice error">${options.error}</div>`) : raw("")}
      <section class="card">
        <h2>Sign in</h2>
        <form method="post" action="/login">
          <label class="field">Username
            <input name="username" autocomplete="username" autofocus required value="${options.username ?? ""}">
          </label>
          <label class="field">Password
            <input name="password" type="password" autocomplete="current-password" required>
          </label>
          <button class="primary" type="submit">Sign in</button>
        </form>
      </section>
    </div>
  `;
  return layout("Sign in — RTMP Proxy", body);
}

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
  const parts = [
    header(user),
    flashBanner(data.flash),
    serverCard(data),
    streamsCard(data),
    keysCard(data),
  ];
  if (canManageUsers(user)) parts.push(usersCard(data));
  if (canSeeEverything(user)) parts.push(allKeysCard(data));
  parts.push(pollScript());
  return layout("Dashboard — RTMP Proxy", parts.join(""));
}

function header(user: User): string {
  return html`
    <header class="top">
      <h1>RTMP Proxy</h1>
      <div class="whoami">
        ${user.username} <span class="badge role-${user.role}">${user.role}</span>
        <form class="inline" method="post" action="/logout">
          <button class="small" type="submit">Sign out</button>
        </form>
      </div>
    </header>
  `;
}

function flashBanner(flash: Flash | null): string {
  if (!flash) return "";
  if (flash.kind !== "secret" || !flash.secret) {
    return html`<div class="notice ${flash.kind}">${flash.message}</div>`;
  }
  return html`
    <div class="notice secret">
      <strong>${flash.message}</strong>
      <p class="hint">Copy this now — it is hashed on the server and cannot be shown again.</p>
      <div class="copybox mono">${flash.secret.key}</div>
      <p class="hint">OBS &rarr; Settings &rarr; Stream &rarr; Custom&hellip;</p>
      <div class="copybox mono">Server: ${flash.secret.ingestUrl}</div>
      <div class="copybox mono">Stream Key: ${flash.secret.streamKey}</div>
    </div>
  `;
}

function serverCard(data: DashboardData): string {
  const { user } = data;
  const addresses = data.serverAddresses.length ? data.serverAddresses : ["<server-address>"];
  const ingest = addresses.map(
    (addr) => html`<div class="copybox mono">rtmp://${addr}:${config.rtmpPort}/${config.rtmpApp}</div>`
  );

  const restart = canRestartServer(user)
    ? html`
        <form class="inline" method="post" action="/server/restart"
              onsubmit="return confirm('Restart the server? Every live stream will be dropped.')">
          <button class="danger" type="submit">Restart server</button>
        </form>
      `
    : "";

  return html`
    <section class="card">
      <h2>Server ${raw(restart)}</h2>
      <p><strong>Ingest URL</strong> — paste into the OBS &ldquo;Server&rdquo; field:</p>
      ${joinHtml(ingest)}
      <p><strong>Stream key format</strong> — the API key travels as a query argument on the stream name:</p>
      <div class="copybox mono">&lt;stream-name&gt;?key=&lt;your-api-key&gt;</div>
      <p class="hint">
        If the API key has its own destination configured, <code>&lt;stream-name&gt;</code> can be
        anything you like. If it does not, <code>&lt;stream-name&gt;</code> must be the stream key of
        the destination service (this is how v1/v2 worked), and the stream is forwarded to
        <code>${db.settings.defaultRelayEdge}</code>.
      </p>
      <p class="hint">Uptime ${formatDuration(data.uptimeSeconds)} · RTMP ${config.rtmpPort} · web ${config.webPort}</p>
    </section>
  `;
}

function streamsCard(data: DashboardData): string {
  const scope = canSeeEverything(data.user) ? "all accounts" : "your account";
  return html`
    <section class="card">
      <h2>Live streams <span class="count" id="stream-count">(${data.streams.length})</span></h2>
      <p class="hint">Showing streams for ${scope}. Refreshes every 3 seconds.</p>
      <div class="table-scroll">
        <table id="streams">
          <thead>
            <tr>
              <th>Stream</th><th>User</th><th>Key</th><th>Duration</th>
              <th>Bitrate</th><th>Video</th><th>Relay</th><th>Source</th><th></th>
            </tr>
          </thead>
          <tbody>${raw(streamRows(data.streams))}</tbody>
        </table>
      </div>
    </section>
  `;
}

export function streamRows(streams: LiveStreamView[]): string {
  if (!streams.length) {
    return html`<tr><td colspan="9" class="empty">No active streams</td></tr>`;
  }
  return streams
    .map(
      (s) => html`
        <tr>
          <td class="mono">${s.app}/${s.maskedName}</td>
          <td>${s.username}</td>
          <td>${s.keyLabel}</td>
          <td>${formatDuration(s.durationSeconds)}</td>
          <td>${s.bitrateKbps} kbps</td>
          <td>${s.video}</td>
          <td>${raw(relayCell(s))}</td>
          <td class="mono">${s.remoteAddress}</td>
          <td>
            <form class="inline" method="post" action="/streams/${s.id}/kill"
                  onsubmit="return confirm('Drop this stream?')">
              <button class="small danger" type="submit">Kill</button>
            </form>
          </td>
        </tr>
      `
    )
    .join("");
}

function relayCell(s: LiveStreamView): string {
  if (!s.relay) return html`<span class="empty">none</span>`;
  const cls = s.relay.state === "running" ? "ok" : s.relay.state === "failed" ? "off" : "";
  const retries = s.relay.restarts ? html` ${s.relay.restarts} retries` : "";
  return html`<span class="badge ${cls}">${s.relay.state}</span>${raw(retries)}<br><span class="mono">${s.relay.target}</span>`;
}

function keysCard(data: DashboardData): string {
  const { user, keys } = data;
  const quota = effectiveKeyQuota(user);
  const quotaLabel = Number.isFinite(quota) ? String(quota) : "unlimited";
  const atLimit = keys.length >= quota;

  const rows = keys.length
    ? keys.map((key) => keyRow(key, true)).join("")
    : html`<tr><td colspan="6" class="empty">No API keys yet</td></tr>`;

  const createForm = atLimit
    ? html`<p class="hint">You have used all ${quotaLabel} of your API keys. Delete one, or ask an administrator to raise your quota.</p>`
    : html`
        <form class="row" method="post" action="/keys">
          <label class="field">Label
            <input name="label" placeholder="Main PC" maxlength="60">
          </label>
          <label class="field">Destination URL (optional)
            <input name="destinationUrl" placeholder="${db.settings.defaultRelayEdge}" size="34">
          </label>
          <label class="field">Destination stream key (optional)
            <input name="destinationKey" placeholder="leave blank to use the published name" size="30">
          </label>
          <button class="primary" type="submit">Create API key</button>
        </form>
      `;

  return html`
    <section class="card">
      <h2>Your API keys <span class="count">(${keys.length} of ${quotaLabel})</span></h2>
      <div class="table-scroll">
        <table>
          <thead>
            <tr><th>Label</th><th>Key</th><th>Destination</th><th>Status</th><th>Last used</th><th></th></tr>
          </thead>
          <tbody>${raw(rows)}</tbody>
        </table>
      </div>
      ${raw(createForm)}
    </section>
  `;
}

function keyRow(key: ApiKey, owned: boolean): string {
  const destination = key.destinationUrl || key.destinationKey
    ? html`<span class="mono">${key.destinationUrl ?? db.settings.defaultRelayEdge}/${key.destinationKey ?? "<published name>"}</span>`
    : html`<span class="empty">default (published name is the stream key)</span>`;

  const status = key.disabled
    ? html`<span class="badge off">paused</span>`
    : html`<span class="badge ok">active</span>`;

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
      <td>${key.label}</td>
      <td class="mono">${key.prefix}&hellip;</td>
      <td>${raw(destination)}</td>
      <td>${raw(status)}</td>
      <td>${key.lastUsedAt ? formatTimestamp(key.lastUsedAt) : raw(html`<span class="empty">never</span>`)}</td>
      <td><div class="actions">${raw(toggle)}${raw(ownerActions)}</div></td>
    </tr>
  `;
}

function usersCard(data: DashboardData): string {
  const { user } = data;
  const manageRoles = canManageRoles(user);

  const rows = data.users
    .map((target) => userRow(target, user, manageRoles))
    .join("");

  const roleOptions = manageRoles
    ? html`
        <label class="field">Role
          <select name="role"><option value="user">user</option><option value="admin">admin</option></select>
        </label>
      `
    : "";

  return html`
    <section class="card">
      <h2>Accounts <span class="count">(${data.users.length})</span></h2>
      <div class="table-scroll">
        <table>
          <thead>
            <tr><th>User</th><th>Role</th><th>Key quota</th><th>Restart</th><th>Status</th><th>Last sign-in</th><th></th></tr>
          </thead>
          <tbody>${raw(rows)}</tbody>
        </table>
      </div>
      <p class="hint">
        ${manageRoles
          ? "As the creator you set roles, key quotas and who may restart the server."
          : "Admins can add and disable plain users. Only the creator changes roles, quotas and the restart permission."}
      </p>
      <form class="row" method="post" action="/users">
        <label class="field">Username <input name="username" required minlength="3" maxlength="32"></label>
        <label class="field">Password <input name="password" type="password" required minlength="8"></label>
        ${raw(roleOptions)}
        <button class="primary" type="submit">Add account</button>
      </form>
    </section>
  `;
}

function userRow(target: User, actor: User, manageRoles: boolean): string {
  const isSelf = target.id === actor.id;
  const isCreator = target.role === "creator";

  const roleCell = manageRoles && !isCreator
    ? html`
        <form class="inline" method="post" action="/users/${target.id}/role">
          <select name="role" onchange="this.form.submit()">
            <option value="user" ${raw(target.role === "user" ? "selected" : "")}>user</option>
            <option value="admin" ${raw(target.role === "admin" ? "selected" : "")}>admin</option>
          </select>
        </form>
      `
    : html`<span class="badge role-${target.role}">${target.role}</span>`;

  const quotaCell = manageRoles && !isCreator
    ? html`
        <form class="inline row" method="post" action="/users/${target.id}/quota">
          <input name="quota" size="3" value="${target.keyQuota ?? ""}"
                 placeholder="${db.settings.defaultKeyQuota}" inputmode="numeric">
          <button class="small" type="submit">Set</button>
        </form>
      `
    : html`<span>${target.keyQuota ?? `${db.settings.defaultKeyQuota} (default)`}</span>`;

  const restartCell = isCreator || target.role === "admin"
    ? html`<span class="badge ok">yes (by role)</span>`
    : manageRoles
    ? html`
        <form class="inline" method="post" action="/users/${target.id}/restart-permission">
          <input type="hidden" name="allowed" value="${target.canRestartServer ? "0" : "1"}">
          <button class="small" type="submit">${target.canRestartServer ? "Revoke" : "Grant"}</button>
        </form>
      `
    : html`<span class="badge ${target.canRestartServer ? "ok" : "off"}">${target.canRestartServer ? "yes" : "no"}</span>`;

  const statusCell = target.disabled
    ? html`<span class="badge off">disabled</span>`
    : html`<span class="badge ok">active</span>`;

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
      <form class="inline row" method="post" action="/users/${target.id}/password">
        <input name="password" type="password" placeholder="new password" minlength="8" size="14" required>
        <button class="small" type="submit">Set</button>
      </form>
    `);
  }

  return html`
    <tr>
      <td>${target.username}${raw(isSelf ? html` <span class="badge">you</span>` : "")}</td>
      <td>${raw(roleCell)}</td>
      <td>${raw(quotaCell)}</td>
      <td>${raw(restartCell)}</td>
      <td>${raw(statusCell)}</td>
      <td>${target.lastLoginAt ? formatTimestamp(target.lastLoginAt) : raw(html`<span class="empty">never</span>`)}</td>
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
              <td>${byUser.get(key.userId) ?? "(deleted)"}</td>
              <td>${key.label}</td>
              <td class="mono">${key.prefix}&hellip;</td>
              <td>${key.disabled ? raw(html`<span class="badge off">paused</span>`) : raw(html`<span class="badge ok">active</span>`)}</td>
              <td>${key.lastUsedAt ? formatTimestamp(key.lastUsedAt) : raw(html`<span class="empty">never</span>`)}</td>
              <td>
                <form class="inline" method="post" action="/keys/${key.id}/${key.disabled ? "resume" : "pause"}">
                  <button class="small" type="submit">${key.disabled ? "Resume" : "Pause"}</button>
                </form>
              </td>
            </tr>
          `
        )
        .join("")
    : html`<tr><td colspan="6" class="empty">No keys belonging to other accounts</td></tr>`;

  return html`
    <section class="card">
      <h2>All API keys <span class="count">(${foreign.length} from other accounts)</span></h2>
      <div class="table-scroll">
        <table>
          <thead><tr><th>Owner</th><th>Label</th><th>Key</th><th>Status</th><th>Last used</th><th></th></tr></thead>
          <tbody>${raw(rows)}</tbody>
        </table>
      </div>
      <p class="hint">Pausing a key drops any stream currently using it and blocks new connections until it is resumed.</p>
    </section>
  `;
}

function pollScript(): string {
  return `<script>
(function () {
  var body = document.querySelector('#streams tbody');
  var count = document.getElementById('stream-count');
  if (!body) return;
  function tick() {
    fetch('/api/streams/rows', { headers: { 'Accept': 'text/html' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data) return;
        if (document.activeElement && document.activeElement.tagName === 'BUTTON') return;
        body.innerHTML = data.rows;
        if (count) count.textContent = '(' + data.count + ')';
      })
      .catch(function () {});
  }
  setInterval(tick, 3000);
})();
</script>`;
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toISOString().replace("T", " ").slice(0, 19) + " UTC";
}
