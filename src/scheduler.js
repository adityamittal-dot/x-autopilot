import { pickWeighted, log, inZone, zonedTime } from './util.js';
import { slotTaken } from './store.js';

/**
 * Today's slots that should be written now: inside their write-ahead window, not
 * already posted, and not so far past their time that they'd bunch up with the next.
 * Every scheduled run checks all slots, so a run GitHub delayed or dropped is
 * picked up by the next one.
 */
export function dueSlots(cfg, history, now = new Date()) {
  const s = cfg.schedule;
  const tz = s.audienceTimezone || 'UTC';
  const today = inZone(now, tz);
  if (s.days && !s.days.includes(today.weekday)) return [];
  return s.slots
    .map((slot) => ({
      id: slot.id,
      type: slot.byWeekday?.[today.weekday] || slot.type,
      day: today.date,
      at: zonedTime(today.date, slot.at, tz),
    }))
    .filter((x) => now >= x.at.getTime() - (s.writeAheadHours ?? 9) * 3600e3)
    .filter((x) => now <= x.at.getTime() + (s.skipIfLateHours ?? 2) * 3600e3)
    .filter((x) => !slotTaken(history, x.id, x.day));
}

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

const BUSINESS = /\$\d|\bpric|\bfund|\braise|\brevenue|\bcost|\bmargin|\bstartup|\bsaas\b|\bipo\b|\bacqui/i;

function isEligible(angle, { news }) {
  if (angle.id === 'paper-plain') return (news || []).some((n) => n.kind === 'research');
  if (angle.id === 'business-of-ai') return (news || []).some((n) => n.kind === 'business' || BUSINESS.test(`${n.title} ${n.summary}`));
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
