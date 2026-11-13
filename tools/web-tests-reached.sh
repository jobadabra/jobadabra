#!/usr/bin/env bash
# Runs the jobadabra-web tests that read a file this PR changes, in the joined tree web CI uses (this repo with web laid over it), and fails only for a test this PR turns red.
#   tools/web-tests-reached.sh <base> <head>        (WEB_DIR=<a jobadabra-web checkout> skips the clone; the Mac proof uses it)
# Step "Web tests that read this PR's files" of .github/workflows/pr-gate.yml. Which tests: tools/web-tests-reached.mjs. No test reads the PR's files: ends in about a second, green.
# Why (13 Nov 2026, owner, asked via AskUserQuestion: "Add the check (Recommended)"): #3684 and #3939 each turned a web test red on every web PR after they merged; the red showed in web, days after.
# A test red on the base too (web main broken by itself) is a warning, not this PR's red: a broken web main must not hold every jobadabra PR that touches a workflow.
set -uo pipefail
base="${1:?usage: web-tests-reached.sh <base> <head>}"; head="${2:?usage: web-tests-reached.sh <base> <head>}"
here="$(git rev-parse --show-toplevel)"; scratch="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/web-tests-reached.$$"
mkdir -p "$scratch"; trap 'git -C "$here" worktree remove --force "$scratch/head" 2>/dev/null; git -C "$here" worktree remove --force "$scratch/base" 2>/dev/null; rm -rf "$scratch"' EXIT
web="${WEB_DIR:-$scratch/web}"
if [ -z "${WEB_DIR:-}" ]; then
  for try in 1 2 3; do git clone -q --depth 1 https://github.com/jobadabra/jobadabra-web.git "$web" 2>/dev/null && break; [ "$try" = 3 ] && { echo "::error::could not clone jobadabra-web (3 tries): its tests cannot be checked"; exit 1; }; sleep $((try * 5)); done
fi
picks="$(git -C "$here" diff --name-only --no-renames "$base...$head" | (cd "$here" && node tools/web-tests-reached.mjs --web "$web" --tree .))" || { echo "::error::web-tests-reached.mjs failed"; exit 1; }
if [ -z "$picks" ]; then echo "no jobadabra-web test reads a file this PR changes: nothing to run"; exit 0; fi
echo "jobadabra-web tests that read this PR's files ($(printf '%s\n' "$picks" | wc -l | tr -d ' ')):"; printf '  %s\n' $picks

# The joined tree of a commit: jobadabra at <ref> with web laid over it, and web itself at .private/, as .private/tools/tree.sh does in web CI (web's own-files tests look for `.private`).
join() {
  git -C "$here" worktree add -q --detach "$scratch/$1" "$2" || return 1
  "$web/tools/lay-private.sh" "$web" "$scratch/$1" || return 1
  (cd "$scratch/$1" && git ls-files -o --exclude-standard -z | xargs -0 -n 500 git add -N -- 2>/dev/null)   # tests that list files with `git ls-files` must see web's files too
  ln -sn "$web" "$scratch/$1/.private"
}
# Runs one test in a tree; prints its output only when it fails. Same environment as web's tests.yml.
run_one() {
  local tree="$1" test="$2"
  (
    cd "$tree" || exit 1
    export SITE_REPO_DIR="$tree/.private" JOBADABRA_FOLLOW_APP=0 JOBADABRA_DISABLE=mail,notion,telegram,google_jobs
    case "$test" in
      *.py) python3 -m unittest discover -s tests -p "$(basename "$test")" 2>&1 ;;
      *) node --test "--test-reporter=$web/tools/site-test-reporter.mjs" "$test" 2>&1 ;;
    esac
  )
}
join head "$head" || { echo "::error::could not build the joined tree of $head"; exit 1; }
red=(); for test in $picks; do out="$(run_one "$scratch/head" "$test")" || { red+=("$test"); printf '\n::group::red on this PR: %s\n%s\n::endgroup::\n' "$test" "$out"; }; done
[ "${#red[@]}" = 0 ] && { echo "all web tests that read this PR's files pass"; exit 0; }
# Red on the head: is it this PR's? Run the same tests on the base.
join base "$base" || { echo "::error::could not build the joined tree of $base"; exit 1; }
mine=(); for test in "${red[@]}"; do if run_one "$scratch/base" "$test" >/dev/null; then mine+=("$test"); else echo "::warning::$test is red on the base too (jobadabra-web main with jobadabra main): not this PR's"; fi; done
[ "${#mine[@]}" = 0 ] && exit 0
echo "::error::this PR turns jobadabra-web test(s) red: ${mine[*]} (its own message is above; the fix is in this PR, or in jobadabra-web first when that test is out of date)"
exit 1
