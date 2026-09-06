import { jaccard, countEmoji, countHashtags } from './util.js';

/**
 * Hard gate: a post either passes every rule or it is not eligible.
 * Returns { pass, reasons[] }.
 */
export function validate(text, cfg, recent = []) {
  const q = cfg.quality;
  const reasons = [];
  const t = (text || '').trim();

  if (!t) reasons.push('empty');
  if (t.length > cfg.content.maxChars) reasons.push(`too long (${t.length}>${cfg.content.maxChars})`);
  if (t.length < q.minChars) reasons.push(`too short (${t.length}<${q.minChars})`);
  if (countHashtags(t) > q.maxHashtags) reasons.push('too many hashtags');
  if (countEmoji(t) > q.maxEmoji) reasons.push('too many emoji');
  if (/[{}<>]\s*\w+\s*[{}<>]|\[[A-Z_]{3,}\]|YOUR_|<repo>|TODO/.test(t)) reasons.push('unfilled placeholder');
  if (/^["'`]|["'`]$/.test(t)) reasons.push('wrapped in quotes');

  const low = t.toLowerCase();
  for (const p of q.bannedPhrases) if (low.includes(p.toLowerCase())) reasons.push(`banned phrase: "${p}"`);
  for (const o of q.bannedOpeners || []) if (low.startsWith(o.toLowerCase())) reasons.push(`banned opener: "${o.trim()}"`);

  for (const prev of recent.slice(-q.similarityWindow)) {
    if (jaccard(t, prev) > q.similarityThreshold) { reasons.push('too similar to a recent post'); break; }
  }

  return { pass: reasons.length === 0, reasons };
}

/**
 * Soft score: among valid candidates, prefer the one with more concrete signal.
 * Higher is better.
 */
export function score(text, cfg) {
  const t = text.trim();
  let s = 0;

  const len = t.length;
  s += len >= 130 && len <= 245 ? 12 : len >= 100 ? 6 : 0;      // sweet spot

  if (/\b\d+(\.\d+)?\s*(ms|s|kb|mb|x|%|k)\b/i.test(t)) s += 14;  // measured claim
  else if (/\b\d+\b/.test(t)) s += 6;                            // any number

  const firstLine = t.split('\n')[0];
  if (firstLine.length <= 90) s += 6;                            // tight hook
  if (!/^(i |my |we )/i.test(t)) s += 3;                         // doesn't open with a pronoun
  if (/[.!?]$/.test(t.replace(/\s*https?:\/\/\S+$/, '').trim())) s += 3;

  if (countHashtags(t) === 0) s += 5;
  if (countEmoji(t) === 0) s += 3;

  // concrete technical nouns beat generic ones
  const concrete = (t.match(/\b(index|query|cache|token|migration|bundle|hook|route|schema|worker|regex|race|timeout|payload|middleware|cron|socket|build|deploy|type|state|render)\b/gi) || []).length;
  s += Math.min(concrete * 4, 12);

  const generic = (t.match(/\b(amazing|awesome|incredible|journey|passion|grind|hustle|productivity|leverage|synergy|robust|seamless|powerful)\b/gi) || []).length;
  s -= generic * 8;

  if (/\bthoughts\?|\bwho else|\bagree\?|\bdrop a\b/i.test(t)) s -= 15;   // engagement bait
  if ((t.match(/\n/g) || []).length > 3) s -= 5;                          // over-formatted

  return s;
}
