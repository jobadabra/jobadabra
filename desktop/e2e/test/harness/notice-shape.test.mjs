// Guard: release — the nightly's skip notice named "Changed:" and "Flaky:" as suites and told a flaky step as "still red"; one loop holds every CI notice to one shape (title, one-line verdict, ≤3 bullets, a named link).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {nightlyNotice, parseGate} from '../../lib/nightly-alert.mjs';
import {notice} from '../../lib/notice.mjs';
import {STORE_KINDS, storeNotice} from '../../lib/store-notices.mjs';

const env = {GITHUB_REPOSITORY: 'o/r', GITHUB_RUN_ID: '5', GITHUB_SERVER_URL: 'https://github.com'};
const RECHECK = 'https://github.com/o/r/actions/runs/99';

// The gate's output as the owner's shot came from it: three changed steps and a flaky one under "apply", each indented, then the reasons it stops the beta.
const CHANGED_AND_FLAKY = `Main's e2e is red:
  apply (since 1234567, https://github.com/o/r/actions/runs/1)
Red suites: apply
Commits landed since: re-checking apply on main abcdef0 before the beta (about 10-15 min)...
Re-check: ${RECHECK}
Re-check failure: main is still red (${RECHECK}).
  Changed: “fills the form” differs from its newest green abc1234 (https://github.com/o/r/actions/runs/70) in src/a.py, src/b.py: a likely regression
  Changed: “asks the person” differs from its newest green abc1234 (https://github.com/o/r/actions/runs/70) in src/c.py: a likely regression
  Changed: “stop halts the fill” differs from its newest green abc1234 (https://github.com/o/r/actions/runs/70) in src/d.py: a likely regression
  Flaky: “saves the kit” passed on the same commit abcdef0 (https://github.com/o/r/actions/runs/71): fix the non-deterministic input it depends on, not the step
Red step: changed | fills the form | https://github.com/o/r/actions/runs/70
Red step: changed | asks the person | https://github.com/o/r/actions/runs/70
Red step: changed | stop halts the fill | https://github.com/o/r/actions/runs/70
Red step: flaky | saves the kit | https://github.com/o/r/actions/runs/71
Stops the beta: apply · Stop halts the fill: a safety step failed
Stops the beta: apply · Saves the kit: a data step failed
Stops the beta: apply · Asks the person: a safety step failed
No beta: fix the suite (skill fix-failing-e2e), or --force "<why>".
`;
const FLAKY_ONLY = `Main's e2e is red:
  apply (since 1234567, https://github.com/o/r/actions/runs/1)
  employers (since 1234567, https://github.com/o/r/actions/runs/1)
Red suites: apply,employers
Re-check: ${RECHECK}
Re-check failure: main is still red (${RECHECK}).
  Flaky: “saves the kit” passed on the same commit abcdef0 (https://github.com/o/r/actions/runs/71): fix the non-deterministic input it depends on, not the step
Red step: flaky | saves the kit | https://github.com/o/r/actions/runs/71
`;
// The same, with a reason that stops the beta on a suite whose results could not be read: that is not "flaky, not a regression".
const FLAKY_BUT_STOPPED = `${FLAKY_ONLY}Stops the beta: employers · results could not be read
`;
const UNREADABLE = "Could not read main's e2e state: unknown, not green.\nNo beta. Re-run, or --force \"<why>\".\n";

const NIGHTLY = [['changed steps and one flaky', CHANGED_AND_FLAKY], ['flaky only', FLAKY_ONLY], ['flaky but stopped', FLAKY_BUT_STOPPED], ['all four kinds', `${CHANGED_AND_FLAKY}Red step: unknown | a step | -\nRed step: broken | x | y | z\n`], ['state unreadable', UNREADABLE]];
const STORES = STORE_KINDS.map(kind => [kind, storeNotice(kind, {...env, TAG: 'v1.2.3', RUN: 'https://github.com/o/r/actions/runs/5'}).message]);

