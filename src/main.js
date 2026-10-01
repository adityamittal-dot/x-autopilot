import { loadConfig, loadVoice, loadPlaybook, log, warn, die, inZone, publishTime } from './util.js';
import { collectGitHubActivity } from './sources/github.js';
import { collectNews, renderNews } from './sources/news.js';
import {
  buildInsightPrompt, buildBipPrompt, buildRecapPrompt,
  buildTipPrompt, buildQuestionPrompt, buildObservationPrompt,
  generateVariants,
} from './generate.js';
import { hasClaudeCredential } from './llm.js';
import { triageNews, condenseActivity } from './prep.js';
import { validate, score } from './quality.js';
import { factCheck } from './factcheck.js';
import { chooseAngle, chooseTopic, dueSlots } from './scheduler.js';
import { resolveChannel, createPost } from './publish/buffer.js';
import { loadHistory, appendPost, recentTexts, recentSourceUrls } from './store.js';

/*
 * One run fills every slot that is due (config.json → schedule.slots), one X post each.
 * Token-heavy prep (news triage, commit condensing) runs on the cheap worker model;
 * only the short briefs reach the expensive writer model.
 *   insight:     a builder's take on the latest AI, dev, and startup news and research
 *   bip:         one thing tried, fixed, or decided, from this week's GitHub work (midweek)
 *   recap:       what I learned / shipped / am working on this week (weekly)
 *   tip:         a bookmarkable practical tip from the author's own stack, by topic
 *   question:    a genuine question to the timeline (news-anchored or a stack tradeoff)
 *   observation: a short, relatable observation about building software or AI tools
 *
 * A slot that has no material (no fresh news, no GitHub activity, no unused commits)
 * runs its configured `fallback` type instead, when one is set, and is otherwise skipped.
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

  const slots = TYPE ? [{ id: 'manual', type: TYPE, fallback: null, day: null, at: null }] : dueSlots(cfg, ctx.history);
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

/** Subjects already used by a bip or recap post in the last `days`, so bip never repeats material. */
function usedCommitSubjects(history, days) {
  const since = Date.now() - days * 864e5;
  const subjects = new Set();
  for (const p of history.posts) {
    if (p.type !== 'bip' && p.type !== 'recap') continue;
    const when = Date.parse(p.dueAt || p.createdAt || '');
    if (!(when >= since)) continue;
    for (const s of p.commits || []) subjects.add(s);
  }
  return subjects;
}

/**
 * Gather the real-world material for one post type and build its prompt + the
 * context string the fact-checker will verify it against. Returns null when there
 * is nothing to post about (the caller then tries the slot's fallback, if any).
 */
async function gatherMaterial(ctx, type, recent) {
  const { cfg, voice, playbook, history } = ctx;
  const fmt = cfg.formats[type];

  if (type === 'insight' || type === 'question') {
    ctx.news ??= await collectNews(cfg);
    const used = recentSourceUrls(history, cfg.news.avoidRepeatWindow);
    let news = ctx.news.filter((n) => !used.has(n.url));
    const enough = news.length >= (cfg.news.minItems ?? 4);

    if (type === 'insight') {
      if (!enough) {
        warn(`Only ${news.length} fresh news item(s). Skipping rather than posting something thin.`);
        return null;
      }
      news = await triageNews(news, cfg, recent);
      const angle = chooseAngle(cfg, history, type, { news });
      return {
        news, angle,
        buildPrompt: () => buildInsightPrompt({ cfg, voice, playbook, news, angle, recent }),
        context: renderNews(news),
        factCheckType: 'insight',
      };
    }

    // question: news is a bonus, not a requirement — stack-tradeoff and student-question work without it.
    news = enough ? await triageNews(news, cfg, recent) : [];
    const topic = chooseTopic(cfg, history);
    const angle = chooseAngle(cfg, history, type, { news });
    const hasNewsBlock = angle.id !== 'stack-tradeoff' && news.length > 0;
    return {
      news, topic, angle,
      buildPrompt: () => buildQuestionPrompt({ cfg, voice, playbook, news, topic, angle, recent }),
      context: hasNewsBlock ? renderNews(news) : topic,
      factCheckType: hasNewsBlock ? 'question' : 'question-stack',
    };
  }

  if (type === 'bip' || type === 'recap') {
    const days = fmt.lookbackDays ?? 7;
    let activity = ctx.activity[days] ??= await collectGitHubActivity({ ...cfg, github: { ...cfg.github, lookbackDays: days } });
    if (!activity.repos.length) {
      warn(`No GitHub activity in the last ${days} days. Skipping rather than inventing a post.`);
      return null;
    }

    if (type === 'bip') {
      // Never retell a commit a bip or recap already used in the last two weeks.
      const used = usedCommitSubjects(history, 14);
      const repos = activity.repos
        .map((r) => ({ ...r, commits: r.commits.filter((c) => !used.has(c.subject)) }))
        .filter((r) => r.commits.length);
      if (!repos.length) {
        warn('No unused commits in the lookback window. Skipping rather than repeating material.');
        return null;
      }
      activity = { ...activity, repos };
    }

    const angle = chooseAngle(cfg, history, type, { activity });
    const digest = await condenseActivity(activity, cfg);          // cheap worker model
    const build = type === 'bip' ? buildBipPrompt : buildRecapPrompt;
    return {
      activity, angle,
      buildPrompt: () => build({ cfg, voice, playbook, digest, angle, recent }),
      context: digest,
      factCheckType: type,
    };
  }

  if (type === 'tip') {
    const topic = chooseTopic(cfg, history);
    const angle = chooseAngle(cfg, history, type, {});
    return {
      topic, angle,
      buildPrompt: () => buildTipPrompt({ cfg, voice, playbook, topic, angle, recent }),
      context: topic,
      factCheckType: 'tip',
    };
  }

  // observation: no external data at all.
  const angle = chooseAngle(cfg, history, type, {});
  return {
    angle,
    buildPrompt: () => buildObservationPrompt({ cfg, voice, playbook, angle, recent }),
    context: null,
    factCheckType: 'observation',
  };
}

