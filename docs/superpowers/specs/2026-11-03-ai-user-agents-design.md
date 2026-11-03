# AI user agents: a persona uses the app, judges it as it goes, and files what confused it

> **Verdict:** evolve the AI explorer we already have (`desktop/e2e/lib/explore.mjs`, 5 Oct, manual only, **0 of 186** Finder issues ever came from it) into a **persona with a goal, realistic data and a judge in the same loop**, driven through the AI broker, **one long session a day (~30 min) that wanders through many journeys in a different, seeded order each time**, files **anything it believes is a bug together with its argument**, and **starts every session from a permanent knowledge base of how the app should work** that it also grows. Report only, never a gate. The 4 tester bugs of this week were **data shapes no test ever had**, not clicks no test made: so the persona's data (a messy CV, forwarded e-mails, a multi-language profile) and the diversity of its paths matter as much as its brain.

**Owner's words (3 Nov 2026):** "claude desktop can maniupulate my jobadabra desktop app. Can we run this on the server, a claude agent that literally tests my app by clicking around. And can interpet on the fly things." · "Right now our process is that we have e2e, that makes screenshots, or does random clicks (interactions) or have differnt states. And then a separate claude job/workflow does review it. How can we make a better version." · picked: "start it now, use the ai-broker (which can be codex, or claude, or Free AI)".
**Owner's answers (3 Nov 2026, on the sketch):** evolve the explorer, not a second tool. Filing: "in the beginning I think it's fine to report anything what he thinks is a bug, but he should have an argument why he think it's a bug" (replayable-only "would be … a blackbox"). Cadence: "I want to run it daily … a longer session. where he tests multiple journeys"; "I don't want him to test the same journeys every day. I want him to be as diverse and as creative every time … new states, new CV profiles, new search strategy, no order of actions … starting with a strategy, searching for some jobs, then changing the strategy, then do some filling, then updating the CV, then changing the cover letter, then doing something on the Focus"; "testing the app for 30 mins, in those 30 mins he will start to understand the app better and file more precise bugs". Types: "of any type: UI (unresponsive elements, bad looking UI, inconsistent design system, bad UX, confusion, hard to do some action, lack of guidance/information on how to do X) … also data, performance, errors (or lack of them)". Memory: "a permanent knowledge/memory about the app … every time the agent starts, he already knows how the app should function … each time he can improve his knowledge … up-to-date with our changes (website changelog, build log, or main git history … you tell me)".
**Who gets what:** the owner gets a daily report of where a first-time person of a given country, language and role got stuck or was confused, with the screen, the data behind it and the steps, filed through the Finder like every other finding. Today he finds these by looking, or a Windows tester does.
**Layer (skill `e2e-harness`):** a **measurement, nightly, report only**. Never a PR gate, never a beta step, no `critical-journeys.json` entry. It adds no e2e step; it reuses the harness (`launch()`, stand-ins) like the explorer does.
Sketch: https://claude.ai/artifact/1CXF87SyJt84HP71QT9SqG (a Claude Artifact, rebuilt 3 Nov 2026 after the owner changed Claude subscription; it carries every answer he gave, and this spec is the whole design).

## What exists (measured on origin/main `df66db14`, 3 Nov 2026)

| Method | Sees | Acts | Judges | Data it starts from | Filed to the Finder |
|---|---|---|---|---|---|
| e2e suites + screenshots | screenshots | scripted | later, by `ui-findings.yml` (AI review of the shots) | the suite's seed / demo data | yes (`ai-review` 77 issues) |
| Wander (nightly) | nothing | random walk | no | 4 start states + faults | via suite failure only |
| Interactions (nightly) | nothing | presses every safe control | rules: dead control, slow, late shift | demo data | `interaction-probe` **6** |
| Layout checks | DOM | no | rules | the screenshot run's | `layout-check` 28 |
| **AI explorer (`suites/explore.mjs`)** | page text + controls | picks a control, types ≤ 200 chars | the same model, but a report needs a *script check* (`text_visible`, `text_missing`, `console_error`, `dead_control`) and is replayed without AI | a set-up app, no goal, no persona | **0** (manual only, `cadence: manual`, Haiku on an API key, ≤ 40 steps, ≤ $0.50) |

- So "no one sees, acts and judges in one loop" is **half true**: the explorer does, but it was never run on a schedule, has no goal, no realistic data, cannot express a *meaning* bug as a check, and does not use the broker.
- Counts: 186 `auto-ui` issues; `source:` ai-review 77, code-review 36, layout-check 28, suite-failure 39, interaction-probe 6, explorer **0** (`gh issue list --label auto-ui`, all states).

### The 4 tester bugs: what they needed to be seen
| Bug (Windows tester, 2–3 Nov) | Fixed in | Pre-fix commit | What had to exist to see it | Existing methods |
|---|---|---|---|---|
| What we learned asks "Workload", "Summary" (bare labels) | #3027 | `b4d64112` | a Profile with ❓ lines / unclear answers | none fed one: the fix notes "no test fed a bare label or a heading line to the queue" |
| "Saved: Summary", a CV heading saved as an answer ("Keep as is") | #3027 | `b4d64112` | label-less saved lines from a CV with headings | same |
| Language line drawn as a level grid that names no language | #3027 | `b4d64112` | a composite language line in the queue | same |
| Inbound list: e-mail subject as title, "Not checked" on an applied job, red "!" logo | #3026 | `b6014b04` | inbound rows (mail leads) on the Jobs list | demo data **had none**: "inbound rows in the nightly AI screenshot review (the demo data now has them)" |

**Baseline: 0 of 4 could be seen by any existing method, because the screens were visited but the data shape was absent.** The persona's value is therefore: (1) data made by the product's own writers from messy, realistic input; (2) a judge that reads *meaning* ("is this a question a person can answer?") while it is on the screen.

## The loop (one step) and the session (~30 min of steps)

