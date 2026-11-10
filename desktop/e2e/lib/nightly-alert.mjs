// The "Nightly skipped" notice, read from tools/red-main-gate.sh's own machine lines, never from its indentation:
//   Red suites: apply,employers                       (the suites the gate found red)
//   Red step: flaky | <step> | <green run url or ->   (one per red step of the re-check: flaky | changed | unknown)
//   Stops the beta: <suite · step: why>               (a safety or data step, or unreadable results)
//   Re-check: <run url>
// nightlyNotice(log, env) -> {message, summary}: the Telegram payload and the one plain line for the job log.
// Why (8 Nov 2026, owner: "let's improve the text formatting/style" and "solve the underlying issues of this errors"): the workflow awk'd every indented line under "Main's e2e is red:", so the gate's
// "  Changed: …" and "  Flaky: …" lines were sent as suites ("apply,Changed:,Changed:,Changed:"), the reasons were glued with ";" and a flaky step was told as "still red".
// Job: report health
import {notice} from './notice.mjs';

const lines = (log, prefix) => String(log).split('\n').filter(line => line.startsWith(prefix)).map(line => line.slice(prefix.length).trim());
const short = url => String(url).replace(/^.*\/actions\/runs\//, 'run ');

/** The facts of one gate log: {suites, steps: [{verdict, step, green}], stops, recheck}. Only unindented machine lines count. */
export function parseGate(log) {
  const suites = [...new Set(lines(log, 'Red suites:').flatMap(list => list.split(',')).map(one => one.trim()).filter(Boolean))];
  const steps = lines(log, 'Red step:').map(row => row.split(' | ').map(one => one.trim())).filter(fields => fields.length >= 3)   // verdict first, url last, the step name in between (it may hold " | ")
    .map(fields => ({verdict: fields[0], step: fields.slice(1, -1).join(' | '), green: fields.at(-1) !== '-' ? fields.at(-1) : ''}));
  return {suites, steps, stops: lines(log, 'Stops the beta:'), recheck: lines(log, 'Re-check:').at(-1) || ''};
}

const more = (count, text) => (count > 1 ? `${text} +${count - 1} more` : text);
// One bullet per kind of finding (reasons it stops, changed, flaky, unknown), each naming the first and counting the rest: a few words, never one row per step.
// An unknown step (no green to compare with) is told with the changed ones: the verdict errs towards "changed" (lib/flaky-verdict.mjs), and three kinds keep the notice at 3 bullets.
const WORDS = {
  changed: one => (one.verdict === 'unknown' ? `Unknown: ${one.step}: no green to compare with` : `Changed: ${one.step}: its files differ from the last green (a likely regression)`),
  flaky: one => `Flaky: ${one.step}: the same code was green in ${one.green ? short(one.green) : 'an earlier run'}`,
};

/** Takes the gate's log text and env (GITHUB_*); returns {message, summary}. */
export function nightlyNotice(log, env = process.env) {
  const {suites, steps, stops, recheck} = parseGate(log);
  const run = recheck || `${env.GITHUB_SERVER_URL || 'https://github.com'}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`;
  const flakyOnly = !stops.length && steps.length > 0 && steps.every(one => one.verdict === 'flaky');   // a stop reason means something real stopped the beta: never "not a regression"
  const verdict = !suites.length ? "Main's e2e state could not be read" : `Main's e2e is red on ${suites.join(', ')}${flakyOnly ? ': flaky, not a regression' : ''}`;
  // Why (10 Nov 2026, owner: every message reads like the Central scout one): the headline carries the cause, the one verdict line says what happened to the nightly.
  const headline = !suites.length ? 'Nightly skipped: main could not be read' : `Nightly skipped: main is red on ${suites.join(', ')}`;
  const bullets = [...(stops.length ? [more(stops.length, `Stops it: ${stops[0]}`)] : []),
    ...Object.keys(WORDS).flatMap(kind => { const same = steps.filter(one => (kind === 'changed' ? one.verdict !== 'flaky' : one.verdict === kind)); return same.length ? [more(same.length, WORDS[kind](same[0]))] : []; })];
  const summary = `Nightly skipped: ${verdict}${stops.length ? ` — ${stops.join(' · ')}` : ''}`;
  return {message: notice({title: headline, verdict: flakyOnly ? 'Flaky, not a regression: the nightly did not run.' : 'The nightly did not run.', bullets, run, linkText: recheck ? 'Open the re-check' : 'Open the run'}), summary};
}
