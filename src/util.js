import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ---------- logging ---------- */
const t = () => new Date().toISOString().slice(11, 19);
export const log  = (...a) => console.log(`[${t()}]`, ...a);
export const warn = (...a) => console.warn(`[${t()}] !`, ...a);
export const die  = (m) => { console.error(`\n✖ ${m}\n`); process.exit(1); };

/* ---------- config ---------- */
export function loadConfig() {
  const cfg = readJSON(path.join(ROOT, 'config.json'));
  // env overrides so you can run the same repo with different accounts
  if (process.env.GITHUB_USERNAME) cfg.github.username = process.env.GITHUB_USERNAME;
  if (process.env.BUFFER_CHANNEL_ID) cfg.buffer.channelId = process.env.BUFFER_CHANNEL_ID;
  if (!cfg.github.username || cfg.github.username === 'YOUR_GITHUB_USERNAME') {
    die('Set your GitHub username in config.json (github.username).');
  }
  return cfg;
}

export function loadVoice() {
  const p = path.join(ROOT, 'voice.md');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
}

/* ---------- json fs ---------- */
export function readJSON(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { if (fallback !== undefined) return fallback; throw e; }
}
export function writeJSON(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n');
}

/* ---------- http ---------- */
export async function http(url, opts = {}, { retries = 3, label = url } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, {
        ...opts,
        headers: { 'user-agent': 'x-autopilot', ...(opts.headers || {}) },
        signal: AbortSignal.timeout(45_000),
      });
      const body = await res.text();
      if (res.status === 429 || res.status >= 500) {
        throw new Error(`${res.status} ${body.slice(0, 200)}`);
      }
      return { ok: res.ok, status: res.status, body, json: safeJSON(body) };
    } catch (e) {
      lastErr = e;
      if (i < retries) {
        const wait = 1200 * 2 ** i;
        warn(`${label} failed (${e.message}); retry in ${wait}ms`);
        await sleep(wait);
      }
    }
  }
  throw new Error(`${label}: ${lastErr?.message || 'unknown error'}`);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function safeJSON(s) { try { return JSON.parse(s); } catch { return null; } }

/** Pull the first JSON object/array out of a possibly fenced LLM response. */
export function extractJSON(text) {
  if (!text) return null;
  const direct = safeJSON(text.trim());
  if (direct) return direct;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) { const v = safeJSON(fenced[1].trim()); if (v) return v; }
  const start = text.search(/[[{]/);
  if (start === -1) return null;
  const open = text[start], close = open === '{' ? '}' : ']';
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) return safeJSON(text.slice(start, i + 1));
  }
  return null;
}

/* ---------- text ---------- */
export function tokenize(s) {
  return new Set(
    String(s).toLowerCase().replace(/https?:\/\/\S+/g, ' ')
      .replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
      .filter((w) => w.length > 3)
  );
}
export function jaccard(a, b) {
  const A = tokenize(a), B = tokenize(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}
export const countEmoji = (s) => (s.match(/\p{Extended_Pictographic}/gu) || []).length;
export const countHashtags = (s) => (s.match(/(^|\s)#\w+/g) || []).length;

/* ---------- time ---------- */
export function inZone(date, timeZone) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone, weekday: 'short', hour: 'numeric', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const g = (k) => f.find((p) => p.type === k)?.value;
  return { weekday: g('weekday'), hour: Number(g('hour')), date: `${g('year')}-${g('month')}-${g('day')}` };
}

export function pickWeighted(items, weightFn = (x) => x.weight ?? 1) {
  const total = items.reduce((s, i) => s + Math.max(0, weightFn(i)), 0);
  if (total <= 0) return items[Math.floor(Math.random() * items.length)];
  let r = Math.random() * total;
  for (const i of items) { r -= Math.max(0, weightFn(i)); if (r <= 0) return i; }
  return items[items.length - 1];
}
