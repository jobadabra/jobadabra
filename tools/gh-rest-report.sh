#!/usr/bin/env bash
# Counts the REST calls tools/bin/gh logged in the last N hours (default 1): calls per hour that count against the shared 5,000-an-hour token (a 304 is free and counted apart), by caller, session and call class.
# Usage: tools/gh-rest-report.sh [hours: a whole number, default 1]   Log: GH_REST_LOG (default ~/.cache/jobadabra/gh-rest.log). Status "-" = the call did not print its headers, "?" = it never returned (both counted as spent); of lines with one call id (column 7) the last counts. GraphQL: tools/gh-graphql-report.sh.
# Why (coordinator mac-95, 14 Nov 2026, rb): three quota outages on 13 Nov and no way to say which caller caused them. Guard: tests/tooling/ci/test_gh_rest_log.py.
log="${GH_REST_LOG:-$HOME/.cache/jobadabra/gh-rest.log}"; hours="${1:-1}"
case "$hours" in ''|*[!0-9]*|0) echo "usage: $0 [hours]  (a whole number of hours, at least 1)" >&2; exit 2 ;; esac
since="$(date -u -d "-$hours hours" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -v-"$hours"H +%Y-%m-%dT%H:%M:%SZ 2>/dev/null)"
[ -n "$since" ] || { echo "cannot compute the start time for $hours hours" >&2; exit 2; }
[ -f "$log" ] || { echo "no REST call logged ($log missing)"; exit 0; }
awk -F'\t' -v since="$since" -v hours="$hours" '
  $1 >= since { if ($7 != "") { t[$7] = $1; w[$7] = $2; cl[$7] = $3; k5[$7] = $5; st[$7] = $6 } else { m++; t[m] = $1; w[m] = $2; cl[m] = $3; k5[m] = $5; st[m] = $6 } }
  END { for (i in t) { if (st[i] == "304") free++; else { n++; s[w[i]]++; c[cl[i]]++; k[k5[i]]++ } }
        printf "0\t0\t%d REST calls spent since %s = %.0f/h (+ %d free 304 reads)\n", n, since, n / hours, free
        for (x in c) printf "1\t%d\t  caller  %-36s %d  (%.0f/h)\n", c[x], x, c[x], c[x] / hours
        for (x in s) printf "2\t%d\t  session %-36s %d\n", s[x], x, s[x]
        for (x in k) printf "3\t%d\t  class   %-50s %d\n", k[x], x, k[x] }' "$log" | sort -t"$(printf '\t')" -k1,1n -k2,2nr | cut -f3-
