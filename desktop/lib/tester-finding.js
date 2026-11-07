// The finding a desktop tester's bug leaves for the twin launcher to file as a GitHub issue (desktop/e2e/lib/tester-issue.mjs): the tester's sentences with the names of the job, its employer and the person
// removed, and the bundle's id and link. Written into the twin's own folder (tester-findings/<bundle id>.json) after the bundle is stored; the app never talks to GitHub.
// Why (7 Nov 2026, owner: GitHub issues hold product bugs only, "no real-data names"; spec 2026-11-07-ai-tester-bug-reports-design.md): the twin runs on the owner's real data, so a tester may type an employer or a job
// title into its report; the private bundle keeps the report as typed, the public issue never sees those words. Only strings the app knows are removed (the job row and session records, the e-mail): a person's name typed
// by the tester that the app does not hold is not caught, and the tester's skill text says not to write them.
// Guard: desktop/test/unit/main/tester-finding.test.js (names removed from every sentence; an id that is not a bundle id writes nothing).
import fs from 'node:fs';
import path from 'node:path';
import {writePrivate} from './private-file.js';
import {testerReport} from './tester-bundle.js';

export const FINDINGS_DIR = 'tester-findings';
const PERSON_KEY = /contact|recruiter|manager|person|name|e-?mail|phone/i;   // job-row fields that hold a person's words
const MIN_NAME = 3;

const LEGAL = /[\s,]+(?:inc|incorporated|corp|corporation|co|company|ltd|limited|llc|plc|gmbh|ag|sa|sarl|sas|bv|nv|ab|oy|srl|spa)\.?$/i;
/** The strings of the sessions, every job row and the e-mail that must not reach an issue: employer and job title (and the employer without its legal ending and its first word), the url and host of a job or session,
 *  any job-row field that holds a person's name, e-mail or phone, and the app's e-mail. -> unique strings, longest first
 *  Why (code review of 4a, 7 Nov 2026): the first version knew only the last session's job; a tester on the Jobs screen typed an employer the app held in another row, and "Acme Co" survived the removal of "Acme Corp". */
export function namesOf({sessions = [], jobs = [], job = null, email = ''} = {}) {
  const found = new Set();
  const add = value => { const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''; if (text.length >= MIN_NAME) found.add(text); };
  const addUrl = value => { add(value); try { add(new URL(String(value)).host.replace(/^www\./, '')); } catch { /* not a url */ } };
  const addCompany = value => { add(value); const bare = typeof value === 'string' ? value.replace(LEGAL, '').replace(/[,.]+$/, '').trim() : ''; add(bare); const first = bare.split(/\s+/)[0]; if (first && first.length >= 4) add(first); };
  for (const session of sessions) { addCompany(session?.company); add(session?.title); addUrl(session?.url); }
  for (const row of [...jobs, ...(job ? [job] : [])]) {
    if (!row || typeof row !== 'object') continue;
    addCompany(row.company); add(row.title); addUrl(row.url);
    for (const [key, value] of Object.entries(row)) if (PERSON_KEY.test(key)) add(value);
  }
  add(email); add(String(email).split('@')[0]);
  return [...found].sort((a, b) => b.length - a.length);
}

const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** `text` with each of `names` (whole words, any case and spacing, with a plural "s"/"es"/"'s" ending) replaced by "<removed>". */
export function scrub(text, names = []) {
  let out = String(text ?? '').replace(/[ \t]+/g, ' ');
  for (const name of names) out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escape(name).replace(/\s+/g, '\\s+')}(?:'s|es|s)?(?![\\p{L}\\p{N}])`, 'giu'), '<removed>');
  return out;
}

/**
 * The finding as the launcher reads it. `input`: what the tester typed ({title, journey, expected, seen, severity, steps}); it is scrubbed first and only then turned into a report, so a title that defaults to the
 * start of "seen" is cut after the names are gone, not through the middle of one. `bundle`: {id, url} from the upload. -> the finding, or null when the scrubbed input is no report
 */
export function findingOf({input, at, bundle, source, names = []}) {
  const clean = value => (Array.isArray(value) ? value.map(clean) : scrub(value, names));
  const {report} = testerReport({title: clean(input.title), journey: clean(input.journey), severity: input.severity, expected: clean(input.expected), seen: clean(input.seen), steps: clean(typeof input.steps === 'string' ? input.steps.split('\n') : input.steps || [])}, at);
  return report ? {version: 1, source, bundleId: bundle.id, bundleUrl: bundle.url || '', at: report.at, report} : null;
}

/** Writes tester-findings/<bundle id>.json in `folder` (the twin's data folder). Throws for an id that is not a bundle id (16 hex characters), so nothing is written outside the folder. -> the file */
export function writeFinding(folder, finding) {
  if (!finding) throw new Error('the report is empty once the names are removed');
  if (!/^[0-9a-f]{16}$/.test(String(finding.bundleId))) throw new Error('the bundle has no usable id');
  const dir = path.join(folder, FINDINGS_DIR);
  fs.mkdirSync(dir, {recursive: true});
  const file = path.join(dir, `${finding.bundleId}.json`);
  writePrivate(file, JSON.stringify(finding, null, 2));
  return file;
}
