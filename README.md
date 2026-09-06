# x-autopilot

**Posts to X three times a week, in your voice, about what you actually shipped.**

It reads your real GitHub activity, writes a post about it, publishes it through
Buffer, then pulls the engagement numbers back and learns which kinds of posts
work for your audience.

<p>
<img alt="cost" src="https://img.shields.io/badge/cost-%240%2Fmonth-2f6f4e">
<img alt="deps" src="https://img.shields.io/badge/dependencies-0-2f6f4e">
<img alt="runtime" src="https://img.shields.io/badge/node-%E2%89%A520-333">
<img alt="runs on" src="https://img.shields.io/badge/runs%20on-GitHub%20Actions-333">
</p>

Runs entirely on GitHub Actions. **Total cost: $0.** No paid tier anywhere in the
chain, and no credit card required at any step.

```
Tue 19:30 IST ─┐
Thu 19:30 IST ─┼─→ read GitHub ─→ pick angle ─→ write 3 drafts ─→ gate them ─→ Buffer ─→ X
Sun 15:30 IST ─┘                                                                   │
                                             data/history.json ←── metrics ────────┘
```

---

## Why it's built this way

X shut down its free API tier in February 2026. Every "free Twitter bot"
tutorial that tells you to grab X API keys and call `POST /2/tweets` is now
wrong — that endpoint bills per post (~$0.015, more with a link).

The way around it: **Buffer's Free plan publishes to X using Buffer's own API
access, and Buffer includes API access on Free** (3,000 requests/month, 100/day).
You never touch X's API or pay X anything. This pipeline pushes ~12 requests a
month, so you're using 0.4% of the free allowance.

| Piece | Service | Free allowance | What this uses |
|---|---|---|---|
| Scheduler | GitHub Actions | unlimited on public repos | ~15 runs/month |
| Activity source | GitHub REST API | 5,000 req/hr authenticated | 2 req/run |
| Writer | Gemini API (free tier) | 1,500 req/day, no card | 1–2 req/run |
| Trends | HN Algolia, dev.to, GitHub Search | keyless, unmetered | 3 req/run |
| Publishing | Buffer Free | 3,000 req/month | ~3 req/run |
| Analytics | Buffer post metrics | included on Free | ~12 req/day |

---

## Setup (about 15 minutes)

### 1. The repo

This repo is the whole system. Keep it **public** — Actions minutes are unlimited
on public repos, and it only ever reads public GitHub data anyway.

> Scheduled workflows on public repos get auto-disabled after 60 days of repo
> inactivity. This one commits to `data/` on every run, so it keeps itself alive.

### 2. Buffer

1. Sign up at [buffer.com](https://buffer.com) — Free plan.
2. Connect your X profile as a channel.
3. **Unpause the queue** for that channel (Buffer sometimes starts paused —
   a paused queue silently swallows everything).
4. Go to `publish.buffer.com/settings/api`, create a **personal API key**.
   You must be the organization owner.

### 3. Gemini

Get a key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey).
Free tier, Google account only, no credit card.

### 4. Repo secrets

`Settings → Secrets and variables → Actions → New repository secret`:

| Name | Value |
|---|---|
| `GEMINI_API_KEY` | from step 3 |
| `BUFFER_API_KEY` | from step 2 |

`GITHUB_TOKEN` is injected by Actions automatically — don't add it.

### 5. Configure

Edit **`config.json`**:

```jsonc
"github": { "username": "adityamittal-dot" }     // already set
"identity": { "stack": [...], "handle": "yourXhandle" }  // ← add your X handle
"schedule": { "timezone": "Asia/Calcutta" }
```

Then edit **`voice.md`**. This is the highest-leverage file in the repo — it is
fed to the model verbatim on every run and it is what stops the output sounding
like every other AI-written build-in-public post. Rewrite the examples in your
own words. Ten minutes here is worth more than any code change.

### 6. Verify before you let it loose

```bash
export GEMINI_API_KEY=...  BUFFER_API_KEY=...
npm run doctor    # checks every credential, finds your X channel, warns on a paused queue
npm run dry       # generates a real post and prints it — sends nothing
```

Run `npm run dry` five or six times. If the posts don't sound like you, fix
`voice.md`, not the code. When they do, you're done.

### 7. Go live

`Actions → post → Run workflow`, set **dry_run: false**. Check Buffer — the post
should be sitting in the queue with a publish time a few minutes out. After that
the cron takes over.

---

## How a run works

