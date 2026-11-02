#!/usr/bin/env bash
# Does a release's build contain the Jobadabra env-name rename (#2926)? Exit 0 yes, 1 no (it still reads only the old names), 2 the question could not be answered.
#   tools/release-after-rename.sh <tag>     (GH_TOKEN and GITHUB_REPOSITORY set, as in a workflow)
# Why (2 Nov 2026, owner: "We don't want to support the old names anymore"): the checks that install a PUBLISHED release and drive it through env names
# (fresh-install-smoke.yml, upgrade-data.yml) set JOBADABRA_* only; a build from before #2926 reads the old names and ignores them (no screenshot hook, the real data
# folder), so those checks go red on it. They install only releases that pass this test, and end green with a notice while no stable is that new.
# TODO(AI): delete this script and its two callers once every stable release is newer than the rename (2 Nov 2026).
set -euo pipefail
tag=${1:?release tag}
RENAME_COMMIT=15c8331533f398a0b82aa01617c27941857eebd7   # "[91] [rn] Finish the rename to Jobadabra (#2926)"
# compare base...head: "ahead" or "identical" means the tag's commit has the rename commit in its history; "behind" or "diverged" means it does not
status=$(gh api "repos/${GITHUB_REPOSITORY:?}/compare/${RENAME_COMMIT}...${tag}" --jq .status) || exit 2
case $status in
  ahead|identical) exit 0 ;;
  behind|diverged) exit 1 ;;
  *) echo "release-after-rename: unexpected compare status '$status' for $tag" >&2; exit 2 ;;
esac
