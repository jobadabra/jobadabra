// Leaf of the plan checks (no imports): what a real check of the person's own CLI (claude -p / codex exec) can end in, one kind each. Shared by lib/claude-code.js, lib/ai/codex-cli.js and lib/plan-readiness.js,
// which would import each other otherwise.
// What a real check (claude -p / codex exec) can end in, one kind each (failureOf).
export const FAILURES = ['signed-out', 'limit', 'needs-git', 'did-not-start', 'failed'];

// {kind, text} from a CLI check -> one of FAILURES, '' for no failure. The git-bash wording is the one Claude Code prints on a Windows PC where it needs Git Bash.
export function failureOf(error) {
  if (!error) return '';
  if (error.kind === 'signed-out') return 'signed-out';
  if (error.kind === 'limit') return 'limit';
  if (/git[- ]?bash/i.test(String(error.text || ''))) return 'needs-git';
  if (error.kind === 'missing') return 'did-not-start';
  return 'failed';
}

