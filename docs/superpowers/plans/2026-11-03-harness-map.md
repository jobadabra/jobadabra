# The harness map (plan)

Session hm, 3 Nov 2026. Spec: `docs/superpowers/specs/2026-11-03-harness-map-design.md`. Sketch: https://claude.ai/artifact/965NLqUUEdcMDGAXFPTUuy. Each PR is titled `[hm] n/N <what>` and its body links the spec and the sketch.

## Owner decisions (3 Nov 2026)
- Layers L0 index, L1 area hub, L2 detail, L3 raw sources; plain markdown links; no graph database, no RAG now.
- One framework for local sessions and the CI agent; project-neutral; extraction parked until a second project wants it.
- "I approve" on both sketches. Nothing past PR 1/8 is built before the owner's yes on the spec.

## PRs
| n/N | What | Who gets what | Review |
|---|---|---|---|
| 1/8 | This spec and plan | The owner decides the places, areas and budgets before any build | docs-only: skips `/code-review` |
| 2/8 | `docs/map/index.md` (L0) + hubs `feedback`, `ai`, `ci`; `tools/context/check-map.mjs` + one unit test; `@docs/map/index.md` in `CLAUDE.md`, one link line atop `AGENTS.md` | The fixer agent and every session reach the three pilot areas in 2 short reads | check script is a tool: `/code-review` |
| 3/8 | Hubs `apply`, `search`, `data` + distilled lessons | Same, for the three biggest product areas | docs-only |
| 4/8 | Hubs `desktop`, `release`, `site`, `growth` + distilled lessons | Same, rest of the areas | docs-only |
| 5/8 | `tools/context/`: sources Linear, Sentry, GitHub; `pack.mjs`; tests for read-only, scrub, bounds, fail-closed | The fixer core gets a context pack before the run; tokens only in the trusted step | `/code-review` (holds tokens) |
| 6/8 | Sources PostHog, Cloudflare | Facts on how many users hit it, Worker errors | `/code-review` |
| 7/8 | Source Notion | Linked doc pages in the pack | `/code-review` |
| 8/8 | Evaluation: the ~14 tasks, three arms, one table | A measured yes or no per layer | report only |

## Order and dependencies
- 2/8 before ca amends its spec (B0): the pack layout and loader contract are final in the spec; ca can start from them now.
- 5/8 before ca's 5/6 core uses a pack. 3/8, 4/8 and 6/8 to 7/8 are independent of each other.
- Keys (free developer keys, read scope, Keychain `jobadabra.*` then GitHub secrets) are created at 5/8, 6/8, 7/8. Linear's key is shared with ca's Linear source (one item, one read-only key); paid plans: ask.

## Not PRs
- Owner's decision on this spec (sketch via the coordinator).
- Cost of the evaluation shown to the owner before 8/8.
- Parked as Linear ideas: RAG index, framework extraction, hub-staleness gate.

## Progress
- [ ] 1/8 Spec and plan
- [ ] 2/8 L0 + pilot hubs + checker
- [ ] 3/8 Hubs apply, search, data
- [ ] 4/8 Hubs desktop, release, site, growth
- [ ] 5/8 Fetchers Linear, Sentry, GitHub + pack builder
- [ ] 6/8 Fetchers PostHog, Cloudflare
- [ ] 7/8 Fetcher Notion
- [ ] 8/8 Evaluation
