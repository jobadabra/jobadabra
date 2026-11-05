// Opens this week's verdict audit (lib/verdict-audit.mjs) on the Verdict audit card of /admin/testing/bug-loop and closes last week's with its score. No AI. Run by finder-review.yml.
// Job: report health
// Why (5 Nov 2026, owner: "turn this pinned issues into dashboards/tabs/pages in Admin"): the audit was a pinned GitHub issue with checkboxes (#2736); it is the D1 store `verdict-audit` now (lib/ci-state.mjs).
import {execFileSync} from 'node:child_process';
import {readState, tryRead, putState} from './lib/ci-state.mjs';
import {auditScore, sampleVerdicts} from './lib/verdict-audit.mjs';

const KEEP = 8;
const gh = args => execFileSync('gh', args, {encoding: 'utf8', maxBuffer: 50 * 1024 * 1024});
const stored = tryRead('verdict-audit');
// Replacing the whole list from a failed read would erase the owner's ticks: stop instead.
if (!stored.ok) { console.log('::warning::The audit store was not read: no audit this week.'); process.exit(0); }
const audits = Array.isArray(stored.value?.audits) ? stored.value.audits : [];
const issues = JSON.parse(gh(['issue', 'list', '--label', 'auto-ui', '--state', 'all', '--limit', '300', '--json', 'number,title,comments']));
const register = readState('noise-register', {entries: []}).entries || [];
const now = new Date().toISOString();
let last = null;
const closed = audits.map(audit => {
  if (audit.closed) return audit;
  last = auditScore(audit);
  return {...audit, closed: now, score: last};
});
const items = sampleVerdicts({issues, register});
if (!items.length) console.log('No verdicts in the last 7 days: no new audit.');
const next = items.length ? [{week: now.slice(0, 10), opened: now, closed: null, score: null, items: items.map(item => ({...item, tick: null}))}, ...closed] : closed;
if (!putState('verdict-audit', {audits: next.slice(0, KEEP)})) process.exit(1);
console.log(`Audit ${items.length ? `opened with ${items.length} verdicts` : 'closed'}${last ? ` (last: ${last.right}/${last.right + last.wrong} right)` : ''}`);
