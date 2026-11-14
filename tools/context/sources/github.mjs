// Context fetcher: a GitHub issue or PR ("#123": title, body, last comments) by GET, or the last 15 commits of some files ("paths a/b.js c.md") from local git.
import {execFileSync} from 'node:child_process';
import {LIMITS, finish, guarded, json, unavailable} from '../lib.mjs';

export const name = 'github';

/** Why (3 Nov 2026, harness map spec): GET only; the token is the workflow's own read-only GITHUB_TOKEN (locally pack.mjs lends the `gh` login); without one the public repo is read anonymously. */
export async function fetch(ref, {limits = LIMITS, env = {}, fetchImpl = globalThis.fetch, cwd = process.cwd()} = {}) {
  return guarded(async () => {
    const text = String(ref || '').trim(), number = /^#(\d{1,7})$/.exec(text), paths = /^paths\s+(.+)$/.exec(text);
    if (paths) return history(paths[1].split(/\s+/), limits, cwd);
    if (!number) return unavailable('a GitHub ref is #123 or "paths a b"');
    const repo = env.GITHUB_REPOSITORY || 'jobadabra/jobadabra';
    if (!/^[\w-][\w.-]*\/[\w-][\w.-]*$/.test(repo)) return unavailable('GITHUB_REPOSITORY must look like owner/name');
    const init = {method: 'GET', headers: {accept: 'application/vnd.github+json', ...(env.GITHUB_TOKEN ? {authorization: `Bearer ${env.GITHUB_TOKEN}`} : {})}};
    const issue = await json(fetchImpl, `https://api.github.com/repos/${repo}/issues/${number[1]}`, init, limits.timeoutMs);
    // Why (3 Nov 2026, Gitar on #3119): the API lists comments oldest first; the newest are the relevant ones, so read a full page (100) and keep the last maxItems. Limit: a thread over 100 comments shows its oldest 100 (parked as JOB-271).
    const comments = (await json(fetchImpl, `https://api.github.com/repos/${repo}/issues/${number[1]}/comments?per_page=100`, init, limits.timeoutMs).catch(() => [])).slice(-(limits.maxItems ?? LIMITS.maxItems));
    return finish(`# GitHub #${issue.number}: ${issue.title}`, [
      `State: ${issue.state} · ${issue.pull_request ? 'pull request' : 'issue'} · Labels: ${(issue.labels || []).map(l => l.name).join(', ') || '(none)'}`,
      '', issue.body || '(empty)', '', '## Comments', ...(comments.length ? comments.map(c => `- ${String(c.created_at).slice(0, 10)}: ${c.body}`) : ['(none)']),
    ].join('\n'), limits);
  });
}

function history(files, limits, cwd) {
  if (!files.every(f => /^[\w./@-]+$/.test(f) && !f.startsWith('-') && !f.includes('..'))) return unavailable('paths must be plain repo-relative file names');
  // Why (xc, 14 Nov 2026, Gitar on #4238): the read's hang guard is the tool's one time limit (LIMITS.timeoutMs), as every other source's call; a slow read ends as "unavailable" (guarded)
  const log = execFileSync('git', ['log', '--format=%h %ad %s', '--date=short', '-15', '--', ...files], {cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: limits.timeoutMs ?? LIMITS.timeoutMs});
  return finish(`# git log -15 of ${files.join(' ')}`, log.trim() || '(no commits)', limits);
}
