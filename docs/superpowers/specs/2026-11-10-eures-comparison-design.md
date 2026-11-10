# Fair EURES comparison

Owner approved the three-part comparison in chat on 10 Nov 2026: normal search with source attribution, a fresh search with EURES disabled, and overlap with EURES.

## Design
An optional, by-hand `eures_comparison` input on Search check runs paired fresh installs per selected persona. Both use the same saved strategy, code, model and 180-second press limit. Alternate the first arm by persona to reduce systematic ordering bias. Disable the EURES reader through the engine's existing feature switch, passed explicitly by the persona harness; do not change the app defaults. Record any EURES-hosted results discovered through other readers as contamination, never silently subtract them and call that an independent run.

Read a fresh EURES reference per persona. Judge the combined pool once, blind to arm/source, with the existing judge. Report distinct relevant title/employer pairs, source contributions (which can overlap), exact overlap with the reference and unmatched pairs. Unknown employers are not evidence of a cross-source match. Different titles may describe the same vacancy: unmatched is explicitly not proof of additional vacancies. This is a same-session sampled reference, not exhaustive EURES recall or a controlled historical before/after experiment.

## Approaches
- Subtract EURES rows from a normal run: cheap, but fails to measure the search when that source is absent.
- Paired fresh searches (chosen): measures both behaviours at roughly twice the presses, plus a fresh reference and one combined judge.
- Replace every nightly run: adds ongoing AI load without necessity; keep the existing schedule unchanged.

## Delivery and cost
Two PRs, site first: 1/2 correct the Night tab labels and accept fixed source counts; 2/2 add paired comparisons and produce those counts. Results live in the existing Actions summary and downloadable JSON/Markdown artifacts; The Night tab accepts optional fixed `relevant_sources` counts; older nights show that no breakdown was recorded. No per-job data enters the central store. No automatic increase in nightly runs. Do not launch a large live rerun without a separate owner decision on cost. Offline fixture invocation verifies reporting, errors, attribution and overlap; existing EURES switch tests verify reader exclusion.

## Progress
- [x] Paired runner and explicit reader switch (proof: tools/persona-search/run.mjs)
- [x] Counts, source attribution, conservative overlap and honest failure report (proof: tools/persona-search/eures_comparison.py)
- [x] Optional workflow input, docs and offline verification (proof: .github/workflows/search-personas.yml)
- [ ] PR opened for owner review
