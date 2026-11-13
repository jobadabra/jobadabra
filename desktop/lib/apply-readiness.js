// Apply readiness: the ONE step that gets a job ready to apply (spec docs/superpowers/specs/2026-11-07-apply-readiness-design.md, R1 of 3).
// Invariants: this file is the only owner of a job's readiness (its kit and its form check); the check is kept on the job's Applications record through the
// store layer (engine `applications update`), so the default store keeps it on this Mac and Notion only holds it when the person chose Notion; a stored check is
// valid while the posting is open (same posting date) and is read again only when the posting changed or a fill found a different form; an unreadable read and a
// simple form whose questions were never matched are never stored (not judged = not read on a guess).
// Why (7 Nov 2026, owner: "we should combine all of these 3 steps into one. One step does all 3 of them" · "I think it stays stable for the whole period of the job posting being active" · "the store" decides where it is kept).
import * as engine from './store/engine.js';
import {matchReads} from './triage-match.js';

export const VERSION = 1;
/** Notion's text column holds 2000 characters: a stored check stays under this (the questions go first, then the match's names). */
export const MAX_CHARS = 1800;
const CORE = ['eligible', 'captcha', 'login', 'accountCreation', 'allFactsSaved', 'simple', 'why'];   // words-ok: the field names of our own read (lib/triage-reader.js), not page words

/** A read worth keeping: not unreadable, and a simple form either has no question to match or has its match with every question judged (a form the AI never judged is "answers not checked", never stored as done). Pure. */
export const storable = read => !!read && read.unreadable !== true && !(read.simple === true && read.questions?.length && (!read.match || read.match.unjudged !== 0));

/** The compact JSON kept on the record, or '' when it cannot fit (then nothing is stored). Pure. */
export function pack(read, {posted = '', now = new Date()} = {}) {
  const core = Object.fromEntries(CORE.filter(key => read[key] !== undefined).map(key => [key, read[key]]));
  const make = extra => JSON.stringify({v: VERSION, at: now.toISOString(), posted: String(posted || ''), read: {...core, ...extra}});
  const match = read.match ? {unjudged: read.match.unjudged || 0, unnamed: read.match.unnamed || 0, missing: (read.match.missing || [])} : undefined;
  for (const extra of [{questions: read.questions, match}, {match}, {match: match && {...match, missing: match.missing.slice(0, 5).map(item => ({...item, label: String(item.label).slice(0, 60)}))}}, {}]) {
    const text = make(Object.fromEntries(Object.entries(extra).filter(([, value]) => value !== undefined)));
    if (text.length <= MAX_CHARS && (extra.match || !read.match)) return text;
  }
  return '';
}

/** The stored text back to {at, posted, read}, or null when it is empty or not ours. Pure. */
export function unpack(text) {
  try {
    const found = JSON.parse(String(text || ''));
    return found?.v === VERSION && found.read && typeof found.read === 'object' ? {at: String(found.at || ''), posted: String(found.posted || ''), read: found.read} : null;
  } catch { return null; }
}

/** Still the same posting the check was made for (its posting date). TODO(AI): a posting closed then reopened with the same date is not detected (7 Nov 2026). Pure. */
export const isFresh = (entry, job) => !!entry && entry.posted === String(job?.posted_at || '');

/**
 * A Jobs list row's stored check as a read ({...read, stored: true}), or null when it has none, it is not ours, or it was made for another posting. Takes the row ({apply_readiness, posted_at}). Pure.
 * Why (13 Nov 2026, owner: "Fix it in this PR"): the window kept its checks only in memory, so a restart put every checked row back to "Not checked" and hid "Account needed".
 */
export function rowCheck(job) {
  const entry = unpack(job?.apply_readiness);
  return isFresh(entry, job) ? {...entry.read, stored: true} : null;
}

/**
 * Builds the step. `prepareKit(code, name, {notices})` drafts a kit ({ok, error?}; `notices`: which of its notices show); `readForm(job)` reads the form in the hidden browser (the L1 read, null when nothing was read);
 * `match(asked)` is the one question match of a check; `call` is the store call (lib/store/engine.js).
 */
