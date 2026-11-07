// What the AI persona is told about its own closed false alarms: a persona issue closed as "by design" becomes one line of knowledge for its area, read by the actor and the judge on the next run.
// Job: report health
// Why (7 Nov 2026, pz, owner via mac-50: "So what's the root cause of these false alarms?" / "are we treating the root cause?"; batch 1 of the lanes: 3 real of 9, and 4 of the 6 false cited no rule, only "general UX"):
// nothing in the persona's code read a closed issue, so a by-design fact the verdict pass had written down in a comment (the Large text size is 100% on a laptop display; the Jobs bar lists the profile's items) reached the next run only if a person wrote a rule for it.
// The fourth layer of the persona's knowledge (rules: people; field notes: the agent; changed since: git; closed verdicts: the verdict pass on a closed issue) has one writer, so it cannot drift: it is COMPUTED from GitHub at run start, never stored, and a lane reads it like a night.
// Only `resolution:by-design` teaches: a detector or harness false positive says nothing about the app, and a duplicate says nothing the first issue does not.
// Guard: desktop/e2e/test/pool/agent-closed.test.mjs.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {areaOfView} from './agent-knowledge.mjs';
import {textOfTitle} from './finder-prefix.mjs';
import {whyOf} from './verdict-comment.mjs';

/** How many closed verdicts one area keeps in the prompt (newest first): the area's rules and notes share the same 3000-token cap, and an old closure is the first to go. */
export const PER_AREA = 10;
const WHY_CHARS = 240;
const FALSE_VERDICT = /^<!-- ui-loop-verdict:false-positive -->/;

/** A verdict's Why as one short sentence for a prompt: code references removed (a persona cannot open a file), cut at a sentence end within WHY_CHARS. */
export function shortWhy(text) {
  const plain = String(text || '').replace(/\s*\([^()]*\b(?:desktop|src|tests|tools|extension)\/[^()]*\)/g, '').replace(/\s+/g, ' ').trim();
  if (plain.length <= WHY_CHARS) return plain;
  const cut = plain.slice(0, WHY_CHARS), end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '));
  return end > 60 ? cut.slice(0, end + 1) : `${cut.trimEnd()}…`;
}

const labelNames = issue => (issue.labels || []).map(label => String(label.name || label));
const hasLabel = (issue, name) => labelNames(issue).includes(name);

/**
 * The closed verdicts of persona issues as lessons per area. `issues`: `gh issue list --state closed --json number,title,labels,comments,closedAt` rows.
 * -> {Area: [{id: 'closed-<n>', number, text, why, at}]} newest first, at most PER_AREA each. An issue counts when it is the persona's (`source:ai-user-agent`), closed as by design (`resolution:by-design`),
 * names its screen (`view:<x>`) and carries a verdict comment of the loop saying why; one without any of these teaches nothing and is skipped, never guessed.
 */
export function closedLessons(issues) {
  const byArea = {};
  for (const issue of issues || []) {
    if (!hasLabel(issue, 'source:ai-user-agent') || !hasLabel(issue, 'resolution:by-design')) continue;
    const view = labelNames(issue).find(name => name.startsWith('view:'))?.slice(5);
    const verdict = [...(issue.comments || [])].reverse().find(comment => FALSE_VERDICT.test(String(comment.body || '')));
    const why = shortWhy(whyOf(verdict?.body));
    if (!view || !why) continue;
    (byArea[areaOfView(view)] ||= []).push({id: `closed-${issue.number}`, number: issue.number, text: textOfTitle(issue.title).slice(0, 120), why, at: String(issue.closedAt || '')});
  }
  for (const area of Object.keys(byArea)) byArea[area] = byArea[area].sort((a, b) => b.at.localeCompare(a.at) || b.number - a.number).slice(0, PER_AREA);
  return byArea;
}

/** The persona's closed by-design issues from GitHub (`gh` injected for tests). A failed read is an error, never an empty list that looks like "nothing was ever closed". */
export const fetchClosed = (gh = args => execFileSync('gh', args, {encoding: 'utf8', maxBuffer: 50 * 1024 * 1024}), repo = process.env.GITHUB_REPOSITORY || 'jobadabra/jobadabra') =>
  JSON.parse(gh(['issue', 'list', '--repo', repo, '--label', 'source:ai-user-agent', '--label', 'resolution:by-design', '--state', 'closed', '--limit', '200', '--json', 'number,title,labels,comments,closedAt']));

/** The file the suite reads (`AGENT_CLOSED_FILE`): {Area: [lesson]}, or {} when the variable is unset or the file does not exist (a local run, a replay). A file that is not JSON is an error. */
export function readClosed(file = process.env.AGENT_CLOSED_FILE) {
  return file && fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const out = process.argv[2];
  if (!out) throw new Error('usage: node lib/agent-closed.mjs <out.json>');
  const lessons = closedLessons(fetchClosed());
  fs.writeFileSync(out, JSON.stringify(lessons, null, 1));
  console.log(`persona closed verdicts: ${Object.values(lessons).flat().length} lesson(s) in ${Object.keys(lessons).length} area(s)`);
}
