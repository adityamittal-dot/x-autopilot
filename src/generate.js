import { http, log, warn, extractJSON } from './util.js';
import { renderActivity } from './sources/github.js';
import { renderTrends } from './sources/trends.js';

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

function buildPrompt({ cfg, voice, activity, trends, angle, recent }) {
  const max = cfg.content.maxChars;
  const linkRule = {
    inline: 'If (and only if) one specific repo is the subject, put its URL on its own final line.',
    none: 'Do not include any URL.',
    reply: 'Do not include a URL in the post itself.',
  }[cfg.content.linkPolicy] || 'Do not include any URL.';

  return `You write single posts for X (Twitter) on behalf of one developer, in their voice.

=== VOICE GUIDE (obey this above all else) ===
${voice}

=== THIS WEEK'S REAL WORK (the only facts you may use) ===
${renderActivity(activity)}

=== WHAT THE DEV WORLD IS TALKING ABOUT RIGHT NOW ===
${cfg.content.useTrendHook ? renderTrends(trends) : '(disabled)'}
Use this ONLY if one item genuinely connects to the work above. It is context for
phrasing and timing, never the subject. Never post commentary on a trend the dev
has no first-hand connection to.

=== THE ANGLE FOR THIS POST ===
${angle.id}: ${angle.brief}

=== POSTS ALREADY PUBLISHED (do not repeat these ideas or their phrasing) ===
${recent.length ? recent.map((t) => `- ${t.replace(/\n/g, ' ')}`).join('\n') : '(none yet)'}

=== HARD CONSTRAINTS ===
- Maximum ${max} characters including any URL. Target 150-240.
- Every factual claim must be traceable to the activity block above. Invent nothing:
  no numbers, no benchmarks, no feature names that do not appear there.
- At most ${cfg.quality.maxHashtags} hashtag and ${cfg.quality.maxEmoji} emoji. Zero is usually right.
- ${linkRule}
- Do not start with: ${(cfg.quality.bannedOpeners || []).map((o) => `"${o.trim()}"`).join(', ')}.
- No engagement bait, no calls to action, no thread markers.
- Write as the developer ("I"), never about them.

=== OUTPUT ===
Return ONLY a JSON object, no prose, no code fence:
{"variants":[{"text":"...","why":"one clause on what makes this land"}, ...]}
Give exactly ${cfg.llm.variants} genuinely different variants — different opening,
different fact chosen, different shape. Not three rewordings of one sentence.`;
}

async function callGemini(model, prompt, cfg) {
  const res = await http(`${BASE}/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: cfg.llm.temperature ?? 1.0,
        maxOutputTokens: 2048,
        responseMimeType: 'application/json',
      },
      safetySettings: [],
    }),
  }, { label: `gemini:${model}`, retries: 1 });

  if (!res.ok) {
    const msg = res.json?.error?.message || res.body.slice(0, 200);
    const err = new Error(`${res.status} ${msg}`);
    err.status = res.status;
    throw err;
  }

  const cand = res.json?.candidates?.[0];
  const text = (cand?.content?.parts || []).map((p) => p.text || '').join('');
  if (!text) throw new Error(`empty response (finishReason=${cand?.finishReason ?? 'unknown'})`);
  return text;
}

/** Try each configured model until one answers. Free-tier models get deprecated; this survives it. */
export async function generateVariants(ctx) {
  const { cfg } = ctx;
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set');
  const prompt = buildPrompt(ctx);

  let lastErr;
  for (const model of cfg.llm.models) {
    try {
      const raw = await callGemini(model, prompt, cfg);
      const parsed = extractJSON(raw);
      const variants = (parsed?.variants || [])
        .map((v) => ({ text: String(v.text || '').trim(), why: v.why || '' }))
        .filter((v) => v.text);
      if (!variants.length) throw new Error('no variants in response');
      log(`gemini: ${variants.length} variant(s) from ${model}`);
      return { model, variants };
    } catch (e) {
      lastErr = e;
      warn(`gemini ${model}: ${e.message}`);
      if (e.status && ![400, 403, 404, 429].includes(e.status)) break;
    }
  }
  throw new Error(`all models failed — last error: ${lastErr?.message}`);
}

/**
 * Deterministic fallback so a bad LLM day never means a missed post.
 * Deliberately plain: it should read as a terse note, not as filler.
 */
export function templateFallback({ activity, cfg }) {
  const r = activity.repos?.[0];
  if (!r) return null;
  const subjects = (r.commits || []).map((c) => c.subject).filter((s) => s.length > 12);
  if (!subjects.length) return null;
  const s = subjects[0].replace(/\.$/, '');
  const lead = s.charAt(0).toLowerCase() + s.slice(1);
  const body = `This week on ${r.name}: ${lead}. ${r.commitCount} commit${r.commitCount === 1 ? '' : 's'} in.`;
  const withUrl = cfg.content.linkPolicy === 'inline' ? `${body}\n${r.url}` : body;
  return withUrl.length <= cfg.content.maxChars ? withUrl : body.slice(0, cfg.content.maxChars);
}
