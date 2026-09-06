import { http, log, warn, tokenize } from '../util.js';

/* All three sources are free, keyless, and unmetered for this volume. */

async function hackerNews() {
  const r = await http('https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=40', {}, { label: 'hn', retries: 2 });
  if (!r.ok || !r.json) return [];
  return (r.json.hits || []).map((h) => ({
    source: 'Hacker News',
    title: h.title,
    url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
    heat: h.points || 0,
  }));
}

async function devto() {
  const r = await http('https://dev.to/api/articles?top=7&per_page=40', {}, { label: 'devto', retries: 2 });
  if (!r.ok || !r.json) return [];
  return r.json.map((a) => ({
    source: 'dev.to',
    title: a.title,
    url: a.url,
    heat: (a.public_reactions_count || 0) + (a.comments_count || 0) * 3,
    tags: a.tag_list || [],
  }));
}

async function githubRising() {
  const since = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10);
  const u = `https://api.github.com/search/repositories?q=${encodeURIComponent(`created:>${since} stars:>40`)}&sort=stars&order=desc&per_page=25`;
  const headers = { accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const r = await http(u, { headers }, { label: 'gh-search', retries: 2 });
  if (!r.ok || !r.json) return [];
  return (r.json.items || []).map((i) => ({
    source: 'GitHub rising',
    title: `${i.name} — ${i.description || 'no description'}`,
    url: i.html_url,
    heat: i.stargazers_count || 0,
    tags: [i.language, ...(i.topics || [])].filter(Boolean),
  }));
}

/** Relevance = keyword overlap with the user's stack + what they actually touched this week. */
function relevance(item, vocab) {
  const words = tokenize(`${item.title} ${(item.tags || []).join(' ')}`);
  let hit = 0;
  for (const w of words) if (vocab.has(w)) hit++;
  return hit;
}

export async function collectTrends(cfg, activity) {
  if (!cfg.trends?.enabled) return [];
  const { sources } = cfg.trends;
  const jobs = [];
  if (sources.hackernews)   jobs.push(hackerNews().catch((e) => (warn('hn:', e.message), [])));
  if (sources.devto)        jobs.push(devto().catch((e) => (warn('devto:', e.message), [])));
  if (sources.githubSearch) jobs.push(githubRising().catch((e) => (warn('gh-search:', e.message), [])));

  const all = (await Promise.all(jobs)).flat().filter((x) => x.title);

  const vocab = tokenize([
    ...(cfg.identity?.stack || []),
    ...(cfg.identity?.interests || []),
    ...(activity?.repos || []).flatMap((r) => [r.name, r.description, r.language, ...(r.topics || [])]),
  ].filter(Boolean).join(' '));

  const scored = all
    .map((x) => ({ ...x, relevance: relevance(x, vocab) }))
    // normalise heat within source so HN points don't drown dev.to reactions
    .map((x) => ({ ...x, rank: x.relevance * 10 + Math.log10(1 + x.heat) }))
    .sort((a, b) => b.rank - a.rank);

  const picked = [];
  const seen = new Set();
  for (const x of scored) {
    const key = x.title.toLowerCase().slice(0, 40);
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(x);
    if (picked.length >= (cfg.trends.maxItems || 8)) break;
  }
  log(`trends: ${picked.length} item(s) from ${new Set(all.map((a) => a.source)).size} source(s)`);
  return picked;
}

export function renderTrends(items) {
  if (!items?.length) return '(no trend data)';
  return items.map((t) => `- [${t.source}] ${t.title}${t.relevance ? ' (relevant to your stack)' : ''}`).join('\n');
}
