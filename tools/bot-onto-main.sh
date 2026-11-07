#!/usr/bin/env bash
# Moves a bot workflow's ONE commit onto main as it is now, right before the push (record-sites, sentry-fix, ui-fix, finder-review).
#   tools/bot-onto-main.sh        (run after tools/bot-commit.sh; HEAD~1 is the checkout's commit)
# Why (7 Nov 2026, run 42372843705): the pool-pr job checked out the run's SHA (f48821c5, 12:31Z), main changed .github/workflows/page-cases.yml at 13:22Z, and the push of a branch
# built on the old SHA at 13:33Z was refused: "refusing to allow a GitHub App to create or update workflow .github/workflows/page-cases.yml without `workflows` permission".
# The App has no workflows permission and a new branch whose tree differs from main in a workflow file counts as updating it. All 4 earlier pushes (2, 3, 4, 6 Nov) were on a checkout
# whose workflow files still matched main. A branch of one commit on today's main differs from it only in the files the bot changed. A conflict stops the job red: nothing is guessed.
set -euo pipefail
git fetch -q --depth=1 origin "+refs/heads/main:refs/remotes/origin/main"
GIT_EDITOR=true git rebase -q --autostash --onto origin/main HEAD~1 || { git rebase --abort 2>/dev/null || true; echo "bot-onto-main: the bot's change conflicts with main's newest commit; no branch was pushed." >&2; exit 1; }
