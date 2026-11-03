# Root cause, never symptoms

Why (owner, 27 Oct 2026): "root causes, never symptoms", and "to avoid going in circles, with tens of PRs about a specific area of the app". Golden rule in the owner's CLAUDE.md. Removed 2 Nov 2026 (owner: "let's decommission AREA-CIRCLES. Did it help in any way?… I don't think"): the counter flagged 76% of PRs, so it said nothing; the rule below stays, judged from the PR itself.

## On a PR that fixes a bug

The description (or the commit message) must state, in a few words each:

1. **Root cause**, one sentence with a file:line, a log line or a measurement.
2. **Why this is not a symptom patch.** A patch that hides what was seen is not a fix: a retry, a longer timeout, a swallowed error, a special case, a threshold nudge, a one-off data repair.
3. **What let it through** (which rule, test or check) and whether that was fixed in the same change.

Each of these is a blocking finding (no approval) with file:line: the cause is missing, the change only treats the symptom and says nothing about the real fix and its owner, or the new test does not play the scenario that was reported.

## On a PR that fixes a red test or check (flaky until shown otherwise)

Why (owner, 3 Nov 2026): "we have a flaky test, but we fix it in the wrong way, which preserves the flakiness, instead of removing it". The same night, #3039's first version swapped one read for a 10 s poll after `closeApp` returned: it narrowed the window and hid the early return the test guards (Gitar caught it); #3036 (apply-1of3) is the model of the right fix.

The description names the **last green run** of that test and the diff of the files it runs. Then one of two cases:

- **Something changed:** the cause is in that diff; the root-cause rules above apply.
- **Nothing changed: it says "flaky"**, names the non-deterministic input (a race, the clock, load, a real browser or process, the outside world), and fixes that input's class plus the guard that let an unproven step block, never the one step.

The PR carries proof the flakiness is gone, not moved: a test that **forces the input** (injects the delay, the order or the stale value) and **fails on the old code every time**, then passes on the new code every time. A cause that is only a hypothesis says so in the description ("not proven"); the change then adds evidence to the red and does not claim a fix.

Each is a blocking finding with file:line:
- The description does not name the last green or the diff, or does not say "flaky" when nothing changed.
- There is no test that forces the input, or it passes on the old code.
- The fix only narrows the window: a longer wait or grace, a retry, a re-run, a second read, a poll with a deadline of its own after a call that promises its state on return, or a looser assertion.
- A fix that waits for the wrong state (the first row that matches, any chip) instead of the state the step needs.

## Going in circles

Judge it from the PR itself: the files it changes and the earlier PRs on the same product or harness code that you can see (desktop/e2e root, lib and suites `.mjs`; tests, fixtures, recordings and the shared registries never count). If you cannot see the history, do not guess: flag only what the diff and the description show.

- The earlier PRs on the same files read as 2 or more fixes in the last 7 days (this PR would be the 3rd): a blocking finding until the description has a `Design:` block in the description: the intended behaviour in the owner's words, as the states, the one owner of each, and the verdicts that change them. The code should then be simplified to match.
- Flag a PR that adds one more case, branch, flag or special case to code that already had 2+ fixes that week; ask what the design says instead.
