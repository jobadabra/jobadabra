#!/usr/bin/env bash
# Sourced by the loops that look at a PR again and again (tools/ship-watch.sh, tools/ship-pr.sh's wait): a PR's state, checks and comments over REST with conditional requests.
# Why (27 Oct 2026, the owner's 5,000-an-hour GraphQL budget ran out and PRs could not be opened): every look asked GitHub's GraphQL for the PR and its checks (a ship's wait
#   looked every 15 s, each watcher every 2 min). A REST read with the last ETag that comes back 304 costs nothing (measured: 1 full read + 3 conditional reads = 1 call).
#   The answers keep the shape of gh's own PR view and checks, so the callers keep their logic. The repo is always explicit: gh's PR commands read it from the working folder
#   and fail in a deleted worktree, so web #177's watcher never saw its merge. Guard: tests/test_pr_rest_lib.py.
# Why (owner, 27 Oct 2026, try 3 on "GraphQL runs out": "No GraphQL in our tools"): opening, editing, listing and labelling PRs and red-main issues are here too, over
#   REST; only what GitHub offers in GraphQL alone (a draft made ready, auto-merge) is left, and tools/bin/gh logs it with its session.
# Why (owner, 10 Nov 2026, asked via AskUserQuestion, "REST first, GraphQL fallback"; amends the 27 Oct line above): at 00:31Z REST core sat at 0/5000 for 30 min and every watcher was blind
#   while GraphQL still had 4,860. REST + ETag stays the only normal path (a normal day uses no GraphQL). Only when a read FAILS and `gh api rate_limit` (never counted) says core is 0,
#   pr_view and pr_checks answer the same read over GraphQL, in the same shape, until the reset; any other failure (404, network, secondary limit) fails as before, with no retry.
#   tools/bin/gh logs each such call as "fallback: REST out". Guard: tests/tooling/ci/test_pr_graphql_fallback.py.

# Every gh of the tools that source this lib goes through tools/bin/gh, which logs a GraphQL call with its session (none should be left but a draft's ready, auto-merge and the REST-out fallback of pr_view and pr_checks).
_pr_bin="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/bin"
case ":$PATH:" in *":$_pr_bin:"*) ;; *) [ -x "$_pr_bin/gh" ] && PATH="$_pr_bin:$PATH" ;; esac

# pr_repo [dir]: "owner/repo" of the dir's origin when it is on GitHub, read from git (no network); empty otherwise.
pr_repo() { git -C "${1:-.}" remote get-url origin 2>/dev/null | sed -nE 's#^(git@github\.com:|ssh://git@github\.com/|https://github\.com/)([^/]+/[^/]+)$#\2#p' | sed -E 's#\.git$##'; }

# pr_get <api path>: the JSON body. Sends the last ETag; a 304 answers from the cache (PR_REST_CACHE, default a folder in TMPDIR), free of the rate limit.
# Fails with no output when GitHub refuses (rate limit, 404) or cannot be reached. The cache file (ETag line, then the body) is replaced whole by a rename.
pr_get() {
  local dir="${PR_REST_CACHE:-${TMPDIR:-/tmp}/pr-rest-cache}" key etag out code h=()
  mkdir -p "$dir" 2>/dev/null || return 1
  key="$dir/$(printf '%s' "$1" | tr -c 'A-Za-z0-9' _)"
  etag="$(head -n 1 "$key" 2>/dev/null)"; [ -z "$etag" ] || h=(-H "If-None-Match: $etag")
  out="$(gh api -i ${h[@]+"${h[@]}"} "$1" 2>/dev/null | tr -d '\r')"   # gh exits 1 on a 304: the status line decides
  code="$(head -n 1 <<<"$out" | awk '{print $2}')"
  case "$code" in
    304) [ -n "$etag" ] && tail -n +2 "$key" ;;
    200) etag="$(sed -n 's/^[Ee][Tt][Aa][Gg]: //p' <<<"$out" | head -n 1)"
         out="$(awk 'body {print} !body && $0 == "" {body = 1}' <<<"$out")"
         [ -n "$out" ] || return 1
         { printf '%s\n' "$etag"; printf '%s\n' "$out"; } > "$key.$$" && mv -f "$key.$$" "$key"
         printf '%s\n' "$out" ;;
    *) return 1 ;;
  esac
}

