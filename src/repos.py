"""The GitHub owner and repo names the engine and the tools read, in one place (org move, 2 Nov 2026; spec docs/superpowers/specs/2026-11-01-github-org-move-design.md).

Why (2 Nov 2026, owner): GitHub's search and `issue list` / `pr list` do not follow a transfer, and neither does a POST (`gh workflow run -R`): a literal old owner reads 0 rows
without an error. Mirrors desktop/lib/repos.js (OWNER) and tools/repos.sh; tests/guards/rules/test_repos_owner.py fails when they differ.
"""
OWNER = 'jobadabra'
PUBLIC_REPO = f'{OWNER}/jobadabra'
WEB_REPO = f'{OWNER}/jobadabra-web'
LAB_REPO = f'{OWNER}/jobadabra-lab'
BENCHMARKS_REPO = f'{OWNER}/jobadabra-benchmarks'
