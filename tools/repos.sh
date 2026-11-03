# Sourced by the shell tools that call gh: the repo names they default to. Shell cannot import desktop/lib/repos.js or src/repos.py, so the owner is written here once;
# tests/guards/rules/test_repos_owner.py fails when the three disagree.
# Why (2 Nov 2026, owner): a search, an issue/PR list and a workflow dispatch (POST) do not follow a transferred repo; a literal old owner reads 0 rows without an error.
JOBADABRA_OWNER="${JOBADABRA_OWNER:-jobadabra}"
JOBADABRA_PUBLIC_REPO="${JOBADABRA_PUBLIC_REPO:-$JOBADABRA_OWNER/jobadabra}"
JOBADABRA_WEB_REPO="${JOBADABRA_WEB_REPO:-$JOBADABRA_OWNER/jobadabra-web}"
JOBADABRA_LAB_REPO="${JOBADABRA_LAB_REPO:-$JOBADABRA_OWNER/jobadabra-lab}"
