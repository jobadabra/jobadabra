#!/usr/bin/env bash
# CI: installs apt packages without ever hanging (owner, 25 Oct 2026: the "ffmpeg for the hero media tests" step sat 11m51s on web #122, normally 15-30 s: "that's way too much"
# ... "let's fix it"). apt itself retries a download 3 times and gives up on a silent mirror after 20 s; each try of `apt-get update` and `install` is cut by `timeout`;
# a failed try is repeated once; then the step fails at once and says why. Worst case about 5 minutes, never 12. Usage: tools/apt-install.sh <package>...
# The same script lives in the private site repo (tools/apt-install.sh). No committed test (tooling-test rule, 3 Nov 2026): checked with a fake apt, sudo and dpkg on PR 3820.
# Why (11 Nov 2026, owner: "I build it now (Recommended)", asked via AskUserQuestion): the mirror still stalled after the two tries (#3798: 3 Linux jobs
#   red at 15:09Z, ~1 red run a day); retries alone could not end it. With APT_DEBS (a folder the action .github/actions/apt-packages restores
#   from the GitHub cache), the packages install from their .deb files with no download and no `apt-get update`; the mirror is reached
#   only on a cold or stale cache, and its downloads land in that folder for the next run.
set -uo pipefail
[ $# -gt 0 ] || { echo "apt-install: no packages named" >&2; exit 2; }
debs="${APT_DEBS:-}"   # the cached .deb folder; empty = no cache (a local run, the private repo's copy)
conf=('Acquire::Retries "3";' 'Acquire::http::Timeout "20";' 'Acquire::https::Timeout "20";' 'DPkg::Lock::Timeout "60";' 'APT::Install-Recommends "false";')
if [ -n "$debs" ]; then   # apt keeps what it downloads in the cached folder (apt runs as root: the folder is opened to it)
  sudo mkdir -p "$debs/partial" && sudo chmod -R a+rwX "$debs"
  conf+=("Dir::Cache::archives \"$debs\";" 'APT::Keep-Downloaded-Packages "true";')
fi
printf '%s\n' "${conf[@]}" | sudo tee "${APT_CONF:-/etc/apt/apt.conf.d/98ci-apt}" >/dev/null   # APT_CONF, like APT_DIR below: a check with a fake apt points it at its own file
cut() { timeout --kill-after=10 "$1" "${@:2}"; }   # a command, ended after $1 seconds
# Why (11 Nov 2026, #3820 run 43069035134): apt leaves a root-only lock file and an _apt-only partial folder in the folder, so the cache's save
#   (tar as the runner user) failed "Permission denied" and nothing was kept; the folder is handed back to the runner user before the save.
mine() { [ -z "$debs" ] || sudo chown -R "$(id -u):$(id -g)" "$debs"; }
# Every named package is installed, by its name or by one an installed package provides; prints the missing ones.
# Why (11 Nov 2026, #3820): on Ubuntu 24.04 libgtk-3-0 and others are only provided (by libgtk-3-0t64 …), so asking dpkg for the name
#   alone called them missing and apt ran (`ready (try 1, 5 s)`, nothing downloaded) on runners that had everything.
installed() {
  local have p missing=()
  have="$(dpkg-query -W -f='${db:Status-Abbrev}|${Package}|${Provides}\n' 2>/dev/null \
    | awk -F'|' '$1 ~ /^ii/ { print $2; n = split($3, each, ", "); for (i = 1; i <= n; i++) { split(each[i], name, " "); print name[1] } }')"
  for p in "$@"; do grep -qxF -- "$p" <<<"$have" || missing+=("$p"); done
  [ ${#missing[@]} -eq 0 ] && return 0
  echo "apt-install: not on the runner yet: ${missing[*]}"; return 1
}
# The second try uses Ubuntu's own archive instead of the runner's Azure mirror (26 Oct 2026: web #154 failed 3 times in a row on a stalled
# mirror, 16:13-16:22): a mirror that is down stays down for minutes, so the same mirror again rarely helps.
apt_dir="${APT_DIR:-/etc/apt}"   # tests point it at a folder of their own
other_mirror() {
  # GitHub's Ubuntu runners keep their mirrors in apt-mirrors.txt (the sources say mirror+file:): without it try 2 still fetched from azure (run 40389661253)
  for file in "$apt_dir"/sources.list "$apt_dir"/sources.list.d/*.sources "$apt_dir"/apt-mirrors.txt; do
    [ -f "$file" ] && sudo perl -pi -e 's#https?://azure\.archive\.ubuntu\.com#http://archive.ubuntu.com#g' "$file"
  done
  echo "apt-install: try 2 on archive.ubuntu.com" >&2
}
buf=(); command -v stdbuf >/dev/null && buf=(stdbuf -oL)   # apt's lines reach the log as they come, so a cut try still shows its last one
# One phase of a try: `apt-get update` (cut at 45 s) or `install` (90 s), -q so the log keeps apt's Hit/Get lines (-qq hid them: 26 Oct 2026,
# three ~95 s stalls on main printed nothing). Sets `why` when it fails: cut at its limit, or apt's exit code.
phase() {
  local limit="$1" name="$2"; shift 2
  cut "$limit" sudo ${buf[@]+"${buf[@]}"} apt-get "$name" -q "$@" >>"$log" 2>&1
  local code=$?
  case "$code" in 0) return 0 ;; 124|137) why="apt-get $name cut after $limit s" ;; *) why="apt-get $name failed (exit $code)" ;; esac
  return 1
}
# Why (11 Nov 2026, #3820): the runner image already has every package most jobs name (xvfb, fonts, Chrome's libraries), so the only
#   network call was `apt-get update`, the step that stalled on every runner from 15:08 to ~17:25Z; nothing missing = no apt call at all.
if installed "$@"; then echo "apt-install: $* already installed (runner image), no apt call"; mine; exit 0; fi
# The cache first: its .deb files by path with --no-download, so a missing or stale file fails at once and the mirror tries below run.
if [ -n "$debs" ] && compgen -G "$debs/*.deb" >/dev/null; then
  log="$(mktemp)"; started=$SECONDS
  if cut 90 sudo apt-get install -y -q --no-download -o Dpkg::Use-Pty=0 "$debs"/*.deb >>"$log" 2>&1 && installed "$@"; then
    echo "apt-install: $* ready (from the cache, $((SECONDS - started)) s)"; mine; exit 0
  fi
  echo "apt-install: the cache did not cover $* (stale or partial), going to the mirror; apt's last lines:" >&2; tail -n 8 "$log" >&2
fi
for attempt in 1 2; do
  [ "$attempt" = 2 ] && other_mirror
  log="$(mktemp)"; started=$SECONDS   # apt's own words: shown when a try fails, so a stall names its source (a mirror, a third-party list, a lock)
  if phase 45 update && phase 90 install -y -o Dpkg::Use-Pty=0 "$@"; then
    echo "apt-install: $* ready (try $attempt, $((SECONDS - started)) s)"; mine; exit 0
  fi
  echo "apt-install: try $attempt: $why, ${attempt}/2; apt's last lines:" >&2; tail -n 15 "$log" >&2; sleep 5
done
echo "::error::apt-install: could not install $* after 2 tries, a package mirror stalled or is down; re-run the job" >&2
exit 1
