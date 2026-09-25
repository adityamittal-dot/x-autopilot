import { pickWeighted, log } from './util.js';

/**
 * Engagement score for a stored post, from whatever metrics Buffer returned.
 * Impressions are the denominator when we have them, so a small account's
 * good post isn't buried by a big account's mediocre one.
 */
export function engagementOf(post) {
  const m = post.metrics;
  if (!m || !Object.keys(m).length) return null;
  const val = (k) => Number(m[k] ?? 0);
  const interactions = val('reactions') + val('likes') + val('comments') + val('replies') +
                       val('reposts') + val('shares') + val('quotes') + val('saves') + val('follows') * 5;
  const impressions = val('impressions') || val('views') || val('reach');
  if (impressions > 0) return (interactions / impressions) * 1000; // per-mille
  return interactions;
}

/**
 * Epsilon-greedy angle selection. Explores until an angle has enough samples,
 * then leans on what actually performed. Falls back to configured weights.
 */
export function chooseAngle(cfg, history, type, ctx = {}) {
  const all = cfg.formats[type].angles;
  const angles = all.filter((a) => isEligible(a, ctx));
  if (!angles.length) return all[0];

  const recentIds = history.posts.filter((p) => (p.type || 'recap') === type).slice(-2).map((p) => p.angle);
  const fresh = angles.filter((a) => !recentIds.includes(a.id));
  const pool = fresh.length ? fresh : angles;

  if (!cfg.learning?.enabled || Math.random() < (cfg.learning.explorationRate ?? 0.25)) {
    const a = pickWeighted(pool);
    log(`angle: ${a.id} (weighted pick)`);
    return a;
  }

  const stats = new Map();
  for (const p of history.posts) {
    const e = engagementOf(p);
    if (e === null || !p.angle || (p.type || 'recap') !== type) continue;
    const s = stats.get(p.angle) || { n: 0, sum: 0 };
    s.n++; s.sum += e;
    stats.set(p.angle, s);
  }

  const min = cfg.learning.minSamplesPerAngle ?? 3;
  const scored = pool.map((a) => {
    const s = stats.get(a.id);
    return { a, n: s?.n ?? 0, avg: s && s.n ? s.sum / s.n : null };
  });

  if (scored.some((x) => x.n < min)) {
    const under = scored.filter((x) => x.n < min);
    const a = pickWeighted(under.map((x) => x.a));
    log(`angle: ${a.id} (still gathering data)`);
    return a;
  }

  const best = scored.sort((x, y) => y.avg - x.avg)[0];
  log(`angle: ${best.a.id} (best avg engagement ${best.avg.toFixed(2)} over ${best.n})`);
  return best.a;
}

function isEligible(angle, { news }) {
  if (angle.id === 'paper-plain') return (news || []).some((n) => n.kind === 'research');
  if (angle.id === 'roundup') return (news || []).length >= 6;
  return true;
}

/** Best audience-local weekday-hour slot, learned from history; empty until there is data. */
export function bestSlotReport(history) {
  const buckets = new Map();
  for (const p of history.posts) {
    const e = engagementOf(p);
    if (e === null || !p.localSlot) continue;
    const b = buckets.get(p.localSlot) || { n: 0, sum: 0 };
    b.n++; b.sum += e;
    buckets.set(p.localSlot, b);
  }
  return [...buckets.entries()]
    .map(([slot, b]) => ({ slot, n: b.n, avg: b.sum / b.n }))
    .sort((a, b) => b.avg - a.avg);
}
