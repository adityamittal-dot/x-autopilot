import { http, log, warn } from '../util.js';

const API = 'https://api.github.com';

let tokenIsBad = false;

async function gh(pathname, params = {}) {
  const u = new URL(API + pathname);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) u.searchParams.set(k, v);
  const headers = { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' };
  if (process.env.GITHUB_TOKEN && !tokenIsBad) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

  const res = await http(u.toString(), { headers }, { label: `github ${pathname}` });
  // A stale or wrong-scoped token should not take the run down: public data works without one.
  if (res.status === 401 && headers.authorization) {
    warn('GITHUB_TOKEN rejected (401) — falling back to unauthenticated public API');
    tokenIsBad = true;
    delete headers.authorization;
    return http(u.toString(), { headers }, { label: `github ${pathname} (anon)` });
  }
  return res;
}

const firstLine = (m) => String(m || '').split('\n')[0].trim();

function isNoise(subject, patterns) {
  const m = String(subject || '').toLowerCase().trim();
  if (!m || m.length < 8) return true;
  return patterns.some((p) => new RegExp(p, 'i').test(m));
}

/** Git trailers and tool signatures are metadata, never post material. */
const TRAILER = /^(?:[A-Za-z-]+-by|cc|co-authored-by|signed-off-by|refs|see-also|change-id)\s*:/i;
const isTrailer = (l) => TRAILER.test(l) || /^(?:🤖|Generated with)/iu.test(l) || /^https?:\/\/\S+$/.test(l);

function parseCommit(message) {
  const lines = String(message || '').split('\n').map((l) => l.trim());
  const head = lines[0] || '';
  const body = lines.slice(1).filter(Boolean).filter((l) => !isTrailer(l));

  // GitHub's merge commits carry the PR title as the body's first line. That
  // title is the most human-readable summary of the work, so prefer it.
  const merge = head.match(/^Merge pull request #(\d+) from \S+$/i);
  const text = merge && body[0] ? body[0] : head;
  const isMergedPR = Boolean(merge && body[0]);

  const cc = text.match(/^(feat|fix|perf|refactor|docs|test|build|ci|style|chore)(\([^)]*\))?!?:\s*(.+)$/i);
  return {
    type: cc ? cc[1].toLowerCase() : null,
    scope: cc ? (cc[2] || '').replace(/[()]/g, '') || null : null,
    subject: cc ? cc[3] : text,
    prNumber: merge ? Number(merge[1]) : null,
    isMergedPR,
    // an extra sentence of context, when the commit body has one
    detail: (isMergedPR ? body[1] : body[0]) || null,
  };
}

/** Events feed, up to 3 pages (GitHub's cap), stopping once we pass the window. */
async function fetchEvents(username, since) {
  const out = [];
  for (let page = 1; page <= 3; page++) {
    const res = await gh(`/users/${username}/events/public`, { per_page: 100, page });
    if (!res.ok) {
      if (page === 1) throw new Error(`GitHub events ${res.status}: ${res.body.slice(0, 200)}`);
      break;
    }
    const batch = res.json || [];
    out.push(...batch);
    if (batch.length < 100) break;
    const oldest = new Date(batch[batch.length - 1].created_at);
    if (oldest < since) break;
  }
  return out;
}

async function fetchCommits(fullName, { since, sha, username }) {
  const res = await gh(`/repos/${fullName}/commits`, { since: since.toISOString(), sha, per_page: 50 });
  if (!res.ok) {
    // 409 = empty repo, 404 = gone/private, 422 = bad ref. None are worth failing the run over.
    if (![404, 409, 422].includes(res.status)) warn(`commits ${fullName}${sha ? `@${sha}` : ''}: HTTP ${res.status}`);
    return [];
  }
  return (res.json || [])
    .filter((c) => {
      const login = c.author?.login;
      if (login && login.toLowerCase() !== username.toLowerCase()) return false;  // co-contributors
      if (login && /\[bot\]$/i.test(login)) return false;
      return true;
    })
    .map((c) => ({ sha: c.sha, ...parseCommit(c.commit?.message), date: c.commit?.author?.date }));
}

/**
 * The public events feed no longer inlines commit messages or PR titles — a
 * PushEvent payload is just {repository_id, push_id, ref, head, before}. So the
 * feed is used only to discover WHICH repos and branches were touched, and the
 * actual content is read from the repo-scoped commits endpoint.
 */
