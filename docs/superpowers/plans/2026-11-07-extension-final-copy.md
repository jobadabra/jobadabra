# Extension final copy implementation plan

Goal: close the accepted extension-only final audit gaps.
Architecture: trusted display metadata and stable IDs at existing display seams; canonical payloads remain unchanged.
Tech: existing ES modules/classic panel bridge, seven bundled catalogs, node:test, fictional browser preview.
Spec: ../specs/2026-11-07-extension-final-copy.md

## Progress

- [x] Read display: named regression first, then explicit key/value metadata for banners, completion and refusals; preserve canonical words, reason matching and raw external values.
- [x] Tips: named actual callback regression first, localize all45 eligible stable IDs, retain current ID for live redraw; reuse matching desktop translations without runtime coupling.
- [x] Errors/metadata: named regression first, mark only authored errors and resolve consumers; Chrome _locales description, same manifest version.
- [x] Verification: named affected unit files, seven-language key/parameter/plural parity; no full suites/live data.
- [x] Preview/handoff: fictional light/dark before-after existing UI, open previews then actual owner prompt; publish only after approval.
- [ ] Ship: commit, ship.sh background, exact-head CI/review threads and Gitar to READY; owner merges.

Review focus: raw reasons containing braces/markup; supported desktop override precedence; old/absent display metadata; selected tip locale refresh without rotation; Russian/Romanian plural counts. Existing nonblocking storage regression remains required.
