#!/usr/bin/env bash
# Runs the jobadabra-web tests that read a file this PR changes, in the joined tree web CI uses (this repo with web laid over it). Red only for a test THIS PR turns red.
#   tools/web-tests-reached.sh <base> <head>        WEB_DIR=<a jobadabra-web checkout> skips the clone; WEB_REPO_URL and CLONE_WAIT (seconds between tries, 5) are for the tests.
# Step "Web tests that read this PR's files" of .github/workflows/pr-gate.yml. Which tests: tools/web-tests-reached.mjs. Guard: desktop/test/tooling/ci/web-tests-reached-run.test.js.
# Why (13 Nov 2026, owner, asked via AskUserQuestion: "Add the check (Recommended)"): #3684 and #3939 each turned a web test red on every web PR after they merged; the red showed in web, a day later.
# The four outcomes (coordinator, 13 Nov 2026, after Gitar's three findings on #3950):
#   - an outside failure (web cannot be cloned or laid over the tree, a package this job lacks) is a ::warning::, never a red: the PR is not at fault and a GitHub outage must not hold every PR;
#   - a test that needs a package this job does not install (playwright-core, a non-stdlib python module) is not run here, and the log says so (web's own CI runs it); the job installs nothing;
#   - a test red on the head and green on the base is this PR's break: red, with the test's own message;
#   - a test red on both is already red without this PR: a warning naming it (a broken web main must not hold every PR that touches a workflow).
set -uo pipefail
base="${1:?usage: web-tests-reached.sh <base> <head>}"; head="${2:?usage: web-tests-reached.sh <base> <head>}"
here="$(git rev-parse --show-toplevel)"
changed="$(git -C "$here" diff --name-only --no-renames "$base...$head")" || { echo "::error::could not read this PR's changed files (git diff $base...$head)"; exit 1; }
# Why (13 Nov 2026, coordinator): no clone and no work when the PR changes nothing. Whether a changed file is read by a web test only web's tests can say (97 of the last 120 merged PRs reach one; docs/map/index.md alone is read by 11 web tests, so "a .md is never read" is false),
# so the clone below is the question's price; a hand-kept list of "never read" paths would drift into the next escape.
[ -n "$changed" ] || { echo "this PR changes no file: no jobadabra-web test can read it"; exit 0; }
scratch="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/web-tests-reached.$$"
mkdir -p "$scratch"; trap 'git -C "$here" worktree remove --force "$scratch/head" 2>/dev/null; git -C "$here" worktree remove --force "$scratch/base" 2>/dev/null; rm -rf "$scratch"' EXIT
web="${WEB_DIR:-$scratch/web}"
if [ -z "${WEB_DIR:-}" ]; then
  for try in 1 2 3; do
    git clone -q --depth 1 "${WEB_REPO_URL:-https://github.com/jobadabra/jobadabra-web.git}" "$web" 2>/dev/null && break
    [ "$try" = 3 ] && { echo "::warning::could not clone jobadabra-web (3 tries): its tests were not checked on this PR"; exit 0; }
    sleep $((try * ${CLONE_WAIT:-5}))
  done
fi
picks="$(printf '%s\n' "$changed" | (cd "$here" && node tools/web-tests-reached.mjs --web "$web" --tree . 2>"$scratch/skipped"))" || { echo "::error::web-tests-reached.mjs failed: $(cat "$scratch/skipped")"; exit 1; }
[ ! -s "$scratch/skipped" ] || { echo "not run here (they need a package this job does not install; jobadabra-web's own CI runs them):"; sed 's/^/  /' "$scratch/skipped"; }
if [ -z "$picks" ]; then echo "no jobadabra-web test that this job can run reads a file this PR changes: nothing to run"; exit 0; fi
echo "jobadabra-web tests that read this PR's files ($(printf '%s\n' "$picks" | wc -l | tr -d ' ')):"; printf '  %s\n' $picks

# The joined tree of a commit: jobadabra at <ref> with web laid over it, and web itself at .private/, as .private/tools/tree.sh does in web CI (web's own-files tests look for `.private`).
join() {
  git -C "$here" worktree add -q --detach "$scratch/$1" "$2" || return 1
  "$web/tools/lay-private.sh" "$web" "$scratch/$1" || return 1
  (cd "$scratch/$1" && git ls-files -o --exclude-standard -z | xargs -0 -n 500 git add -N -- 2>/dev/null)   # tests that list files with `git ls-files` must see web's files too
  cp -R "$web" "$scratch/$1/.private"   # a real folder, as web CI checks it out: a symlink would be listed and followed differently
}
# Runs one test in a tree and prints its output; the status is the test's. Same environment as web's tests.yml.
run_one() {
  local tree="$1" test="$2" reporter=()
  [ -f "$web/tools/site-test-reporter.mjs" ] && reporter=("--test-reporter=$web/tools/site-test-reporter.mjs")
  (
    cd "$tree" || exit 1
    export SITE_REPO_DIR="$tree/.private" JOBADABRA_FOLLOW_APP=0 JOBADABRA_DISABLE=mail,notion,telegram,google_jobs
    case "$test" in
      *.py) python3 -m unittest discover -s tests -p "$(basename "$test")" 2>&1 ;;
      *) node --test ${reporter[@]+"${reporter[@]}"} "$test" 2>&1 ;;
    esac
  )
}
join head "$head" || { echo "::warning::could not lay jobadabra-web over the PR head (did web's layout change?): its tests were not checked on this PR"; exit 0; }
# A package the scan could not see (a computed import) still shows as a missing module: that is this job's gap, not the PR's break.
MISSING='Cannot find (module|package)|ERR_MODULE_NOT_FOUND|ModuleNotFoundError|No module named'
red=(); for test in $picks; do
  out="$(run_one "$scratch/head" "$test")" && continue
  if printf '%s' "$out" | grep -Eq "$MISSING"; then echo "::warning::$test needs a package this job does not install: not checked on this PR ($(printf '%s' "$out" | grep -Em1 "$MISSING" | cut -c1-160))"; continue; fi
  red+=("$test"); printf '\n::group::red on this PR: %s\n%s\n::endgroup::\n' "$test" "$out"
done
[ "${#red[@]}" = 0 ] && { echo "every jobadabra-web test that reads this PR's files passes"; exit 0; }
# Red on the head: is it this PR's? Run the same tests on the base.
mine=()
if join base "$base"; then
  for test in "${red[@]}"; do if run_one "$scratch/base" "$test" >/dev/null; then mine+=("$test"); else echo "::warning::$test is red on the base too (jobadabra-web main with jobadabra main): not this PR's"; fi; done
else
  echo "::warning::could not lay jobadabra-web over the base: cannot tell whether ${red[*]} was red already, so it counts as this PR's"; mine=("${red[@]}")
fi
[ "${#mine[@]}" = 0 ] && exit 0
echo "::error::this PR turns jobadabra-web test(s) red: ${mine[*]} (its own message is above; the fix is in this PR, or in jobadabra-web first when that test is out of date)"
exit 1
