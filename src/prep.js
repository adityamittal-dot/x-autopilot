import { log, warn } from './util.js';
import { generateJSON } from './llm.js';
import { renderNews } from './sources/news.js';
import { renderActivity } from './sources/github.js';

/*
 * Token-heavy prep runs on the cheap worker model (llm.worker, Haiku by default).
 * It reads the big raw inputs and hands the expensive writer model a short brief.
 * Both steps fall back to the raw data if the worker fails, so a bad worker day
 * degrades quality slightly instead of skipping the post.
 */

/**
 * Read the whole news pool (up to ~40 items) and keep the few with the most reach
 * potential, each as a short factual brief. Returns items shaped like news items,
 * so the writer prompt and source tracking work the same either way.
 */
export async function triageNews(news, cfg, recent) {
  const keep = cfg.news.briefs ?? 6;
  const prompt = `Below is today's pool of AI and developer news and research, numbered.

=== THE AUDIENCE ===
${cfg.identity.audience || 'Developers on X.'} The account belongs to a full-stack developer.
Stack: ${cfg.identity.stack.join(', ')}
Interests: ${cfg.identity.interests.join(', ')}

=== ALREADY POSTED RECENTLY (skip items on the same story) ===
${recent.length ? recent.slice(-10).map((t) => `- ${t.replace(/\n/g, ' ')}`).join('\n') : '(none)'}

=== THE POOL ===
${renderNews(news)}

=== TASK ===
Choose the ${keep} items with the most reach potential for builders on X right now:
genuinely new, consequential for people who build software or run it as a business, and
something a working developer can have a real opinion on. Big moves people are already
talking about (model releases, pricing changes, major deals, security incidents) beat
niche ones. Keep a mix: at least two business or startup items (pricing, funding, deals,
what AI does to SaaS) when strong ones exist, and at most one research paper unless
papers clearly dominate the day. Prefer items touching the interests when potential is similar.

For each, write a brief using ONLY facts stated in that item's title and summary.
Do not add model sizes, benchmarks, dates, company names, or any detail not in the text.

Return ONLY JSON:
{"picks":[{"n":<item number>,"brief":"2-3 plain factual sentences from the item text","reach":"one clause: why developers will engage"}]}`;

  try {
    const { parsed } = await generateJSON(prompt, cfg, 'worker');
    const picks = (parsed?.picks || [])
      .map((p) => ({ item: news[Number(p.n) - 1], brief: String(p.brief || '').trim(), reach: String(p.reach || '').trim() }))
      .filter((p) => p.item && p.brief)
      .slice(0, keep);
    if (picks.length < Math.min(3, news.length)) throw new Error(`only ${picks.length} usable pick(s)`);
    log(`triage: kept ${picks.length} of ${news.length} items`);
    return picks.map(({ item, brief, reach }) => ({
      ...item,
      summary: brief,
      reach,
    }));
  } catch (e) {
    warn(`triage failed (${e.message}); writer gets the top raw items instead`);
    return news.slice(0, 15);
  }
}

/**
 * Condense a week of commits across repos into a short learned / shipped / in-progress
 * digest, quoting commit subjects so the writer can stay factual.
 */
export async function condenseActivity(activity, cfg) {
  const prompt = `Below is one developer's real GitHub activity for the past week.

${renderActivity(activity)}

=== TASK ===
Condense it into a digest for writing a weekly build-in-public recap. Use ONLY what the
commits, PRs, and releases show. For every point, quote the commit subject(s) it comes from.
- shipped: finished, user-visible things (features, releases, fixes that landed)
- learned: gotchas or lessons the commits imply (a fix for a crash implies a gotcha)
- inProgress: work that looks unfinished or ongoing
Keep at most 4 points per list, most interesting first. Name the repo for each point.

Return ONLY JSON:
{"shipped":[{"repo":"...","point":"...","evidence":["commit subject", ...]}],
 "learned":[...same shape...],
 "inProgress":[...same shape...]}`;

  try {
    const { parsed } = await generateJSON(prompt, cfg, 'worker');
    const lists = ['shipped', 'learned', 'inProgress'];
    const total = lists.reduce((n, k) => n + (Array.isArray(parsed?.[k]) ? parsed[k].length : 0), 0);
    if (!total) throw new Error('empty digest');
    const text = lists.map((k) => {
      const rows = (parsed[k] || []).map((p) =>
        `  - [${p.repo}] ${p.point}${p.evidence?.length ? `\n      from: ${p.evidence.slice(0, 3).map((e) => `"${e}"`).join(', ')}` : ''}`);
      return `${k.toUpperCase()}:\n${rows.join('\n') || '  (nothing)'}`;
    }).join('\n\n');
    log(`condense: digest with ${total} point(s)`);
    return text;
  } catch (e) {
    warn(`condense failed (${e.message}); writer gets the raw activity instead`);
    return renderActivity(activity);
  }
}
