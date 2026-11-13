# Source it from tools/ship.sh: land the branch through a pull request with auto-merge instead of pushing to main (owner, 12 Oct 2026).
# Guarded by tests/test_ship_pr.py (a fake gh: tests/fake_gh.py). The checks that must pass run in CI on the PR (.github/workflows/pr-gate.yml, build.yml, page-cases.yml);
# the local push hook runs only its fast pure checks (SHIP_PR=1 in tools/pre-push-check.sh).
#   ship_mode                 prints pr (origin is on GitHub and gh answers: main takes pull requests only) or direct (any other origin: the old push to main); SHIP_MODE=pr|direct forces one
#   ship_review               true while the owner reviews every PR by hand (owner, 12 Oct 2026): always, whatever the repository setting (that is the owner's own Enable auto-merge button); SHIP_REVIEW=0 = auto-merge
#   ship_pr_land              push the branch, open (or reuse) the PR; with auto-merge: turn it on and wait until merged (sets `sha`, `files`); in review: wait until the required
#                             checks are green, then stop with the PR open for the owner (sets `review_n`, `review_url`: ship.sh prints `ship: REVIEW #n <url>`)
# A required check that failed: `fail_reason` names it with its log link and the run exits 1, the PR stays open (fix, commit, run ship again: it finds the PR).
# The step "Core flow files up to date with main" of the one required job failing, or a conflict with main, is no failure: the branch is rebased on the new main (extension version taken again) and pushed again, up to 5 times.
#   SHIP_PR_POLL=<s> seconds between looks (default 15)      SHIP_PR_TIMEOUT=<s> give up waiting after (default 2700; the PR stays open with auto-merge on)
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/pr-rest-lib.sh"
ship_mode() {
  case "${SHIP_MODE:-auto}" in pr|direct) echo "$SHIP_MODE"; return ;; esac
  # main takes pull requests only (ruleset): a GitHub origin gh can read lands through a PR, with or without auto-merge (review mode, ship_review). No answer from gh = direct.
  case "$(git remote get-url origin 2>/dev/null)" in *github.com*) command -v gh >/dev/null && [ -n "$(gh api "repos/$(ship_repo)" --jq .full_name 2>/dev/null)" ] && { echo pr; return; } ;; esac
  echo direct
}
ship_repo() { git remote get-url origin | sed -E 's#^.*github.com[:/]##; s#\.git$##'; }
ship_review() {
  [ "${SHIP_REVIEW:-1}" != 0 ]   # the owner merges every PR by hand; only SHIP_REVIEW=0 arms auto-merge. Never the repository setting: the owner allowed auto-merge for his own button (17 Oct 2026) and ship armed #1139/#1140 by itself
}
# 15 Oct 2026: one required job, so the failing STEP names the cause: true when the failed job's red steps include the flow-files one (tools/flow-fresh.mjs; keep its name in pr-gate.yml).
ship_flow_step_red() {
  gh api "repos/{owner}/{repo}/actions/jobs/${1##*/}" --jq '[.steps[]? | select(.conclusion == "failure") | .name] | join("|")' 2>/dev/null | grep -q 'Core flow files up to date with main'
}
# A caller that defines only session_name (an older ship.sh mid-rebase, tests/test_pr_rest_lib.py's stub) still tags: the name's last part, as before #2629.
command -v session_short >/dev/null 2>&1 || session_short() { local name; name="$(session_name)"; echo "${name##*-}"; }
ship_pr_fail() { fail_reason="$1"; echo "ship: FAILED $1" >&2; exit 1; }
# The lease names what origin has NOW (empty: nothing): the branch is deleted on merge, so the local tracking ref of an earlier landing is stale and a bare --force-with-lease refuses (12 Oct 2026). Only this session writes the branch.
# ship_pr_lookup <repo> <branch>: sets `n` to the branch's open PR, empty when there is none. Stops the run (nothing pushed, no PR created) when GitHub cannot say.
# Why (13 Nov 2026, pq; bl on #4022 and gq on #4031, REST core 0): an unreadable lookup used to read as no PR: the run pushed, tried to create a second one (422) and never started its watcher.
# ship_rest_reset_text: " until hh:mm" when GitHub says when the REST quota comes back, else nothing (the one wording of every "REST quota 0" line of ship).
ship_rest_reset_text() {
  local reset; reset="$(gh api rate_limit --jq .resources.core.reset 2>/dev/null)"
  [ -z "$reset" ] || echo " until $(date -d "@$reset" +%H:%M 2>/dev/null || date -r "$reset" +%H:%M 2>/dev/null)"
}
ship_pr_lookup() {
  local when=""
  if n="$(pr_of_head "$1" "$2" 2>/dev/null)"; then return 0; fi
  when="$(ship_rest_reset_text)"
  ship_pr_fail "GitHub could not say whether $2 already has an open pull request (REST quota 0$when, or unreachable): nothing was pushed and no pull request was created; run tools/ship.sh again"
}
# ship_pair_lines <pr> <repo>: runs tools/ship-search-hold.sh and writes each line it prints as a step; its `PAIR NOT STARTED <why>|<command>` becomes
# `ship: FAILED pair not started (<why>[, REST quota 0 until hh:mm]); start it by hand: <command>`, a line the watchers wake on. The run goes on: the PR stays held for its pair.
# Why (14 Nov 2026, rb; owner via mac-95: #4091 and #4100 sat ~25 min with no pair, REST quota 0 at ~22:50Z): a failed dispatch was one plain step line, so no session heard that its pair never started.
ship_pair_lines() {
  local line why when
  while IFS= read -r line; do
    case "$line" in
      "PAIR NOT STARTED "*) why="${line#PAIR NOT STARTED }"; when=""; ! _pr_rest_out || when="$(ship_rest_reset_text)"; echo "ship: FAILED pair not started (${why%%|*}${when:+; REST quota 0$when}); start it by hand: ${why#*|}" ;;
      "") ;;
      *) step "$line" ;;
    esac
  done < <(bash "$tools/ship-search-hold.sh" "$1" "$2")
}
ship_pr_push() { local now; now="$(git ls-remote origin "refs/heads/$branch" 2>/dev/null | cut -f1)"; git push -q "--force-with-lease=refs/heads/$branch:$now" origin "HEAD:refs/heads/$branch" 2>&1 || ship_pr_fail "could not push the branch $branch to origin"; }
# No stacking (owner, 17 Oct 2026: a PR on another PR's branch gets stuck when the base merges or is retargeted): refuse to push a branch that carries a commit of another open PR.
ship_pr_no_stacking() {
  local mine others hit="" pn ref sha theirs
  mine="$(git rev-list origin/main..HEAD)"
  others="$(pr_list "$(ship_repo)" open 2)" || return 0
  # Why (try 3 on "GraphQL runs out", 27 Oct 2026): REST lists no commits of a PR; their commits come from git (every session's branch is in this clone), else its head alone.
  while IFS=$'\t' read -r pn ref sha; do
    [ -n "$sha" ] && [ "$ref" != "$branch" ] || continue
    if git cat-file -e "$sha^{commit}" 2>/dev/null; then theirs="$(git rev-list "origin/main..$sha")"; else theirs="$sha"; fi
    if grep -qxF -f <(printf '%s\n' "$theirs" | grep .) <<<"$mine" 2>/dev/null; then hit="#$pn ($ref)"; break; fi
  done < <(jq -r '.[] | "\(.number)\t\(.headRefName)\t\(.headRefOid)"' <<<"$others")
  [ -z "$hit" ] || ship_pr_fail "this branch carries commits of the open PR $hit; one PR per branch off main, no stacking: start from origin/main (tools/worktree.sh) and bring over only your own commits (git cherry-pick)"
}
ship_pr_land() {
  local n="" repo out view state mergeable checks failing name link who tries=0 waited=0 last_say=0 body title poll="${SHIP_PR_POLL:-15}" limit="${SHIP_PR_TIMEOUT:-2700}"
  files="$(git diff --name-only origin/main HEAD)"
  ship_pr_no_stacking
  repo="$(ship_repo)"
  ship_pr_lookup "$repo" "$branch"   # sets n
  # A PR's title names the whole PR (owner, 24 Oct 2026: #1743 was titled by its 6th commit, a spec tick): 2+ commits that are not "Move ..." splits need --title= when the PR is opened.
  if [ -z "$n" ] && [ -z "${SHIP_PR_TITLE:-}" ] && [ "$(git log --format=%s origin/main..HEAD | grep -vc '^Move ')" -ge 2 ]; then
    ship_pr_fail "this PR has several commits: pass --title=\"<what the whole PR does for the user>\" (a PR's title names the whole change, not its newest commit)"
  fi
  step "pushing $branch (not main) and opening a pull request"
  ship_pr_push
  if [ -z "$n" ]; then
    title="${SHIP_PR_TITLE:-$(bash "$tools/pr-title.sh" origin/main)}"   # the newest commit that is not a "Move ..." split, or --title= (18 Oct 2026)
    who="$(session_short)"; [ "$who" = "?" ] || title="[$who] ${title#"[$who] "}"   # (a --title already starting with the tag keeps one: 24 Oct 2026, #1750 read "[d8] [d8] ...") the session that opened it, short (owner, 15 Oct 2026; tools/session-name.sh)
    # A repo without this toolkit (jobadabra-web, jobadabra-lab) has the body check only in its CI, and the lab's Actions can be blocked (24 Oct 2026, lab #57 opened with a free-form body): no body, no PR.
    [ -z "${external:-}" ] || [ -n "${SHIP_PR_BODY:-}" ] || ship_pr_fail "no --body=<file>: a PR of this repo needs the laid-out description (verdict, Why, Unblocks, impact table, Before/After; ~/jobadabra/tools/pr-body-template.md)"
    [ -n "${SHIP_PR_BODY:-}" ] || step "no --body=<file>: the PR shows the subject, the facts and the commit folded; a 5-second summary goes in a file (CLAUDE.md \"PR descriptions\")"
    body="$(bash "$tools/pr-body.sh" origin/main ${SHIP_PR_BODY:+"--body=$SHIP_PR_BODY"})"   # the summary first, the facts, the commit folded (tools/pr-body.sh)
    rows="$(git log --format='%(trailers:key=Pool-row,valueonly)' origin/main..HEAD | grep -v '^$' | grep -iv '^none' | sort -u || true)"   # the pool rows this PR fixes (the Pool-row lines)
    # Why (13 Nov 2026, owner via sa, over #3969 shown as a draft: "as draft should start only if it needs a pair run"): a draft means "waiting for a pair", nothing else;
    #   this takes back #3965's "every PR opens as a draft".
    out="$(pr_open "$repo" "$branch" "$title" "$body" ${SHIP_PR_DRAFT:+draft} 2>&1)" || ship_pr_fail "could not open the pull request: $(echo "$out" | tail -n 1)"
    n="${out##*/}"
    if [ -n "$rows" ]; then pr_label "$repo" "$n" pool-fix 1D76DB "fixes a row of the applying pool (from its Pool-row lines)" || true; fi   # a missing label never fails a landing
    step "opened the pull request: $(echo "$out" | tail -n 1)"
  else
    step "the branch already has pull request #$n: reusing it"
    # Why (10 Nov 2026, fr; 79 PRs since 25 Oct carried a cancelled "pure checks" beside a green one, #3643 among them): the description and the title used to be two PATCHes, so two `edited` events
    #   seconds apart. Each starts the Guard gate; one cancelled the other and the cancelled run stayed red on the head. ONE request carries both now (pr_set_text), so a re-ship makes one event.
    new_body=""; new_title=""; who="$(session_short)"
    if [ -n "${SHIP_PR_BODY:-}" ]; then   # a new --body=<file> on a PR that is already open: its description is refreshed through the same tools/pr-body.sh (16 Oct 2026: #1049 kept the first draft's numbers)
      new_body="$(bash "$tools/pr-body.sh" origin/main "--body=$SHIP_PR_BODY")" || { new_body=""; step "could not build the description of #$n from --body (the old one stays)"; }
    fi
    if [ -n "${SHIP_PR_TITLE:-}" ]; then   # --title= on a PR that is already open: its title is replaced (only then)
      new_title="$SHIP_PR_TITLE"; [ "$who" = "?" ] || new_title="[$who] ${new_title#"[$who] "}"
      new_title="$(pr_new_title "$repo" "$n" "$new_title")" || { new_title=""; step "could not read the current title of #$n: it stays as it is (a held PR must keep DONT MERGE)"; }   # a held PR keeps "DONT MERGE" (11 Nov 2026, sm)
    else   # no --title: still keep the "[xx]" tag (21 Oct 2026: site#18 and #19 were red for a missing tag, opened or retitled by hand): add it when the title lacks one
      title="$(pr_view "$repo" "$n" 2>/dev/null | jq -r '.title // empty' || true)"
      if [ "$who" != "?" ] && [ -n "$title" ] && ! printf '%s' "$title" | grep -qE '^\[[^]]+\] '; then new_title="[$who] $title"; fi
    fi
    if [ -n "$new_body$new_title" ]; then
      if pr_set_text "$repo" "$n" "$new_title" "$new_body" 2>/dev/null; then
        [ -z "$new_body" ] || step "refreshed the description of #$n from --body"
        [ -z "$new_title" ] || step "retitled #$n"
      else step "could not edit the title and description of #$n (the old ones stay)"; fi
    fi
    if [ -n "${SHIP_PR_DRAFT:-}" ]; then gh pr ready "$n" --undo >/dev/null 2>&1 && step "#$n is a draft again until it is READY on its new head" || true; fi   # --draft: a new push is not yet checked or approved
  fi
  if ship_review && [ -z "${external:-}" ]; then   # a pending "Moves:" number: ship holds the PR and starts its pair (tools/ship-search-hold.sh, 13 Nov 2026)
    ship_pair_lines "$n" "$repo"
  fi
  [ -z "${external:-}" ] || bash "$tools/lab-ci-dispatch.sh" "$n"   # a lab PR has no Actions of its own: the public repo runs its tests (tools/lab_ci.py)
  ship_watch_start "$n"   # from here on the log also hears RED / GREEN / READY / MERGED / CLOSED, whatever way this run ends (18 Oct 2026: #1321 sat red unnoticed)
  local review=""; if ship_review; then review=1; step "review mode: the owner reviews and merges #$n by hand; waiting for every check it started"
  elif ! out="$(gh pr merge "$n" --auto --rebase 2>&1)"; then
    case "$out" in
      *"clean status"*) out="$(gh pr merge "$n" --rebase 2>&1)" || ship_pr_fail "could not merge pull request #$n: $(echo "$out" | tail -n 1)" ;;   # no check to wait for: merge now
      *) ship_pr_fail "could not turn on auto-merge for pull request #$n: $(echo "$out" | tail -n 1) (a repository setting? tools/pr-settings.sh)" ;;
    esac
  fi
  [ -n "$review" ] || step "auto-merge is on for #$n: waiting for the required checks and the merge"
  # Why (27 Oct 2026, the owner's GraphQL budget ran out and PRs could not be opened): this wait looked every 15 s with two GraphQL queries; REST with the last ETag
  #   (tools/pr-rest-lib.sh) costs about one call per look and nothing for an unchanged answer.
  repo="$(ship_repo)"
  while :; do
    view="$(pr_view "$repo" "$n")" || view=""
    state="$(jq -r '.state // empty' <<<"$view" 2>/dev/null)"; mergeable="$(jq -r '.mergeable // empty' <<<"$view" 2>/dev/null)"
    case "$state" in
      MERGED) sha="$(jq -r '.mergeCommit.oid // empty' <<<"$view" | cut -c1-7)"; ship_fetch || true; [ -n "$sha" ] || sha="$(git rev-parse --short origin/main)"   # the PR is merged: a fetch that still fails must not turn it into FAILED
              step "pull request #$n is merged: $sha"; return 0 ;;
      CLOSED) ship_pr_fail "pull request #$n was closed without merging: $(jq -r '.url' <<<"$view")" ;;
    esac
    # Why (30 Oct 2026, owner via a8, design D): keep every started check (14 Oct: suites start by paths), except BASE's grey tolerant failures.
    checks="$(pr_checks "$repo" "$(jq -r '.headRefOid // empty' <<<"$view" 2>/dev/null)" || true)"
    if jq -e 'any(.[]?; .bucket == "fail" or .bucket == "cancel")' <<<"${checks:-[]}" >/dev/null 2>&1; then
      out="$(python3 "$tools/pr_lanes.py" "$repo" "${GITHUB_BASE_REF:-main}" <<<"${checks:-[]}")" && checks="$out"
    fi
    failing="$(jq -r '[.[]? | select(.bucket == "fail" or .bucket == "cancel")] | first // empty | "\(.name)\t\(.link)"' <<<"${checks:-[]}" 2>/dev/null)" || failing=""
    # A run the next push superseded shows as cancelled (every PR workflow cancels its older run, 15 Oct 2026): not a failure while a newer run may be starting. Only a check that
    # stays cancelled over 3 more looks (about a minute) counts, as one that failed.
    if [ -n "$failing" ] && ! jq -e 'any(.[]?; .bucket == "fail")' <<<"${checks:-[]}" >/dev/null 2>&1 && [ "${cancel_looks:-0}" -lt 3 ]; then
      cancel_looks=$(( ${cancel_looks:-0} + 1 )); step "a check was cancelled (a newer push replaces its run): looking again ($cancel_looks/3)"; sleep "$poll"; waited=$((waited + poll + 1)); continue
    fi
    if [ -n "$failing" ] || [ "$mergeable" = CONFLICTING ]; then
      name="${failing%%$'\t'*}"; link="${failing#*$'\t'}"
      if { [ -n "$failing" ] && ship_flow_step_red "${link%%[?#]*}"; } || { [ -z "$failing" ] && [ "$mergeable" = CONFLICTING ]; }; then
        tries=$((tries + 1)); [ "$tries" -le 5 ] || ship_pr_fail "pull request #$n still clashes with main after 5 rebases: $(jq -r '.url' <<<"$view")"
        step "main moved under files this PR changes (${name:-conflict}): rebasing again ($tries/5) and pushing it again"
        rebase; ship_pr_push; files="$(git diff --name-only origin/main HEAD)"
      else
        ship_pr_fail "check '$name' failed: $link . Pull request #$n stays open: fix it, commit, run tools/ship.sh again"
      fi
    fi
    # Review mode ends when every check the PR started passed (none pending, none failing): the PR waits for the owner, nothing has landed on main.
    if [ -n "$review" ] && [ -z "$failing" ] && jq -e 'length > 0 and all(.[]; .bucket == "pass" or .bucket == "skipping")' <<<"${checks:-[]}" >/dev/null 2>&1; then
      # Why (11 Nov 2026, owner: "you should put it as draft and a prefix \"DONT MERGE\""; 13 Nov 2026, owner via sa: "anything not a draft is safe to merge"): green is not ready. This step used to
      #   mark a draft ready on green, before Gitar's approval (a green, unapproved PR was merged on 12 Nov); the watcher marks it ready at READY, never a "DONT MERGE" draft.
      if grep -q 'DONT MERGE' <<<"$(jq -r '.title // empty' <<<"$view")"; then step "#$n: every check is green, but its title says DONT MERGE: it stays a draft (undo the hold by hand: gh pr ready $n, then strip the title prefix)"
      elif [ "$(jq -r '.isDraft // false' <<<"$view")" = true ]; then step "#$n: every check is green: it stays a draft until READY (Gitar Approved, no unanswered comment), when the watcher marks it ready"; fi
      review_n="$n"; review_url="$(jq -r '.url // empty' <<<"$view")"; step "#$n: every check is green: open for the owner's review"; return 0
    fi
    if [ "$waited" -ge "$limit" ]; then ship_pr_fail "pull request #$n is not merged after ${limit}s (it merges by itself when the checks pass): $(jq -r '.url' <<<"$view")"; fi
    [ $((waited - last_say)) -lt 60 ] || { step "still waiting for #$n (${waited}s)"; last_say=$waited; }
    sleep "$poll"; waited=$((waited + poll + 1))
  done
}
