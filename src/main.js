import { loadConfig, loadVoice, loadPlaybook, log, warn, die, inZone, publishTime } from './util.js';
import { collectGitHubActivity } from './sources/github.js';
import { collectNews } from './sources/news.js';
import { buildInsightPrompt, buildRecapPrompt, generateVariants } from './generate.js';
import { hasClaudeCredential } from './llm.js';
import { triageNews, condenseActivity } from './prep.js';
import { validate, score } from './quality.js';
import { chooseAngle } from './scheduler.js';
import { resolveChannel, createPost } from './publish/buffer.js';
import { loadHistory, appendPost, recentTexts, recentSourceUrls, postedToday } from './store.js';

/*
 * One run = one X post. Token-heavy prep (news triage, commit condensing) runs on the
 * cheap worker model; only the short briefs reach the expensive writer model.
 *   insight: latest AI/dev news + research, leaning toward the dev's stack (weekdays)
 *   recap:   what I learned / shipped / am working on, from this week's GitHub activity (weekly)
 */

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run') || process.env.DRY_RUN === 'true';
const typeArg = argv[argv.indexOf('--type') + 1];
const TYPE = (argv.includes('--type') ? typeArg : process.env.POST_TYPE) || 'insight';

function preflight(cfg) {
  if (!cfg.formats[TYPE]) die(`unknown post type "${TYPE}" — use one of: ${Object.keys(cfg.formats).join(', ')}`);
  // In CI there is no interactive login, so a missing credential must stop the run loudly.
  if (process.env.CI && cfg.llm.provider === 'claude' && !hasClaudeCredential() && !process.env.GEMINI_API_KEY) {
    die('No LLM credential. Add the CLAUDE_CODE_OAUTH_TOKEN repo secret (run `claude setup-token` to create it).');
  }
  if (!DRY && !process.env.BUFFER_API_KEY) die('BUFFER_API_KEY is not set — nothing can be sent to X. Add it as a repo secret.');
}

async function run() {
  const cfg = loadConfig();
  preflight(cfg);
  const fmt = cfg.formats[TYPE];
  const voice = loadVoice();
  const playbook = loadPlaybook();
  const history = loadHistory();
  log(`mode=${DRY ? 'DRY RUN' : 'live'} type=${TYPE} posts=${history.posts.length}`);

  if (!DRY && postedToday(history, TYPE)) {
    warn(`A ${TYPE} post was already created today. Skipping so a re-run doesn't double-post.`);
    return;
  }

  const recent = recentTexts(history, cfg.quality.similarityWindow);
  let buildPrompt, news = [], activity = null, angle;

  if (TYPE === 'recap') {
    cfg.github.lookbackDays = fmt.lookbackDays ?? 7;
    activity = await collectGitHubActivity(cfg);
    if (!activity.repos.length) {
      warn('No GitHub activity this week. Skipping the recap rather than inventing one.');
      return;
    }
    angle = chooseAngle(cfg, history, TYPE, { activity });
    const digest = await condenseActivity(activity, cfg);          // cheap worker model
    buildPrompt = () => buildRecapPrompt({ cfg, voice, playbook, digest, angle, recent });
  } else {
    news = await collectNews(cfg, { exclude: recentSourceUrls(history, cfg.news.avoidRepeatWindow) });
    if (news.length < (cfg.news.minItems ?? 4)) {
      warn(`Only ${news.length} fresh news item(s). Skipping rather than posting something thin.`);
      return;
    }
    news = await triageNews(news, cfg, recent);                    // cheap worker model
    angle = chooseAngle(cfg, history, TYPE, { news });
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
    die(model
      ? 'Nothing passed the quality gate after 2 attempts. Skipping this slot.'
      : 'The LLM never answered (see warnings above). Nothing was posted.');
  }

  const { dueAt, onSlot } = publishTime(cfg, TYPE);
  const zone = inZone(dueAt, cfg.schedule.audienceTimezone);
  const localSlot = `${zone.weekday}-${String(zone.hour).padStart(2, '0')}`;
  const newsUrls = new Set(news.map((n) => n.url));
  const sourceUrls = (chosen.sources || []).filter((u) => newsUrls.has(u));

  console.log('\n' + '─'.repeat(64));
  console.log(chosen.text);
  console.log('─'.repeat(64));
  console.log(`type=${TYPE} angle=${angle.id} model=${model} chars=${chosen.text.length} ` +
    `due=${dueAt.toISOString()} (${localSlot} ${cfg.schedule.audienceTimezone}${onSlot ? '' : ', run was late'})`);
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
    type: TYPE,
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

  log(`Done. Queued in Buffer for X at ${dueAt.toISOString()}.`);
}

run().catch((e) => die(e.stack || e.message));