# pr_view <repo> <n> [full]: the PR like `gh pr view --json number,url,title,state,mergeable,headRefOid,headRefName,mergeCommit` (state OPEN|MERGED|CLOSED,
# mergeable MERGEABLE|CONFLICTING|UNKNOWN, labels: the label names). "full" adds comments, reviews and commits in the same shape (3 more reads, free while unchanged).
pr_view() { _pr_view_rest "$@" || { _pr_rest_out && _pr_gql_view "$@"; }; }
# _pr_reviews_all <repo> <n>: every review of the PR (REST lists oldest first, 100 a page, so the newest one sits on the last page); at most 10 pages.
# Why (13 Nov 2026, Gitar's finding on #4124): READY reads the newest Claude review of the head; the first page alone would miss it on a PR with more than 100 reviews. The first request keeps its old path (cache key).
_pr_reviews_all() {
  local page=1 acc part
  acc="$(pr_get "repos/$1/pulls/$2/reviews?per_page=100")" || return 1
  part="$acc"
  while [ "$(jq 'length' <<<"$part" 2>/dev/null || echo 0)" -ge 100 ] && [ "$page" -lt 10 ]; do
    page=$((page + 1))
    part="$(pr_get "repos/$1/pulls/$2/reviews?per_page=100&page=$page")" || return 1
    acc="$(jq -sc 'add' <<<"$acc $part")"
  done
  printf '%s\n' "$acc"
}
_pr_view_rest() {
  local p c r k
  p="$(pr_get "repos/$1/pulls/$2")" || return 1
  if [ "${3:-}" = full ]; then
    c="$(pr_get "repos/$1/issues/$2/comments?per_page=100")" && r="$(_pr_reviews_all "$1" "$2")" && k="$(pr_get "repos/$1/pulls/$2/commits?per_page=100")" || return 1
  else c='[]'; r='[]'; k='[]'; fi
  printf '%s\n%s\n%s\n%s\n' "$p" "$c" "$r" "$k" | jq -sc '.[0] as $p | {number: $p.number, url: $p.html_url, title: $p.title, headRefOid: $p.head.sha, headRefName: $p.head.ref,
      isDraft: ($p.draft // false), state: (if $p.merged_at then "MERGED" elif $p.state == "closed" then "CLOSED" else "OPEN" end),
      mergeable: (if $p.mergeable == true then "MERGEABLE" elif $p.mergeable == false then "CONFLICTING" else "UNKNOWN" end),
      mergeState: ($p.mergeable_state // "unknown"),
      mergeCommit: (if $p.merged_at then {oid: $p.merge_commit_sha} else null end), labels: [$p.labels[]?.name],
      comments: [.[1][]? | {id: .node_id, author: {login: (.user.login // "")}, body, url: .html_url, createdAt: .created_at}],
      reviews: [.[2][]? | {id: .node_id, author: {login: (.user.login // "")}, body, state, submittedAt: .submitted_at}],
      commits: [.[3][]? | {authoredDate: .commit.author.date, committedDate: .commit.committer.date}]}'
}

# pr_checks <repo> <sha>: the newest check-run of each name and every commit status of the sha like `gh pr checks --json name,bucket,link` (bucket pass|fail|pending|skipping|cancel).
# Why (#2282, its own first run; 10 Nov 2026, REST-out fallback): two edits of a PR start the same workflow twice and the first run is cancelled; the list keeps both, gh's checks keep only the newest. The REST reader is _pr_checks_rest; this wrapper tries it first and asks GraphQL (same rows, same rules) only when REST core is out of quota.
pr_checks() { _pr_checks_rest "$@" || { _pr_rest_out && _pr_gql_checks "$@"; }; }
_pr_checks_rest() {
  local runs st id run excluded='[]' status_excluded='[]'
  runs="$(pr_get "repos/$1/commits/$2/check-runs?per_page=100")" && st="$(pr_get "repos/$1/commits/$2/status")" || return 1
  # A cached or mismatched combined status cannot decide this head's red or green state.
  jq -e --arg sha "$2" '(.sha // $sha) == $sha' <<<"$st" >/dev/null || return 1
  # Why (#2618, 30 Oct 2026): a manual record run on the same SHA is not a PR check; filter before choosing the newest check by name.
  # Actions URLs identify their workflow run; non-Actions checks still belong to the requested commit. Unknown provenance leaves the read pending.
  while IFS= read -r id; do
    [ -n "$id" ] || continue
    run="$(pr_get "repos/$1/actions/runs/$id")" || return 1
    if ! jq -e --arg sha "$2" '.head_sha == $sha and .event != "workflow_dispatch"' <<<"$run" >/dev/null; then
      excluded="$(jq -c --arg id "$id" '. + [$id]' <<<"$excluded")"
    fi
    # Why (#2634, Gitar, 30 Oct 2026): the PR verdict's status belongs to this commit, but its workflow_run reporter executes on main's SHA.
    if ! jq -e --arg sha "$2" '.event == "workflow_run" or (.head_sha == $sha and .event != "workflow_dispatch")' <<<"$run" >/dev/null; then
      status_excluded="$(jq -c --arg id "$id" '. + [$id]' <<<"$status_excluded")"
    fi
  done < <(printf '%s\n%s\n' "$runs" "$st" | jq -sr '[((.[0].check_runs[]?.html_url), (.[1].statuses[]?.target_url)) | . // "" | capture("/actions/runs/(?<id>[0-9]+)")? | .id] | unique[]')
  printf '%s\n%s\n' "$runs" "$st" | jq -sc --arg sha "$2" --argjson excluded "$excluded" --argjson status_excluded "$status_excluded" '
    def allowed(excluded): ((. // "" | capture("/actions/runs/(?<id>[0-9]+)").id) // "") as $id | excluded | index($id) | not;
    [(.[0].check_runs // []
      | map(select((.head_sha // $sha) == $sha) | select(.html_url | allowed($excluded)))
      | group_by(.name) | map(max_by(.id))[] | {name, link: (.html_url // ""), bucket: (if .status != "completed" then "pending"
        elif (.conclusion | IN("success", "neutral")) then "pass" elif .conclusion == "skipped" then "skipping" elif .conclusion == "cancelled" then "cancel" else "fail" end)}),
      (.[1].statuses[]? | select(.target_url | allowed($status_excluded)) | {name: .context, link: (.target_url // ""), bucket: (if .state == "success" then "pass" elif .state == "pending" then "pending" else "fail" end)})]'
}

# --- GraphQL fallback (owner, 10 Nov 2026): used only by pr_view and pr_checks, only while REST core is out of quota. ---

# _pr_rest_out: succeeds only when GitHub says the REST core budget is 0 (`rate_limit` is never counted). A 404, a network error or a secondary limit is not "out": the read just fails.
_pr_rest_out() { [ "$(gh api rate_limit --jq '.resources.core.remaining' 2>/dev/null)" = 0 ]; }

# _pr_gql <query> [gh api args]: one GraphQL call; tools/bin/gh logs it with its session and this reason. Fails on any GraphQL error.
_pr_gql() { GH_GRAPHQL_WHY="fallback: REST out" gh api graphql -f query="$1" "${@:2}" 2>/dev/null; }

# _pr_gql_view <repo> <n> [full]: pr_view's answer from GraphQL, field for field the same shape (mergeState = GitHub's mergeStateStatus, lowercase like REST's mergeable_state).
_pr_gql_view() {
  local full=false; [ "${3:-}" = full ] && full=true
  _pr_gql 'query($o:String!,$r:String!,$n:Int!,$full:Boolean!){repository(owner:$o,name:$r){pullRequest(number:$n){number url title headRefOid headRefName isDraft state mergeable mergeStateStatus
      mergeCommit{oid} labels(first:100){nodes{name}} comments(first:100)@include(if:$full){nodes{id author{__typename login} body url createdAt}} reviews(first:100)@include(if:$full){nodes{id author{__typename login} body state submittedAt}}
      commits(first:100)@include(if:$full){nodes{commit{authoredDate committedDate}}}}}}' -f o="${1%%/*}" -f r="${1#*/}" -F n="$2" -F full="$full" \
    | jq -ce 'def login: (.author.login // "") + (if .author.__typename == "Bot" then "[bot]" else "" end);   # Why (Gitar, 10 Nov 2026): GraphQL names a bot without the [bot] suffix REST puts on it; pc_items tells bots by that suffix
      .data.repository.pullRequest | select(. != null) | {number, url, title, headRefOid, headRefName, isDraft, state, mergeable, mergeState: (.mergeStateStatus | ascii_downcase),
        mergeCommit: (if .mergeCommit then {oid: .mergeCommit.oid} else null end), labels: [.labels.nodes[].name],
        comments: [.comments.nodes[]? | {id, author: {login: login}, body, url, createdAt}],
        reviews: [.reviews.nodes[]? | {id, author: {login: login}, body, state, submittedAt}],
        commits: [.commits.nodes[]?.commit | {authoredDate, committedDate}]}'
}

# _pr_gql_checks <repo> <sha>: pr_checks' answer from GraphQL, with the same rules: the newest run of each check name, no workflow_dispatch suite (#2618), a status from an Actions run kept
# only when that run is a workflow_run reporter or ran on this sha and was not dispatched (#2634). A suite or status whose provenance cannot be decided leaves the read pending (fails), never green.
_pr_gql_checks() {
  local c ids id q runs='{}' out
  c="$(_pr_gql 'query($o:String!,$r:String!,$sha:GitObjectID!){repository(owner:$o,name:$r){object(oid:$sha){... on Commit{oid
      checkSuites(first:100){nodes{workflowRun{databaseId event} checkRuns(first:100){nodes{databaseId name status conclusion permalink}}}} status{contexts{context state targetUrl}}}}}}' \
    -f o="${1%%/*}" -f r="${1#*/}" -f sha="$2")" || return 1
  # A status links to the Actions run that wrote it; one aliased lookup by URL tells each run's event and commit (a run of main's reporter is on another sha, so it is not among this commit's suites).
  ids="$(jq -r '[.data.repository.object.status.contexts[]?.targetUrl // "" | capture("/actions/runs/(?<id>[0-9]+)")? | .id] | unique[]' <<<"$c" 2>/dev/null)" || return 1
  if [ -n "$ids" ]; then
    q='{'; while IFS= read -r id; do q="$q r$id: resource(url: \"https://github.com/$1/actions/runs/$id\") { ... on WorkflowRun { event checkSuite { commit { oid } } } }"; done <<<"$ids"
    runs="$(_pr_gql "$q }" | jq -ce '.data // empty')" || return 1
  fi
  out="$(printf '%s\n%s\n' "$c" "$runs" | jq -sc --arg sha "$2" '
    def rid: (. // "" | capture("/actions/runs/(?<id>[0-9]+)")? | .id) // "";
    .[0].data.repository.object as $o | .[1] as $runs | ($o.checkSuites.nodes // []) as $suites | ($o.status.contexts // []) as $contexts
    | def run: $runs["r" + (.targetUrl | rid)];
      if $o == null
        or any($suites[]; .workflowRun == null and any(.checkRuns.nodes[]; (.permalink | rid) != ""))
        or any($contexts[]; (.targetUrl | rid) != "" and (run.event // "") == "") then empty
      else [($suites | map(select((.workflowRun.event // "") != "workflow_dispatch") | .checkRuns.nodes[]) | group_by(.name) | map(max_by(.databaseId))[]
            | {name, link: (.permalink // ""), bucket: (if (.status | ascii_downcase) != "completed" then "pending"
                elif (.conclusion // "" | ascii_downcase | IN("success", "neutral")) then "pass" elif (.conclusion // "" | ascii_downcase) == "skipped" then "skipping"
                elif (.conclusion // "" | ascii_downcase) == "cancelled" then "cancel" else "fail" end)}),
            ($contexts[] | select((.targetUrl | rid) == "" or run.event == "workflow_run" or (run.checkSuite.commit.oid == $sha and run.event != "workflow_dispatch"))
              | {name: .context, link: (.targetUrl // ""), bucket: (if .state == "SUCCESS" then "pass" elif .state == "PENDING" or .state == "EXPECTED" then "pending" else "fail" end)})] end' 2>/dev/null)"
  [ -n "$out" ] || return 1
  printf '%s\n' "$out"
}

# pr_list <repo> <state open|closed> [pages=1]: every PR of the state, 100 a page, newest first, as [{number, headRefName, headRefOid, merged}]. Each page is a conditional read.
pr_list() {
  local page=1 out all='[]'
  while [ "$page" -le "${3:-1}" ]; do
    out="$(pr_get "repos/$1/pulls?state=$2&per_page=100&page=$page")" || return 1
    all="$(jq -c --argjson a "$all" '$a + [.[] | {number, headRefName: .head.ref, headRefOid: .head.sha, merged: (.merged_at != null)}]' <<<"$out")" || return 1
    [ "$(jq length <<<"$out")" -eq 100 ] || break
    page=$((page + 1))
  done
  printf '%s\n' "$all"
}

# pr_of_head <repo> <branch>: the number of the open PR whose head is <branch> of <repo>'s owner; empty (exit 0) when there is none; exit 1 with nothing printed when GitHub cannot say.
# Why (13 Nov 2026, pq; bl on #4022 at 19:47Z, REST core 0 until 20:03Z): the read was piped into jq, so the function had jq's exit status and a quota 403 (no output) read as no open PR; ship.sh went on to create a
#   second one (422) with no watcher. An unknown answer is never none: REST out (core 0) reads over GraphQL like pr_view; any other failure fails, and the caller must not create a PR.
pr_of_head() {
  local out
  out="$(pr_get "repos/$1/pulls?state=open&head=${1%%/*}:$2&per_page=1")" || { _pr_rest_out && _pr_gql_of_head "$@"; return; }
  jq -r '.[0].number // empty' <<<"$out"
}
# _pr_gql_of_head <repo> <branch>: pr_of_head's answer from GraphQL (only PRs whose head is in the repo's own owner, like REST's head=owner:branch). The branch name matches any fork's branch of that name, so a page
#   with more behind it and no match of ours is unknown (exit 1), never none (Gitar on #4093).
_pr_gql_of_head() {
  local out
  out="$(_pr_gql 'query($o:String!,$n:String!,$b:String!){repository(owner:$o,name:$n){pullRequests(headRefName:$b,states:OPEN,first:100){pageInfo{hasNextPage} nodes{number headRepositoryOwner{login}}}}}' -f o="${1%%/*}" -f n="${1#*/}" -f b="$2")" || return 1
  jq -r --arg o "${1%%/*}" '.data.repository | if . == null then error("no repository") else (.pullRequests as $p | ($p.nodes | map(select(.headRepositoryOwner.login == $o)) | .[0].number) as $m | if $m == null and $p.pageInfo.hasNextPage then error("more pages") else ($m // empty) end) end' <<<"$out" || return 1
}

# pr_open <repo> <branch> <title> <body> [draft]: opens the PR into main; prints its URL.
pr_open() { gh api -X POST "repos/$1/pulls" -f base=main -f head="$2" -f title="$3" -f body="$4" ${5:+-F draft=true} --jq .html_url; }

# pr_keep_hold <current title> <new title>: the title to set on an open PR. A held PR (draft, "DONT MERGE" in its title) keeps the words, right after its tag(s), when a re-ship replaces
#   its title; any other PR gets the new title as given. Invariant: the hold is never dropped by ship (the tag stays first: the PR-title check wants it there, web #526).
# Why (11 Nov 2026, sm, owner 10 Nov: "you should put it as draft and a prefix \"DONT MERGE\""): ship.sh --title= replaced #3809's title wholesale, so each push dropped the words and sm restored them by hand.
pr_keep_hold() {
  case "$1" in *"DONT MERGE"*) ;; *) printf '%s' "$2"; return 0 ;; esac
  case "$2" in *"DONT MERGE"*) printf '%s' "$2"; return 0 ;; esac
  case "$2" in "["*) printf '%s' "$2" | sed -E 's/^((\[[^]]+\] )+)/\1DONT MERGE /' ;; *) printf 'DONT MERGE %s' "$2" ;; esac
}

# pr_new_title <repo> <n> <requested title>: the title to set on open PR #n: its current title is read and pr_keep_hold applied. Exit 1 (nothing printed) when the current title cannot be read:
#   whether the PR is held is then unknown, so the caller keeps the old title rather than risk dropping the hold (Gitar, #3810: a failed lookup used to read as "not held").
pr_new_title() {
  local current
  current="$(pr_view "$1" "$2" 2>/dev/null | jq -r '.title // empty' 2>/dev/null)" || return 1
  [ -n "$current" ] || return 1
  pr_keep_hold "$current" "$3"
}

# pr_set_text <repo> <n> <title> <body>: replaces the title and/or the description in ONE request (an empty argument is left as it is). Two PATCHes are two `edited` events,
#   and two events on one commit make the Guard gate cancel one of its own runs, which stays red on the head (10 Nov 2026, fr; 79 PRs since 25 Oct).
pr_set_text() {
  local args=()
  [ -z "$3" ] || args+=(-f "title=$3")
  [ -z "$4" ] || args+=(-f "body=$4")
  [ "${#args[@]}" -gt 0 ] || return 0
  gh api -X PATCH "repos/$1/pulls/$2" "${args[@]}" --jq .number >/dev/null
}

# pr_label <repo> <n> <label> <color> <description>: creates the label when the repo lacks it, then puts it on the PR.
pr_label() { gh api -X POST "repos/$1/labels" -f name="$3" -f color="$4" -f description="$5" >/dev/null 2>&1; gh api -X POST "repos/$1/issues/$2/labels" -f "labels[]=$3" >/dev/null; }

# pr_issues <repo> <label>: the open issues (never PRs) with that label, as [{number, title, body}].
pr_issues() { pr_get "repos/$1/issues?state=open&labels=$2&per_page=100" | jq -c '[.[] | select(.pull_request | not) | {number, title, body: (.body // "")}]'; }
