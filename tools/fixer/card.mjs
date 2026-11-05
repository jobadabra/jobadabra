// What the AI fixer tells a feedback card when its run ends (web 5/5a, 5 Nov 2026; owner: "Button starts the new agent"): ONE report to the site, in fixed words only.
//   node card.mjs       env: REF (the card's 16 hex), REPO, PR_NUMBER (the draft PR, or ''), VERDICT and BLOCKED (the run record's words)
// Why (5 Nov 2026): the site holds a clicked card in `ai_running` for an hour (and lets no other card start) until its run reports, then calls it failed. The report carries a pull request link we made, a verdict
// word and a blocked_by word from the record: never the agent's reason or any text of the card (the repository is PUBLIC and so is this log). Guard: desktop/test/tooling/ci/fixer-card.test.js.
import {pathToFileURL} from 'node:url';
import {REF, VERDICTS, report} from '../feedback-ai.mjs';
import {BLOCKED} from './record.mjs';

const FAILED = ['run-failed', 'tests-failed', 'publish-failed', 'steps', 'time', 'broker', 'conflict', 'same-failure', 'round-failed', 'rounds'];

/** The site report of a finished first run: {ref, status: 'pr', pr} when a draft PR opened; {ref, status: 'none', verdict, why} when the agent changed nothing and said why; else {ref, status: 'failed', why}. `why` is always a word of the record's blocked_by list. null for a bad handle. */
export function cardBody({ref, repo, pr, verdict, blocked}) {
  if (!REF.test(String(ref))) return null;
  const number = /^[1-9]\d{0,6}$/.test(String(pr)) ? String(pr) : '';
  if (number && /^[\w.-]+\/[\w.-]+$/.test(String(repo))) return {ref, status: 'pr', pr: `https://github.com/${repo}/pull/${number}`};
  const why = BLOCKED.includes(blocked) ? blocked : 'run-failed';
  if (!FAILED.includes(why) && VERDICTS.includes(verdict)) return {ref, status: 'none', verdict, why};
  return {ref, status: 'failed', why: FAILED.includes(why) ? why : 'run-failed'};
}

async function main(env = process.env) {
  const body = cardBody({ref: env.REF, repo: env.REPO, pr: env.PR_NUMBER, verdict: env.VERDICT, blocked: env.BLOCKED});
  if (!body) return console.log('not a card run: nothing to tell');
  try { await report(body, env); console.log(`told the card: ${body.status}${body.why ? ` (${body.why})` : ''}`); }
  catch (error) { console.log(`the card was not told: ${String(error.message).slice(0, 200)}`); }   // a run that never took the brief owns no card: the site refuses and the card ages out; never a red job
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
