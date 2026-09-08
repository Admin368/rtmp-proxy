export const styles = `
:root {
  color-scheme: light dark;
  --bg: #f4f5f7;
  --panel: #ffffff;
  --border: #dfe3e8;
  --text: #1c2430;
  --muted: #63707f;
  --accent: #2f6fd0;
  --accent-text: #ffffff;
  --danger: #c23934;
  --ok: #1f8a4c;
  --warn: #b8860b;
  --code-bg: #eef1f5;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #14181d;
    --panel: #1c2229;
    --border: #2c343d;
    --text: #e6eaef;
    --muted: #9aa7b4;
    --accent: #4d8ae0;
    --accent-text: #0b0e12;
    --danger: #e2695f;
    --ok: #4cc37e;
    --warn: #d8a83a;
    --code-bg: #12171c;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 24px 16px 64px;
  background: var(--bg);
  color: var(--text);
  font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}
.wrap { max-width: 1100px; margin: 0 auto; }
header.top {
  display: flex; flex-wrap: wrap; gap: 12px; align-items: baseline;
  justify-content: space-between; margin-bottom: 20px;
}
header.top h1 { font-size: 20px; margin: 0; }
.whoami { color: var(--muted); font-size: 14px; }
.badge {
  display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 12px;
  border: 1px solid var(--border); background: var(--code-bg); color: var(--muted);
}
.badge.role-creator { color: var(--accent); border-color: var(--accent); }
.badge.role-admin { color: var(--warn); border-color: var(--warn); }
.badge.ok { color: var(--ok); border-color: var(--ok); }
.badge.off { color: var(--danger); border-color: var(--danger); }
section.card {
  background: var(--panel); border: 1px solid var(--border); border-radius: 10px;
  padding: 18px 20px; margin-bottom: 18px;
}
section.card > h2 { margin: 0 0 14px; font-size: 16px; }
section.card > h2 .count { color: var(--muted); font-weight: 400; }
p.hint { color: var(--muted); font-size: 13px; margin: 6px 0 0; }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border); vertical-align: middle; }
th { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
tr:last-child td { border-bottom: none; }
.table-scroll { overflow-x: auto; }
code, .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 13px; }
.copybox {
  background: var(--code-bg); border: 1px solid var(--border); border-radius: 6px;
  padding: 10px 12px; word-break: break-all; margin: 8px 0;
}
form.inline { display: inline; }
form.row { display: flex; flex-wrap: wrap; gap: 8px; align-items: flex-end; }
label.field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--muted); }
input, select {
  font: inherit; padding: 7px 9px; border-radius: 6px; border: 1px solid var(--border);
  background: var(--panel); color: var(--text); min-width: 0;
}
input:focus, select:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
button {
  font: inherit; padding: 7px 13px; border-radius: 6px; border: 1px solid var(--border);
  background: var(--panel); color: var(--text); cursor: pointer;
}
button:hover { border-color: var(--accent); }
button.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-text); }
button.danger { color: var(--danger); border-color: var(--danger); }
button.danger:hover { background: var(--danger); color: var(--accent-text); }
button.small { padding: 4px 9px; font-size: 13px; }
.notice {
  padding: 10px 14px; border-radius: 8px; margin-bottom: 16px; border: 1px solid var(--border);
}
.notice.error { border-color: var(--danger); color: var(--danger); }
.notice.ok { border-color: var(--ok); color: var(--ok); }
.notice.secret { border-color: var(--accent); }
.empty { color: var(--muted); font-style: italic; }
.login { max-width: 360px; margin: 12vh auto; }
.login form { display: flex; flex-direction: column; gap: 12px; }
.actions { display: flex; gap: 6px; flex-wrap: wrap; }
`;
