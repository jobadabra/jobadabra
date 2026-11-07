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
const CORE = ['eligible', 'captcha', 'login', 'accountCreation', 'allFactsSaved', 'simple', 'why'];

/** A read worth keeping: not unreadable, and a simple form either has no question to match or has its match. Pure. */
export const storable = read => !!read && read.unreadable !== true && !(read.simple === true && read.questions?.length && !read.match);

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
 * Builds the step. `prepareKit(code, name)` drafts a kit ({ok, error?}); `readForm(job)` reads the form in the hidden browser (the L1 read, null when nothing was read);
 * `match(asked)` is the one question match of a check; `call` is the store call (lib/store/engine.js).
 */
export function createReadiness({storage, prepareKit, readForm, match = asked => matchReads(storage, asked), call = engine.call, clock = () => new Date(), log = () => {}}) {
  const waiting = new Map();   // url → {job, read}: fresh simple forms whose questions the check's one match has not judged yet
  const recordOf = url => call(storage, 'applications', 'get', {url}).catch(() => null);

  /** The stored check of a job as a read (match included), or null when none, another posting's, or not ours. */
  async function storedCheck(job) {
    const entry = unpack((await recordOf(String(job?.url || '')))?.apply_readiness);
    return isFresh(entry, job) ? entry.read : null;
  }

  async function save(job, read) {
    const text = pack(read, {posted: job.posted_at, now: clock()});
    const record = text ? await recordOf(job.url) : null;
    if (!record?.id) return false;   // no Applications row yet: the kit step makes it, the next check stores
    await call(storage, 'applications', 'update', {app_id: record.id, fields: {apply_readiness: text}}).catch(error => log('apply', 'readiness: the check was not stored', {error: String(error?.message || error).slice(0, 200)}));
    return true;
  }

  /** One job: its kit when missing, then its stored check or a fresh read. → {kit, check, stored}. */
  async function applyReadiness(job) {
    const kit = job.kit || !job.code ? {ok: true} : await prepareKit(job.code, job.title || 'this job').catch(error => ({ok: false, error: String(error?.message || error)}));
    const stored = await storedCheck(job);
    if (stored) return {kit, check: stored, stored: true};
    const read = await readForm(job);
    if (storable(read)) await save(job, read);
    else if (read && read.unreadable !== true) waiting.set(job.url, {job, read});
    return {kit, check: read, stored: false};
  }

  /** The check's one match of the fresh simple forms; each matched form is then stored with its match. → {[url]: {missing, unjudged}}. Never throws. */
  async function settle(asked) {
    const found = await match(asked).catch(() => ({}));
    for (const [url, matched] of Object.entries(found || {})) {
      const entry = waiting.get(url);
      if (entry) await save(entry.job, {...entry.read, match: matched});
    }
    waiting.clear();   // a form left unmatched (Stop, a failed match) is not stored
    return found || {};
  }

  return {storedCheck, applyReadiness, settle};
}
