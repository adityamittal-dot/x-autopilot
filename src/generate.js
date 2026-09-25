import { log } from './util.js';
import { generateJSON } from './llm.js';
import { renderNews } from './sources/news.js';

const today = () => new Date().toISOString().slice(0, 10);

function sharedRules(cfg, fmt) {
  return `=== HARD CONSTRAINTS ===
- Maximum ${fmt.maxChars} characters. Target 180-260. At most ${fmt.maxLines} lines.
- No URLs. X suppresses reach on posts with links. Name the source in words instead.
- At most ${cfg.quality.maxHashtags} hashtag and ${cfg.quality.maxEmoji} emoji. Zero is usually right.
- Do not start with: ${(cfg.quality.bannedOpeners || []).map((o) => `"${o.trim()}"`).join(', ')}.
- No engagement bait, no "thoughts?", no calls to action, no thread markers.
- Write as the developer ("I" where natural), never about them.`;
}

function outputSpec(cfg, withSources) {
  const src = withSources ? ',"sources":["the url(s) of the item(s) this variant is about"]' : '';
  return `=== OUTPUT ===
Return ONLY a JSON object, no prose, no code fence:
{"variants":[{"text":"...","why":"one clause on why this will get reach"${src}}, ...]}
Give exactly ${cfg.llm.variants} genuinely different variants: different hook, different
item or fact chosen, different shape. Not rewordings of one sentence.`;
}

function recentBlock(recent) {
  return recent.length ? recent.map((t) => `- ${t.replace(/\n/g, ' ')}`).join('\n') : '(none yet)';
}

/** Weekday post: the latest AI/dev news and research, leaning toward the dev's stack. */
export function buildInsightPrompt({ cfg, voice, playbook, news, angle, recent }) {
  const fmt = cfg.formats.insight;
  return `You write one X post for a developer's account. The goal is reach: a post
developers stop scrolling for, reply to, and repost.

Today is ${today()}.

=== VOICE GUIDE (how this person sounds) ===
${voice}

=== REACH PLAYBOOK (how high-reach dev posts on X are shaped) ===
${playbook}

=== THE DEVELOPER ===
Stack: ${cfg.identity.stack.join(', ')}
Interests: ${cfg.identity.interests.join(', ')}

=== LATEST AI + DEV NEWS AND RESEARCH (pre-screened; the only facts you may use) ===
${renderNews(news)}

Pick the item(s) with the most reach potential for a developer audience: genuinely new,
consequential, and something this developer can credibly have a view on. Prefer items
that touch their stack when the reach potential is similar.

=== THE ANGLE FOR THIS POST ===
${angle.id}: ${angle.brief}

=== POSTS ALREADY PUBLISHED (do not repeat these ideas, stories, or phrasing) ===
${recentBlock(recent)}

${sharedRules(cfg, fmt)}
- Every factual claim must come from the news block above. Do not add numbers, names,
  benchmarks, dates, or features that are not there. Opinions are fine; fake facts are not.
- Never claim the developer used, tested, or benchmarked something. They read about it.

${outputSpec(cfg, true)}`;
}

/** Weekly post: what I learned, what I shipped, what I'm on, from real GitHub activity. */
export function buildRecapPrompt({ cfg, voice, playbook, digest, angle, recent }) {
  const fmt = cfg.formats.recap;
  return `You write one X post for a developer's account: their weekly build-in-public recap.
The goal is reach: the kind of weekly recap that other builders reply to and follow for.

Today is ${today()}.

=== VOICE GUIDE (how this person sounds) ===
${voice}

=== REACH PLAYBOOK (how high-reach dev posts on X are shaped) ===
${playbook}

=== THIS WEEK'S REAL WORK (the only facts you may use) ===
${digest}

Use only what this digest shows. Do not invent struggles or feelings the data can't support.

=== THE ANGLE FOR THIS POST ===
${angle.id}: ${angle.brief}

=== POSTS ALREADY PUBLISHED (do not repeat these ideas or their phrasing) ===
${recentBlock(recent)}

${sharedRules(cfg, fmt)}
- Every factual claim must be traceable to the activity block. No numbers, benchmarks,
  or feature names that are not there.
- Refer to projects by name. No repo URLs.

${outputSpec(cfg, false)}`;
}

export async function generateVariants(prompt, cfg) {
  const { model, parsed } = await generateJSON(prompt, cfg);
  const variants = (parsed?.variants || [])
    .map((v) => ({
      text: String(v.text || '').trim(),
      why: v.why || '',
      sources: Array.isArray(v.sources) ? v.sources.filter((s) => typeof s === 'string') : [],
    }))
    .filter((v) => v.text);
  if (!variants.length) throw new Error('no variants in response');
  log(`llm: ${variants.length} variant(s) from ${model}`);
  return { model, variants };
}
