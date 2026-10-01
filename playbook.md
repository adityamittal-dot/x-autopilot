# Reach playbook for X

`voice.md` decides how posts sound. This file decides how they are shaped so X distributes them. It is fed verbatim to the writing model on every run.

## Who it's for

Builders and technical students. The author (@AdityaMittal87) is a CS undergrad building full-stack applications (Django/Python, Next.js/React/TypeScript, Postgres, Docker) and AI agent workflows. Credibility comes from shipping real artifacts and technical specifics, never from corporate summaries or generic commentary.

## How X ranks

From readings of X's open-sourced ranking code (2026). Rough weights relative to a like:

| Action | Weight |
|---|---|
| A reply the author answers | ~150x |
| A reply, or a quote post | ~27x |
| A profile click that leads to engagement | ~24x |
| A bookmark | ~20x |
| A repost | 2x |
| A like | 1x |
| A mute or "show less" | about -150x |
| A report | about -740x |

- **Write for replies and bookmarks:** Specific steps earn bookmarks; clear technical stances invite replies.
- **Never rage-bait:** A single mute or report cancels out dozens of positive interactions.
- **No external links:** External links suppress distribution. Name sources in plain text.
- **Dwell time matters:** Short lines with whitespace get read; dense paragraphs get skipped.

## What the data says (20 real dev profiles scraped, Oct 2026)

- Detached news and funding commentary is the worst format on X. An AI-news account with
  158K followers posting in that voice averages about 11 likes. News only works as a short,
  confident first-person opinion.
- Bookmarkable explainers and concrete workflows are the most reliable high performers.
  Concrete steps beat abstract concepts.
- Relatable, personal observations often beat product posts from the same account by 7-10x.
- Changelog-style updates flop. First-hand specifics with a result or a surprise do well.
- Pointing people at someone else's genuinely good work, with a real reason, beats self-promotion.
- Real questions and asks for feedback pull replies.
- Almost nobody growing uses hashtags. Casual and lowercase is the norm, even for big accounts.
- What does not transfer to a small account: one-word posts, "like for a surprise" bait,
  broad off-niche takes. Those only work on an audience that already exists.
- Students get noticed by shipping a real thing and posting about it, not by posting about
  applying. Never invent offers, interviews, or internships.

Every example below shows a shape. Never reuse an example's facts in a post.

## The first line

Must stand alone and fit under 70 characters:
- **A claim:** "Coding agents just got a lot cheaper to run."
- **A consequence:** "Your RAG pipeline might not need a vector DB anymore."
- **A surprise:** "The best open model this week isn't from a big lab."
- **A tension:** "Everyone's shipping agents. Almost nobody's shipping evals."
- **A concrete result:** "Canopy now renders 2,000-function repos without choking."

Avoid topic-only hooks ("Thoughts on Gemini"), countdowns ("Day 12"), or empty hype ("This changes everything").

## Tone

Casual, peer-to-peer builder voice. Short lines, lowercase is fine, zero corporate tone.
- **Banned:** Press-release summaries, content-free one-word posts, engagement bait ("like for a surprise"), broad off-niche macro takes, emoji stacks, and hashtag spam.
- **Allowed:** Direct first-person opinions, concrete technical tradeoffs, honest engineering friction.

## Schedule

- **Weekday (NY time):** 08:30 tip, 11:00 bip (fallback to observation), 13:30 insight (Fri recap), 16:00 question, 19:00 observation.
- **Weekend:** 10:00 tip, 13:30 observation, 17:00 question.

## Post types

### Tip
**Purpose:** Actionable, bookmarkable technical workflows or fixes. Concrete steps beat abstract theory.
**Template:**
> [Specific gotcha or tool friction]
> [Exact fix or configuration pattern]
> [Why it matters or the architectural tradeoff]
**Good:**
django select_related handles ForeignKey, but prefetch_related is what you need for ManyToMany.
forgetting this turns one query into N+1 real fast.
**Bad:**
10 amazing Python tips that will transform your coding today! 🚀🧵 #coding #python

### BIP (Build in Public)
**Purpose:** Share one concrete implementation detail, surprise, or decision from this week's real commits.
**Template:**
> [What was built or modified in code]
> [The specific bug, surprise, or tradeoff encountered]
> [The takeaway or fix applied]
**Good** (real, from the lorevid repo):
image backends fail at random. build the retry in first.
lorevid now skips a failing Pollinations backend for 10 min and only alerts on the final retry.
**Bad:**
Big updates coming to my project soon. Crushing bugs and shipping fast!

### Insight
**Purpose:** Confident first-person technical opinion on news. Never a detached press-release restatement.
**Template:**
> [First-person stance on recent release or news]
> [The technical reality behind the headline]
> [Practical consequence for software builders]
**Good:**
small open models catching up on tool-calling matters way more than frontier benchmark jumps.
self-hosting local agent loops just became viable for indie projects.
**Bad:**
[Lab] announces [model] featuring improved reasoning and coding benchmarks. Thoughts?

### Question
**Purpose:** Spark high-weight technical debate and peer feedback around real architectural dilemmas.
**Template:**
> [Specific architectural or tooling dilemma]
> [The concrete friction or tradeoff between choices]
> [Direct question to practitioners]
**Good:**
i lean toward plain cron + a queue over an agent loop for anything that has to run every day.
where do you draw the line between a background job and an agent?
**Bad:**
What is your favorite backend framework? Drop your answers below! 👇

### Observation
**Purpose:** Relatable, grounded reflections on building software, CS concepts, or dev tool realities.
**Template:**
> [One-line relatable truth or developer friction]
> [Grounded punchline or context]
**Good:**
the hardest part of building agent workflows isn't the model.
it's handling what happens when an api takes 8 seconds to return a 500.
**Bad:**
Grind every day. Consistency is the only secret to becoming a top developer.

### Recap
**Purpose:** Friday review connecting shipped artifacts, technical gotchas, and next steps.
**Template:**
> [Week wrap hook]
> shipped: [specific feature or artifact]
> learned: [concrete technical gotcha from commits]
> next: [upcoming focus]
**Good** (shape only; every line must come from that week's commits):
image backends fail at random. build the retry in first.
shipped: a `cat contact.json` terminal card on my portfolio
next: more projects in its lab section
**Bad:**
Another productive week in the books! Grateful for the progress and excited for what comes next.

## Rules that protect reach

- One idea per post. If it needs a thread, it's two separate posts.
- Specific beats general: real framework names, library names, and exact errors.
- Plain words. If a sentence belongs in a press release, delete it.
- End on an insight or a real technical question; never "thoughts?" or "agree?".
- Zero hashtags is the default. Never use hashtag blocks.
- No emoji bullets, no 🚀, no 🧵, no ALL CAPS.
- Never fake first-hand experience ("I tried X") when the source is news.

## After posting

- **Manual replies:** The automation must never reply. The account owner must reply manually in the first hour to activate the ~150x reply weight.
- **Outbound replies:** Author replies manually to peer accounts shortly after they post to build network reach.
- **Profile foundation:** Maintain an active X Premium subscription for algorithmic visibility, a bio stating what you build, and a pinned post showcasing a real shipped artifact.