**Session = persona + a seeded plan of goals, not one journey.** Owner: "In a short session he is just doing the warmup." A session runs ~30 minutes (~200 steps) in one app, one data folder, so state accumulates (jobs found, answers given, a CV changed) and later steps meet the consequences of earlier ones. It starts from the knowledge base (below), spends the first minutes on what changed since its last session, then follows its plan, and ends by writing back what it learned. The plan is built by the diversity generator (next section); the loop below runs once per step.

```
 goal (from the plan) + persona + what I know about this app
        │
   ① READ     accessibility tree (names, roles, state) + visible text; screenshot only for the judge
   ② DECIDE   one structured answer: {next action, why, what I expect}   (what I expect comes from the knowledge base, or "unknown")
   ③ ACT      Playwright press / type / choose (same safety rule as the probe)
   ④ RE-CHECK did the screen change as expected? reopen it; read the stored value through the app's own IPC: is it saved, and is it sensible (not its own label)?
   ⑤ NOTE     if confused, or what happened differs from what I expect, or it is slow/ugly/unclear: a note NOW with an ARGUMENT (screen, data behind it, steps so far)
        └── next step; a goal ends when reached, "stuck" (same screen 3 times) or its step share is spent; the plan moves to the next goal
```

**Bug types the agent looks for (owner: "anything basically"):** UI (a control that does nothing, looks wrong, breaks the design system), UX (confusing, hard to do, no guidance on how to do X), data (a wrong, empty or label-as-value saved row; a consequence that did not happen), performance (a step that takes long with no sign of work), errors (a raw error shown, or an error that should have appeared and did not). Each note has one `type` of these five, so precision is a number per type.

- **One broker call per turn** (the broker is request/response: `{tier, prompt, schema, images}`, no tool-use loop; `lib/broker-client.mjs`). The turn's answer is a JSON schema: `{action, control, text?, expect, confused?: {what, why}}`. The prompt carries persona, goal, the last 6 steps in words and the current observation.
- **Re-check (④) is what the explorer lacks.** After a Save the agent asks the app for the stored row (the same command channel `lib/offline-app-commands.mjs` the suites use) and the judge call answers: "is this value a sensible answer to its label?". This is how "Saved: Summary" is found even if the screen looks fine.
- **Notes carry an argument, in the loop.** A turn writes `{type, claim, argument: {expected, observed, why it matters}, evidence}`; `expected` cites a knowledge-base entry id or says "general UX: <principle>". A note with no argument is dropped. A second broker call (below) reads the note and screenshot cold and says whether the argument holds.
- **Safety:** the explorer's rule stays (`isSafe`: nothing that deletes, sends, signs in, leaves the app, spends AI credit; Enter never pressed; ≤ 200 typed characters; no password field). The agent can't leave the window (`JOBADABRA_E2E` host doors are closed, `lib/e2e-host.js`).

## Diversity: a different session every day

Owner: "I don't want him to test the same journeys every day … as diverse and as creative every time."  A session is **generated from one seed** (printed in the report; `workflow_dispatch` takes a seed to replay it), from three pools:

1. **Who** (fictional only; names, CVs, e-mails invented; global, not tech, memory `project-global-not-tech`): country × UI language × role × CV shape × strategy. The CV is *generated* per seed from a list of shapes that have broken things (heading lines as text, a table CV, no summary, 3 to 4 languages with levels, gap years, a salary in another currency, an unusual file name, a very short or very long CV), not picked from five fixed people. The table below is the seed list.
2. **Which moves** (the vocabulary of what a person does in this app): set a strategy, change it, search for jobs, open a job, fill an application (Check mode, never Submit), update the CV, generate a tailored CV or cover letter, change the cover letter, answer What we learned, dismiss a question, read Inbound replies, use Focus, change a setting, use ⌘K, go back, reload, quit and reopen. The vocabulary is read from the app's own list of commands (`⌘K` palette registry, one entry per action) so a new action appears in the pool the day it ships.
3. **Which order**: the plan is a random *story*, not a script, e.g. "strategy → search → change strategy → fill → update CV → change the cover letter → Focus". The planner (one `mid` call at the start) is given the persona, the moves, the knowledge base's "least visited" list and "changed since last session" list, and writes 6 to 10 goals with an expected consequence each. Order is shuffled by the seed; **at least half the goals must be a move/state pair not in the last 7 sessions' coverage record** (the session writes its coverage to the knowledge base: screen × state × move).

The journeys below stop being the unit of a run and become **named plans for the proof** (replaying the tester bugs) and for by-hand reruns.

| Persona (seed list) | Country · language · role | CV quirk (the data shape that mattered) |
|---|---|---|
| Marta | Portugal · pt-PT · primary-school teacher | headings as lines ("Summary", "Experience"), 2 languages with levels |
| Dennis | Germany · de · warehouse supervisor | tabular CV, no summary, shift work |
| Aisha | Kenya/UK · en · nurse | credentials list, 3 languages, gap years |
| Tomasz | Poland · pl · bookkeeper | one-page CV in a table, salary in zł |
| Lucía | Spain · es · UX designer | portfolio links, 4 languages |

| Named plan (for the proof and by-hand runs) | Finish line (the agent must say it reached it) | Screens |
|---|---|---|
| J1 Fill Profile from my CV | "Your details" has my name, e-mail, ≥ 5 facts, nothing saved that is only a heading | Setup/Profile |
| J2 Answer What we learned | the queue is empty or every item is answered/dismissed; each saved value read back | What we learned drawers, Fill your details |
| J3 Change strategy, re-score | new target role + place saved, jobs re-scored, the "re-score" prompt answered | Strategy, Jobs |
| J4 Inbound replies | forwarded mails matched to jobs; the Inbound list reads like the Jobs list | Jobs (Inbound) |
| J5 First run | wizard AI → CV → Strategy (and nothing else) | Setup wizard |
| J6 Settings tour | find "where do I turn on notifications / change language" | Settings, ⌘K |

## A person who lives for weeks, and deep states on day one (owner, 3 Nov 2026; phase 2)

