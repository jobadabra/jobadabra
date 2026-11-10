#!/bin/sh
# Links the main checkout's installed folders (node_modules of desktop, desktop/e2e, worker, site, and .venv) into a worktree, so its tests, lint and push gate run at once.
# Why (29 Oct 2026, owner, #2462): a bare git worktree add had none, the push gate ran 437 s, failed in "desktop (clean checkout)" and hid the cause: one linker, called by every way a worktree is made
# (tools/worktree.sh, the post-checkout hook) and named by the push gate's refusal. .venv: the app runs the engine with <repo>/.venv/bin/python when it exists, else the system python3 with no `anthropic`.
# usage: tools/link-modules.sh [<tree>]   (default: here). Idempotent; never changes the main checkout or a folder the tree already has. Guard: tests/test_worktree.py.
tree="${1:-$PWD}"
common="$(git -C "$tree" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || exit 0
main="$(dirname "$common")"
[ -d "$main" ] && [ "$(cd "$main" && pwd -P)" != "$(cd "$tree" && pwd -P)" ] || exit 0   # the main checkout itself, or a clone: nothing to link from
# Why (#3423, 10 Nov 2026): `! -e` then link is check-then-act; a second linker (post-checkout hook, worktree.sh, a session's loop) can link in between, and a plain ln -s then follows that link and
# writes node_modules INSIDE the main checkout's shared folder (the 7 Nov 04:17 self-link). -n never follows the destination: the loser fails quietly. Guard: tests/tooling/hooks/test_link_modules_race.py.
for dir in desktop/node_modules desktop/e2e/node_modules app-core/node_modules site/node_modules .venv; do
  # Why (1 Nov 2026): until the main checkout has its own app-core/node_modules, it holds this folder as worker/node_modules: link that one meanwhile (linked with -n like the rest, #3423).
  [ "$dir" = app-core/node_modules ] && [ ! -d "$main/$dir" ] && [ -d "$main/worker/node_modules" ] && [ ! -e "$tree/$dir" ] && [ -d "$tree/app-core" ] && { ln -sn "$main/worker/node_modules" "$tree/$dir" 2>/dev/null; continue; }
  [ -d "$main/$dir" ] && [ ! -e "$tree/$dir" ] && [ -d "$tree/$(dirname "$dir")" ] && ln -sn "$main/$dir" "$tree/$dir" 2>/dev/null
done
exit 0