```
GitHub events API ─┐
                   ├─→ activity digest (repos, commits, releases, merged PRs)
your repo metadata ┘         │
                             ▼
HN + dev.to + GitHub ──→ trend context (used as a hook, never as the subject)
                             │
                             ▼
              angle chosen (shipped / working-on / learned /
              problem-solved / new-project / milestone)
                             │
                             ▼
                  Gemini writes 3 different variants
                             │
                             ▼
         hard gate: length, hashtags, emoji, banned phrases,
         banned openers, placeholder leaks, similarity vs. last 20
                             │
                             ▼
         soft score: measured numbers > vague claims, tight hook,
         concrete technical nouns, no engagement bait
                             │
                             ▼
                  best surviving variant → Buffer → X
                             │
                             ▼
              logged to data/history.json (committed back)
```

**It skips rather than lies.** No GitHub activity in the window → no post. No
variant passes the gate → no post. A missed slot costs nothing; a bad post costs
you followers.

**It never invents facts.** The prompt hands the model your commit subjects and
tells it every claim must be traceable to them. Numbers in your posts are numbers
from your commits.

**The lookback is adaptive.** It looks back exactly as far as the gap since your
last post, so a quiet week doesn't get skipped and a busy week isn't posted twice.

---

## The learning loop

`metrics.yml` runs daily and pulls engagement back from Buffer into
`data/history.json`. After a few weeks, `chooseAngle()` stops picking randomly
and starts favouring the angles that actually perform for *your* audience,
keeping 25% exploration so it never over-fits.

Engagement is normalised per 1,000 impressions, so an early small post isn't
buried by a later big one.

```bash
npm run metrics   # pull latest numbers
npm run report    # writes data/report.html — open it in a browser
```

The report shows which angle wins, which time slot wins, and every post with its
numbers. It's also uploaded as a workflow artifact on every metrics run.

For follower growth specifically, X's own free dashboard at
[analytics.x.com](https://analytics.x.com) stays the source of truth — no free
API exposes follower counts anymore.

---

## Tuning

| I want... | Change |
|---|---|
| Different days/times | `cron` lines in `.github/workflows/post.yml` (UTC) |
| More or fewer posts | add/remove `cron` lines |
| Different mix of post types | `content.angles[].weight` in `config.json` |
| No links in posts | `content.linkPolicy: "none"` (X does suppress reach on posts with links) |
| Stricter or looser filtering | `quality.*` in `config.json` |
| A repo kept out of posts | `github.excludeRepos` |
| Different model | `llm.models` — it tries each in order and falls through on failure |
| Posts to sound different | **`voice.md`** |

### Things that will eventually break, and how they're handled

- **A Gemini model gets deprecated.** `llm.models` is a fallback chain; it walks
  down the list. Add the new model name at the top when one ships.
- **Your GitHub token 401s.** Falls back to the unauthenticated public API.
- **A trend source goes down.** Each is caught independently; the run continues.
- **Gemini has a bad day.** Two attempts at a lower temperature, then a
  deterministic template fallback, then skip.
- **Buffer's queue is paused.** `npm run doctor` warns you; the run logs it.

---

## Honest limitations

- **Buffer Free holds 10 queued posts per channel.** At 3/week you'll never come
  close, but don't also queue 10 by hand.
- **Threads aren't supported on Buffer Free.** These are single posts by design.
- **Metrics come from Buffer, not X directly.** They're accurate but arrive on
  Buffer's refresh cadence, not instantly.
- **You still have to reply to people.** Automation gets you consistent output;
  it does not get you an audience on its own. The posts are the top of the
  funnel — the conversations under them are the actual growth.

---

## Commands

```bash
npm run doctor    # verify every credential and connection
npm run dry       # generate and print a post, send nothing
npm run post      # generate and schedule for real
npm run metrics   # pull engagement from Buffer
npm run report    # rebuild data/report.html
```

No dependencies. Node 20+. `npm install` isn't needed.

---

## Layout

```
config.json              every knob except the writing itself
voice.md                 the writing itself — edit this first
src/
  main.js                the run: collect → choose → generate → gate → publish
  sources/github.js      your events feed → a clean activity digest
  sources/trends.js      Hacker News + dev.to + GitHub Search, scored for relevance
  generate.js            Gemini call, model fallback chain, template fallback
  quality.js             hard gate + soft scoring
  scheduler.js           angle selection, epsilon-greedy over past engagement
  publish/buffer.js      Buffer GraphQL: channels, createPost, metrics
  metrics.js             daily engagement sync
  store.js               data/history.json
scripts/
  doctor.js              verify every credential and connection
  report.js              build data/report.html
data/history.json        every post, with its numbers. the memory of the system.
```

## License

MIT. Do whatever you want with it.