async function runSlot(ctx, slot) {
  const { cfg, history } = ctx;
  const recent = recentTexts(history, cfg.quality.similarityWindow);

  // Try the slot's own type first, then its configured fallback (if any) when there's no material.
  const attempts = [slot.type, ...(slot.fallback && slot.fallback !== slot.type ? [slot.fallback] : [])];
  let material = null, type = null;
  for (const t of attempts) {
    log(`── ${slot.id}: ${t}${t !== slot.type ? ' (fallback)' : ''}`);
    material = await gatherMaterial(ctx, t, recent);
    if (material) { type = t; break; }
    if (t === slot.type && slot.fallback) log(`  ${slot.id}: no material for ${t}, trying fallback "${slot.fallback}"`);
  }
  if (!material) return; // nothing to post, and no usable fallback — skip as today

  const fmt = cfg.formats[type];
  const { buildPrompt, context, angle, news = [], activity, topic } = material;

  // Generate, gate, score, fact-check. One retry if nothing passes.
  let chosen = null, model = null, gatePassed = 0;
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

    const passing = graded.filter((g) => g.pass).sort((a, b) => b.score - a.score);
    gatePassed += passing.length;
    for (const candidate of passing) {
      const check = await factCheck(candidate.text, cfg, { type: material.factCheckType, context });
      log(`  ${check.ok ? '✓' : '✗'} fact-check${check.skipped ? ' (checker unavailable, not blocking)' : ''}` +
        `${check.problems.length ? `: ${check.problems.join('; ')}` : ''}`);
      if (check.ok) { chosen = candidate; break; }
    }
  }

  if (!chosen) {
    // No template fallback: a weak or wrong post costs more reach than a skipped slot.
    if (!model) throw new Error('the LLM never answered (see warnings above)');
    throw new Error(gatePassed ? 'nothing passed fact-check after 2 attempts' : 'nothing passed the quality gate after 2 attempts');
  }

  const { dueAt, onSlot } = publishTime(cfg, slot.at);
  const zone = inZone(dueAt, cfg.schedule.audienceTimezone);
  const localSlot = `${zone.weekday}-${String(zone.hour).padStart(2, '0')}`;
  const newsUrls = new Set(news.map((n) => n.url));
  const sourceUrls = (chosen.sources || []).filter((u) => newsUrls.has(u));

  // bip: only the evidence the model cited that actually matches a real commit subject.
  // recap: every commit subject the digest was built from (no evidence field is asked for).
  let commits = [];
  if (type === 'bip') {
    const known = new Set((activity?.repos || []).flatMap((r) => r.commits.map((c) => c.subject)));
    commits = (chosen.evidence || []).filter((e) => known.has(e));
  } else if (type === 'recap') {
    commits = (activity?.repos || []).flatMap((r) => r.commits.map((c) => c.subject));
  }
  const postTopic = (type === 'tip' || type === 'question') ? (topic || null) : null;

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
    topic: postTopic,
    commits,
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
