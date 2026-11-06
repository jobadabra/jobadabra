// Publishes PR screenshots under a git tag (never a release: a release can become "Latest") and prints their raw URLs:
// node tools/pr-assets.mjs <tag, e.g. pr-assets-<branch>> <file.png>... [--repo=<owner/repo>]
// The images are hosted in the repo that owns the PR: --repo (or GITHUB_REPOSITORY) names it; a PR in the private site repo uses --repo=jobadabra/jobadabra-web.
// The URL is github.com/<repo>/raw/<tag>/<file>, not raw.githubusercontent.com: measured 25 Oct 2026 on the private jobadabra-lab (a probe issue, opened in the browser),
// the raw.githubusercontent.com image did not render, the github.com/.../raw/... one did (for anyone who can open the repo, so also after jobadabra-web goes private on 1 Nov).
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {publishFiles} from '../desktop/e2e/lib/evidence.mjs';
import {PUBLIC_REPO} from '../desktop/e2e/lib/repos.mjs';

// The image URL a PR body uses, for a public or a private repo. Parentheses are encoded: an unescaped ')' ends a markdown image URL early (review, 6 Nov 2026).
export const imageUrl = (repo, tag, file) => `https://github.com/${repo}/raw/${tag}/${file.split('/').map(part => encodeURIComponent(part).replace(/[()]/g, c => c === '(' ? '%28' : '%29')).join('/')}`;

// A tag with a branch's name is the #3321 trap. Why (6 Nov 2026, owner: "some PRs have broken screenshots in the before/after"; jobadabra#3321): github.com/<repo>/raw/<name>/<file> resolves a branch
// before a tag, so the images 404 for as long as the branch lives. Returns the refusal text, or null when no branch has that name.
export function branchNameRefusal(tag, repo, heads) {
  return heads.includes(tag) ? `pr-assets: "${tag}" is also a branch of ${repo}, and github.com/${repo}/raw/${tag}/... would resolve to the branch (404 images): use the tag pr-assets-<branch>` : null;
}

// The branch names of the remote that equal `tag` (empty when none, or when the remote cannot be asked: the tag push then fails on its own).
export function branchesNamed(tag, remote) {
  try { return execFileSync('git', ['ls-remote', '--heads', remote, tag], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).split('\n').filter(Boolean).map(line => line.split('\trefs/heads/')[1]); }
  catch { return []; }
}

export function parseArgs(argv, env = {}) {
  const repoFlag = argv.find(arg => arg.startsWith('--repo='));
  const [tag, ...files] = argv.filter(arg => !arg.startsWith('--repo='));
  return {tag, files, repo: repoFlag ? repoFlag.slice('--repo='.length) : env.GITHUB_REPOSITORY || PUBLIC_REPO};
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const {tag, files, repo} = parseArgs(process.argv.slice(2), process.env);
  if (!tag || !files.length || !/^[^/\s]+\/[^/\s]+$/.test(repo)) { console.error('usage: node tools/pr-assets.mjs <tag, e.g. pr-assets-<branch>> <file.png>... [--repo=<owner/repo>]'); process.exit(2); }
  const remote = `https://github.com/${repo}.git`;
  const refusal = branchNameRefusal(tag, repo, branchesNamed(tag, remote));
  if (refusal) { console.error(refusal); process.exit(2); }
  const out = publishFiles({repo, tag, message: `PR images ${tag}`, files: files.map(from => ({from, to: path.basename(from)})), remote});
  for (const [file, url] of Object.entries(out)) console.log(imageUrl(repo, url.split('/')[5], file));   // the tag may carry a number when its name was taken: read it back from the published URL
}