export async function collectGitHubActivity(cfg) {
  const { username, excludeRepos = [], excludeCommitPatterns = [], maxRepos = 4 } = cfg.github;
  const since = new Date(Date.now() - cfg.github.lookbackDays * 864e5);

  const [events, reposRes] = await Promise.all([
    fetchEvents(username, since),
    gh(`/users/${username}/repos`, { sort: 'pushed', direction: 'desc', per_page: 30, type: 'owner' }),
  ]);
  const ownedRepos = reposRes.ok ? (reposRes.json || []) : [];

  const skip = (full) => {
    const short = full.split('/')[1] || full;
    return excludeRepos.some((x) => x.toLowerCase() === short.toLowerCase());
  };

  const meta = new Map();
  for (const r of ownedRepos) {
    meta.set(r.full_name, {
      name: r.name, fullName: r.full_name, description: r.description, language: r.language,
      stars: r.stargazers_count, url: r.html_url, homepage: r.homepage || null,
      topics: r.topics || [], defaultBranch: r.default_branch, createdAt: r.created_at,
      pushedAt: r.pushed_at, isFork: r.fork,
    });
  }

  // ---- discovery ----
  const touched = new Map();
  const bump = (full) => {
    if (!touched.has(full)) touched.set(full, { full, events: 0, refs: new Set(), sawRelease: false, isNew: false, wentPublic: false });
    return touched.get(full);
  };

  for (const ev of events) {
    if (new Date(ev.created_at) < since) continue;
    const full = ev.repo?.name;
    if (!full || skip(full)) continue;
    const t = bump(full);
    t.events++;
    if (ev.type === 'PushEvent' && ev.payload?.ref) t.refs.add(String(ev.payload.ref).replace(/^refs\/heads\//, ''));
    if (ev.type === 'ReleaseEvent') t.sawRelease = true;
    if (ev.type === 'CreateEvent' && ev.payload?.ref_type === 'repository') t.isNew = true;
    if (ev.type === 'PublicEvent') t.wentPublic = true;
  }
  // repos pushed inside the window but beyond the 300-event ceiling
  for (const r of ownedRepos) {
    if (skip(r.full_name)) continue;
    if (r.pushed_at && new Date(r.pushed_at) >= since) bump(r.full_name);
  }

  const candidates = [...touched.values()]
    .sort((a, b) => (b.events - a.events) ||
      (new Date(meta.get(b.full)?.pushedAt || 0) - new Date(meta.get(a.full)?.pushedAt || 0)))
    .slice(0, maxRepos);

  // ---- content ----
  const repos = [];
  const highlights = [];

  for (const t of candidates) {
    const m = meta.get(t.full) || { name: t.full.split('/')[1], fullName: t.full, url: `https://github.com/${t.full}` };
    const seen = new Map();

    const refs = [undefined];  // default branch first
    for (const r of [...t.refs].filter((r) => r && r !== m.defaultBranch).slice(0, 2)) refs.push(r);

    for (const ref of refs) {
      for (const c of await fetchCommits(t.full, { since, sha: ref, username })) {
        if (!seen.has(c.sha)) seen.set(c.sha, c);
      }
    }

    const all = [...seen.values()].sort((a, b) => new Date(b.date) - new Date(a.date));
    const commits = [];
    for (const c of all) {
      if (isNoise(c.subject, excludeCommitPatterns)) continue;
      if (commits.some((x) => x.subject === c.subject)) continue;
      commits.push(c);
      if (commits.length >= 20) break;
    }

    let releases = [];
    if (t.sawRelease) {
      const res = await gh(`/repos/${t.full}/releases`, { per_page: 3 });
      if (res.ok) {
        releases = (res.json || [])
          .filter((r) => new Date(r.published_at || r.created_at) >= since)
          .map((r) => ({ tag: r.tag_name, name: r.name, url: r.html_url }));
      }
    }

    const mergedPRs = commits.filter((c) => c.isMergedPR).map((c) => ({ title: c.subject, number: c.prNumber }));

    const entry = {
      ...m, commits, commitCount: all.length, releases,
      prs: mergedPRs, issues: [], isNew: t.isNew, wentPublic: t.wentPublic,
      types: commits.reduce((acc, c) => (c.type && (acc[c.type] = (acc[c.type] || 0) + 1), acc), {}),
    };
    entry.score = commits.length * 3 + all.length + releases.length * 15 +
                  mergedPRs.length * 6 + (t.isNew ? 12 : 0) + (t.wentPublic ? 8 : 0);
    if (entry.score > 0) repos.push(entry);

    for (const r of releases) highlights.push({ kind: 'release', repo: t.full, ...r });
    if (t.isNew) highlights.push({ kind: 'new-repo', repo: t.full, description: m.description });
    if (t.wentPublic) highlights.push({ kind: 'went-public', repo: t.full });
    for (const p of mergedPRs.slice(0, 3)) highlights.push({ kind: 'pr-merged', repo: t.full, title: p.title });
  }

  repos.sort((a, b) => b.score - a.score);

  const digest = {
    windowDays: cfg.github.lookbackDays,
    since: since.toISOString(),
    username,
    repos: repos.slice(0, 5),
    highlights: highlights.slice(0, 8),
    totalCommits: repos.reduce((s, r) => s + r.commitCount, 0),
    activeRepoCount: repos.length,
  };

  log(`github: ${digest.totalCommits} commit(s) across ${digest.activeRepoCount} repo(s) in ${cfg.github.lookbackDays}d`);
  if (!repos.length) warn('github: no qualifying activity in the window');
  return digest;
}

/** Compact, token-cheap rendering of the digest for the prompt. */
export function renderActivity(d) {
  if (!d.repos.length) return '(no public GitHub activity in this window)';
  const out = [];
  for (const r of d.repos) {
    const b = [`REPO ${r.name}${r.isNew ? ' (brand new)' : ''}${r.wentPublic ? ' (just made public)' : ''}`];
    if (r.description) b.push(`  about: ${r.description}`);
    if (r.language) b.push(`  language: ${r.language}${r.stars ? `, ${r.stars} stars` : ''}`);
    b.push(`  ${r.commitCount} commit(s) this window`);
    if (r.commits.length) {
      b.push('  what changed:');
      for (const c of r.commits.slice(0, 12)) {
        b.push(`    - ${c.type ? `[${c.type}] ` : ''}${c.subject}`);
        if (c.detail) b.push(`        context: ${c.detail.slice(0, 160)}`);
      }
    }
    for (const rel of r.releases) b.push(`  released: ${rel.tag || rel.name}`);
    b.push(`  url: ${r.url}`);
    out.push(b.join('\n'));
  }
  return out.join('\n\n');
}
