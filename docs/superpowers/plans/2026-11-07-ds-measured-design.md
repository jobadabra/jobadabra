# Design checks measured, not ticked (ds)

The PR's "Design checks" were six `- [x]` lines that `tools/pr-body.sh` counted; nothing read the screen (owner, 7 Nov 2026: "this Design checks on the PR seems stale and inefficient" · "It should check design system compliance. Spacing/magins,colors,buttons, cards... bla bla"; chosen "Measured check (Recommended)").

## Progress
- [x] 1/3 Spacing ratchet: raw margin, padding and gap in the renderer CSS may only shrink against the base; the push hook runs it. (proof: tools/spacing-scale.mjs)
- [ ] 2/3 Rendered evaluator in `npm run shot`: 380 and 1100 px, light and dark; prints the "Design system (measured on <sha>)" table (one primary button per card, no ghost/link button, no card in a card, nothing clipped, AA contrast, spacing on the scale).
- [ ] 3/3 `tools/pr-body.sh` checks the generated table (present, sha = HEAD, no ❌); the six tick boxes are deleted from `tools/pr-body-template.md`, `tools/pr-body-format.py` and `docs/rules/desktop-ui.md`.
