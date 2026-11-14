#!/usr/bin/env bash
# Holds a search PR whose "Moves:" number is still pending (its pair is started by the PR's verdict, tools/pr_verdict_pair.py): draft, "DONT MERGE" after the session tag, label search-hold (ship's own hold).
# Why (13 Nov 2026, owner via sa: "we shoulndt do  by hand"; plan docs/superpowers/plans/2026-11-13-search-pair.md 4/4): a session wrote "→ pending", then set the hold and
#   dispatched the pair by hand. The pair (search-pair.yml's comment job, tools/persona-search/pair.py settle) writes the numbers and lifts only a hold carrying the label.
# Usage: tools/ship-search-hold.sh <pr> <owner/repo>   (called by tools/ship-pr.sh in review mode; one line per thing it did on stdout, nothing when the body has no pending number)
set -uo pipefail
n="$1"; repo="$2"; tools="$(cd "$(dirname "$0")" && pwd)"
view="$(gh pr view "$n" -R "$repo" --json title,body,isDraft,labels 2>/dev/null)" || { echo "could not read #$n: no search hold checked"; exit 0; }
people="$(jq -r '.body // ""' <<<"$view" | python3 "$tools/persona-search/pair.py" pending)" || people=""
[ -n "$people" ] || exit 0
title="$(jq -r '.title // ""' <<<"$view")"
if ! grep -q 'DONT MERGE' <<<"$title"; then
  if [[ "$title" =~ ^(\[[^]]+\]\ )(.*)$ ]]; then held="${BASH_REMATCH[1]}DONT MERGE ${BASH_REMATCH[2]}"; else held="DONT MERGE $title"; fi   # the tag stays first (web #526)
  gh label create search-hold -R "$repo" --color B60205 --description "ship holds this PR until its before/after pair writes the pending Moves number" --force >/dev/null 2>&1 || true
  if gh pr edit "$n" -R "$repo" --title "$held" --add-label search-hold >/dev/null 2>&1; then echo "#$n has a pending Moves number: held (DONT MERGE + label search-hold) until its pair writes it"
  else echo "could not set the hold on #$n: set it by hand (gh pr edit $n --title \"$held\")"; fi
fi
if [ "$(jq -r '.isDraft' <<<"$view")" != true ]; then gh pr ready "$n" -R "$repo" --undo >/dev/null 2>&1 || true; fi
# Why (14 Nov 2026, owner via sa: "I want all the PRs like that, to start the pair by themselves"; plan docs/superpowers/plans/2026-11-14-pr-checks-rows-and-pair.md 3/5): this script no longer starts the pair. The PR's verdict does
#   (tools/pr_verdict_pair.py, run by pr-verdict.yml after each verdict): one starter for every search PR, once per head, with its row on the PR's checks. The hold above stays until 5/5.
echo "#$n: its before/after pair starts by itself from the PR's verdict (a row \"Search before/after\" appears on the PR's checks within minutes)"