**Owner's words (relayed by mac-07, 3 Nov 2026):** "we should have goals. To try to use the app as a real human... that can do steps not in the order the app is expected.. OR can get into states, not common.... I'm not sure we should start fresh every time … a fresh state/profile … in the first day it just does wizard... second day it searches for jobs and does the profile filling. Third day it activates gmail.. Fourth day it activates always on... Basically that can get into more deep scenarios, which with a fresh/basic state it will not be possible. So that every day new jobs are being found. New scenarios." Asked to advise ("Not sure, you advise me"; "how we can find bugs that would matter for the users"), mac-07 recommended living personas plus aged states, the person's goal as the oracle, severity, real-use weighting and a replay proof.

**Verdict:** a session no longer starts from a fresh install. A **persona lives across nights**: each night is one chapter of its life, its data folder is saved after the night and restored the next, and a **fake world moves** (new fictional jobs, new mail). Because a month takes a month, an **aged-state generator** builds a "day 30" folder so deep states run tonight. Every finding carries the snapshot and seed that reproduce it.

**Checked against the code (origin/main, 3 Nov 2026):**
| Need | What exists | What is new |
|---|---|---|
| Reuse a data folder | `launch({profile})` keeps the person's data across a relaunch (`lib/app.mjs:43`) | save it after a night, restore it the next (nothing does across runs yet) |
| Fake Gmail / Notion / job feeds | `lib/google-fake.mjs` (3 invented mails), `lib/notion-fake.mjs`, `fixtures/feeds` + `lib/feeds.mjs` (varied by seed) | a day's mail (reply, rejection, interview invite) and a day's new jobs from a seeded generator |
| Days passing on the app's clock | libfaketime on Linux, used by `tools/clock-moved.mjs` | a clock option on `launch()` |
| Real accounts, real sites, job texts kept centrally | none, and none will be | rule stays: fictional data only (memory `project-no-job-texts-central`) |

### Two lanes (owner, 3 Nov 2026: "could we simulate those states, by presetting a specific state? Or we should have both methods... 3 sessions that use the same profile/state for a week, let's say. And 3 sessions that start fresh every day with random profile every time, with random states...")
| Lane | What a session starts from | Lives | Finds |
|---|---|---|---|
| **A · Living** | the same persona's saved folder, one chapter further each night | 7 nights, then retires and a new persona starts (staggered) | bugs that need history: a state the earlier nights left, consequences, restarts |
| **B · Fresh random** | a **seeded random state built by the product's own writers**: a random person plus a random depth (0 to 500 jobs, n CV versions, a full or empty profile, connections on or off, Always on on or off) | one night | deep and odd states without waiting a month: pre-seeding and fresh-random in one mechanism |

Both lanes use the same plan, moves, re-check and findings; they differ only in where the folder comes from. Lane B's generator **is** the aged-state generator below (the "day 30 folder" is one draw of its depth). Lane A needs the snapshot save/restore; lane B needs none. **Decided (owner, 3 Nov 2026, "1 living + 2 short fresh"):** each night **1 living persona (200 steps, one profile for 7 nights) + 2 fresh personas (60 steps each, a random person and a random pre-seeded state)**, about **4.5% of the Codex week a night, ~32% a week** (straight per-step estimate; the context-growth estimate below gives ~3.8%). It grows toward 3 + 3 only on measured real bugs per night.

### Chapters of one life (lane A; a persona-day is one chapter)
| Night | Chapter | Done when |
|---|---|---|
| 1 | Wizard: AI → CV → Strategy (and nothing else) | the app is set up; the CV's facts are in Your details, no heading saved as a fact |
| 2 | First search, Jobs list, Profile filling, What we learned | jobs found and scored; the queue answered or dismissed; each saved value read back |
| 3 | Connect Gmail (fake Google) | replies matched to jobs; the Inbound list reads like the Jobs list |
| 4 | Always on | the setting is on, a night passes on the app's clock, the morning shows what ran |
| 5 | Applying in Check mode (never Submit) | forms filled and checked; answers kept |
| 6+ | Free days: new jobs arrive, replies and rejections arrive, strategy and CV change | a goal from the plan (3/11), in the state the earlier nights left |

### Off-script on purpose
Steps in the wrong order, back or quit in the middle of a step, restart the app, skip a step, change a setting mid-run, go offline, days passing on the app's clock. These are moves in the plan's pool (3/11), weighted up on chapters 2 to 6; the pool's pairs are the coverage unit, so a new order counts as new.

### The world that moves (fictional only)
- **Jobs:** a seeded generator writes the day's postings in the shape of `fixtures/feeds` (roles and places of the persona's strategy, plus some outside it); the stand-in feed serves them; no real site, nothing stored centrally.
- **Mail:** `google-fake` receives the day's mails (a reply, a rejection, an interview invite, a forwarded lead) built from the same generator, tied to jobs the persona applied to.
- **Notion:** `notion-fake` when the persona's store is Notion (a minority of personas).
- **Clock:** a night's "days passing" is libfaketime on Linux (how `clock-moved` moves it).

### Staggered personas
A new persona starts when the oldest has finished chapter 5, so every life stage runs somewhere each night. With N persona-days per night the stages covered each night are: 1 → one stage; 2 → an early and a late one; 3 → early, middle and late.

### Aged states: day 30 tonight
A generator builds an aged folder through the product's own writers (engine commands, never hand-written rows): 300 jobs with a scoring backlog, several CV versions, a full profile with Education rows and more than six details, a Gmail history, Always on running. Why: this week's tester bugs all lived in such states: the 303-job scoring backlog, the CV-version limit, the 6-details cap, Edit on Education rows. A fresh install cannot reach them. Aged folders are a few fixed recipes plus the seed (not stored: rebuilt each night), so they cost no storage and replay exactly.

