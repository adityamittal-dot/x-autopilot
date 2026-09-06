import { http, log, warn } from '../util.js';

const API = 'https://api.github.com';

let tokenIsBad = false;

async function gh(pathname, params = {}) {
  const u = new URL(API + pathname);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
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

const clean = (m) => String(m || '').split('\n')[0].trim();

function isNoise(msg, patterns) {
  const m = clean(msg).toLowerCase();
  if (!m || m.length < 8) return true;
  return patterns.some((p) => new RegExp(p, 'i').test(m));
}

/** Strip a conventional-commit prefix but remember the type. */
function parseCommit(msg) {
  const text = clean(msg);
  const m = text.match(/^(feat|fix|perf|refactor|docs|test|build|ci|style|chore)(\([^)]*\))?!?:\s*(.+)$/i);
  return m
    ? { type: m[1].toLowerCase(), scope: (m[2] || '').replace(/[()]/g, '') || null, subject: m[3] }
    : { type: null, scope: null, subject: text };
}

/**
 * Collect a digest of what the user actually did, from their public event feed.
 * One request for events + one for repos = well inside any rate limit.
 */
export async function collectGitHubActivity(cfg) {
  const { username, excludeRepos = [], excludeCommitPatterns = [] } = cfg.github;
  const since = new Date(Date.now() - cfg.github.lookbackDays * 864e5);

  const [eventsRes, reposRes] = await Promise.all([
    gh(`/users/${username}/events/public`, { per_page: 100 }),
    gh(`/users/${username}/repos`, { sort: 'pushed', direction: 'desc', per_page: 30, type: 'owner' }),
  ]);

  if (!eventsRes.ok) throw new Error(`GitHub events ${eventsRes.status}: ${eventsRes.body.slice(0, 200)}`);
  const events = eventsRes.json || [];
  const allRepos = reposRes.ok ? (reposRes.json || []) : [];

  const repoMeta = new Map();
  for (const r of allRepos) {
    repoMeta.set(r.full_name, {
      name: r.name,
      fullName: r.full_name,
      description: r.description,
      language: r.language,
      stars: r.stargazers_count,
      url: r.html_url,
      homepage: r.homepage || null,
      topics: r.topics || [],
      createdAt: r.created_at,
      pushedAt: r.pushed_at,
      isFork: r.fork,
    });
  }

  const skip = (full) => {
    const short = full.split('/')[1] || full;
    return excludeRepos.some((x) => x.toLowerCase() === short.toLowerCase());
  };

  const repos = new Map();   // fullName -> aggregated work
  const highlights = [];     // releases, new repos, merged PRs

  const touch = (full) => {
    if (!repos.has(full)) {
      repos.set(full, {
        ...(repoMeta.get(full) || { name: full.split('/')[1], fullName: full, url: `https://github.com/${full}` }),
        commits: [], commitCount: 0, types: {}, prs: [], issues: [], releases: [],
      });
    }
    return repos.get(full);
  };

  for (const ev of events) {
    const when = new Date(ev.created_at);
    if (when < since) continue;
    const full = ev.repo?.name;
    if (!full || skip(full)) continue;

    switch (ev.type) {
      case 'PushEvent': {
        const r = touch(full);
        r.commitCount += ev.payload?.distinct_size ?? ev.payload?.commits?.length ?? 0;
        for (const c of ev.payload?.commits || []) {
          if (isNoise(c.message, excludeCommitPatterns)) continue;
          const p = parseCommit(c.message);
          if (p.type) r.types[p.type] = (r.types[p.type] || 0) + 1;
          if (r.commits.length < 25 && !r.commits.some((x) => x.subject === p.subject)) r.commits.push(p);
        }
        break;
      }
      case 'ReleaseEvent': {
        const r = touch(full);
        const rel = { tag: ev.payload?.release?.tag_name, name: ev.payload?.release?.name, url: ev.payload?.release?.html_url };
        r.releases.push(rel);
        highlights.push({ kind: 'release', repo: full, ...rel, at: ev.created_at });
        break;
      }
      case 'CreateEvent': {
        if (ev.payload?.ref_type === 'repository') {
          const r = touch(full);
          r.isNew = true;
          highlights.push({ kind: 'new-repo', repo: full, description: r.description, at: ev.created_at });
        }
        break;
      }
      case 'PublicEvent': {
        const r = touch(full); r.wentPublic = true;
        highlights.push({ kind: 'went-public', repo: full, at: ev.created_at });
        break;
      }
      case 'PullRequestEvent': {
        const pr = ev.payload?.pull_request;
        if (!pr) break;
        const r = touch(full);
        const entry = { title: pr.title, merged: !!pr.merged, action: ev.payload.action, additions: pr.additions, deletions: pr.deletions };
        r.prs.push(entry);
        if (pr.merged) highlights.push({ kind: 'pr-merged', repo: full, title: pr.title, at: ev.created_at });
        break;
      }
      case 'IssuesEvent': {
        if (ev.payload?.action === 'opened' && ev.payload?.issue) {
          touch(full).issues.push({ title: ev.payload.issue.title });
        }
        break;
      }
      default: break;
    }
  }

  // Rank repos by how much real work landed in them.
  const ranked = [...repos.values()]
    .map((r) => ({
      ...r,
      score: r.commits.length * 3 + r.commitCount + r.releases.length * 15 +
             r.prs.filter((p) => p.merged).length * 6 + (r.isNew ? 12 : 0) + (r.wentPublic ? 8 : 0),
    }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);

  const digest = {
    windowDays: cfg.github.lookbackDays,
    since: since.toISOString(),
    username,
    repos: ranked.slice(0, 5),
    highlights: highlights.slice(0, 8),
    totalCommits: ranked.reduce((s, r) => s + r.commitCount, 0),
    activeRepoCount: ranked.length,
  };

  log(`github: ${digest.totalCommits} commits across ${digest.activeRepoCount} repo(s) in ${cfg.github.lookbackDays}d`);
  if (!ranked.length) warn('github: no qualifying activity in the window');
  return digest;
}

/** Compact, token-cheap rendering of the digest for the prompt. */
export function renderActivity(d) {
  if (!d.repos.length) return '(no public GitHub activity in this window)';
  const lines = [];
  for (const r of d.repos) {
    const bits = [`REPO ${r.name}${r.isNew ? ' (brand new)' : ''}${r.wentPublic ? ' (just made public)' : ''}`];
    if (r.description) bits.push(`  about: ${r.description}`);
    if (r.language) bits.push(`  language: ${r.language}${r.stars ? `, ${r.stars} stars` : ''}`);
    bits.push(`  ${r.commitCount} commit(s) this window`);
    if (r.commits.length) {
      bits.push('  commit subjects:');
      for (const c of r.commits.slice(0, 12)) bits.push(`    - ${c.type ? `[${c.type}] ` : ''}${c.subject}`);
    }
    for (const rel of r.releases) bits.push(`  released: ${rel.tag || rel.name}`);
    for (const p of r.prs.filter((x) => x.merged).slice(0, 4)) bits.push(`  merged PR: ${p.title}`);
    for (const i of r.issues.slice(0, 3)) bits.push(`  opened issue: ${i.title}`);
    bits.push(`  url: ${r.url}`);
    lines.push(bits.join('\n'));
  }
  return lines.join('\n\n');
}
