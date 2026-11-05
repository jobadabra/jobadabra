# Harness usage and help statistics (plan)

Session hm, 5 Nov 2026. Sketch: https://claude.ai/artifact/PnCF7m1cZ3eesN1CGxTYTt

> **Verdict:** the Agent harness page gets a second card from the CI fixer's own run records: how many runs read the map (`docs/map/`) and how those runs fared against the ones that did not. Counts and averages only, $0, no AI.

## Owner's words
- "I want to get statistics about how much time each tools/harness is being used. How efficient it is ..." then, asked whether local or CI: "Let's for now go on the CI harness only." (5 Nov 2026)
- Chose "Usage + help on real runs": count the use (A) and the help per run, with and without the map (B); no AI cost, no controlled test.

## The data
Upload kind `harness-fixer`, sent by the daily harness-stats workflow next to the `harness` card, to the same route:
`{kind:'harness-fixer', days:[{day, runs, tools:[{id:'map-index'|'map-hub', runs}], help:{with_map:{n, turns, calls, minutes, ready}, without_map:{...}}}]}`
- A run "used the map" when a `read` or `search` step of its record has a path under `docs/map/` (`index.md` = index, any other = hub).
- turns, calls, minutes are averages over the group, 1 decimal; `ready` = runs that stopped `ready`; an empty group is zeros.
- The context pack (`tools/context/pack.mjs`) is not used by the fixer yet: not counted.
- The step that parses the artifacts holds no secret; the step that stores both cards holds the site key.

## Progress
- [ ] 1/2 web page: the two kinds accepted, cleaned and drawn on /admin/ai/harness (jobadabra-web) (proof: none: the test is in jobadabra-web)
- [ ] 2/2 jobadabra: the daily harness upload also sends `harness-fixer` (proof: desktop/test/tooling/ci/harness-stats.test.js)

## Parked (Notion Backlog, not a PR)
- The local scan of this Mac's Claude sessions (`harness-local`: how often the map, codemap and the context pack are really called) — owner, 5 Nov 2026: CI harness only for now.
