import path from 'node:path';
import fs from 'node:fs';
import { ROOT, loadConfig, log } from '../src/util.js';
import { loadHistory } from '../src/store.js';
import { engagementOf, bestSlotReport } from '../src/scheduler.js';

const cfg = loadConfig();
const h = loadHistory();
const posts = [...h.posts].reverse();

const byAngle = new Map();
for (const p of h.posts) {
  const e = engagementOf(p);
  const a = byAngle.get(p.angle) || { n: 0, scored: 0, sum: 0 };
  a.n++;
  if (e !== null) { a.scored++; a.sum += e; }
  byAngle.set(p.angle, a);
}
const angleRows = [...byAngle.entries()]
  .map(([angle, a]) => ({ angle, n: a.n, avg: a.scored ? a.sum / a.scored : null }))
  .sort((x, y) => (y.avg ?? -1) - (x.avg ?? -1));

const slots = bestSlotReport(h);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = (v) => (v === null || v === undefined ? '—' : Number(v).toLocaleString());

const metricKeys = [...new Set(h.posts.flatMap((p) => Object.keys(p.metrics || {})))];

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>x-autopilot report</title>
<style>
:root{--bg:#fbfbfa;--fg:#1a1a18;--mut:#6b6b66;--line:#e4e4e0;--card:#fff;--acc:#2f6f4e}
@media(prefers-color-scheme:dark){:root{--bg:#131311;--fg:#eceae4;--mut:#9a9a92;--line:#2c2c28;--card:#1c1c19;--acc:#7fc9a1}}
*{box-sizing:border-box}body{margin:0;padding:32px 20px;background:var(--bg);color:var(--fg);
font:15px/1.55 ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif;max-width:900px;margin-inline:auto}
h1{font-size:22px;margin:0 0 4px}h2{font-size:14px;text-transform:uppercase;letter-spacing:.07em;color:var(--mut);margin:36px 0 12px;font-weight:600}
.sub{color:var(--mut);margin:0 0 8px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
.stat{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px}
.stat b{display:block;font-size:26px;font-variant-numeric:tabular-nums}
.stat span{color:var(--mut);font-size:12px}
table{width:100%;border-collapse:collapse;font-size:14px}
th,td{text-align:left;padding:9px 10px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--mut);font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.05em}
td.n,th.n{text-align:right;font-variant-numeric:tabular-nums}
.wrap{overflow-x:auto;border:1px solid var(--line);border-radius:10px;background:var(--card)}
.post{white-space:pre-wrap;max-width:420px}
.tag{display:inline-block;padding:1px 7px;border-radius:99px;background:var(--line);font-size:11px;color:var(--mut)}
.bar{height:6px;background:var(--acc);border-radius:3px;min-width:2px}
.empty{color:var(--mut);padding:18px;text-align:center}
</style></head><body>
<h1>x-autopilot</h1>
<p class="sub">@${esc(cfg.identity.handle || cfg.github.username)} · generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC</p>

<div class="grid">
  <div class="stat"><b>${h.posts.length}</b><span>posts published</span></div>
  <div class="stat"><b>${h.posts.filter((p) => p.metrics && Object.keys(p.metrics).length).length}</b><span>with metrics</span></div>
  <div class="stat"><b>${num(h.posts.reduce((s, p) => s + Number(p.metrics?.impressions ?? p.metrics?.views ?? 0), 0))}</b><span>impressions</span></div>
  <div class="stat"><b>${num(h.posts.reduce((s, p) => s + Number(p.metrics?.reactions ?? p.metrics?.likes ?? 0), 0))}</b><span>reactions</span></div>
</div>

<h2>Which angle performs</h2>
<div class="wrap">${angleRows.length ? `<table>
<tr><th>Angle</th><th class="n">Posts</th><th class="n">Avg engagement /1k</th><th></th></tr>
${angleRows.map((r) => {
  const max = Math.max(...angleRows.map((x) => x.avg ?? 0), 1);
  return `<tr><td>${esc(r.angle)}</td><td class="n">${r.n}</td><td class="n">${r.avg === null ? '—' : r.avg.toFixed(1)}</td>
  <td><div class="bar" style="width:${Math.round(((r.avg ?? 0) / max) * 100)}%"></div></td></tr>`;
}).join('')}</table>` : '<p class="empty">No posts yet.</p>'}</div>

<h2>Which slot performs</h2>
<div class="wrap">${slots.length ? `<table>
<tr><th>Local slot</th><th class="n">Posts</th><th class="n">Avg engagement /1k</th></tr>
${slots.map((s) => `<tr><td>${esc(s.slot)}</td><td class="n">${s.n}</td><td class="n">${s.avg.toFixed(1)}</td></tr>`).join('')}
</table>` : '<p class="empty">Needs a few posts with metrics before this is meaningful.</p>'}</div>

<h2>Posts</h2>
<div class="wrap">${posts.length ? `<table>
<tr><th>When</th><th>Angle</th><th>Post</th>${metricKeys.map((k) => `<th class="n">${esc(k)}</th>`).join('')}</tr>
${posts.map((p) => `<tr>
  <td>${esc((p.dueAt || p.createdAt).slice(0, 10))}<br><span class="tag">${esc(p.localSlot || '')}</span></td>
  <td>${esc(p.angle)}</td>
  <td class="post">${esc(p.text)}</td>
  ${metricKeys.map((k) => `<td class="n">${num(p.metrics?.[k])}</td>`).join('')}
</tr>`).join('')}</table>` : '<p class="empty">Nothing published yet. Run <code>npm run dry</code> first.</p>'}</div>

<h2>Notes</h2>
<p class="sub">Engagement /1k = (reactions + comments + reposts + saves + 5&times;follows) &divide; impressions &times; 1000, so a small post is not buried by a big one. Metrics come from Buffer; X's own analytics at analytics.x.com stays the source of truth for follower growth.</p>
</body></html>`;

const out = path.join(ROOT, 'data', 'report.html');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
log(`report written to ${out}`);
