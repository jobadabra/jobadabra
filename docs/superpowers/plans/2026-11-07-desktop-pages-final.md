# Remaining desktop page translation implementation plan

> Execute inline using superpowers:executing-plans; no delegated implementation.

**Goal:** Close the confirmed authored English gaps in the assigned desktop page slice.
**Architecture:** Explicit keyed display readers and bundled catalogs. Preserve canonical model/write/parser/action values and unknown raw prose.
**Tech:** Existing JS ESM renderer, desktop i18n, Node named tests and demo shots.
**Spec:** docs/superpowers/specs/2026-11-07-desktop-pages-final.md

## Tasks

1. Coordinate nav/components ownership; inspect current readers and relevant tests. Add failing non-English assertions to existing consumer/model tests.
2. Add isolated finalPages catalogs/registrar/readers. Localize Profile known part titles, Strategy field/side/options/hints and summary/proposal display; preserve writes and options' values.
3. Localize interview picker suffix and known report/review/Actions headings only at display. Keep parser output/canonical headings and generated content unchanged.
4. Localize shared palette labels/hints/groups/paths and gate button after ownership confirmation. Preserve keywords, action reachability/dispatch and raw dynamic names.
5. Run named affected tests, catalog contract and changed-source gates. Check required replay paths without workflow behavior changes.
6. Capture representative before/after demo shots in light/dark, inspect, open them and request owner approval. Continue any independent fixes while pending; publish only on explicit approval.
7. Commit and tools/ship.sh --background; fix own red checks/review feedback and watch exact-head READY. Owner alone merges.
