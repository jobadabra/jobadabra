// Why an e2e suite went red (owner, 27 Oct 2026: "What are the biggest root causes? Is the flakiness? Is real bugs? ... code changed without adjusting the e2e?").
// ONE module shared by the collector (tools/ci-intel/jobs/e2e-intel.mjs) and the page: the red's own failure line first (the runner's "✗ step: reason"), then what is a fact (a
// cancelled job, a CI step that failed before the suite, the AI key's credit, a green second try), then the fix's own words (an "E2E-cause:" trailer), and only then
// an AI call with a fixed answer (CLAUDE.md "The AI decides"): no keyword list guesses drift, test bug or product bug. Rules 1-2 (18-24 Oct) read only the fix's
// files and left 49% of reds "unknown" or "not fixed yet" and "test bug" at 0. Guard: desktop/test/ci-intel-e2e-causes.test.js.

// group: who caused it. ours = our CI and AI plumbing, tests = the e2e tests, app = the product. The page sums by group first.
export const CAUSES = [
  {id: 'ai', group: 'ours', label: 'AI credit or answer', color: '#e5484d', hint: 'the AI key had no credit, the AI refused or was busy, or a live AI answer differed from the expected one'},
  {id: 'ci', group: 'ours', label: 'CI setup broke', color: '#9b7be0', hint: 'a CI step before the suite failed (install, relay, display, staging), or the fix changed only workflows or tools'},
  {id: 'picker', group: 'ours', label: 'PR step picker', color: '#7d63c4', hint: 'the PR\'s step picker named a step the suite does not have (renamed since the coverage map)'},
  {id: 'runner', group: 'ours', label: 'Runner', color: '#8d949c', hint: 'GitHub\'s runner was lost, cancelled or out of space, or the network dropped'},
  {id: 'flake', group: 'tests', label: 'Flake', color: '#f5b54a', hint: 'red, then green on the second try with the same code'},
  {id: 'timing', group: 'tests', label: 'Timing / budget', color: '#d9a03a', hint: 'a wait or the suite\'s time budget ran out'},
  {id: 'drift', group: 'tests', label: 'Test drift', color: '#e07b39', hint: 'the app changed and the test was not updated: the fix changed only the test, to follow the app'},
  {id: 'test', group: 'tests', label: 'Test bug', color: '#3987e5', hint: 'the test was wrong on its own (a race, a bad stub, a wrong assumption): the fix changed only the test, the app had not moved'},
  {id: 'product', group: 'app', label: 'Product bug', color: '#3fb68b', hint: 'the app was wrong: the fix changed the app, the extension or the engine'},
  {id: 'open', group: 'none', label: 'Not fixed yet', color: '#c2703d', hint: 'no later run of the suite has passed yet'},
  {id: 'unknown', group: 'none', label: 'Unknown', color: '#5b6b7a', hint: 'the run gave no failure line and its fix could not be named'},
];
export const CAUSE_IDS = CAUSES.map(cause => cause.id);
export const GROUPS = [{id: 'ours', label: 'Our CI and AI'}, {id: 'tests', label: 'The tests'}, {id: 'app', label: 'The app'}, {id: 'none', label: 'Not named yet'}];
/** The group id of a cause id ('none' when the cause is unknown). Reads CAUSES only. */
export const groupOf = id => CAUSES.find(cause => cause.id === id)?.group || 'none';
// Rows stored by rules 1-2 (before 27 Oct 2026), drawn under today's ids until the collector rewrites them.
export const LEGACY = {credit: 'ai', infra: 'runner'};
/** A stored cause id read under today's ids: a legacy id maps to its new one, anything else unknown is 'unknown'. */
export const causeId = id => LEGACY[id] || (CAUSE_IDS.includes(id) ? id : 'unknown');
/** The cause id of a red that caught a bug: the app was wrong (2 Nov 2026; before, only pull-request runs counted). */
export const CATCH_CAUSE = 'product';
/** cause id -> true when that red caught a bug (the product); false for any other id or none. One definition for the Testing card, the E2E scorecard and the collector's `caught` flag, on every run kind. */
export const isCatch = cause => cause === CATCH_CAUSE;
export const RULES_VERSION = 3;   // 3: every run kind, the failure line, trailers and the AI (27 Oct 2026)

// The causes the AI may give for a red that no fact names (the rest are facts the code reads).
export const AI_CAUSES = ['drift', 'test', 'product', 'ai', 'timing', 'unknown'];

const CREDIT = /insufficient_quota|credit balance is too low|exceeded your current quota|billing_hard_limit/i;
const RUNNER = /runner has received a shutdown signal|lost communication with the server|No space left on device|npm error code ECONNRESET|network aborted/i;
const PICKER = /steps picked for this PR: no step is named|picked step\(s\) not found/;
const AI_SAID = /the AI refused|AI limit reached|judge call failed|Free AI (?:is )?busy|rate limit|\b429\b|scores are not stable/i;
const BUDGET = /budget ran out|over its \d+-minute budget|did not finish within|silence limit|took [\d.]+ s to finish loading/i;
const NOT_RUN = /not run: the suite was over/;
const STAMP = /^﻿?\d{4}-\d\d-\d\dT[\d:.]+Z\s/;

