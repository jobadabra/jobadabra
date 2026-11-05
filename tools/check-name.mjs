// The name a CI stats row gives a workflow run: its workflow name, plus its file when that name is a bare layer several files share.

/**
 * A run's check name for the stats (tools/sdlc-stats.mjs, tools/pr-check-scorecard.mjs). Takes a run with `name` (the workflow's name) and `path`
 * (".github/workflows/tests-python.yml"). Returns "Unit · tests-python" for a bare layer name, and any other name as it is ("CI · Tests").
 * Why (5 Nov 2026, owner: "Yes, rename + fold"): the PR checks are named by layer, and four files are named "Unit", so the name alone would merge
 * their runs into one row and pair one file's red with another file's green.
 */
export const checkName = ({name = '', path = ''}) =>
  (!name.includes(' · ') && path ? `${name} · ${path.split('/').pop().replace(/\.ya?ml$/, '')}` : name);