test('every CI notice has the one shape: bold title, a one-line verdict, at most 3 bullets, a named link, no raw URL', () => {
  for (const [name, message] of [...NIGHTLY.map(([name, log]) => [`nightly: ${name}`, nightlyNotice(log, env).message]), ...STORES.map(([kind, message]) => [`store: ${kind}`, message])]) {
    const text = message.text, rows = text.split('\n\n');
    assert.match(text, /^\S+ <b>[^<\n]+<\/b> [^\n]+/, `${name}: icon, title, then the verdict on the first line\n${text}`);
    assert.equal(message.parse_mode, 'HTML', name);
    const bullets = text.split('\n').filter(line => line.startsWith('• '));
    assert.ok(bullets.length <= 3, `${name}: ${bullets.length} bullets`);
    assert.ok(/<a href="https:\/\/[^"]+">Open the (run|re-check)<\/a>/.test(text), `${name}: a named link\n${text}`);
    assert.doesNotMatch(text.replace(/<a href="[^"]+">/g, ''), /https?:\/\//, `${name}: no bare URL`);
    assert.doesNotMatch(text, /;[^ ]|Changed:,|Flaky:,/, `${name}: no glued wall of text`);
    assert.ok(rows.length <= 3, `${name}: head, bullets, link`);
  }
});

test('the nightly notice names the suites the gate printed, never its indented "Changed:" and "Flaky:" lines', () => {
  assert.deepEqual(parseGate(CHANGED_AND_FLAKY).suites, ['apply']);
  assert.deepEqual(parseGate(FLAKY_ONLY).suites, ['apply', 'employers']);
  const {message, summary} = nightlyNotice(CHANGED_AND_FLAKY, env);
  assert.match(message.text, /Main&#39;s e2e is red on apply|Main's e2e is red on apply/);
  assert.doesNotMatch(summary, /Changed:|Flaky:/);
  assert.ok(!/apply,Changed|Changed:,/.test(message.text + summary));
});

test('a flaky step is told as flaky with the run that was green, never as "still red"', () => {
  const {message} = nightlyNotice(FLAKY_ONLY, env);
  assert.match(message.text, /flaky, not a regression/);
  assert.match(message.text, /Flaky: saves the kit: the same code was green in run 71/);
  assert.doesNotMatch(message.text, /still red/);
  assert.doesNotMatch(nightlyNotice(FLAKY_BUT_STOPPED, env).message.text, /not a regression/, 'a stop reason means it is not only flaky');
  assert.match(nightlyNotice(FLAKY_BUT_STOPPED, env).message.text, /Stops it: employers · results could not be read/);
  assert.match(nightlyNotice(CHANGED_AND_FLAKY, env).message.text, /Changed: fills the form/);
});

test('many steps and reasons are counted in one bullet per kind, not one row each and not glued with ";"', () => {
  const text = nightlyNotice(CHANGED_AND_FLAKY, env).message.text;
  assert.match(text, /• Stops it: apply · Stop halts the fill: a safety step failed \+2 more/, text);
  assert.match(text, /• Changed: fills the form: [^\n]+ \+2 more/, text);
  assert.match(text, /• Flaky: saves the kit: the same code was green in run 71\n/, text);
  assert.equal(notice({title: 't', bullets: ['a', 'b', 'c']}).text.includes('more'), false, 'exactly 3 bullets are all shown');
  assert.match(notice({title: 't', bullets: ['a', 'b', 'c', 'd']}).text, /• \+2 more/, 'a 4th kind is counted');
});

test('a step name with " | " and an unknown step keep the notice at 3 bullets and are not garbled', () => {
  const log = `Red suites: apply\nRed step: changed | a | b step | https://github.com/o/r/actions/runs/70\nRed step: unknown | c step | -\nRed step: half a row\nStops the beta: apply · x\n`;
  const {steps} = parseGate(log);
  assert.deepEqual(steps.map(one => [one.verdict, one.step, one.green]), [['changed', 'a | b step', 'https://github.com/o/r/actions/runs/70'], ['unknown', 'c step', '']]);
  const text = nightlyNotice(log, env).message.text;
  assert.equal(text.split('\n').filter(line => line.startsWith('• ')).length, 2, text);   // stops + (changed/unknown merged: first + 1 more)
  assert.match(text, /Changed: a \| b step[^\n]* \+1 more/);
});

test('an unreadable state says so and links the run', () => {
  const {message, summary} = nightlyNotice(UNREADABLE, env);
  assert.equal(summary, "Nightly skipped: Main's e2e state could not be read");
  assert.ok(message.text.includes('actions/runs/5">Open the run</a>'), message.text);
});

test('the store notices keep their one fix command and their own tag', () => {
  const {message, event, level} = storeNotice('chrome-store-publish', {...env, TAG: 'v1.2.3', RUN: 'https://github.com/o/r/actions/runs/5'});
  assert.equal(event, 'chrome-store-failed');
  assert.equal(level, 'problem');
  assert.match(message.text, /v1\.2\.3 is stable, but its Chrome Web Store publish failed/);
  assert.match(message.text, /gh workflow run extension-store-publish\.yml -R o\/r --ref main -f tag=v1\.2\.3/);
  assert.match(storeNotice('msix-store-weekly', env).message.text, /By hand: gh workflow run msix-store-weekly\.yml -R o\/r --ref main(?! -f)/);
});

test('no workflow or script hands send() a plain string: every notice goes through lib/notice.mjs', async () => {
  const {spawnSync} = await import('node:child_process');
  const root = new URL('../../../../', import.meta.url).pathname;
  const found = spawnSync('git', ['grep', '-n', '-e', 'send(process.env.MESSAGE', '--', '.github', 'tools', 'desktop/e2e', ':!*test*'], {cwd: root, encoding: 'utf8'});
  assert.equal(found.status, 1, `a plain-string alert (git grep exits 1 when there is none):\n${found.stdout}`);   // positive control: git grep itself ran (status 0 = hits, 128 = it could not run)
});
