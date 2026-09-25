<div align="center">

# x-autopilot

**Your X account, run like a publication. Written from real news and your real commits.**

Three well-timed posts every weekday for developers and founders, a weekly build-in-public
recap from your GitHub, and a loop that learns what gets *your* audience to reply.

[![post](https://github.com/adityamittal-dot/x-autopilot/actions/workflows/post.yml/badge.svg)](https://github.com/adityamittal-dot/x-autopilot/actions/workflows/post.yml)
[![metrics](https://github.com/adityamittal-dot/x-autopilot/actions/workflows/metrics.yml/badge.svg)](https://github.com/adityamittal-dot/x-autopilot/actions/workflows/metrics.yml)
![node](https://img.shields.io/badge/node-%E2%89%A520-339933?logo=node.js&logoColor=white)
![dependencies](https://img.shields.io/badge/npm%20dependencies-0-blue)
![cost](https://img.shields.io/badge/running%20cost-%240-brightgreen)
[![license](https://img.shields.io/badge/license-MIT-lightgrey)](LICENSE)

</div>

---

## The problem

Growing on X as a developer takes two things most builders don't have time for: posting
something worth reading every day, and posting it when your audience is actually awake.
Scheduling tools solve the second part. AI writing tools "solve" the first by producing
the same generic threads everyone scrolls past.

x-autopilot does both properly. It reads the day's AI, dev, and startup news, picks the
stories builders are actually talking about, and writes a specific, opinionated post
grounded only in those sources. For build-in-public posts, it reads your real commits.
It never invents a fact, never pretends you tried something you only read about, and
skips a slot rather than posting something weak.

## What it does

- **Daily takes on what matters to builders.** Pulls ~200 items a day from seven sources,
  ranks them so no single feed floods the pool, and has a cheap model shortlist the six
  with the most reach potential. A strong model then writes three variants in your voice.
- **Build in public, without the busywork.** Wednesday's midday post is one concrete
  thing you tried, fixed, or decided this week. Friday's is a weekly recap of what you
  learned, shipped, and are working on. Both come straight from your GitHub activity.
- **Written for how X ranks posts.** X weighs a reply at ~27× a like and a bookmark at
  ~20×, and a single mute costs more than many likes earn. Posts are shaped to earn
  replies and bookmarks, with no links (X shows those to fewer people), no hashtag
  stacks, and no engagement bait.
- **A quality gate with teeth.** Length, links, banned clichés, hook quality, and
  similarity to your last 20 posts are all checked. The best passing variant wins; if
  none pass, nothing is posted.
- **It learns.** Engagement from X flows back daily. Once each post style has data, the
  picker favors the styles your audience responds to, while still exploring.
- **It runs itself.** GitHub Actions on a schedule, Buffer for publishing, fixed publish
  times so GitHub's cron delays never make a post late, and catch-up logic so a dropped
  run never means a missed or duplicated post.

## Sample output

Real posts the tool produced from real sources:

> Image backends fail at random. Build the retry in first.
> lorevid now skips a failing Pollinations backend for 10 min and only alerts on the final retry.
>
> Shipped: a `cat contact.json` terminal card on my portfolio.
> Next: more projects in its lab section.

<sub>Weekly recap, from a week of commits across three repos. Published.</sub>

> Your supervisor agent might be your biggest line item.
>
> A team on dev.to swapped supervisor LLMs for typed state machines and cut multi-agent token waste 70%.
>
> If the next step is deterministic, paying a model to pick it is margin you're burning.

<sub>Business-of-AI take on a news item. Test run.</sub>

> Failed renders in lorevid don't retry right away.
>
> They wait for the next daily run, and that run skips any script that already rendered.
>
> Recovery is slower, but there's one scheduler to reason about instead of a retry loop nested inside a cron job.

<sub>Midweek "I tried it" post, from commits. Test run.</sub>

---

## How it works

```
                       ┌──────────────────────────────────────────────┐
 TechCrunch, HN,       │ rank + cap per source → Haiku shortlists 6   │
 HF papers, Simon W.,  │ with a brief of facts from each item         │──┐
 dev.to, Lobsters,  ──▶│                                              │  │
 GitHub rising         └──────────────────────────────────────────────┘  │   Opus writes 3
                                                                         ├─▶ variants in your ─▶ quality gate ─▶ Buffer ─▶ X
 your GitHub commits,  ┌──────────────────────────────────────────────┐  │   voice + playbook      + scoring      fixed time
 PRs, releases      ──▶│ Haiku condenses: shipped / learned / ongoing │──┘                                            │
                       └──────────────────────────────────────────────┘                                               │
                                                                                                                       ▼
                    angle picker  ◀────────  data/history.json  ◀────────  daily X metrics (impressions, replies, …)
```

Two models, split by cost. **Claude Haiku 4.5** does the token-heavy reading: triaging
dozens of stories, condensing a week of commits. **Claude Opus 5.5** only sees the short
briefs and does the writing. On a Claude subscription token this costs nothing extra;
at API rates it's roughly $0.08–0.12 per post.

### Schedule

| Slot | Mon, Tue, Thu | Wed | Fri | New York | UTC (summer) |
|---|---|---|---|---|---|
| Morning | news take | news take | news take | 9:30 AM | 13:30 |
| Midday | news take | **I tried it** | **weekly recap** | 1:00 PM | 17:00 |
| Evening | news take | news take | news take | 5:30 PM | 21:30 |

Slots are hours apart because X counts a second post from the same author in one feed
refresh at about half. Each slot gets up to 20 minutes of jitter. Daylight saving is
handled, and the timezone, times, days, and post types are all in `config.json`.

### Post styles

| Type | Styles (weighted, then learned from your engagement) |
|---|---|
| News take | builder take · business of AI · worth saving · contrarian · what it means · paper in plain words · roundup |
| I tried it | tried and the result · problem solved · a decision and its tradeoff |
| Weekly recap | lesson-led · shipped-led · three bullets |

---

## Use it for your account

About 15 minutes. You need a GitHub account, a Buffer account (free plan) with your X
account connected, and a Claude subscription or API key.

1. **Fork this repo** and clear out the previous owner's data:
   ```bash
   echo '{ "posts": [] }' > data/history.json
   ```
2. **Edit `config.json`:**
   - `github.username`: whose commits feed the build-in-public posts
   - `identity.handle`, `identity.stack`, `identity.interests`, `identity.audience`: who you are
     and who you write for (this steers which news gets picked)
   - `buffer.channelId`: set to `""` and it finds your X channel automatically
3. **Rewrite `voice.md` in your own words.** It's the most important file in the repo:
   it's how the posts sound. `playbook.md` is how they're shaped for reach; keep it or tune it.
4. **Buffer.** Connect your X account, **make sure the queue isn't paused**, and create an
   API key at `publish.buffer.com/settings/api`.
5. **Add two repo secrets:**
   ```bash
   claude setup-token                                   # prints a long-lived token
   gh secret set CLAUDE_CODE_OAUTH_TOKEN -R <you>/x-autopilot
   gh secret set BUFFER_API_KEY          -R <you>/x-autopilot
   ```
6. **Check everything locally** (Node 20+ and `npm i -g @anthropic-ai/claude-code`):
   ```bash
   export BUFFER_API_KEY=...
   npm run doctor        # credentials, X channel, paused queue, publish times
   npm run dry           # writes a real news post and prints it; nothing is sent
   npm run dry:bip       # same for an "I tried it" post
   npm run dry:recap     # same for the weekly recap
   ```
7. **Enable Actions** on your fork. The schedule takes over on the next weekday. To test
   end to end first: `Actions → post → Run workflow`, type **insight**, **dry_run** off,
   and a post shows up in your Buffer queue a few minutes out.

**What stays your job:** reply to replies in the first hour after a post goes live. A
reply that the author answers is the strongest signal X ranks on, and it's where
followers actually come from.

---

## Seeing what works

`metrics.yml` runs daily and pulls each post's X numbers from Buffer into
`data/history.json`, along with the live post URL. Engagement is normalised per 1,000
impressions, so a small account's good post isn't buried.

```bash
npm run metrics   # pull the latest numbers
npm run report    # data/report.html: best styles, best time slots, every post linked to X
```

The report is also attached to each metrics run as a downloadable artifact.

---

## Configuration

Everything except the writing lives in `config.json`; the writing lives in two Markdown
files the model reads on every run.

| I want to change... | Edit |
|---|---|
| How posts sound | **`voice.md`** |
| How posts are shaped | **`playbook.md`** |
| Posting times, days, or posts per day | `schedule.slots`, `schedule.days`, `schedule.audienceTimezone`, plus a `cron` line in `.github/workflows/post.yml` a few hours before any new slot |
| Which post type runs in a slot on a given day | `schedule.slots[].byWeekday` (`insight`, `bip`, `recap`) |
| The mix of post styles | `formats.<type>.angles[].weight` |
| News sources and topics | `news.sources`, `news.hnQueries`, `news.devtoTags`, `news.techcrunchFeeds`, `news.maxSourceShare` |
| Who the posts are for | `identity.audience`, `identity.interests`, `identity.stack` |
| Longer posts (X Premium) | `formats.<type>.maxChars`, `maxLines` |
| Models | `llm.claude.model`, `llm.worker.model`, `llm.claude.effort`; optional Gemini fallback with `GEMINI_API_KEY` |
| How strict the quality gate is | `quality.*` |

## Costs

| Piece | Service | Cost |
|---|---|---|
| Scheduling | GitHub Actions (public repo) | $0 |
| News and research | TechCrunch, Hacker News, Hugging Face papers, Simon Willison, dev.to, Lobsters, GitHub search (keyless, read-only) | $0 |
| Your activity | GitHub REST API | $0 |
| Writing | Claude Opus 5.5 + Haiku 4.5 via `claude setup-token` | $0 extra on a subscription |
| Publishing and metrics | Buffer free plan → X | $0 |

X's own posting API is paid per post; Buffer's free plan posts to X and includes API
access, which is why publishing goes through it.

## Design principles

- **No invented facts.** Every claim must trace to a supplied news item or commit.
  Opinions are welcome; made-up numbers are not.
- **Skip over slop.** No fresh news, no activity, or nothing passes the gate means no post.
  A missed slot costs nothing; a bad post costs reach and trust.
- **Deterministic timing.** Posts are generated hours ahead and handed to Buffer with an
  exact publish time. Every run fills all due slots and records what it posted, so reruns
  and delayed runs are safe.
- **Zero dependencies.** Plain Node, `fetch`, and the Claude Code CLI. Nothing to update,
  nothing to audit.

## Project layout

```
config.json              every knob except the writing
voice.md                 how you sound
playbook.md              how reach-focused X posts are shaped
src/
  main.js                one run: every due slot → collect → prep → write → gate → Buffer
  scheduler.js           which slots are due; style picker learning from engagement
  sources/news.js        news, startup, and research feeds, ranked for reach
  sources/github.js      your commits, PRs, and releases
  prep.js                cheap model: news triage, commit condensing
  generate.js            writer prompts: news takes, "I tried it", weekly recap
  llm.js                 Claude CLI (writer + worker), optional Gemini fallback
  quality.js             hard gate and soft scoring
  publish/buffer.js      Buffer GraphQL: channels, scheduling, metrics
  metrics.js             daily X engagement sync
  store.js               data/history.json
scripts/
  doctor.js              check every credential and connection
  report.js              build data/report.html
.github/workflows/
  post.yml               weekday slots, plus manual runs with dry-run
  metrics.yml            daily engagement sync and report
```

## License

[MIT](LICENSE) © 2026 Aditya Mittal
