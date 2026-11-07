# Design checks measured, not ticked (ds)

The PR's "Design checks" were six `- [x]` lines that `tools/pr-body.sh` counted; nothing read the screen (owner, 7 Nov 2026: "this Design checks on the PR seems stale and inefficient" · "It should check design system compliance. Spacing/magins,colors,buttons, cards... bla bla"; chosen "Measured check (Recommended)").

## Progress
- [x] 1/3 Spacing ratchet: raw outer-space, padding and gap values in the renderer CSS may only shrink against the base; the push hook runs it. (proof: tools/spacing-scale.mjs)
- [x] 2/3 `npm run design-check` renders the screens a PR changes at 380 and 1100 px, light and dark, against main's render and prints the "Design system (measured on <sha>)" table: spacing on the scale, one primary button per card, no ghost or link button, no card in a card, nothing clipped, AA contrast; ❌ only for a violation main does not have. (proof: desktop/scripts/design-check.mjs)
- [x] 3/3 `tools/pr-body.sh` reads the generated table instead of counting six ticks: present, six rule rows, no ❌, measured on a commit with the same renderer change as HEAD; the six boxes are deleted from the template, the formatter and the desktop-ui rule. (proof: tools/design-table-check.py)
