# x-autopilot

**Grows reach on X on autopilot.** Every weekday it posts a sharp take on the latest AI
and developer news and research, leaning toward your stack. Every Friday it posts a
build-in-public recap of what you learned, shipped, and are working on, straight from
your real GitHub activity. Then it pulls the engagement back and learns which kinds of
posts get reach for *your* audience.

X only. Runs on GitHub Actions, publishes through Buffer, writes with Claude.

```
Mon–Fri ─→ news + research feeds ─→ Haiku triages ~40 items ─→ Opus writes 3 variants ─┐
Friday  ─→ your GitHub commits   ─→ Haiku condenses the week ─→ Opus writes 3 variants ─┤
                                                                                        ▼
                               quality gate ─→ best variant ─→ Buffer (fixed time) ─→ X
                                                                                        │
                                     data/history.json ←── X metrics via Buffer ────────┘
```

---

## Schedule

Times are chosen for the X algorithm: the first hour of engagement decides most of a
post's reach, and developer audiences are most active on weekday mornings, US Eastern
(research across 2026 studies: Tue–Thu 9–11 AM peaks, Sunday is ~23% below average).

| Day | Post | Goes live (New York) | India (IST) |
|---|---|---|---|
| Mon–Fri | AI/dev news take | 10:00 AM + up to 20 min jitter | 7:30 PM (8:30 PM in winter) |
| Fri | Weekly recap | 1:00 PM + up to 20 min jitter | 10:30 PM (11:30 PM in winter) |

The workflow runs hours earlier and hands Buffer the exact publish time, so GitHub's
cron delays (often 1–4 hours) never make a post late. Daylight saving is handled.
Change the times in `config.json → schedule`.

---

## Why it's built this way

- **Posting goes through Buffer.** X's posting API is paid per post. Buffer's free plan
  posts to X and includes API access.
- **Two Claude models.** The cheap one (Haiku 4.5) does the token-heavy reading:
  triaging dozens of news items and condensing a week of commits. The expensive one
  (Opus 5.5) only sees the short briefs and does the writing. On a Claude subscription
  token this costs nothing extra; at API rates it's about $0.12 a post.
- **No links in posts.** X shows posts with external links to fewer people, so the
  source is named in words and the URL is kept in `history.json`.
- **It skips rather than posts something weak.** No fresh news, no activity, or nothing
  passes the quality gate → no post. A missed slot costs nothing; a bad post costs reach.
- **It never invents facts.** Every claim must come from the supplied news items or your
  commits. Opinions are allowed; fake numbers are not.

| Piece | Service | Cost |
|---|---|---|
| Scheduler | GitHub Actions (public repo) | $0 |
| Recap source | GitHub REST API | $0 |
| News + research | Hacker News, Hugging Face papers, Simon Willison, dev.to, Lobsters, GitHub search (all keyless, read-only) | $0 |
| Writer + worker | Claude Opus 5.5 + Haiku 4.5 via `claude setup-token` | $0 extra on a subscription |
| Publishing + metrics | Buffer Free → X | $0 |

---

## Setup (about 15 minutes)

1. **Buffer.** Connect your X account (only X is used). **Unpause the queue.** Create a
   personal API key at `publish.buffer.com/settings/api`.
2. **Claude.** Run `claude setup-token` and copy the token.
3. **Repo secrets** (`Settings → Secrets and variables → Actions`, or with `gh`):
   ```bash
   gh secret set CLAUDE_CODE_OAUTH_TOKEN -R <you>/x-autopilot
   gh secret set BUFFER_API_KEY          -R <you>/x-autopilot
   ```
   `GITHUB_TOKEN` is provided by Actions automatically.
4. **`config.json`.** Set `identity.handle` to your X handle; adjust `identity.stack`
   and `identity.interests`. These steer which news gets picked.
5. **`voice.md` and `playbook.md`.** `voice.md` is how you sound; `playbook.md` is how
   high-reach posts are shaped. Both are fed to the writer on every run. Rewrite the
   examples in your own words.
6. **Verify:**
   ```bash
   export BUFFER_API_KEY=...        # Claude uses your local `claude` login
   npm run doctor                   # every credential, the X channel, the queue, publish times
   npm run dry                      # a real news post, printed, nothing sent
   npm run dry:recap                # a real recap, printed, nothing sent
   ```
7. **Go live.** `Actions → post → Run workflow` with **dry_run off**. The post should
   appear in Buffer's X queue with a publish time set. After that the crons take over.

---

## The learning loop

`metrics.yml` runs daily and pulls each post's X numbers (impressions, likes, replies,
reposts) from Buffer into `data/history.json`, along with the live post URL.
Engagement is normalised per 1,000 impressions. Once each angle has a few posts with
numbers, the angle picker favours what works for your audience, keeping 25% exploration.

```bash
npm run metrics   # pull the latest X numbers
npm run report    # data/report.html: best angles, best slots, every post with a link to X
```

Follower growth isn't exposed by any free API; check analytics.x.com.

**The part automation can't do:** reply to every reply in the first hour after a post
goes live. The algorithm weights author replies heavily.

---

## Tuning

| I want... | Change |
|---|---|
| Different publish times | `schedule.publishAt` + `schedule.audienceTimezone` |
| Different days | `cron` lines in `.github/workflows/post.yml` (keep them hours before publish time) |
| Different mix of post styles | `formats.<type>.angles[].weight` |
| Different news sources or topics | `news.sources`, `news.hnQueries`, `news.devtoTags` |
| Longer posts (X Premium) | `formats.<type>.maxChars` and `maxLines` |
| A different writer or worker model | `llm.claude.model`, `llm.worker.model`, `llm.claude.effort` |
| Stricter or looser filtering | `quality.*` |
| Posts to sound different | **`voice.md`** |
| Posts to be shaped differently | **`playbook.md`** |

---

## Commands

```bash
npm run doctor      # verify every credential and connection
npm run dry         # generate and print a news post, send nothing
npm run dry:recap   # generate and print the weekly recap, send nothing
npm run post        # generate and schedule for real (POST_TYPE=insight|recap)
npm run metrics     # pull X engagement via Buffer
npm run report      # rebuild data/report.html
```

No npm dependencies. Node 20+ and the Claude Code CLI (`npm i -g @anthropic-ai/claude-code`).

---

## Layout

```
config.json              every knob except the writing
voice.md                 how you sound
playbook.md              how reach-focused X posts are shaped
src/
  main.js                one run: collect → prep → write → gate → Buffer
  sources/news.js        AI/dev news + research feeds, ranked for reach and stack fit
  sources/github.js      your week of commits, PRs and releases
  prep.js                cheap worker model: news triage, commit condensing
  llm.js                 Claude CLI (writer + worker roles), Gemini fallback
  generate.js            writer prompts for news posts and the weekly recap
  quality.js             hard gate + soft scoring
  scheduler.js           angle selection, epsilon-greedy over past engagement
  publish/buffer.js      Buffer GraphQL: channels, createPost, metrics
  metrics.js             daily X engagement sync
  store.js               data/history.json
scripts/
  doctor.js              verify every credential and connection
  report.js              build data/report.html
```

## License

MIT.
