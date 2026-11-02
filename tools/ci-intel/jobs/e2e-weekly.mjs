#!/usr/bin/env node
// Posts the weekly e2e summary (tools/ci-intel/lib/e2e-weekly.mjs) as one GitHub issue in this repo and one Telegram message on the CI alerts bot (e2e-weekly.yml, Mondays).
//   node tools/ci-intel/jobs/e2e-weekly.mjs [--dry-run]      --dry-run prints the issue and the message instead of posting them
// Reads the snapshot /admin/testing/e2e draws (GET /e2e/data?snapshot=1, SELFHEAL_PUBLISH_KEY), so the page, the issue and Telegram show the same numbers.
// Why (2 Nov 2026, owner: the CI collectors live beside the tests they measure): the issue is filed in THIS repo, the one whose token runs the job; it was in jobadabra-web (spec rule D, 28 Oct 2026:
// "the e2e analysis stays private"), and tools/e2e_weekly.py filed one here before that, so the week's causes are public again as they were until 2 Nov. Set ISSUE_REPO to write elsewhere (needs a token that can).
// Replaced tools/e2e_weekly.py (its own classifier) in the same change, so one job writes the report.
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {issueBody, issueTitle, telegramText, weekly} from '../lib/e2e-weekly.mjs';
import {tellOwner} from '../lib/ai-refusal.mjs';

const base = process.env.E2E_INTEL_URL || 'https://www.jobpilotto.top/e2e/data', key = process.env.SELFHEAL_PUBLISH_KEY;
const repo = process.env.ISSUE_REPO || process.env.GITHUB_REPOSITORY || 'jobadabra/jobadabra', LABEL = 'e2e-weekly';
const gh = (...args) => execFileSync('gh', args, {encoding: 'utf8'}).trim();

/** Creates this week's issue, or rewrites it when the job runs again the same day; returns its URL. */
function writeIssue(title, body) {
  gh('label', 'create', LABEL, '-R', repo, '--force', '--color', '1D76DB', '--description', 'The weekly e2e summary (tools/ci-intel/jobs/e2e-weekly.mjs)');
  const same = JSON.parse(gh('issue', 'list', '-R', repo, '--label', LABEL, '--state', 'all', '--limit', '20', '--json', 'number,title,url')).find(issue => issue.title === title);
  if (!same) return gh('issue', 'create', '-R', repo, '--title', title, '--label', LABEL, '--body', body);
  gh('issue', 'edit', String(same.number), '-R', repo, '--body', body);
  return same.url;
}

async function main() {
  if (!key) throw new Error('SELFHEAL_PUBLISH_KEY is not set: the snapshot cannot be read');
  const response = await fetch(`${base}?snapshot=1`, {headers: {Authorization: `Bearer ${key}`}});
  if (!response.ok) throw new Error(`the site answered ${response.status} for the e2e snapshot`);
  const s = weekly(await response.json());
  if (process.argv.includes('--dry-run')) { console.log(`# ${issueTitle(s)}\n\n${issueBody(s)}\n\n---\n${telegramText(s)}`); return; }
  await deliver(s);
}

/**
 * Writes the week's issue, then the Telegram message linking it. Throws when the message did not go out, so the run is red: tellOwner never throws
 * (a missing token, a non-2xx answer, no network → {skipped}). Why (#211, Gitar): a green run with no Monday message went unseen.
 */
export async function deliver(s, {write = writeIssue, tell = tellOwner} = {}) {
  const url = write(issueTitle(s), issueBody(s));
  console.log(`${issueTitle(s)}: ${url}`);
  const told = await tell(telegramText(s, url));
  console.log(`Telegram: ${JSON.stringify(told)}`);
  if (!told?.sent) throw new Error(`the weekly message did not reach Telegram (${told?.skipped || 'no answer'}); the issue is at ${url}`);
  return url;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main().catch(error => { console.error(`::error::${error.message}`); process.exit(1); });
