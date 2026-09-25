import { loadConfig, loadVoice, loadPlaybook, log, warn, die, inZone, publishTime } from './util.js';
import { collectGitHubActivity } from './sources/github.js';
import { collectNews } from './sources/news.js';
import { buildInsightPrompt, buildBipPrompt, buildRecapPrompt, generateVariants } from './generate.js';
import { hasClaudeCredential } from './llm.js';
import { triageNews, condenseActivity } from './prep.js';
import { validate, score } from './quality.js';
import { chooseAngle, dueSlots } from './scheduler.js';
import { resolveChannel, createPost } from './publish/buffer.js';
import { loadHistory, appendPost, recentTexts, recentSourceUrls } from './store.js';

/*
 * One run fills every slot that is due (config.json → schedule.slots), one X post each.
 * Token-heavy prep (news triage, commit condensing) runs on the cheap worker model;
 * only the short briefs reach the expensive writer model.
 *   insight: a builder's take on the latest AI, dev, and startup news and research
 *   bip:     one thing tried, fixed, or decided, from this week's GitHub work (midweek)
 *   recap:   what I learned / shipped / am working on this week (weekly)
 *
 * `--type <t>` skips the slot logic and writes one post of that type, going live a
 * few minutes after the run. That's what `npm run dry` and manual runs use.
 */

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run') || process.env.DRY_RUN === 'true';
const typeArg = argv.includes('--type') ? argv[argv.indexOf('--type') + 1] : process.env.POST_TYPE;
const TYPE = typeArg && typeArg !== 'auto' ? typeArg : null;

function preflight(cfg) {
  if (TYPE && !cfg.formats[TYPE]) die(`unknown post type "${TYPE}" — use one of: ${Object.keys(cfg.formats).join(', ')}`);
  // In CI there is no interactive login, so a missing credential must stop the run loudly.
  if (process.env.CI && cfg.llm.provider === 'claude' && !hasClaudeCredential() && !process.env.GEMINI_API_KEY) {
    die('No LLM credential. Add the CLAUDE_CODE_OAUTH_TOKEN repo secret (run `claude setup-token` to create it).');
  }
  if (!DRY && !process.env.BUFFER_API_KEY) die('BUFFER_API_KEY is not set — nothing can be sent to X. Add it as a repo secret.');
}

async function run() {
  const cfg = loadConfig();
  preflight(cfg);
  const ctx = { cfg, voice: loadVoice(), playbook: loadPlaybook(), history: loadHistory(), news: null, activity: {} };

  const slots = TYPE ? [{ id: 'manual', type: TYPE, day: null, at: null }] : dueSlots(cfg, ctx.history);
  log(`mode=${DRY ? 'DRY RUN' : 'live'} posts=${ctx.history.posts.length} ` +
    `slots=${slots.map((s) => `${s.id}:${s.type}`).join(',') || 'none due'}`);
  if (!slots.length) return;

  // A failed slot must not take the others down; the next scheduled run retries it.
  let failed = 0;
  for (const slot of slots) {
    try {
      await runSlot(ctx, slot);
    } catch (e) {
      failed++;
      warn(`slot ${slot.id} (${slot.type}): ${e.message}`);
    }
  }
  if (failed) die(`${failed} of ${slots.length} slot(s) produced no post (see above).`);
}