export function createReadiness({storage, prepareKit, readForm, match = asked => matchReads(storage, asked), call = engine.call, clock = () => new Date(), log = () => {}}) {
  let cancels = 0;   // counts Stops, so a check that was drafting a kit can tell one arrived before it opens the browser
  const waiting = new Map();   // url → {job, read}: fresh simple forms whose questions the check's one match has not judged yet
  const recordOf = url => call(storage, 'applications', 'get', {url}).catch(error => { log('apply', 'readiness: the record was not read', {error: String(error?.message || error).slice(0, 200)}); return null; });

  /**
   * The stored check of a job as a read (match included), or null when none, another posting's, or not ours. A form that needed the person's details is matched again from its stored questions
   * (verdicts are kept per question, so this is the saved details compared again, no browser and no new AI); without its questions it is read again.
   */
  async function storedCheck(job) {
    const entry = unpack((await recordOf(String(job?.url || '')))?.apply_readiness);
    if (!isFresh(entry, job)) return null;
    const {read} = entry;
    if (!read.match?.missing?.length) return read;
    if (!read.questions?.length) return null;
    const again = (await match([{url: job.url, questions: read.questions}]).catch(() => ({})))?.[job.url];
    if (!again || again.unjudged !== 0) return read;
    const updated = {...read, match: again};
    if (JSON.stringify(again) !== JSON.stringify(read.match)) await save(job, updated);
    return updated;
  }

  async function save(job, read) {
    const text = pack(read, {posted: job.posted_at, now: clock()});
    const record = text ? await recordOf(job.url) : null;
    if (!record?.id) return false;   // no Applications row yet: the kit step makes it, the next check stores
    await call(storage, 'applications', 'update', {app_id: record.id, fields: {apply_readiness: text}}).catch(error => log('apply', 'readiness: the check was not stored', {error: String(error?.message || error).slice(0, 200)}));
    return true;
  }

  /**
   * One job: its kit when missing, then its stored check or a fresh read. `notices` says which of the kit's notices show: 'all' for a press on this one job (Apply, Redraft, a top match),
   * 'failures' for a batch or Ready's night (a job that could not be prepared is said; the rest is the batch's summary), 'none' for the Jobs check (each job's line says it). → {kit, check, stored}.
   */
  async function applyReadiness(job, {notices = 'none'} = {}) {
    const asked = cancels;
    const kit = job.kit || !job.code ? {ok: true} : await prepareKit(job.code, job.title || 'this job', {notices}).catch(error => ({ok: false, error: String(error?.message || error)}));
    // Why (8 Nov 2026, red main after #3573): a kit draft that ran and failed no longer blocks the form read; the read is still worth showing (kept only once a row exists), and the kit's reason travels with the result.
    if (kit.ok === false) log('apply', 'readiness: the kit was not drafted', {error: String(kit.error || kit.reason || '').slice(0, 200), refused: kit.refused === true});
    if (kit.refused === true) return {kit, check: null, stored: false};   // Why (8 Nov 2026, Gitar on #3578): a gate (Notion, move, allowance, no AI) starts nothing, neither the browser nor the match
    if (cancels !== asked) return {kit, check: null, stored: false, cancelled: true};
    const stored = await storedCheck(job);
    if (stored) return {kit, check: stored, stored: true};
    const read = await readForm(job);
    if (!read && cancels !== asked) return {kit, check: null, stored: false, cancelled: true};   // a read Stop cut short is not a result (jobs-triage.js)
    if (storable(read)) await save(job, read);
    else if (read && read.unreadable !== true) waiting.set(job.url, {job, read});
    return {kit, check: read, stored: false};
  }

  /** The check's one match of the fresh simple forms; each matched form is then stored with its match. → {[url]: {missing, unjudged}}. Never throws. */
  async function settle(asked) {
    const found = await match(asked).catch(() => ({}));
    for (const [url, matched] of Object.entries(found || {})) {
      const entry = waiting.get(url);
      const merged = entry && {...entry.read, match: matched};
      if (merged && storable(merged)) await save(entry.job, merged);   // a match with a question nobody judged is not stored: the next check asks again
    }
    waiting.clear();   // a form left unmatched (Stop, a failed match) is not stored
    return found || {};
  }

  return {storedCheck, applyReadiness, settle, cancel: () => { cancels += 1; waiting.clear(); }};
}
