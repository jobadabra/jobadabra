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
  return {...finding, id: fingerprint(finding)};
}

/** The issue body: the Finder's layout, then the bundle's line (id, private link, the replay command) before the fingerprint comment. */
export function bodyOf(file, finding = findingOf(file)) {
  const body = issueBody(finding, file.bundleUrl || `bundle ${file.bundleId}`, {});
  const evidence = ['### Evidence bundle', `\`${file.bundleId}\` (private, Admin only): ${file.bundleUrl || 'see Admin → Testing → Bug bundles'}`, `Journey: ${file.report.journey || 'none'}. Replay it: \`cd desktop && npm run twin -- --replay ${file.bundleId}\``, ''].join('\n');
  return body.replace(/\n<!-- fingerprint:/, `\n${evidence}\n<!-- fingerprint:`);
}

/**
 * Files one finding file. -> {action: 'filed' | 'seen-again' | 'skipped', issue?, why?}. `gh` runs a GitHub CLI command and returns its output; a failure throws (the caller says which file).
 * A low report is skipped; an open issue with the same fp: label gets a comment with the new bundle instead of a second issue.
 */
export function fileFinding(file, {gh, repo = REPO} = {}) {
  if (!BUNDLE_ID.test(String(file.bundleId))) return {action: 'skipped', why: 'no usable bundle id'};
  if (file.report.severity === 'low') return {action: 'skipped', why: 'low severity is not filed; the bundle stays in Admin'};
  const finding = findingOf(file), label = labelFor(finding.id);
  const open = JSON.parse(gh(['issue', 'list', '--repo', repo, '--label', label, '--state', 'open', '--json', 'number', '--limit', '1']) || '[]');
  if (open.length) {
    gh(['issue', 'comment', String(open[0].number), '--repo', repo, '--body', `Seen again by Claude Desktop: bundle \`${file.bundleId}\` (${file.bundleUrl || 'private, Admin only'}).`]);
    return {action: 'seen-again', issue: open[0].number};
  }
  // Why (code review of 4a): a free-text journey ("J3, J4") would split into a label that does not exist, and the issue would fail to open.
  const journey = /^[\w.-]{1,40}$/.test(String(file.report.journey)) && file.report.journey !== 'none' ? [`journey:${file.report.journey}`] : [];
  const labels = [LABEL, label, ...labelsFor(finding), ...journey];
  for (const name of labels.slice(1)) gh(['label', 'create', name, '--repo', repo, '--force', '--color', name.startsWith('severity:high') ? 'D93F0B' : name.startsWith('severity:') ? 'FBCA04' : 'EDEDED']);
  const url = gh(['issue', 'create', '--repo', repo, '--title', issueTitle(finding), '--body', bodyOf(file, finding), '--label', labels.join(',')]);
  return {action: 'filed', issue: Number(url.split('/').pop()) || 0, url};
}

/**
 * Files every unfiled finding in `<home>/tester-findings`, moving each to `done/` (or `failed/` with the error beside it) so a restart never files one twice. `retryFailed` first moves failed/ back (one more try at the next start).
 * Never throws: a filing that cannot even be moved aside is reported and left, so one bad file cannot stop the launcher. -> [{file, ...result}]
 */
export function fileAll(home, {gh, repo, say = () => {}, retryFailed = false} = {}) {
  const dir = path.join(home, FINDINGS);
  if (!fs.existsSync(dir)) return [];
  const mine = /^[0-9a-f]{16}\.json$/, out = [];
  if (retryFailed && fs.existsSync(path.join(dir, 'failed'))) for (const name of fs.readdirSync(path.join(dir, 'failed')).filter(entry => mine.test(entry))) { try { fs.renameSync(path.join(dir, 'failed', name), path.join(dir, name)); } catch (error) { say(`tester bug ${name}: could not retry (${error.message})`); } }
  for (const name of fs.readdirSync(dir).filter(entry => mine.test(entry))) {
    const file = path.join(dir, name);
    let result;
    try { result = fileFinding(JSON.parse(fs.readFileSync(file, 'utf8')), {gh, repo}); } catch (error) { result = {action: 'failed', why: error.message}; }
    const target = path.join(dir, result.action === 'failed' ? 'failed' : 'done');
    try {
      fs.mkdirSync(target, {recursive: true});
      if (result.action === 'failed') fs.writeFileSync(path.join(target, `${name}.error.txt`), result.why);
      fs.renameSync(file, path.join(target, name));
    } catch (error) { result = {...result, why: `${result.why ? `${result.why}; ` : ''}could not move the file aside: ${error.message}`}; }
    say(`tester bug ${name.replace('.json', '')}: ${result.action}${result.issue ? ` #${result.issue}` : ''}${result.why ? ` (${result.why})` : ''}`);
    out.push({file: name, ...result});
  }
  return out;
}

/** Files what is there now and everything the app writes later. -> stop(), which files whatever is left once more. Why: fs.watch fires on the rename of a finished write, so no polling interval. */
export function watchFindings(home, options = {}) {
  const run = () => { try { fileAll(home, options); } catch (error) { (options.say || (() => {}))(`tester bugs: ${error.message}`); } };
  fs.mkdirSync(path.join(home, FINDINGS), {recursive: true});
  run();
  const watcher = fs.watch(path.join(home, FINDINGS), run);
  return () => { watcher.close(); run(); };
}
