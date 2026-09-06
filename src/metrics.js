import { loadConfig, log, warn, die, sleep } from './util.js';
import { getPostMetrics } from './publish/buffer.js';
import { loadHistory, saveHistory } from './store.js';

/**
 * Pull engagement numbers back from Buffer for anything published in the last
 * 45 days. Buffer refreshes metrics on its own cadence, so re-syncing an older
 * post is cheap and worth it.
 */
async function run() {
  loadConfig();
  const history = loadHistory();
  const now = Date.now();

  const targets = history.posts.filter((p) => {
    if (!p.id) return false;
    const age = (now - new Date(p.dueAt || p.createdAt).getTime()) / 864e5;
    if (age < 0.5 || age > 45) return false;                       // too fresh / too old
    if (!p.metricsUpdatedAt) return true;
    const since = (now - new Date(p.metricsUpdatedAt).getTime()) / 864e5;
    return since > (age < 7 ? 0.9 : 6);                            // refresh fast then slow
  });

  if (!targets.length) { log('metrics: nothing to sync'); return; }
  log(`metrics: syncing ${targets.length} post(s)`);

  let updated = 0;
  for (const p of targets) {
    try {
      const m = await getPostMetrics(p.id);
      if (m) {
        p.metrics = m.metrics;
        p.status = m.status;
        p.metricsUpdatedAt = new Date().toISOString();
        updated++;
        log(`  ${p.id}: ${Object.entries(m.metrics).map(([k, v]) => `${k}=${v}`).join(' ') || '(no metrics yet)'}`);
      }
    } catch (e) {
      warn(`  ${p.id}: ${e.message}`);
    }
    await sleep(1500); // stay far under 100 req / 15 min on the free plan
  }

  saveHistory(history);
  log(`metrics: updated ${updated}`);
}

run().catch((e) => die(e.stack || e.message));
