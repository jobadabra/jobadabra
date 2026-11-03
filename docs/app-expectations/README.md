# App expectations: how Jobadabra should behave

One short cause → effect rule per line, read by the AI user agent at the start of every session (spec `docs/superpowers/specs/2026-11-03-ai-user-agents-design.md`, "The agent's knowledge"). A file per area, named like the ⌘K group the area is in.

Line format (parsed by `desktop/e2e/lib/agent-knowledge.mjs`):

`- [<area>-<n>] <rule, one sentence> | source: <path, PR or owner quote> | code: <paths, or ->`

- **Every rule has a source.** A rule with no source is not added (nothing is invented). The first lines are the owner's examples and rules the specs and tests already state.
- `code:` lists the files that implement the rule. When one of them changes, the agent marks the rule "stale: re-verify" at its next session. `-` = checked by area only.
- A person edits these files in a PR. The agent only proposes (an issue note); a 👍 from the owner or a PR makes it a line here.
