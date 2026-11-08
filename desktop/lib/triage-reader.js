// Apply triage (spec 2026-10-30-apply-triage, PR C2a): the queue of form reads that the hidden browser's extension takes one at a time. A read is not an application: no store row, no session, no saved mode.
import {randomUUID} from 'node:crypto';
import {readFromJudge, readFromLook} from './triage-read.js';

/**
 * The steps of one read, in order: the app marks `opening` when it hands the read out; the light look (extension/triage-look.js) reports `looking` on each page it reads and `pressing` before it
 * presses a posting's Apply, and a `looking` after `pressing` is marked `landed` (the page Apply brought); the judge-based read of older extensions reports `judging` and `planning`.
 */
export const STEPS = ['opening', 'looking', 'pressing', 'landed', 'judging', 'planning'];
const REPORTED = new Set(['looking', 'pressing', 'judging', 'planning']);

// Why (8 Nov 2026, owner: "still slow, still almost no live updates"; chose "A: fix the end + steps"): on the owner's run 4 of 4 reads sat out the whole 150 s with no report after their
// Apply press. A look that goes quiet now ends 30 s after its last step, with that step named; 30 s is ≥ 3× the slowest measured step (a new page shape's AI kind ~8 s, a page load ~10 s,
// #3548). The judge of an older extension (~49 s) is never cut by it: from `judging` on, only the read's whole deadline holds.
export const SILENT_MS = 30000;
const SILENT_WHY = {opening: 'unreadable', pressing: 'afterApply', landed: 'afterApply'};   // the page never loaded; the page Apply opened never answered; any other quiet step "took too long"

// Why (30 Oct 2026, owner): the measured plan adds 15 s to a 49 s judge; allow 150 s for both steps.
export const READ_TIMEOUT_MS = 150000;

/**
 * One reader per app. `read(url)` queues a job's form read and resolves with the mode table's flags ({eligible, captcha, login, accountCreation, allFactsSaved}) or null when nothing was read.
 * Takes the extension's polls (`take`) and reports (`report`); `set`, `clear` and `uuid` are injectable so a test never waits for a clock.
 * `onStep({url, step})` hears each step as it starts (the Jobs dialog shows it); `onDone({url, outcome, last, totalMs, queueMs, openMs, judgeMs, planMs, quietMs})` hears each read's end and where its time went
 * (app.log; #3519: ten jobs took about ten minutes and nothing said which step cost it). Invariants: at most one read is handed to the extension at a time; a read ended without a report is reported once by `takeEnded` so its page is closed; a report for an id that is not the active one is refused; a read that gets no report in `timeoutMs`, or no step in `silentMs` before its judge, resolves {unreadable: true, why}.
 */
