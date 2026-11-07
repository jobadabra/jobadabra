// The light triage read (#3519): load the page, read its controls, ask the page kind once (kept per page shape), report a verdict. Replaces the whole apply journey for a read tab.
// Why (7 Nov 2026, owner: "we don't need to go through normal flow of applying… Load the page and read form controls… a more simpler/faster flow specifically for form triaging", "for that it would be 5 seconds"):
// no Apply press, no 20 s watch for a missing form, no form judge (~49 s) and no answer plan (~15 s); one settle of at most 3 s. The judgment stays the AI's (askKind); the counts only AND with it (triage-verdict.js).
import {preparePage} from './fill-flow-read.js';
import {pressPosting} from './fill-flow-steps.js';
import {pageShape} from './page-reads.js';
import {pageStill} from './page-still.js';
import {brokenOf} from './ladder/site-broken.js';
import {verdictOf} from './triage-verdict.js';

const SETTLE_MS = 3000;   // the most a page that draws its form after the load is given (Why 2026-11-07, #3519: the old read waited up to 4 s here plus 20 s for a no-form page)

/** The counts of a page, looked at again while an empty page is still growing, for at most SETTLE_MS in all. Returns pageShape's counts or null when the page could not be read. */
async function countsOf(tabId, {shape, still, now, wait}) {
  const from = now();
  let counts = await shape(tabId);
  for (let again = 0; !counts && again < 4; again++) { await wait(500); counts = await shape(tabId); }   // a page can refuse a read right after its load (the old readPage looked again for 4 s)
  while (counts && now() - from < SETTLE_MS && !counts.fields && !counts.textareas && !counts.files && !counts.anyFiles && !counts.passwords && !counts.choices) {
    await still(tabId, {maxMs: 1000});
    const next = await shape(tabId);
    if (!next) break;
    const growing = next.nodes !== counts.nodes;
    counts = next;
    if (!growing) break;
  }
  return counts;
}

/**
 * What the read tab shows, for the app: {look, simple, why}, {unreadable: true, why}, or null when this look must not report (the tab moved on: the page it moved to is read by its own look).
 * `step` is the flow's step ({tab, gen, flow}); the page-kind ask is the flow's own askKind. A posting whose application is a form behind its Apply button gets that button pressed once (owner, 7 Nov 2026: "Press Apply
 * once, then read", because most of his jobs open a posting first); nothing else is pressed, filled or typed. `parts` replaces the page reads and waits in a test: {prepare, shape, still, now, press, wait}.
 */
export async function lookAtForm(step, parts = {}) {
  const {tab} = step, {askKind, late} = step.flow;
  const {prepare = preparePage, shape = pageShape, still = pageStill, now = Date.now, press = pressPosting, wait = ms => new Promise(resolve => setTimeout(resolve, ms))} = parts;
  const gone = what => late(tab, step.gen, what);
  await prepare(step);   // a cookie popup closed and collapsed sections opened, as a person would, before the controls are counted
  let counts = await countsOf(tab.id, {shape, still, now, wait});
  if (!counts || brokenOf(counts)) return {unreadable: true, why: 'unreadable'};
  let kind = await askKind(tab);
  if (gone('triage page kind')) return null;
  let verdict = verdictOf(kind, counts);
  if (verdict.why === 'posting') {
    Object.assign(step, {kind, role: kind.role, counts, host: (() => { try { return new URL(tab.url).hostname; } catch { return ''; } })()});
    if (!await press(step)) return null;   // false: the press moved the tab to another page, which gets its own look
    if (gone('triage apply press')) return null;
    if (step.pressed) {
      counts = await countsOf(tab.id, {shape, still, now, wait});
      if (!counts) return {unreadable: true, why: 'unreadable'};
      kind = await askKind(tab);   // the page the press brought: its kept answer is keyed by its own shape, so a form seen before costs nothing
      if (gone('triage page kind after the press')) return null;
      verdict = verdictOf(kind, counts);
    }
    if (verdict.why === 'posting') verdict = {simple: false, why: 'no form'};   // pressed or not, no form came
  }
  const {simple, why} = verdict;
  const look = {role: kind?.role || '', fields: (counts.fields || 0) + (counts.textareas || 0), files: counts.files || 0, frames: counts.frames || 0};
  return why === 'unknown' || why === 'frame' ? {unreadable: true, why, look} : {look, simple, why};   // a page whose form this read cannot see is "not checked", never a guess
}
