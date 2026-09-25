import { http, log, warn, tokenize } from '../util.js';

/*
 * Latest AI + dev news and research. Every source is free and keyless.
 * Each item: { source, kind: 'news'|'research'|'repo', title, url, summary, heat, publishedAt }
 */

const clip = (s, n = 280) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
const decode = (s) => String(s || '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&amp;/g, '&');

async function hackerNews(cfg, since) {
  const seen = new Map();
  for (const query of cfg.news.hnQueries || ['AI']) {
    const u = new URL('https://hn.algolia.com/api/v1/search');
    u.searchParams.set('query', query);
    u.searchParams.set('tags', 'story');
    u.searchParams.set('numericFilters', `created_at_i>${Math.floor(since / 1000)},points>${cfg.news.hnMinPoints ?? 60}`);
    u.searchParams.set('hitsPerPage', '20');
    const r = await http(u.toString(), {}, { label: `hn:${query}`, retries: 1 });
    for (const h of r.json?.hits || []) {
      if (seen.has(h.objectID)) continue;
      seen.set(h.objectID, {
        source: 'Hacker News', kind: 'news', title: h.title,
        url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
        summary: `${h.points} points, ${h.num_comments} comments on HN`,
        heat: h.points || 0, publishedAt: h.created_at,
      });
    }
  }
  return [...seen.values()];
}

async function huggingFacePapers(cfg, since) {
  const r = await http('https://huggingface.co/api/daily_papers?limit=100', {}, { label: 'hf-papers', retries: 1 });
  return (r.json || [])
    .filter((p) => new Date(p.paper?.submittedOnDailyAt || p.publishedAt) >= since)
    .map((p) => ({
      source: 'Hugging Face papers', kind: 'research', title: p.title || p.paper?.title,
      url: `https://huggingface.co/papers/${p.paper?.id}`,
      summary: clip(p.paper?.summary || p.summary, 400),
      heat: p.paper?.upvotes || 0, publishedAt: p.paper?.submittedOnDailyAt || p.publishedAt,
    }));
}

async function simonWillison(cfg, since) {
  const r = await http('https://simonwillison.net/atom/everything/', {}, { label: 'simonwillison', retries: 1 });
  const entries = String(r.body || '').match(/<entry>[\s\S]*?<\/entry>/g) || [];
  return entries.map((e) => {
    const get = (tag) => (e.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)) || [])[1];
    return {
      source: 'Simon Willison', kind: 'news', title: decode(get('title')).trim(),
      url: (e.match(/<link[^>]*href="([^"]+)"/) || [])[1],
      summary: clip(decode(get('summary') || get('content')), 400),
      heat: 50, // curated feed with no score of its own; treated as mid-heat
      publishedAt: get('updated') || get('published'),
    };
  }).filter((x) => new Date(x.publishedAt) >= since);
}

async function devto(cfg, since) {
  const out = [];
  for (const tag of cfg.news.devtoTags || ['ai']) {
    const r = await http(`https://dev.to/api/articles?tag=${encodeURIComponent(tag)}&top=3&per_page=20`, {}, { label: `devto:${tag}`, retries: 1 });
    for (const a of r.json || []) {
      if (new Date(a.published_at) < since) continue;
      out.push({
        source: 'dev.to', kind: 'news', title: a.title, url: a.url, summary: clip(a.description),
        heat: (a.public_reactions_count || 0) + (a.comments_count || 0) * 3, publishedAt: a.published_at,
        tags: a.tag_list || [],
      });
    }
  }
  return out;
}

async function lobsters(cfg, since) {
  const r = await http('https://lobste.rs/t/ai.json', {}, { label: 'lobsters', retries: 1 });
  return (r.json || [])
    .filter((s) => new Date(s.created_at) >= since)
    .map((s) => ({
      source: 'Lobsters', kind: 'news', title: s.title, url: s.url || s.short_id_url,
      summary: clip(s.description_plain), heat: (s.score || 0) * 5, publishedAt: s.created_at, tags: s.tags,
    }));
}

async function githubRising(cfg, since) {
  const day = new Date(since).toISOString().slice(0, 10);
  const q = `created:>${day} stars:>30 topic:${cfg.news.githubTopic || 'llm'}`;
  const headers = { accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const r = await http(`https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=15`,
    { headers }, { label: 'gh-rising', retries: 1 });
  return (r.json?.items || []).map((i) => ({
    source: 'GitHub rising', kind: 'repo', title: `${i.full_name}: ${i.description || 'no description'}`,
    url: i.html_url, summary: `${i.stargazers_count} stars since ${i.created_at.slice(0, 10)}, ${i.language || 'n/a'}`,
    heat: i.stargazers_count || 0, publishedAt: i.created_at, tags: [i.language, ...(i.topics || [])].filter(Boolean),
  }));
}

const SOURCES = { hackernews: hackerNews, huggingface: huggingFacePapers, simonwillison: simonWillison, devto, lobsters, githubRising };

/**
 * Collect, dedupe, and rank. Heat is converted to a within-source percentile so
 * HN points don't drown paper upvotes; stack relevance and recency break ties.
 */
export async function collectNews(cfg, { exclude = new Set() } = {}) {
  const since = Date.now() - (cfg.news.lookbackHours ?? 72) * 3600e3;
  const enabled = Object.entries(cfg.news.sources || {}).filter(([, on]) => on).map(([k]) => k);
  const batches = await Promise.all(enabled.map((k) =>
    SOURCES[k](cfg, since).catch((e) => (warn(`news ${k}: ${e.message}`), []))));

  const vocab = tokenize([...(cfg.identity?.stack || []), ...(cfg.identity?.interests || [])].join(' '));
  const ranked = [];
  for (const items of batches) {
    const sorted = items.filter((x) => x.title && x.url).sort((a, b) => a.heat - b.heat);
    sorted.forEach((x, i) => {
      const pct = sorted.length > 1 ? i / (sorted.length - 1) : 0.5;
      const words = tokenize(`${x.title} ${x.summary} ${(x.tags || []).join(' ')}`);
      let stackHits = 0;
      for (const w of words) if (vocab.has(w)) stackHits++;
      const ageH = (Date.now() - new Date(x.publishedAt).getTime()) / 3600e3;
      ranked.push({ ...x, stackHits, rank: pct * 10 + Math.min(stackHits, 3) * 2 + Math.max(0, 3 - ageH / 24) });
    });
  }

  const picked = [];
  const seenKeys = new Set();
  for (const x of ranked.sort((a, b) => b.rank - a.rank)) {
    const key = x.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40);
    if (seenKeys.has(key) || exclude.has(x.url)) continue;
    seenKeys.add(key);
    picked.push(x);
    if (picked.length >= (cfg.news.maxItems || 18)) break;
  }
  log(`news: ${picked.length} item(s) from ${enabled.length} source(s), ${batches.flat().length} seen`);
  return picked;
}

export function renderNews(items) {
  if (!items?.length) return '(no news collected)';
  return items.map((x, i) => [
    `[${i + 1}] (${x.kind}, ${x.source}${x.stackHits ? ', touches your stack' : ''}) ${x.title}`,
    x.summary ? `    ${x.summary}` : null,
    x.reach ? `    reach: ${x.reach}` : null,
    `    url: ${x.url}`,
  ].filter(Boolean).join('\n')).join('\n');
}