export function createTriageReader({uuid = randomUUID, set = setTimeout, clear = clearTimeout, timeoutMs = READ_TIMEOUT_MS, silentMs = SILENT_MS, now = Date.now, onStep = () => {}, onDone = () => {}} = {}) {
  const waiting = new Map(), queue = [], ended = new Set();
  const hear = fn => value => { try { fn(value); } catch { /* a listener's failure never leaves a read unanswered */ } };
  const heardStep = hear(onStep), heardDone = hear(onDone);
  let active = '';
  // Why (2026-10-30, g2's G4 step, #2624): Cancel and a timeout resolve the app's promise but nothing told the extension, so the read's page stayed open in the hidden browser; a read ended without a report is remembered here until the poll hands it to the extension to close.
  function finish(id, value, reported = false) {
    const row = waiting.get(id);
    if (!row) return false;
    clear(row.timer); clear(row.quiet);
    waiting.delete(id);
    heardDone(summaryOf(row, value, reported, now()));
    const at = queue.findIndex(item => item.id === id);
    if (at >= 0) queue.splice(at, 1);
    if (active === id) { active = ''; if (!reported) ended.add(id); }   // only a read that was handed out has a page to close
    row.resolve(value);
    return true;
  }
  function mark(id, given) {
    const row = waiting.get(id);
    const step = given === 'looking' && row?.marks.pressing !== undefined ? 'landed' : given;
    if (!row) return false;
    clear(row.quiet);   // a step heard again (a redirect, a second look) is still progress: the quiet guard starts over, but no new step is marked or told
    row.quiet = row.marks.judging === undefined && row.marks.planning === undefined && step !== 'judging' && step !== 'planning' ? set(() => finish(id, {unreadable: true, why: SILENT_WHY[row.last] || 'timeout'}), silentMs) : null;
    if (row.marks[step] !== undefined) return false;
    row.marks[step] = now();
    row.last = step;
    heardStep({url: row.url, step});
    return true;
  }
  return {
    /** Queues one job's read; resolves with the read flags, {unreadable: true, why} when the page could not be read (or not in time), or null when it was cancelled. Takes the job's URL. */
    read(url) {
      const id = `tr${uuid().slice(0, 8)}`;
      const address = String(url || '');
      return new Promise(resolve => {
        waiting.set(id, {resolve, url: address, queued: now(), marks: {}, timer: set(() => finish(id, {unreadable: true, why: 'timeout'}), timeoutMs)});
        queue.push({id, url: address});
      });
    },
    /** The next queued read for the extension, or null while one is already out or none waits. Returns {id, url}. */
    take() {
      if (active || !queue.length) return null;
      const next = queue.shift();
      active = next.id;
      mark(next.id, 'opening');
      return next;
    },
    /** The extension's report that the active read reached `step` (looking, pressing, judging, planning). Returns false for any other id, an unknown step or a step already marked. */
    step: (id, step) => id === active && REPORTED.has(step) && mark(id, step),
    /** True while a read is queued or out, so a real application is never started beside it. */
    busy: () => waiting.size > 0,
    /** The extension's answer for the active read: {simple, why} from the light look, or {botCheck, loginWall, accountCreation} from the judge and allFactsSaved from the answer plan, or {unreadable: true} when the page never became a form. Returns false for any other id. */
    report(id, payload = {}) {
      if (!active || id !== active) return false;
      if (payload.unreadable === true) return finish(id, {unreadable: true, why: typeof payload.why === 'string' && payload.why ? payload.why : 'unreadable'}, true);
      return finish(id, 'simple' in payload ? readFromLook(payload) : readFromJudge(payload, {eligible: true, allFactsSaved: payload.allFactsSaved}), true);   // the light read says `simple`; the judge-based read (kept for the demo and older extensions) says its flags
    },
    /** Resolves every queued and active read with null (Cancel, the app quitting). Returns how many it ended. */
    cancelAll: () => [...waiting.keys()].filter(id => finish(id, null)).length,
    /** The reads ended without a report (Cancel, a timeout) whose page the extension still holds; each is returned once. Returns [id]. */
    takeEnded() { const ids = [...ended]; ended.clear(); return ids; },
  };
}

/** Where one read's time went. Queue = waiting for the browser; open = handed out until the judge (the whole look, for the light read); judge = the AI's judgment; plan = matching the saved answers; last and quiet = the step it ended on and its time there. A step that never started is 0. */
function summaryOf(row, value, reported, end) {
  const {opening, judging, planning} = row.marks, span = (from, to) => (from === undefined ? 0 : Math.max(0, to - from));
  const outcome = !reported ? (opening === undefined ? 'cancelled-before-start' : 'ended-without-report') : value === null || value?.unreadable === true ? 'unreadable' : 'read';
  // Each step ends where the next one that was reported starts, so a lost report never makes two steps count the same time.
  const judgingStart = judging ?? planning, address = row.url.split(/[?#]/)[0];   // the address without its query: a tracking token has no place in the log
  const last = row.last || '', quietMs = last ? span(row.marks[last], end) : 0;   // the step a read ended on and how long it was quiet there: where a hang sits (8 Nov 2026)
  return {url: address, outcome, last, totalMs: end - row.queued, queueMs: (opening ?? end) - row.queued, openMs: span(opening, judgingStart ?? end), judgeMs: judging === undefined ? 0 : span(judging, planning ?? end), planMs: span(planning, end), quietMs};
}
