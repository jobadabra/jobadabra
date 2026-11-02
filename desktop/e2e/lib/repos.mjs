// Job: pick the suites
// The GitHub owner and repo names the harness and the Node tools default to, in one place (org move, 2 Nov 2026; spec docs/superpowers/specs/2026-11-01-github-org-move-design.md).
// Why (2 Nov 2026, owner): a search, an issue or PR list and a workflow dispatch do not follow a transferred repo, so a literal old owner reads zero rows without an error. Mirrors desktop/lib/repos.js:
// not an import of it, because several jobs check out only desktop/e2e/ and a few tools; tests/test_repos_owner.py keeps the mirrors equal.
export const OWNER = 'jobadabra';
export const PUBLIC_REPO = `${OWNER}/jobadabra`;
export const WEB_REPO = `${OWNER}/jobadabra-web`;
export const LAB_REPO = `${OWNER}/jobadabra-lab`;
