# App expectations: how Jobadabra should behave

One short cause → effect rule per line, read by the AI user agent at the start of every session (spec `docs/superpowers/specs/2026-11-03-ai-user-agents-design.md`, "The agent's knowledge"). A file per area, named like the ⌘K group the area is in.

Line format (parsed by `desktop/e2e/lib/agent-knowledge.mjs`):

`- [<area>-<n>] <rule, one sentence> | source: <path, PR or owner quote> | code: <paths, or ->`

- **Every rule has a source.** A rule with no source is not added (nothing is invented). The first lines are the owner's examples and rules the specs and tests already state.
- `code:` lists the files that implement the rule. When one of them changes, the agent marks the rule "stale: re-verify" at its next session. `-` = checked by area only.
- **A rule names where it applies, and comes with its control** (4 Nov 2026: `profile-1` was written from one fix with no scope and filed "Work permit" on the fixed commit, because the only check on a rule was that it finds the old bug). A PR that adds or widens a rule replays the fixed commit with the rule on (`ai-user-agents.yml`, `app_ref` = the fixed commit, `plan` = the rule's plan) and puts the run id and "n filed" in its body; it must file nothing about the rule.
- A person edits these files in a PR. The agent only proposes (an issue note); a 👍 from the owner or a PR makes it a line here.
