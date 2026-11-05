// Tells the owner on Telegram when a release ends WITHOUT reaching testers or stable: a build failed, the E2E gate went red or did not run, a lane check failed, or a promotion to stable failed.
//   node release-failed-alert.mjs beta <version> [--gate true]     (the beta's last job; NEEDS = toJSON(needs) in the environment, not argv: it can be large; GITHUB_REPOSITORY, GITHUB_SERVER_URL, GITHUB_RUN_ID, SELFHEAL_PUBLISH_KEY, CI_ALERTS_TELEGRAM_* from the runner)
//   node release-failed-alert.mjs stable <version> --step "Promote to stable"                       (a promotion or store step that failed)
// Why (5 Nov 2026, owner: "I didn't get any notification. I should have"; beta 0.9.12, run 42056409953): release-alert.mjs only speaks when a lane was OFFERED, so a build that failed in both lanes was silent
// (9 of the last 28 betas failed; a beta started by hand had no alert path at all). This is the other half: the same sender (ci-alert.mjs send, switchboard event `release-failed`, old CI-alerts bot as fallback).
// A lane that WAS offered is not told here: release-alert.mjs says "offered on Mac only; Windows was not". A cancelled run says nothing. A failed alert never fails the release.
// Job: report health
import path from 'node:path';
import {alertHtml} from './lib/telegram-html.mjs';
import {send} from './ci-alert.mjs';

const EVENT = 'release-failed';
// Per lane, the stages of the beta in order; the first that is not green is where the lane stopped (the later ones were skipped because of it).
const LANES = [
  {lane: 'Mac', stages: [['build', 'Build'], ['test-mac', 'E2E gate'], ['release-mac', 'Lane check'], ['release-mac-offer', 'Offer']]},
  {lane: 'Windows', stages: [['windows', 'Build'], ['test-windows', 'E2E gate'], ['release-windows', 'Lane check'], ['release-windows-offer', 'Offer']]},
];
const resultOf = (needs, job) => needs?.[job]?.result || 'skipped';

/** The lanes of a beta that did not reach testers -> [{lane, step, result}]; `gate` false (a build only) looks at the build alone. */
export function failedLanes(needs, {gate = true} = {}) {
  const out = [];
  for (const {lane, stages} of LANES) {
    const stopped = stages.slice(0, gate ? stages.length : 1).find(([job]) => resultOf(needs, job) !== 'success');
    if (stopped) out.push({lane, step: stopped[1], result: resultOf(needs, stopped[0])});
  }
  return out;
}

/** Only the word `true` means the run had an E2E gate: a build-only run leaves the output EMPTY (its plan step is skipped), and empty must not read as gated (code review of 3/4b). */
export const gateOf = value => String(value ?? '').trim() === 'true';

const said = result => (result === 'failure' ? 'failed' : result === 'cancelled' ? 'was cancelled' : 'did not run');

/** The Telegram message: what did not ship, where each lane stopped, the run. */
export function failedMessage({kind, version, lanes, env = process.env}) {
  const server = env.GITHUB_SERVER_URL || 'https://github.com', repo = env.GITHUB_REPOSITORY || '';
  const run = env.GITHUB_RUN_ID && repo ? `${server}/${repo}/actions/runs/${env.GITHUB_RUN_ID}` : '';
  const word = kind === 'stable' ? 'Stable' : 'Beta';
  return alertHtml({icon: '🔴', title: `${word} ${version} did not ship`, verdict: kind === 'stable' ? 'It was not promoted to stable' : 'No lane was offered to beta testers',
    bullets: lanes.map(({lane, step, result}) => ({label: lane, parts: [`${step} ${said(result)}`]})), links: run ? [{text: 'Open the run', url: run}] : []});
}

/** Decides and sends; returns the line to print. Never throws, never prints a token. */
export async function alertReleaseFailed({kind = 'beta', version, needs = {}, lanes = null, gate = true, env = process.env, fetcher = fetch}) {
  try {
    const stopped = lanes || failedLanes(needs, {gate});
    const offered = !lanes && LANES.some(({stages}) => resultOf(needs, stages.at(-1)[0]) === 'success');
    // A cancelled RUN never gets here (the workflow step is `!cancelled()`); a job that timed out may read `cancelled` and is told as "was cancelled" (code review of 3/4b: a hang must not be silent).
    if (!version || !stopped.length || offered) return 'release-failed-alert: nothing to tell (a lane was offered, or nothing failed)';
    return await send(failedMessage({kind, version, lanes: stopped, env}), env, fetcher, {event: EVENT});
  } catch (error) { return `release-failed-alert: not sent (${String(error?.name || 'error')})`; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const [kind, version, ...rest] = process.argv.slice(2);
  const flag = name => { const at = rest.indexOf(name); return at >= 0 ? rest[at + 1] : undefined; };
  const needs = JSON.parse(flag('--needs') || process.env.NEEDS || '{}');
  const step = flag('--step');
  console.log(await alertReleaseFailed({kind, version: String(version || '').replace(/^desktop-v/, ''), needs, gate: gateOf(flag('--gate') ?? process.env.GATE),
    lanes: step ? [{lane: 'Stable', step, result: 'failure'}] : null}));
}
