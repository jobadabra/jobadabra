#!/usr/bin/env bash
# Holds a search PR whose "Moves:" number is still pending and starts its before/after pair: draft, "DONT MERGE" after the session tag, label search-hold (ship's own hold).
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
busy="$(gh run list -R "$repo" --workflow search-pair.yml --limit 30 --json status,displayTitle --jq "[.[] | select(.status != \"completed\" and (.displayTitle | startswith(\"Search pair · #$n \")))] | length" 2>/dev/null || echo 0)"
if [ "${busy:-0}" != 0 ]; then echo "#$n: its pair is already queued or running: not started again"
else
  # Why (14 Nov 2026, rb; owner via mac-95: #4091 and #4100 sat ~25 min with no pair, REST quota 0 at ~22:50Z, and the only trace was a plain line nobody read): a dispatch that fails is tried once more
  #   after 3 s (a 5xx or a dropped connection; GitHub has no GraphQL mutation for a workflow dispatch, so a quota-0 failure cannot be read around and waits for the reset), then ends as `PAIR NOT STARTED <gh's own words>`,
  #   which tools/ship-pr.sh turns into the `ship: FAILED pair not started` line the watchers wake on. The held PR stays held: only its pair lifts the hold.
  for try in 1 2; do
    if err="$(gh workflow run search-pair.yml -R "$repo" -f pr="$n" -f people="$people" 2>&1 >/dev/null)"; then
      echo "#$n: started its before/after pair for $people (search-pair.yml; its comment writes the number and lifts the hold)"; exit 0
    fi
    [ "$try" = 2 ] || sleep "${SHIP_PAIR_RETRY_S:-3}"
  done
  echo "PAIR NOT STARTED $(tail -n 1 <<<"$err" | cut -c1-160)|gh workflow run search-pair.yml -R $repo -f pr=$n -f people='$people'"
fi
