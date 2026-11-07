// Files the GitHub issue of a desktop tester's bug: the twin launcher reads each tester-findings/<bundle id>.json the app wrote (desktop/lib/tester-finding.js) and makes the issue through the Finder's own text and labels
// (lib/triage-issues.mjs issueBody/labelsFor, fingerprint dedupe by the fp: label), so a bug from Claude Desktop looks and is found like every other. The issue carries the tester's sentences and the bundle's link; no picture, log or state.
// Why (7 Nov 2026, owner: Claude Desktop "can't it just fill using send feedback… or filling github issues directly?"; spec 2026-11-07-ai-tester-bug-reports-design.md): filing is the launcher's, not the app's, so the app holds no GitHub credential.
// Low severity is not filed (the Finder's rule, owner 4 Oct 2026): the bundle stays and is listed in Admin → Testing → Bug bundles.
// Job: report health
// Guard: desktop/e2e/test/harness/tester-issue.test.mjs (the body has no picture or log; a second report of the same bug is a comment; low is not filed).
import fs from 'node:fs';
import path from 'node:path';
import {fingerprint} from './vision.mjs';
import {PUBLIC_REPO} from './repos.mjs';
import {issueBody, labelsFor} from './triage-issues.mjs';
import {LABEL, issueTitle, labelFor} from './triage-findings.mjs';

export const REPO = process.env.GITHUB_REPOSITORY || PUBLIC_REPO;
const FINDINGS = 'tester-findings';
const BUNDLE_ID = /^[0-9a-f]{16}$/;

/** The Finder finding of a tester file. view is "app" (the tester names a journey, not a screen), kind "functionality"; the id is the Finder's fingerprint of view, kind and title. */
export function findingOf(file) {
  const {report} = file;
  const steps = (report.steps || []).map((step, index) => `${index + 1}. ${step}`).join('\n');
  const finding = {view: 'app', severity: report.severity, kind: 'functionality', title: String(report.title || report.seen).slice(0, 80), source: 'desktop-tester',
    detail: `${report.seen}${steps ? `\n\nSteps:\n${steps}` : ''}`, expected: report.expected};
  const evidence = {id: file.bundleId, url: file.bundleUrl || 'see Admin → Testing → Bug bundles', line: `Journey: ${report.journey || 'none'}. Replay it: \`cd desktop && npm run twin -- --replay ${file.bundleId}\``};
  return {...finding, id: fingerprint(finding), evidence};
}

/** The issue body: the Finder's layout, with the bundle's block (id, private link, the replay command) from the shared renderer (lib/triage-issues.mjs evidenceBundle). */
export const bodyOf = (file, finding = findingOf(file)) => issueBody(finding, file.bundleUrl || `bundle ${file.bundleId}`, {});

/**
 * Files one finding file. -> {action: 'filed' | 'seen-again' | 'skipped', issue?, why?}. `gh` runs a GitHub CLI command and returns its output; a failure throws (the caller says which file).
 * A low report is skipped; an open issue with the same fp: label gets a comment with the new bundle instead of a second issue.
 */
export async function fileFinding(file, {gh, repo = REPO} = {}) {
  if (!BUNDLE_ID.test(String(file.bundleId))) return {action: 'skipped', why: 'no usable bundle id'};
  if (file.report.severity === 'low') return {action: 'skipped', why: 'low severity is not filed; the bundle stays in Admin'};
  const finding = findingOf(file), label = labelFor(finding.id);
  const open = JSON.parse(await gh(['issue', 'list', '--repo', repo, '--label', label, '--state', 'open', '--json', 'number', '--limit', '1']) || '[]');
  if (open.length) {
    await gh(['issue', 'comment', String(open[0].number), '--repo', repo, '--body', `Seen again by Claude Desktop: bundle \`${file.bundleId}\` (${file.bundleUrl || 'private, Admin only'}).`]);
    return {action: 'seen-again', issue: open[0].number};
  }
  // Why (code review of 4a): a free-text journey ("J3, J4") would split into a label that does not exist, and the issue would fail to open.
  const journey = /^[\w.-]{1,40}$/.test(String(file.report.journey)) && file.report.journey !== 'none' ? [`journey:${file.report.journey}`] : [];
  const labels = [LABEL, label, ...labelsFor(finding), ...journey];
  for (const name of labels.slice(1)) await gh(['label', 'create', name, '--repo', repo, '--force', '--color', name.startsWith('severity:high') ? 'D93F0B' : name.startsWith('severity:') ? 'FBCA04' : 'EDEDED']);
  const url = await gh(['issue', 'create', '--repo', repo, '--title', issueTitle(finding), '--body', bodyOf(file, finding), '--label', labels.join(',')]);
  return {action: 'filed', issue: Number(url.split('/').pop()) || 0, url};
}