### Every finding replays
A finding carries `{persona, chapter, seed, snapshot id}`. The replay restores that snapshot, applies the seed and runs the recorded steps offline, without AI (like the explorer's `replay`). A long-lived state is what makes bugs unreproducible, so this is a requirement, not a nicety: **no finding is filed without a replay that reproduces it**, and the snapshot is attached to the issue's evidence branch (`agent-evidence`) so it outlives the artifact's retention.

### Where saved days live (decided: owner, 3 Nov 2026, "GitHub Actions artifact")
A night's snapshot (data folder, seed, chapter, coverage) is a GitHub Actions artifact `agent-life-<persona>` (retention 30 days, the existing artifact secret scan runs on it, fictional data only); the next night downloads the last successful one. The folder's size is printed by the first run; if it is large, the data folder is trimmed to the store and settings (caches excluded).

### Cost per night (estimate from the 2/11 measurement)
A session of n steps costs about 4.5k·n + 26·n² tokens (the context grows ~50 tokens a step), and 1% of the Codex week is ~720k tokens (the 40-calls-per-1% rule): **200 steps ≈ 2M ≈ 2.8%, 100 steps ≈ 0.7M ≈ 1.0%, 60 steps ≈ 0.4M ≈ 0.5%.** A short session is much cheaper per step because the context stays small.
| Sessions per night (living + fresh) | Steps each | Per night | Per week | Verdict |
|---|---|---|---|---|
| 1 + 0 | 200 | 2.8% | ~20% | the smallest start |
| 1 + 1 | 200 | 5.6% | ~39% | both lanes, one each |
| 1 + 1 | 100 | 2.0% | ~14% | both lanes, short |
| 3 + 3 | 200 | 16.8% | **~118%** | **not possible**: more than the Codex week |
| 3 + 3 | 100 | 6.0% | ~42% | possible |
| 3 + 3 | 60 | 3.0% | ~21% | possible; sessions too short to finish a chapter |
No brake stays (owner, 3 Nov 2026): a spent Codex week falls to Claude, then Free AI; the cost view shows the share per workflow. **Decided start: 1 living at 200 steps + 2 fresh at 60 steps** (2.8% + 2 × 0.5% = ~3.8% a night by this table's formula, ~4.5% by a straight per-step scale; ~27% to ~32% a week). Raise by measured yield (findings that hold up and replay, per session and per lane), toward 3 + 3.

### What makes a finding matter (mac-07's recommendation, adopted)
- **The oracle is the person's goal, not the screen.** After each action the agent re-opens the screen and checks the stored value: saved, right, and said so. 5 of the tester's 8 new items this week were silent failures. 3/11's re-check is the first piece.
- **Severity:** **high** = loses data, a wrong result or a false status, or the person is stuck; **medium** = a task is slower or harder than it should be; **low** = looks wrong. Wording nitpicks are not filed.
- **Weight journeys by real use:** where installs spend time and what feedback rows and Sentry say; every tester report becomes a scenario in the plan's pool.
- **Proof:** 8/11 replays this week's tester bugs on the commits before their fixes and counts found vs missed; later, the escape rate (bugs users report that the agent missed).

### Phase 2 PRs (after the core eight; order decided by the owner, 3 Nov 2026: fresh random states first, the living persona after)
| PR | What | Proof |
|---|---|---|
| 9/11 | the aged-state generator and the first deep-state sessions | the generator builds the day-30 folder with the product's writers; a replay of the 303-job backlog bug on its pre-fix commit is found |
| 10/11 | a living persona: save and restore the snapshot across nights, the chapters, staggered personas, replay from a snapshot | two nights in a row restore the same folder; a finding replays from its snapshot |
| 11/11 | the moving world: daily jobs, daily mail, the clock option, the off-script moves | a night with a new reply and a day passing shows in the next morning's state |

## Where it runs

| Question | Decision | Measured / why |
|---|---|---|
| Runner | `ai-user-agents.yml`, Ubuntu, the app built from main in the job, xvfb | the same `launch()` every e2e suite uses (`lib/app.mjs`): Playwright `_electron`, throwaway profile, `JOBADABRA_E2E=1`, `ownerGuardEnv`, `ownPortEnv`; the engine refuses any folder but its temp one |
| How it drives Electron | **Playwright `_electron`** for acting and reading; the **app's own command channel** for seeding and for stored-value reads | alternatives rejected: CDP direct (same as Playwright with fewer helpers); pixels via computer use (what Claude Desktop does: no DOM, 10× tokens, cannot run headless on Linux) |
| What the agent reads | `locator.ariaSnapshot()` (playwright-core 1.55) **plus** the explorer's `observePage` text; measured in 2/11: equal tokens, neither wins on every view, so the text stays the acting view (see "Measured") | spike measures per view: tokens, ms, controls with no accessible name (an unnamed control is itself a finding) |
| The app's own AI | the harness stand-in, answered **by operation + shape** (`x-jp-action`), the answer set recorded from real runs (`ai-format-manifest`) | rule of `e2e-harness`; the CV-parse answer for a persona is recorded once per persona from a real parse (a Mac/CI refill), so heading lines come out the way the real engine writes them |
| Notion, sites, mail | stand-ins (`notion-proxy`, recorded pages); mail leads built by the engine's own mail commands from invented mails | `Real sites only with fake data`: none used |
| Never | the owner's app, port 47111, Keychain, accounts, Claude login, `~/.claude.json` | existing guards + `desktop/e2e/test` owner-guard tests; this suite adds a test that its env has none of them |
| Not covered | Windows-only look (fonts, paths) | non-goal; the integration app layer runs on Windows; a Windows night is parked (JOB below) |

## AI: the broker only

- Every call: `askBroker()` (`lib/broker-client.mjs`), GitHub OIDC, lane `scheduled`. No API key, no `modelFetch`. The explorer's API-key path is deleted. Engine = whatever the broker's flag says (Codex, Claude or Free AI); the report prints `aiLine` once.
- Tiers: **act = `small`** (picking the next control from a named list is easy), **note judge and re-check = `mid`** with screenshot. `large` never. 2/11's spike runs the same recorded journey with small and mid for acting and keeps the cheaper one that reaches the finish line equally often (≥ 4 of 5 runs).
- **Measured inputs we have** (`2026-10-28-ci-on-codex-subscription-design.md`): ~7 s per call sequential, 4 at a time ~10 s each, ~18k tokens per call (that was a long prompt), ≥ 40 calls per 1% of the Codex week. Our turns are shorter (observation capped), so 18k is the **ceiling**; 2/11 prints tokens per call.
- **Budget per session (hard):** **35 minutes of wall clock and 260 broker calls**, whichever ends first: ~200 acting calls (tier small), ≤ 40 note judges and re-checks (tier mid, with screenshot), 1 planner, 1 write-back (mid). 200 steps × (~7 s call + ~2 s app) ≈ 30 min. At the measured ceiling (40 calls per 1% of the week) that is **≤ 6.5% of the Codex week a day, ~45% over 7 days**. That is the ceiling: our turns are far shorter than the 18k-token calls it was measured on, and 2/11 prints the real tokens per call, after which this figure is replaced by a measured one (it can fall by half or more).
- **Measured (2/11 by-hand run 41572083373, 3 Nov 2026, tier small, engine Claude on every call; replaces the ceiling above):** 29 calls in 251 s wall (202 s of AI), so **7.0 s per call (4.8 to 11.6 s)** and about **1.7 s of app time per step**; **~4.5k input + ~0.9k output = ~5.4k tokens per call**, rising ~50 tokens per step (4.8k average over the first 10 calls, 5.8k over the last 10, as older views are elided). Extrapolated, a 200-step session is ~2M tokens (call 200 ≈ 15k, under the 18k ceiling), about 2.8% of the Codex week on the ceiling's 40-calls-per-1% rule: **an estimate, ~45% of the old 6.5%**; 35 minutes fits ~240 steps at 8.7 s, so the 260-call cap is never the binding one. **Small vs mid** (same screen, 3 calls each): small 5.7 s, mid 8.3 s (+45%), same input (~2.4k), mid answers shorter (301 vs 479 to 874 output tokens) and all three mid answers were the same click, small varied: **small acts, mid judges and plans.** **Tree or text** (8 views): tokens equal (2,758 text vs 2,771 tree), named controls 102 vs 99, unnamed 3 vs 1, the tree reads 2× faster (277 vs 529 ms); neither sees more on every view (the tree wins on interviews and settings, the text on focus and strategy). **Decision: the text view stays the acting view** (it numbers the controls a move names); the tree is not added to the prompt; counting its unnamed controls as a finding is parked as JOB-250. **Also seen:** with no goal the agent called `done` after 29 steps on 3 views (jobs, calendar, interviews) and filed nothing: the plan and the persona (3/11) are what make a session wander.
- **No week brake (owner, 3 Nov 2026: "We have codex + claude + Free AI… fallbacks. So I'd suggest no brake, but we should have a view/report/control over how costly is each of the session, how many tokens it burns compared to all the CI workflows").** The broker's own chain handles a spent Codex week (Codex → Claude → Free AI, `lib/fallback.mjs`); a refused call mid-session (`capped`) ends it with the notes so far, filed as usual. What replaces the brake is the cost view and the control below. **Quality note:** a session that falls to Free AI mid-way is weaker; each call's engine is recorded and the report shows the share per engine, so a poor session can be read as "mostly on Free AI".

### Cost view and control (new; the owner's ask)
- **Today nobody can see tokens per workflow:** the broker passes only the lane (`pr`, `scheduled`, `bench`, `drift`) to its meter (`jobadabra-web workers/ai-broker/worker.js:226`, `x-lane`), and a per-consumer counter was only a plan (`2026-10-28-ci-on-codex-subscription-design.md`, "/admin/ai-cost, PR 7"). So the first PR is in `jobadabra-web`: the broker tallies every accepted call by **workflow file name read from the verified OIDC claim** (`job_workflow_ref`, never from what the caller says), per UTC day: `{workflow, calls, tokens, ms, engine}`; its `/health` returns the tallies.
- **The view:** a section on /admin/ai-cost (the page that already shows the broker card) and one line in each session's report: **this session: N calls, T tokens, M min, X% of today's CI tokens, Y% of the week, engines: codex a% · claude b% · free c%**; a table of every workflow's tokens for the last 7 days, so "how many tokens it burns compared to all the CI workflows" is a bar, not an estimate.
- **The control (no code to change):** repository variables read by the workflow: `AI_USER_AGENT` = `on` | `off` (a switch), `AI_USER_AGENT_MINUTES` (default 35) and `AI_USER_AGENT_CALLS` (default 260), so the owner can shorten, lengthen or stop the daily session from GitHub's settings page, and the report prints the values it ran with. No automatic skipping; if he wants a brake later it is one more variable.
- **One long session, not several short ones**: context stays in one place; the write-back keeps what it learned. A **rolling summary** (every 40 steps a `mid` call compresses the session so far into ≤ 600 tokens) keeps each turn's prompt short.

## Findings: into the Finder, with a detector of their own

**Owner's rule (3 Nov 2026): at the beginning, file anything the agent thinks is a bug, but it must argue why.** A silent "replayable only" filter would make the agent a black box; every issue is a way to see and improve its judge and behaviour.

- Detector name **`ai-user-agent`** (`source:ai-user-agent`), labels `agent-type:<ui|ux|data|performance|error>`, `persona:<id>`, `seed:<n>`, `judge:<agrees|disagrees>`, `proved` when it replays. Kinds map to the Finder's existing list (`text`, `functionality`, `wrong-result`, `consistency`, `empty-state`) plus `unnamed-control` and `slow-no-feedback`. Precision per detector is already computed on /admin/testing/self-healing from `source:` labels; this method adds a per-`agent-type` split, so it is tracked from day one.
- **Every issue is an argument, not a complaint:** the claim; **expected** (the knowledge-base entry it relies on, quoted, or the named UX principle); **observed**; **why it matters**; the screenshot; the data behind it (stored row or queue item as text); the steps from the session's start in words; the persona and seed to replay.
- **Filing rule:** a note with an argument and a second-opinion call (different tier, cold read of note + screenshot) is filed whether the second opinion agrees or not; a *disagrees* issue carries `judge:disagrees` and `needs-human`, so the owner sees where judge and agent differ, and that is the data for improving the judge. A note without an argument is not filed (it is counted in the report as "dropped: no argument").
- **A flood guard, not a filter:** at most **12 issues per session**, ranked by (proved, then judge agrees, then severity); the rest are listed in the report with their arguments. Why: the Finder's own judge pass takes at most 3 a run, and a 30-minute session can note dozens. The cap is raised or removed when precision is known.
- **Proved** (the explorer's "an agent explores, a script proves", kept): where a script check exists (explorer checks + new `value_equals_label`, `no_bare_label`) the steps are replayed from a fresh seeded profile **without AI**; a hold gets the `proved` label and ranks first. Replay is a bonus signal, not a gate.
- **Closed issues teach the agent:** an `ai-user-agent` issue closed `wontfix-auto` / "by design" becomes a knowledge-base entry "not a bug: <claim>, because <reason>" the next session reads (the Finder already feeds corrections back this way: `lib/reversals.mjs`). A confirmed one becomes an "expected" entry.
- Dedup: the Finder's fingerprint (`fp:<id>`, view + normalised claim) as for every detector; "Seen again" / "Not seen" comments apply.
- Precision readout: findings **filed / confirmed / false positive** per `agent-type` and persona, `judge` agreement rate, plus **recall** on the planted-bug check below.

## Seeing what it did, bugs or not (owner, 3 Nov 2026)

Owner: "What's the way to collect data about him? About what journeys did it go … I'd like to see what it did, even though it didn't find any bug." Today the explorer keeps nothing but its bugs. **Recommendation: record everything from the first session, in three layers of detail, and show it on a page.**

| Layer | What | Kept where, how long | Why |
|---|---|---|---|
| **Step trace** | every step as one JSON line: time, screen, what it saw (control names, not raw text), action, what it expected (and the knowledge id), what happened, ms, tokens, engine and model; a screenshot at the end of every goal and at every note | workflow artifact `agent-session-<date>`, 30 days; screenshots ≤ 1 MB each, ≤ 40 a session | the raw material to improve the prompt, the planner and the judge: replay any session from its seed and compare |
| **Goal verdicts** | per goal: *worked as expected* / *worked, with doubts* / *could not finish* / *bug*; one sentence each, with the evidence (the stored value read back, the banner that appeared). **A pass is recorded with its evidence, not left blank.** | in the session summary | "no bug found" becomes "7 goals checked, 6 worked, 1 could not finish: here is why"; a goal it could not finish is a signal about the app's guidance or about the agent |
| **Session summary** | seed, persona, plan, goals and verdicts, coverage (screen × state × move, new vs seen before), notes filed / dropped (no argument) / over the cap, cost (calls, tokens, minutes, share of today's CI, engines), knowledge read and written | `agent-memory` branch (one small file per session, indexed), and **published to the site like the Finder's numbers** (`selfheal-stats.mjs` reads the run's artifacts and PUTs the snapshot with the existing `SELFHEAL_PUBLISH_KEY`: no new secret) | one page for all sessions |

- **The page:** `/admin/testing/agent` in `jobadabra-web` (the Testing menu, next to the self-healing page): a row per session (date, persona, seed, goals reached of planned, steps, notes filed, cost, engine mix), a **story** per session in plain words ("Marta set the strategy 'primary-school teacher in Lisbon' → searched, 14 jobs → opened the third → filled it in Check mode → everything as expected"), a **coverage map** (screens × moves, colored by days since last seen), and the trend of precision per `agent-type` once issues have verdicts.

## How it reports a bug: GitHub issues, with the Send-feedback evidence package (owner's question, 3 Nov 2026)

Owner: "Maybe we can use the freshly built 'Send feedback' which can include the profile, screenshot … relevant data and logs … receive them in a similar Feedback tag, but filled by AI. Or should it simply create GitHub issues?" **Recommendation: GitHub issues (the Finder's lifecycle), carrying the same evidence package Send feedback now builds. Not the production Feedback channel.**

| | Send feedback (the real-user channel) | GitHub issue through the Finder |
|---|---|---|
| Evidence | screenshot, redacted logs, the screen's data, an optional Profile snapshot, app version, OS, install id | the same four, built by the same code (below) |
| What happens to it | a D1 row, files in R2 for 90 days, **a Telegram message to the owner for every report**, a viewer on /admin/growth/feedback; no status, no dedupe, no link to a fix | `fp:` dedupe, "Seen again" / "Not seen", the verdict pass, `wontfix-auto` / `confirmed`, precision per detector, a PR can say "Fixes #n", the triage skill and sessions work from it |
| For an AI reporter | up to 12 reports a session = 12 Telegram messages a day, mixed with the rare real person's; counts and the admin list lose their meaning; the CI test app has its outbound network cut by design ("nothing it learns leaves this computer") so the post would have to come from the runner, to the production API | synthetic and real stay apart by `source:ai-user-agent`; the Finder already files from CI |
| What the owner wants: "see and improve the agent / judge" | one list, no precision | `judge:` and `agent-type:` labels give precision per type, and a closed issue teaches the agent (knowledge layer 2) |

How the evidence package is built so it is identical to a person's report: the harness opens the page the agent is on and calls **the same registry that "Send feedback" uses** (`renderer/feedback-data.js`, pages in `renderer/pages/feedback-screens.js`) for the screen's data, takes the window screenshot the same way, reads the app log through **the same redactor** (`desktop/lib/log` redaction), and exports the persona's Profile snapshot (fictional, so safe to attach). Files go to an `agent-evidence` branch (like `pr-assets` for the Finder's screenshots; deleted after 30 days), and the issue body shows the screenshot and links the logs, screen data and profile. A bonus: every note exercises the Send-feedback data functions, so a screen whose data function breaks shows up as a note.
- **If the owner prefers to read them in the Feedback tab:** later, an additive `source=ai-agent` filter on /admin/growth/feedback that lists these issues, with no Telegram. It is parked, not built (value is small while the issue list and the sessions page exist).

## Cadence by risk

Owner's answer replaces "one journey a night": **one long session a day, daily, all areas in play**, with the plan *weighted* by risk instead of the run frequency being. Weights = commits to each area's code since 20 Oct 2026 (`git log --since=2026-10-20 -- <paths>`, 3 Nov), recomputed at each session start:

| Area | Commits in 14 days | Broke for a user this week | Share of goals in the plan |
|---|---|---|---|
| Jobs list + Inbound | **51** | yes (#3026) | largest |
| What we learned | **36** | yes (#3027) | large |
| Focus | 36 | no | large |
| Strategy + re-score | 32 | no (#3024 just landed) | large |
| Profile / Your details | 28 | yes (#3027) | medium |
| Setup wizard | 22 | no (Tier 1 e2e covers it) | small |
| Settings | 16 | no | small |

Rules: every area gets at least one goal a week (the planner is told which ones it skipped); an area whose code changed on main since the last session gets a goal **today**; the "novelty" half of the plan (new move/state pairs) is exempt from the weights. A session by hand (`workflow_dispatch`: seed, persona, optional named plan) is always possible.

## The agent's knowledge: permanent, growing, current

Owner: "every time the agent starts, he already knows how the app should function … each time he can improve his knowledge … he also must be up-to-date with our changes … you tell me." **Recommendation: three layers, each with one owner, so memory can't drift and can't fill the prompt.**

| Layer | What it holds | Who writes it | Where it lives | How it reaches the agent |
|---|---|---|---|---|
| **1. Expectations** (how the app *should* work) | short cause→effect rules, one per line, each with an id and a source: "Updating the CV shows a re-score call to action on Jobs" · "A tailored CV generated for a job is the one attached to that job's application form" · "A question is a sentence, never a bare label" | **people** (the owner's examples above are the first entries) and the agent's *proposals* once the owner confirms (a 👍 on the issue, or a PR) | `docs/app-expectations/<area>.md` in the repo, reviewed like code, so it is public and versioned | the session loads the files of the areas in its plan (≤ 3k tokens, an index first); an entry whose cited code changed since its last check is marked "stale: re-verify" |
| **2. Field notes** (what the agent *saw*) | screens and controls discovered, how a flow really behaves, which state needs which setup, "not a bug" verdicts, the coverage record (screen × state × move, last seen) | **the agent**, in its write-back step at the end of each session | a data branch `agent-memory` of this repo (like `pr-assets` for screenshots: no PR noise, not main), one file per area, entries `observed` → `seen 3×` → promoted to a proposal for layer 1; each entry names its session and the commit it was seen on | loaded with layer 1 for the plan's areas; entries seen on an old commit are down-weighted |
| **3. What changed** (freshness) | the changes since the last session: every merged PR's **verdict line** (each PR body starts with "🟢 what changed for the user"), its title and changed files mapped to areas through the existing code map (`desktop/scripts/codemap.mjs`) | **the workflow**, computed, never written by hand | built at session start from `git log <last-session-sha>..main` + the PR bodies (`gh pr view`), plus the website changelog page as a cross-check | a "changed since last session" list of ≤ 40 lines the planner turns into goals ("a PR changed Focus today: test Focus") |

- **Why git history + PR verdict lines and not the website changelog or the build log:** the changelog is written for users, after a release, and lags main by days; the build log says what was built, not what a person sees; the PR verdict line already says it for every merged PR the same day, with the files, so layer 3 needs no new writing habit. The changelog stays a cross-check.
- **The knowledge is the agent's second source of "expected"**: a note's argument cites a layer-1 id. A claim that contradicts a layer-1 entry is a strong note; a claim with no entry is a "general UX" note and says so; the write-back proposes a new layer-1 entry for it when the owner's confirmation would settle it.
- **No second pipeline:** layer 1 is markdown in the repo (existing review), layer 2 is a branch the workflow pushes to (existing pattern), layer 3 is `git log`. Nothing is served from the website; nothing learned from installs (the private-skeleton rule is not touched, this is developer knowledge about our own app).
- **Seed (4/11):** the first layer-1 files are written from the owner's stated examples plus the rules the specs and `docs/rules/*.md` already state in one line ("re-score after a strategy change", "Find jobs ≤ 3 min", "every mention of AI credit says what it buys"); each entry cites its spec. Nothing is invented: an expectation with no source is not added.
- **Size control:** an area's layer-1+2 text is capped at ~3k tokens when loaded; the write-back merges duplicates and drops field notes not seen for 30 days (kept in git history).

## Proof it is better (acceptance, measured in 8/11)

Replay: for each tester bug, check out the **pre-fix commit** (table above), run the matching **named plan** (a short, fixed plan, not a diverse session, so the four are comparable) with the persona whose data has the shape, 3 runs each; in addition, **2 free diverse sessions** on the same pre-fix commit, to measure whether the diverse long session finds them *unprompted* (the number that matters for the daily run) (broker AI is not deterministic), and run today's e2e + screenshot review on the same commit.
- Baseline (already measured, above): existing methods **0 of 4**.
- **Target: the agent finds ≥ 3 of 4 on ≥ 2 of 3 runs**, each as a *proved* finding or a *judged* note that matches the bug; and **0 filed findings about those four on the fixed commit `df66db14`** (the fixes hold; a filed issue there counts as a false positive). Free sessions are reported as "found n of 4 unprompted", with no target until measured.
- A fifth control: a **planted** bug (a Save that stores the label) the agent must find, so recall is a number from run 1 (the same idea as `mutants.json`).
- The result table (bug × runs found × method) goes into the PR body and this spec. If < 3 of 4, the spec says so and the persona data, not the prompt, is fixed first (the cause in 3 of the 4 is data, see "What exists").

## Non-goals
- No gate: not on a PR, not in the beta, not a `critical-journeys.json` step.
- No Submit, no real site, no real account, no captcha, no login wall, no computer-use of the owner's screen.
- No AI fixing: the Finder's fixer stays off (memory `feedback-ui-fixer-stays-off`).
- No Windows/Mac look; no pixel-level layout (layout checks own that).
- No second findings pipeline, no second broker client; the knowledge base is markdown + one git branch, not a database or a served service.
- No learning from real users' installs and nothing sent to the website: the knowledge is about our own app, written by us and the agent.
- No automatic promotion of the agent's claims to "how the app should work": a person confirms (👍 or a PR).
- Not replacing the AI screenshot review or Interactions: they see every view cheaply; the agent goes deep where the data matters.

## Acceptance criteria
1. A daily + by-hand workflow runs one ~30-minute session (seeded persona, plan, order) on an app built from main, using the broker only, within the minutes and calls its repository variables say (defaults 35 and 260; `AI_USER_AGENT=off` stops it); a refused call mid-session ends it with its notes filed.
1a. Every session writes a step trace and a summary with a verdict and its evidence per goal, passes included, and /admin/testing/agent lists each session with its story; a session with no bug still shows what it covered.
1b. The broker tallies calls and tokens per workflow (from the verified token claim) and /admin/ai-cost shows the agent's tokens next to every other CI workflow's; each session's report prints its own tokens, share of today's CI tokens, share of the week and engines used.
2. A session prints: seed, persona, the plan's goals and which were reached, steps, calls by tier, tokens, minutes, `aiLine`, the week's share used, and its coverage (new move/state pairs vs the last 7 sessions).
3. Two sessions with different seeds differ: ≥ 50% of their goals are different move/state pairs (a unit test of the planner on fixed seeds).
4. A note with an argument reaches `triage.mjs` as `source:ai-user-agent`, and at most 12 a session open as issues with screenshot, data, steps, `agent-type`, `judge`; the rest are in the report; a note without an argument is counted and dropped.
5. The session starts by loading layer 1 and 2 for its areas and the "changed since last session" list, and ends with a write-back to the `agent-memory` branch; a test proves a session reads a changed-file's area into its plan.
6. The owner-guard test: the suite's env contains no owner path, port, key or login.
7. The proof table above is in the PR body with numbers, and the target is met or the spec says it is not.
8. /admin/testing/self-healing shows the detector with filed / confirmed / false-positive per `agent-type` after the first session.
9. `explore.mjs` has no API-key path left; `cadence: manual` is replaced by `night-report`; `lanes.json` states why it is not a beta step.

## Progress
- [x] Read what exists: explorer, broker client, Finder sources, tester-bug PRs (this spec) (proof: docs/superpowers/specs/2026-11-03-ai-user-agents-design.md)
- [x] Sketch; owner's answers on base (evolve), filing (anything with an argument), cadence (daily, ~30 min, diverse) (3 Nov 2026) (proof: none: the sketch was a Claude Artifact and the answers came in the chat; they are quoted under "Owner's answers" in this spec)
- [x] Owner's yes on the knowledge design (3 layers); no week brake, a cost view and control instead (3 Nov 2026) (proof: none: the answer came in the chat; it is quoted in "Seeing what it did" and "AI: the broker only" in this spec)
- [x] Told a8 what is added to `desktop/e2e/`; a8's overlap: the Worker timer's daily slot in `app-core/src/scheduler.js` goes on its own lines (3 Nov 2026) (proof: none: a message to session jobadabra-63 and its reply, no file)
- [x] Plan `docs/superpowers/plans/2026-11-03-ai-user-agents.md` with the PR split (3 Nov 2026) (proof: docs/superpowers/plans/2026-11-03-ai-user-agents.md)
- [x] [ag] 1/11 (jobadabra-web #340 merged 3 Nov 2026) the broker tallies calls and tokens per workflow from the verified claim; /admin/ai-cost shows each workflow's share (proof: none: the work is in jobadabra-web, merged as #340 8aadd09)
- [x] [ag] 2/11 spike: observation (ariaSnapshot vs text), tokens and seconds per call, small vs mid; the explorer on the broker only; a 30-minute session skeleton with the step/minute/call caps (proof: desktop/e2e/lib/explore.mjs @2cc46fc6)
- [x] [ag] 3/11 diversity: persona + CV shape generator, move vocabulary from the ⌘K registry, seeded planner, coverage record; value re-check; planted bug (proof: desktop/e2e/lib/agent-plan.mjs @8d76749)
- [x] [ag] 4/11 knowledge: `docs/app-expectations/` seed, `agent-memory` branch write-back, "changed since last session" from git + PR verdict lines (proof: desktop/e2e/lib/agent-knowledge.mjs @75edb22)
- [ ] [ag] 5/11 findings core: detector `ai-user-agent`, notes with arguments, second opinion, 12-a-session cap, session summary and cost line
- [ ] [ag] 6/11 the session runner and the daily workflow `ai-user-agents.yml`, the evidence package on `agent-evidence`
- [ ] [ag] 7/11 (jobadabra-web) `/admin/testing/agent`: sessions, stories, coverage map, fed by the self-heal publish
- [ ] [ag] 8/11 replay proof on `b4d64112` / `b6014b04` / `df66db14`, numbers into this spec
- [ ] [ag] 9/11 aged states: the day-30 folder generator and the first deep-state sessions (phase 2; order per the owner's answer)
- [ ] [ag] 10/11 a living persona: snapshot saved and restored across nights, chapters, staggered personas, replay from a snapshot (phase 2)
- [ ] [ag] 11/11 the moving world: daily jobs and mail, a clock option, the off-script moves (phase 2)
- [ ] First daily session's findings on /admin/testing/self-healing
