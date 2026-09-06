import { loadConfig, loadVoice, log, warn, die, inZone } from './util.js';
import { collectGitHubActivity } from './sources/github.js';
import { collectTrends } from './sources/trends.js';
import { generateVariants, templateFallback } from './generate.js';
import { validate, score } from './quality.js';
import { chooseAngle } from './scheduler.js';
import { resolveChannel, createPost } from './publish/buffer.js';
import { loadHistory, appendPost, recentTexts, daysSinceLastPost } from './store.js';

const DRY = process.argv.includes('--dry-run') || process.env.DRY_RUN === 'true';

async function run() {
  const cfg = loadConfig();
  const voice = loadVoice();
  const history = loadHistory();

  // Look back exactly as far as the gap since the last post, so nothing is
  // double-covered and nothing is missed after a quiet week.
  const gap = daysSinceLastPost(history);
  if (gap !== null) {
    cfg.github.lookbackDays = Math.round(
      Math.min(cfg.github.maxLookbackDays, Math.max(cfg.github.minLookbackDays, gap + 1))
    );
  }
  log(`mode=${DRY ? 'DRY RUN' : 'live'} lookback=${cfg.github.lookbackDays}d posts=${history.posts.length}`);

  const activity = await collectGitHubActivity(cfg);
  if (!activity.repos.length) {
    warn('Nothing shipped in this window. Skipping rather than inventing a post.');
    return { skipped: 'no-activity' };
  }

  const trends = await collectTrends(cfg, activity).catch((e) => (warn('trends:', e.message), []));
  const angle = chooseAngle(cfg, history, activity);
  const recent = recentTexts(history, cfg.quality.similarityWindow);

  // Generate, gate, score. One retry with a nudged prompt if everything fails.
  let chosen = null, model = null, attempts = [];
  for (let attempt = 1; attempt <= 2 && !chosen; attempt++) {
    let batch;
    try {
      batch = await generateVariants({ cfg, voice, activity, trends, angle, recent });
    } catch (e) {
      warn(`generation attempt ${attempt}: ${e.message}`);
      continue;
    }
    model = batch.model;
    const graded = batch.variants.map((v) => {
      const check = validate(v.text, cfg, recent);
      return { ...v, ...check, score: check.pass ? score(v.text, cfg) : -Infinity };
    });
    attempts.push(...graded);
    const passing = graded.filter((g) => g.pass).sort((a, b) => b.score - a.score);
    for (const g of graded) {
      log(`  ${g.pass ? '✓' : '✗'} [${g.pass ? g.score : g.reasons.join(', ')}] ${g.text.replace(/\n/g, ' ⏎ ').slice(0, 90)}`);
    }
    if (passing.length) chosen = passing[0];
    else if (attempt === 1) cfg.llm.temperature = Math.max(0.6, (cfg.llm.temperature ?? 1) - 0.3);
  }

  if (!chosen) {
    const fb = templateFallback({ activity, cfg });
    const check = fb ? validate(fb, cfg, recent) : { pass: false, reasons: ['no fallback available'] };
    if (check.pass) {
      warn('All generated variants failed the gate — using the deterministic fallback.');
      chosen = { text: fb, why: 'template fallback', score: 0 };
      model = 'template';
    } else {
      warn('Nothing passed the quality gate. Skipping this slot; nothing is worse than a bad post.');
      return { skipped: 'quality-gate', attempts: attempts.map((a) => ({ text: a.text, reasons: a.reasons })) };
    }
  }

  const jitter = Math.floor(Math.random() * ((cfg.schedule.jitterMinutes ?? 0) + 1));
  const offsetMin = (cfg.schedule.publishDelayMinutes ?? 5) + jitter;
  const dueAt = new Date(Date.now() + offsetMin * 60_000).toISOString();
  const zone = inZone(new Date(dueAt), cfg.schedule.timezone);
  const localSlot = `${zone.weekday}-${String(zone.hour).padStart(2, '0')}`;

  console.log('\n' + '─'.repeat(64));
  console.log(chosen.text);
  console.log('─'.repeat(64));
  console.log(`angle=${angle.id}  model=${model}  chars=${chosen.text.length}  slot=${localSlot}  why=${chosen.why}\n`);

  if (DRY) {
    log('Dry run — not sent to Buffer, not written to history.');
    return { dryRun: true, text: chosen.text, angle: angle.id };
  }

  const channel = await resolveChannel(cfg);
  const post = await createPost({ channelId: channel.id, text: chosen.text, dueAt });

  appendPost(history, {
    id: post.id,
    text: chosen.text,
    angle: angle.id,
    model,
    createdAt: new Date().toISOString(),
    dueAt: post.dueAt || dueAt,
    localSlot,
    repos: activity.repos.slice(0, 3).map((r) => r.fullName),
    trendHooks: trends.slice(0, 3).map((t) => t.title),
    charCount: chosen.text.length,
    qualityScore: chosen.score,
    metrics: null,
    metricsUpdatedAt: null,
  });

  log('Done. Post is in the Buffer queue.');
  return { posted: post.id };
}

run().catch((e) => die(e.stack || e.message));