const MINE = /^[0-9a-f]{16}\.json$/;
/** Moves failed/ back next to the unfiled ones (one more try at the next start). */
function takeBackFailed(dir, say) {
  const failed = path.join(dir, 'failed');
  if (!fs.existsSync(failed)) return;
  for (const name of fs.readdirSync(failed).filter(entry => MINE.test(entry))) {
    try { fs.renameSync(path.join(failed, name), path.join(dir, name)); } catch (error) { say(`tester bug ${name}: could not retry (${error.message})`); }
  }
}

/** Files one finding file and moves it to done/ or, with its error beside it, failed/. Never throws: a file that cannot be moved aside is reported and left. -> {action, issue?, why?} */
async function settle(dir, name, {gh, repo}) {
  const file = path.join(dir, name);
  let result;
  try { result = await fileFinding(JSON.parse(fs.readFileSync(file, 'utf8')), {gh, repo}); } catch (error) { result = {action: 'failed', why: error.message}; }
  const target = path.join(dir, result.action === 'failed' ? 'failed' : 'done');
  try {
    fs.mkdirSync(target, {recursive: true});
    if (result.action === 'failed') fs.writeFileSync(path.join(target, `${name}.error.txt`), result.why);
    fs.renameSync(file, path.join(target, name));
  } catch (error) { result = {...result, why: `${result.why ? `${result.why}; ` : ''}could not move the file aside: ${error.message}`}; }
  return result;
}

/**
 * Files every unfiled finding in `<home>/tester-findings`, so a restart never files one twice. `retryFailed` first takes failed/ back. Never throws. -> [{file, ...result}]
 */
export async function fileAll(home, {gh, repo, say = () => {}, retryFailed = false} = {}) {
  const dir = path.join(home, FINDINGS);
  if (!fs.existsSync(dir)) return [];
  if (retryFailed) takeBackFailed(dir, say);
  const out = [];
  for (const name of fs.readdirSync(dir).filter(entry => MINE.test(entry))) {   // one at a time: a second watch event waits for this one (see watchFindings)
    const result = await settle(dir, name, {gh, repo});
    say(`tester bug ${name.replace('.json', '')}: ${result.action}${result.issue ? ` #${result.issue}` : ''}${result.why ? ` (${result.why})` : ''}`);
    out.push({file: name, ...result});
  }
  return out;
}

/** What the last twin run left (HOME is replaced at each start): one more try, never an error for the caller. `enabled` false does nothing (no Admin key, so no tester mode, so no findings). */
export async function flushLeftovers(home, {enabled = true, say = () => {}, ...options} = {}) {
  if (!enabled) return;
  try { await fileAll(home, {...options, say, retryFailed: true}); } catch (error) { say(`tester bugs left from the last run were not filed: ${error.message}`); }
}

/**
 * Files what is there now and everything the app writes later. -> stop(), which closes the watch and resolves when the filing in progress and one last pass are done.
 * Why: fs.watch fires on the rename of a finished write, so no polling interval; the runs are chained so two events never file the same finding twice, and `gh` is asynchronous so a hung network never blocks the launcher (Gitar on #3441).
 */
export function watchFindings(home, {enabled = true, ...options} = {}) {
  if (!enabled) return async () => {};
  let chain = Promise.resolve();
  const run = () => { chain = chain.then(() => fileAll(home, options)).catch(error => (options.say || (() => {}))(`tester bugs: ${error.message}`)); return chain; };
  fs.mkdirSync(path.join(home, FINDINGS), {recursive: true});
  run();
  const watcher = fs.watch(path.join(home, FINDINGS), run);
  return async () => { watcher.close(); await run(); };
}