// "E2E · Windows · apply" (a release run calls e2e.yml) or a job with the step "Run the apply suite (the only try)" (e2e.yml on its own; "(first try)" before 31 Oct 2026) -> {suite, platform}; else null.
// Why (2 Nov 2026, owner: "has this caught bug been counted?"): the step was renamed on 31 Oct (91976ad7) and this matched the old name only, so no red of a standalone e2e.yml run was read for two days.
export function suiteOfJob(name = '', steps = [], windows = false) {
  const match = /^E2E · (Windows|Mac \+ Linux) · (.+)$/.exec(name);
  if (match) return {suite: match[2].trim(), platform: match[1] === 'Windows' ? 'windows' : 'mac'};
  const step = (steps || []).map(item => /^Run the (\S+) suite(?: on Windows)?(?: \((?:first|the only) try\))?$/.exec(item.name || '')).find(Boolean);
  return step ? {suite: step[1], platform: windows || /Windows/.test(name) ? 'windows' : 'mac'} : null;
}
const isSuiteStep = name => /\bsuite\b|harness test|e2e tooling test/i.test(name || '');

// The red's own words from its log: the first "✗ step: reason" that is not "not run: over budget", else the first Error line, else the first ::error that is not an exit code.
export function failureLine(log = '') {
  const lines = String(log || '').split('\n').map(line => line.replace(STAMP, '').trim());
  const marks = lines.filter(line => /^(✗|✖) /.test(line) || /^not ok \d+ /.test(line));
  const pick = marks.find(line => !NOT_RUN.test(line)) || marks[0]
    || lines.find(line => /^(Error|tar|bash|npm error code)\b/.test(line)) || lines.find(line => /^##\[error\]/.test(line) && !/Process completed with exit code/.test(line)) || '';
  return pick.replace(/^##\[error\]/, '').replace(/\s+/g, ' ').slice(0, 220);
}

// What the facts name, or null when only the fix (a trailer, then the AI) can tell. facts: {jobConclusion, failedStep, log, line, rerun}.
export function factCause({jobConclusion, failedStep = '', log = '', line = '', rerun}) {
  if (jobConclusion === 'cancelled' || failedStep === 'Set up job' || RUNNER.test(log || '')) return 'runner';
  if (failedStep && !isSuiteStep(failedStep)) return 'ci';   // a CI step before the suite (the relay, the display, the install) failed: no step of the app ran
  if (PICKER.test(line)) return 'picker';   // before the second try: a picker red passes "once more", which runs the whole suite (26 Oct: 19 picker reds read as flakes)
  if (CREDIT.test(log || '')) return 'ai';
  if (rerun === 'success') return 'flake';
  if (AI_SAID.test(line)) return 'ai';
  if (BUDGET.test(line)) return 'timing';
  return null;
}

// "E2E-cause: drift apply, applyflows" in a fix's message -> 'drift' for those suites (no suite listed = every suite the commit fixes). Cause ids only.
// Why (2 Nov 2026, owner: "has this caught bug been counted?"): digits of 6+ are GitHub run ids, never suite names ("E2E-cause: product apply 41412195017"): the runs the fix closes.
/** A GitHub run id as the trailer writes it (6+ digits): never a suite name. The trailer gate imports this one. */
export const RUN_ID = /^\d{6,}$/;
export function trailerCauses(message = '') {
  return String(message).split('\n').map(line => /^E2E-cause:\s*([a-z]+)\b(.*)$/i.exec(line.trim())).filter(Boolean)
    .map(match => { const words = match[2].split(/[\s,]+/).map(word => word.trim()).filter(Boolean); return {cause: match[1].toLowerCase(), suites: words.filter(word => !RUN_ID.test(word)), runs: words.filter(word => RUN_ID.test(word))}; })
    .filter(item => CAUSE_IDS.includes(item.cause) && !['open', 'unknown'].includes(item.cause));
}
const baseOf = suite => String(suite).replace(/-\d+of\d+$/, '');   // "applyflows-1of2" is a slice of applyflows
const forSuite = (item, suite) => !item.suites.length || item.suites.some(name => name === baseOf(suite) || name === suite);
/** The window rule: commits between a red and the suite's next green, oldest first -> the first trailer for the suite. A trailer that names runs answers only those runs (namedCause). */
export function trailerCause(commits = [], suite = '') {
  for (const commit of commits) for (const item of trailerCauses(commit.message)) if (!item.runs.length && forSuite(item, suite)) return {cause: item.cause, sha: commit.sha};
  return null;
}
/** A fix that names the red's run id, in any main commit (newest first: a later word corrects an earlier one) -> {cause, sha}, or null. Wins over the window rule: an intermittent red gets its next green before its fix (2 Nov 2026: apply-1of3, #2986 was read for #2988). */
export function namedCause(commits = [], suite = '', runId = '') {
  for (const commit of commits) for (const item of trailerCauses(commit.message)) if (item.runs.includes(String(runId)) && forSuite(item, suite)) return {cause: item.cause, sha: commit.sha};
  return null;
}
/** The run ids a message's trailers name. */
export const namedRuns = (message = '') => trailerCauses(message).flatMap(item => item.runs);

// What a commit changed, in the AI's words: the app, the e2e tests, CI, or several.
const APP = /^(src\/|desktop\/(lib|renderer|main\.js|preload)|extension\/|worker\/src\/)/;
const TESTS = /^(desktop\/e2e\/|tests\/|desktop\/test\/|worker\/test\/)/;
const CI = /^(\.github\/|tools\/)/;
/** True when a repo path is app code (src, desktop libs and renderer, extension). */
export const isApp = file => APP.test(file);
/** Which kinds a commit's files touch, joined by '+' ('app+tests'); 'nothing' for an empty list. Pure: paths in, a string out. */
export function changedKinds(files = []) {
  const kinds = new Set(files.map(file => (APP.test(file) ? 'app' : TESTS.test(file) ? 'tests' : CI.test(file) ? 'ci' : 'other')));
  return ['app', 'tests', 'ci', 'other'].filter(kind => kinds.has(kind)).join('+') || 'nothing';
}
const STOP = new Set('the and for with from that this then when its not was are one two each after before your into only does were what which there their them they have has'.split(' '));
const words = text => new Set((String(text).toLowerCase().match(/[a-z]{4,}/g) || []).filter(word => !STOP.has(word)));
// The commits most likely to be the fix: shared words with the failure line, and the suite's own name or test file. A search for evidence; the AI judges it.
export function likelyFixes(commits = [], {suite = '', line = ''} = {}, max = 4) {
  const wanted = words(line), base = baseOf(suite);
  return commits.map(commit => {
    const have = words(commit.message);
    const score = [...wanted].filter(word => have.has(word)).length + (new RegExp(`\\b${base}\\b`, 'i').test(commit.message) ? 3 : 0) + ((commit.files || []).some(file => file.includes(`e2e/suites/${base}`)) ? 3 : 0);
    return {...commit, score};
  }).filter(commit => commit.score >= 3).sort((a, b) => b.score - a.score).slice(0, max);
}

export const DIFF_MAX = 2500;   // characters of each of the two likeliest fixes' diff the AI reads (27 Oct 2026: without the diff it agreed with a hand reading on 13 of 23)
// The AI's one question, with a fixed answer the code validates. Input: the red (suite, kind, failure line) and the likely fixes (subject + what each changed).
export function causePrompt({suite, kind, line, fixes = []}) {
  const body = message => String(message).split('\n').slice(1).filter(line => line.trim() && !/^[A-Z][\w-]+: /.test(line)).join(' ').replace(/\s+/g, ' ').slice(0, 400);   // the fix's own why, trailers left out
  const list = fixes.map((fix, i) => `${i + 1}. ${String(fix.message).split('\n')[0].slice(0, 120)}\n   why: ${body(fix.message) || '(no body)'}\n   files: ${(fix.files || []).slice(0, 8).join(', ') || '(unknown)'} [${changedKinds(fix.files)}]${fix.diff ? `\n   diff:\n${String(fix.diff).slice(0, DIFF_MAX)}` : ''}`).join('\n');
  return {system: 'You name why an end-to-end test step failed in CI, from its failure line and the commits that made it pass again. Answer only JSON: {"cause": one of '
    + `${AI_CAUSES.map(id => `"${id}"`).join(', ')}, "fix": the number of the fixing commit or 0}. drift = the app changed on purpose and the test was updated to follow it; `
    + 'test = the test itself was wrong (a race, a stub, a wrong wait or assumption) and only the test changed; product = the app was wrong and the app was fixed; '
    + 'ai = a live AI answer differed or the AI refused; timing = the fix only gave a slow step more time; unknown = the commits do not show it. '
    + 'Judge by what the fixing commit changed and why, not by the failure\'s wording: a timeout whose fix updates the test to the app\'s new screen or words is drift.',
  user: `Suite: ${suite} (${kind} run)\nFailure: ${line || '(no line)'}\nCommits between the red and the next green:\n${list}`};
}
// The AI's answer, validated: a listed cause and a commit number, or null (the red stays unknown, never a guess).
export function readAnswer(text = '') {
  try {
    const raw = String(text), data = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
    return AI_CAUSES.includes(data?.cause) ? {cause: data.cause, fix: Number.isInteger(data.fix) ? data.fix : 0} : null;
  } catch { return null; }
}

// A PR's red is judged on the PR itself: the push that turned the suite green changed the PR's own app files (a bug caught before merge) or only its tests
// (drift caught before merge); the same commit green again is a flake. prFiles: the files the PR changes; fixFiles: the files between the red and the green push.
export function prCause({sameCommit, fixFiles = [], prFiles = []}) {
  if (sameCommit) return 'flake';
  const own = fixFiles.filter(file => prFiles.includes(file));
  if (own.some(isApp)) return 'product';
  if (own.some(file => TESTS.test(file))) return 'drift';
  return own.length ? 'ci' : null;
}