async function runSlot(ctx, slot) {
  const { cfg, voice, playbook, history } = ctx;
  const type = slot.type;
  const fmt = cfg.formats[type];
  log(`── ${slot.id}: ${type}`);

  const recent = recentTexts(history, cfg.quality.similarityWindow);
  let buildPrompt, news = [], activity = null, angle;

  if (type === 'recap' || type === 'bip') {
    const days = fmt.lookbackDays ?? 7;
    activity = ctx.activity[days] ??= await collectGitHubActivity({ ...cfg, github: { ...cfg.github, lookbackDays: days } });
    if (!activity.repos.length) {
      warn(`No GitHub activity in the last ${days} days. Skipping rather than inventing a post.`);
      return;
    }
    angle = chooseAngle(cfg, history, type, { activity });
    const digest = await condenseActivity(activity, cfg);          // cheap worker model
    const build = type === 'bip' ? buildBipPrompt : buildRecapPrompt;
    buildPrompt = () => build({ cfg, voice, playbook, digest, angle, recent });
  } else {
    // One fetch per run; each slot drops the stories already posted, including by an earlier slot.
    ctx.news ??= await collectNews(cfg);
    const used = recentSourceUrls(history, cfg.news.avoidRepeatWindow);
    news = ctx.news.filter((n) => !used.has(n.url));
    if (news.length < (cfg.news.minItems ?? 4)) {
      warn(`Only ${news.length} fresh news item(s). Skipping rather than posting something thin.`);
      return;
    }
    news = await triageNews(news, cfg, recent);                    // cheap worker model
    angle = chooseAngle(cfg, history, type, { news });
    buildPrompt = () => buildInsightPrompt({ cfg, voice, playbook, news, angle, recent });
  }

  // Generate, gate, score. One retry if nothing passes.
  let chosen = null, model = null;
  for (let attempt = 1; attempt <= 2 && !chosen; attempt++) {
    let batch;
    try {
      batch = await generateVariants(buildPrompt(), cfg);
    } catch (e) {
      warn(`generation attempt ${attempt}: ${e.message}`);
      continue;
    }
    model = batch.model;
    const graded = batch.variants.map((v) => {
      const check = validate(v.text, cfg, recent, fmt);
      return { ...v, ...check, score: check.pass ? score(v.text, cfg, fmt) : -Infinity };
    });
    for (const g of graded) {
      log(`  ${g.pass ? '✓' : '✗'} [${g.pass ? g.score : g.reasons.join(', ')}] ${g.text.replace(/\n/g, ' ⏎ ').slice(0, 100)}`);
    }
    chosen = graded.filter((g) => g.pass).sort((a, b) => b.score - a.score)[0] || null;
  }

  if (!chosen) {
    // No template fallback: a weak post costs more reach than a skipped slot.
    throw new Error(model
      ? 'nothing passed the quality gate after 2 attempts'
      : 'the LLM never answered (see warnings above)');
  }

  const { dueAt, onSlot } = publishTime(cfg, slot.at);
  const zone = inZone(dueAt, cfg.schedule.audienceTimezone);
  const localSlot = `${zone.weekday}-${String(zone.hour).padStart(2, '0')}`;
  const newsUrls = new Set(news.map((n) => n.url));
  const sourceUrls = (chosen.sources || []).filter((u) => newsUrls.has(u));

  console.log('\n' + '─'.repeat(64));
  console.log(chosen.text);
  console.log('─'.repeat(64));
  console.log(`slot=${slot.id} type=${type} angle=${angle.id} model=${model} chars=${chosen.text.length} ` +
    `due=${dueAt.toISOString()} (${localSlot} ${cfg.schedule.audienceTimezone}${onSlot || !slot.at ? '' : ', run was late'})`);
  if (sourceUrls.length) console.log(`sources: ${sourceUrls.join(' ')}`);
  console.log(`why: ${chosen.why}\n`);

  if (DRY) {
    log('Dry run — not sent to Buffer, not written to history.');
    return;
  }

  const channel = await resolveChannel(cfg);
  const post = await createPost({ channelId: channel.id, text: chosen.text, dueAt: dueAt.toISOString() });

  appendPost(history, {
    id: post.id,
    type,
    slot: slot.id,
    slotDay: slot.day || inZone(new Date(), cfg.schedule.audienceTimezone).date,
    text: chosen.text,
    angle: angle.id,
    model,
    createdAt: new Date().toISOString(),
    dueAt: post.dueAt || dueAt.toISOString(),
    localSlot,
    repos: activity ? activity.repos.slice(0, 3).map((r) => r.fullName) : [],
    sourceUrls,
    charCount: chosen.text.length,
    qualityScore: chosen.score,
    metrics: null,
    metricsUpdatedAt: null,
  });

  log(`Queued in Buffer for X at ${dueAt.toISOString()}.`);
}

run().catch((e) => die(e.stack || e.message));
