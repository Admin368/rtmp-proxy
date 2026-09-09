export const styles = `
/* Monochrome, dark only. Hierarchy comes from weight, spacing and contrast —
   there is no hue anywhere in this file, and state is carried by shape. */
:root {
  color-scheme: dark;

  --bg: #0a0a0a;
  --surface: #101010;
  --surface-2: #161616;
  --surface-3: #1d1d1d;

  --line: #202020;
  --line-2: #2e2e2e;
  --line-3: #454545;

  --fg: #f2f2f2;
  --fg-2: #b4b4b4;
  --fg-3: #7d7d7d;
  --fg-4: #565656;
  --fg-invert: #0a0a0a;

  --radius: 10px;
  --radius-sm: 7px;
  --gap: 20px;

  --mono: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
  --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, Helvetica, Arial, sans-serif;
}

* { box-sizing: border-box; }

html { -webkit-text-size-adjust: 100%; }

body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
  font: 15px/1.6 var(--sans);
  font-feature-settings: "tnum" 1;
  letter-spacing: -0.006em;
  -webkit-font-smoothing: antialiased;
}

::selection { background: var(--fg); color: var(--fg-invert); }

:focus-visible {
  outline: 2px solid var(--fg);
  outline-offset: 2px;
  border-radius: 4px;
}

.wrap { max-width: 1080px; margin: 0 auto; padding: 0 24px 96px; }

/* ---------------------------------------------------------------- top bar */

.topbar {
  position: sticky;
  top: 0;
  z-index: 10;
  /* Solid rather than a translucent blur: on an all-black theme the blur buys nothing
     visually, and it forces a compositing layer that some renderers paint incorrectly. */
  background: var(--bg);
  border-bottom: 1px solid var(--line);
  margin-bottom: 36px;
}
.topbar .inner {
  max-width: 1080px;
  margin: 0 auto;
  padding: 14px 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.brand {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--fg);
  display: flex;
  align-items: center;
  gap: 10px;
}
.brand .mark {
  width: 9px; height: 9px; border-radius: 50%;
  background: var(--fg);
  box-shadow: 0 0 0 4px rgba(242, 242, 242, 0.09);
}
.topbar .who {
  display: flex; align-items: center; gap: 12px;
  font-size: 13px; color: var(--fg-3);
}
.topbar .who .name { color: var(--fg-2); }

/* ------------------------------------------------------------------- type */

h1.page {
  font-size: 26px;
  font-weight: 600;
  letter-spacing: -0.02em;
  margin: 0 0 4px;
}
p.lede { color: var(--fg-3); margin: 0 0 32px; font-size: 14px; }

.card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  margin-bottom: var(--gap);
  overflow: hidden;
}
.card > header {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px; flex-wrap: wrap;
  padding: 16px 20px;
  border-bottom: 1px solid var(--line);
}
.card > header h2 {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--fg-2);
  display: flex; align-items: center; gap: 10px;
}
.card > header .count {
  font-weight: 400;
  letter-spacing: 0;
  text-transform: none;
  color: var(--fg-4);
}
.card > .body { padding: 20px; }
.card > .body.tight { padding: 0; }
.card > footer {
  padding: 14px 20px;
  border-top: 1px solid var(--line);
  background: var(--surface-2);
}

.hint { color: var(--fg-4); font-size: 13px; margin: 10px 0 0; line-height: 1.55; }
.hint:first-child { margin-top: 0; }
.hint code { color: var(--fg-3); }

/* ------------------------------------------------------------- copy fields */

.copyfield { display: grid; gap: 6px; margin-bottom: 14px; }
.copyfield:last-child { margin-bottom: 0; }
.copyfield > .label {
  font-size: 11px; letter-spacing: 0.09em; text-transform: uppercase; color: var(--fg-4);
}
.copyfield > .row {
  display: flex; align-items: stretch; gap: 0;
  background: var(--bg);
  border: 1px solid var(--line-2);
  border-radius: var(--radius-sm);
  overflow: hidden;
}
.copyfield .value {
  flex: 1 1 auto;
  padding: 11px 13px;
  font: 13px/1.5 var(--mono);
  color: var(--fg);
  word-break: break-all;
  min-width: 0;
}
.copyfield .copy {
  flex: 0 0 auto;
  border: 0;
  border-left: 1px solid var(--line-2);
  background: transparent;
  color: var(--fg-4);
  padding: 0 15px;
  font-size: 12px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  cursor: pointer;
  transition: color .12s, background .12s;
}
.copyfield .copy:hover { color: var(--fg); background: var(--surface-3); }
.copyfield .copy[data-copied="1"] { color: var(--fg); }

/* ---------------------------------------------------------------- notices */

.notice {
  border: 1px solid var(--line-2);
  border-left-width: 3px;
  border-radius: var(--radius-sm);
  padding: 14px 18px;
  margin-bottom: var(--gap);
  background: var(--surface);
  font-size: 14px;
}
.notice.ok { border-left-color: var(--fg-3); }
.notice.error { border-left-color: var(--fg); background: var(--surface-2); }
.notice.secret { border-left-color: var(--fg); background: var(--surface-2); }
.notice strong { font-weight: 600; }
.notice .hint { margin-top: 6px; }
.notice .copyfield { margin-top: 14px; }

/* ----------------------------------------------------------------- tables */

.scroll { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
thead th {
  text-align: left;
  padding: 11px 20px;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--fg-4);
  background: var(--surface-2);
  border-bottom: 1px solid var(--line);
  white-space: nowrap;
}
tbody td {
  padding: 13px 20px;
  border-bottom: 1px solid var(--line);
  vertical-align: middle;
}
tbody tr:last-child td { border-bottom: none; }
tbody tr { transition: background .12s; }
tbody tr:hover { background: var(--surface-2); }
td.num { font-variant-numeric: tabular-nums; color: var(--fg-2); }
td .sub { display: block; font-size: 12px; color: var(--fg-3); margin-top: 2px; }
.mono { font-family: var(--mono); font-size: 13px; }
.empty { color: var(--fg-4); }
td.empty-row { padding: 34px 20px; text-align: center; color: var(--fg-4); }

/* ------------------------------------------------------------ state marks */

.dot {
  display: inline-block; width: 7px; height: 7px; border-radius: 50%;
  margin-right: 8px; vertical-align: 1px;
}
.dot.live { background: var(--fg); box-shadow: 0 0 0 0 rgba(242,242,242,.45); animation: pulse 2.4s ease-out infinite; }
.dot.on { background: var(--fg-2); }
.dot.off { background: transparent; border: 1px solid var(--fg-4); }
.dot.warn { background: var(--fg-4); }
@keyframes pulse {
  0% { box-shadow: 0 0 0 0 rgba(242,242,242,.40); }
  70% { box-shadow: 0 0 0 7px rgba(242,242,242,0); }
  100% { box-shadow: 0 0 0 0 rgba(242,242,242,0); }
}
@media (prefers-reduced-motion: reduce) { .dot.live { animation: none; } }

.chip {
  display: inline-block;
  padding: 2px 9px;
  border: 1px solid var(--line-3);
  border-radius: 999px;
  font-size: 11px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--fg-3);
  white-space: nowrap;
}
.chip.solid { background: var(--fg); border-color: var(--fg); color: var(--fg-invert); }
.chip.quiet { border-color: var(--line-2); color: var(--fg-4); }

/* ------------------------------------------------------------ controls */

button, .btn {
  font: 500 13px/1 var(--sans);
  padding: 9px 15px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--line-3);
  background: transparent;
  color: var(--fg-2);
  cursor: pointer;
  transition: color .12s, border-color .12s, background .12s;
  white-space: nowrap;
}
button:hover { color: var(--fg); border-color: var(--fg-3); }
button:active { transform: translateY(0.5px); }
button.primary { background: var(--fg); border-color: var(--fg); color: var(--fg-invert); font-weight: 600; }
button.primary:hover { background: #fff; border-color: #fff; color: var(--fg-invert); }
button.small { padding: 6px 11px; font-size: 12px; }
button.ghost { border-color: transparent; color: var(--fg-4); }
button.ghost:hover { border-color: var(--line-3); color: var(--fg); }
button.danger { color: var(--fg-4); border-color: var(--line-2); }
button.danger:hover { background: var(--fg); border-color: var(--fg); color: var(--fg-invert); }
button:disabled { opacity: .4; cursor: not-allowed; }

.actions { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
form.inline { display: inline; }

label.field { display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: var(--fg-4); }
label.field > span { letter-spacing: 0.04em; }
input, select {
  font: 14px/1.4 var(--sans);
  padding: 9px 11px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--line-2);
  background: var(--bg);
  color: var(--fg);
  min-width: 0;
  transition: border-color .12s;
}
input::placeholder { color: var(--fg-4); }
input:hover, select:hover { border-color: var(--line-3); }
input:focus, select:focus { border-color: var(--fg-3); outline: none; }
input:focus-visible, select:focus-visible { outline: 2px solid var(--fg); outline-offset: 1px; }
select { cursor: pointer; }

form.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 14px;
  align-items: end;
}
form.grid button { justify-self: start; }
form.tiny { display: flex; gap: 6px; align-items: center; }
form.tiny input { width: 62px; padding: 6px 8px; font-size: 13px; }
form.tiny input[type="password"] { width: 130px; }

/* ------------------------------------------------------------------ login */

.login { max-width: 380px; margin: 16vh auto 0; padding: 0 24px; }
.login .brand { justify-content: center; margin-bottom: 28px; }
.login form { display: grid; gap: 16px; }
.login button { width: 100%; padding: 11px; }

/* ----------------------------------------------------------------- footer */

.meta {
  display: flex; flex-wrap: wrap; gap: 8px 22px;
  font-size: 12px; color: var(--fg-4);
}
.meta b { font-weight: 500; color: var(--fg-3); }

/* ------------------------------------------------------------- responsive */

@media (max-width: 760px) {
  .wrap { padding: 0 16px 72px; }
  .topbar .inner { padding: 12px 16px; }

  /* Tables become stacked records; each cell keeps its header via data-label. */
  table, thead, tbody, tr, td { display: block; width: 100%; }
  thead { display: none; }
  tbody tr {
    border-bottom: 1px solid var(--line);
    padding: 14px 16px;
  }
  tbody tr:last-child { border-bottom: none; }
  /* Label above value. A left/right flex row looks tidier until a cell holds several
     elements — a state dot, a value and a sub-line — which then wrap unpredictably. */
  tbody td {
    display: block;
    padding: 7px 0;
    border: none;
    text-align: left;
  }
  tbody td::before {
    content: attr(data-label);
    display: block;
    margin-bottom: 1px;
    font-size: 11px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--fg-4);
  }
  tbody td:empty { display: none; }
  /* Stacked rows have the full width, so long values wrap instead of forcing
     the whole card into a horizontal scroll. */
  .scroll { overflow-x: visible; }
  tbody td .mono { word-break: break-all; }
  tbody td .sub { text-align: left; }
  td.empty-row { display: block; text-align: center; padding: 28px 0; }
  td.empty-row::before { content: none; }
  .actions { justify-content: flex-start; margin-top: 6px; }
  form.tiny { flex-wrap: wrap; }
  form.tiny input, form.tiny input[type="password"] { width: auto; flex: 1 1 120px; }
}
`;
