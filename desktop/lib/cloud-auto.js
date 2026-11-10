// Full automation in the cloud, the Mac's side (cloud browser runner cs 4/4, model A, spec docs/superpowers/specs/2026-11-08-cloud-browser-runner-design.md "cs 4/4 Design"): when the Mac is about to go away
// (sleep, shutdown, quit, screen lock) its confirmed Full automation items that have not pressed go to the site as ONE auto night with each item's own stamp, and the cloud browser sends them; this takes the
// outcomes back into the store. Nothing changes while the Mac stays on: no timer sends, nothing here presses.
// Invariants: an item is marked sent in the store BEFORE the site hears of it (the Mac never presses it from then on); a send the site refused puts every item back; the site sends an item at most once (its one
// reserved attempt); an outcome written back never overwrites a receipt; a night that already started today takes no more items (they stay with the Mac, a quit hands them over as before); no page text, answer or
// address is logged. Guard: test/unit/main/cloud-auto.test.js.

const registry = new WeakMap();
/** The cloud Full automation of a store, or null when none was made (a test, the demo, a CLI session): the stop paths ask it (focus-handlers.js, background-apply-controller.js). */
export const cloudAutoOf = storage => registry.get(storage) || null;
/** Registers (or, with null, removes) a store's cloud Full automation so the stop paths can find it. -> `auto`. */
export const keepCloudAuto = (storage, auto) => { if (auto) registry.set(storage, auto); else registry.delete(storage); return auto; };

const GIVE_UP_MS = 5 * 60 * 1000;   // an outcome that has not arrived once the site says nothing is left running this long after the send: lost, the person checks
const REASONS = {not_eligible: 'not_eligible', bot_check: 'captcha_runtime', stopped: 'stopped'};   // words-ok: our own reason ids (the site's `why` code -> the hand-off reason), not page knowledge; the cloud's words for why it did not press -> the Mac's hand-off reason ids (anything else: 'needs_user')
const day = at => at.toISOString().slice(0, 10);

/**
 * deps: {storage, eligible() -> bool (Always on, the owner's own run), side (lib/background-apply-cloud.js), jobs() -> the kept job list, build(list) -> {batch, skipped} (buildBatch), kitInfo(url) -> {stage, eligible},
 * waitMin() -> the Apply wait in minutes, site (lib/ready-site.js), ownKey() -> the person's own Claude key or '', markApplied(url, why), now() -> Date, log(message, extra)}.
 * -> {handOver(why), takeBack(), heard(got), stopFor(session), stopForUrl(url), open()}; none throws.
 */
export function createCloudAuto({storage, eligible, side, jobs, build, kitInfo, waitMin, site, ownKey = () => '', markApplied, now = () => new Date(), log = () => {}}) {
  const mine = () => storage.settings().cloudAuto || {};
  const save = patch => storage.saveSettings({cloudAuto: {...mine(), ...patch}});
  let running = Promise.resolve(), declinedAt = 0;
  const serial = work => { const value = running.then(work); running = value.catch(() => {}); return value; };

  async function rollBack(sessions) { for (const session of sessions) await side.unsend(session); }

  // Marks every sendable item sent in the store (the Mac never presses it from here); -> {held: the items the cloud holds now, newly: the sessions marked just now}.
  async function mark(entries) {
    const held = [], newly = [];
    for (const entry of entries) {
      if (entry.state.state === 'cloud') held.push(entry);   // an earlier send of today that the site never started
      else if (await side.send(entry.session)) { held.push(entry); newly.push(entry.session); }
    }
    return {held, newly};
  }
  // One job of the batch with the Mac's own queued item (its stamp, never made up here) and the job's stage and kit eligibility as the Mac knows them.
  const stamped = async (job, entry) => ({...job, item: {job: job.id, url: job.url, session: entry.session, state: 'queued', manualOverride: false, mode: 'auto', chosenAt: entry.state.chosenAt, autoConfirmedAt: entry.state.autoConfirmedAt,
    queuedAt: entry.state.queuedAt, waitMin: waitMin(), allowIneligible: entry.state.allowIneligible === true}, ...(await kitInfo(job.url).then(info => ({stage: info.stage, kit: {...job.kit, eligible: info.eligible}}), () => ({})))});
  // Why (cs 4/4 design, the site's cron starts ANY queued night at its next tick): only an answer that says the night was NOT queued puts the items back. No answer (the network went with the lid) or a 5xx may mean it was:
  // the items stay sent, and the retry (takeBack) posts the same night again (409 "already started" then says the site has it). Double sending is the worse failure.
  const notQueued = result => !result.ok && !!result.status && result.status < 500 && result.status !== 409;

  /** Posts the night and starts it. -> {ok: true} (the site has it, started or already started), {uncertain: true} (no answer: kept), or the refusal (put back by the caller). */
  async function deliver(batch, why) {
    const codes = batch.jobs.map(job => job.id);
    const posted = await site.autoSend(storage, batch, {ai: ownKey()});
    if (notQueued(posted)) { log(`cloud Full automation not sent (${why})`, {status: posted.status}); return posted; }
    if (!posted.ok && posted.status !== 409) { log(`cloud Full automation: no answer (${why}), kept to retry`, {}); return {ok: false, uncertain: true, error: posted.error}; }
    if (!posted.ok) return {ok: true};   // 409: the same night, already started by an earlier send the answer of which was lost
    const started = await site.autoRun(storage);
    if (started.ok || started.status === 409) return {ok: true};
    const stopped = notQueued(started) ? await site.autoStop(storage, codes) : {ok: false};   // the queued night must not start by itself either
    log(`cloud Full automation not started (${why})`, {status: started.status || 0});
    return stopped.ok ? started : {ok: false, uncertain: true, error: started.error};
  }

  async function sendAll(why) {
    if (!eligible()) return {skipped: 'not Always on'};
    const at = now(), today = day(at), state = mine();
    if (state.night === today && state.started) return {skipped: 'today\'s cloud night already started'};
    const byUrl = new Map(jobs().map(job => [job.url, job])), out = new Set(Object.values(state.sent || {}).filter(entry => entry.started).map(entry => entry.session));
    const known = (await side.candidates()).filter(entry => byUrl.has(entry.url) && !out.has(entry.session));   // one the cloud already runs is never posted in a second night
    if (!known.length) return {skipped: 'no Full automation item the jobs list holds'};
    const {held, newly} = await mark(known);
    let built;
    try { built = await build(held.map(entry => byUrl.get(entry.url))); } catch (error) { await rollBack(newly); throw error; }   // nothing was posted: back where they were
    const {batch, skipped} = built, byCode = new Map(held.map(entry => [byUrl.get(entry.url).code, entry])), ready = batch.jobs.filter(job => byCode.has(job.id));
    const posted = new Set(ready.map(job => byCode.get(job.id).session)), left = held.filter(entry => !posted.has(entry.session));
    await rollBack(newly.filter(session => !posted.has(session)));   // no kit or CV file: never sent half-made
    // Why (retro review of #3697, Gitar + code review, 10 Nov 2026): an item left in 'cloud' by an earlier send whose answer was lost may be queued, running or pressed on the site, and the site's Stop cannot tell "never had it" from
    // "finished" (both 404). Only a Stop the site confirms puts it back to the Mac; any other answer keeps it out and flagged started, so the ordinary wait ends it as "check" (never pressed twice, never stranded in 'cloud').
    const kept = {...(mine().sent || {})};
    let unsure = false;
    for (const entry of left.filter(each => !newly.includes(each.session))) {
      const code = byUrl.get(entry.url).code, dropped = await site.stop(storage, code).catch(() => ({ok: false}));
      if (dropped?.ok && await side.unsend(entry.session)) delete kept[code];
      else { unsure = true; kept[code] = {url: entry.url, session: entry.session, at: now().getTime(), ...kept[code], started: true}; log('cloud Full automation: an item without a kit is kept out, the site may hold it', {}); }
    }
    if (left.length) save({sent: kept, ...(unsure && !ready.length ? {night: today, started: true} : {})});
    if (!ready.length) return {skipped: 'nothing complete to send', details: skipped};
    const items = await Promise.all(ready.map(job => stamped(job, byCode.get(job.id))));
    const before = kept, sentNow = {...before, ...Object.fromEntries(ready.map(job => [job.id, {url: job.url, session: byCode.get(job.id).session, at: at.getTime()}]))};
    // Why (code review of cs 4/4): the item is recorded BEFORE the site hears of it, so a quit that cuts this short (the 15 s wait) or a crash after the post never strands an outcome the Mac cannot map back.
    save({night: today, started: false, sent: sentNow});
    const done = await deliver({...batch, night: today, fillAt: undefined, jobs: items}, why);
    if (notQueued(done) || (!done.ok && !done.uncertain)) { save({started: false, sent: before}); await rollBack(newly); return done; }
    if (!done.ok) return done;
    save({started: true, sent: Object.fromEntries(Object.entries(sentNow).map(([code, entry]) => [code, ready.some(job => job.id === code) ? {...entry, started: true} : entry]))});
    for (const job of ready) await side.closeLocal(byCode.get(job.id).session);   // nothing here will press it: the Mac stays on at a lock or a sleep, and its hidden tab goes
    log(`cloud Full automation sent (${why})`, {jobs: ready.length});
    return {ok: true, sent: ready.length};
  }

  async function write(entry, got) {
    const states = {submitted: 'submitted', unknown: 'unknown', not_submitted: 'not_submitted', failed: 'not_submitted'};
    const outcome = {state: states[got.state] || 'not_submitted', attempt: String(got.outcome?.attempt || ''), reason: got.state === 'failed' ? 'needs_user' : REASONS[got.why] || 'needs_user'};
    const saved = await side.take(entry.session, outcome);
    if (saved?.state === 'receipt_confirmed') await markApplied(entry.url, 'Full automation in the cloud: the site\'s reserved attempt, the page\'s own confirmation').catch(error => log('cloud Full automation: Applied not saved', {error: String(error?.message || error).slice(0, 120)}));
    return saved;
  }

  /** What the site's /reads returned (any caller of readTake): the auto outcomes are kept first, then written. The site has already deleted them, so they wait in settings until each is written. */
  async function heard(got) {
    const arrived = (got?.submits || []).filter(each => each?.job);
    if (arrived.length) save({inbox: [...(mine().inbox || []), ...arrived]});
    return serial(async () => {
      for (const each of [...(mine().inbox || [])]) {
        const sent = {...(mine().sent || {})}, entry = sent[each.job], held = each.state === 'not_submitted' && each.why === 'already';
        // Why (code review of cs 4/4): "already" means another night of the same item holds its one attempt: that night's own outcome is the answer, so this one is no end for the item.
        if (held) log('cloud Full automation: another night holds this item', {});
        else if (entry) await write(entry, each);
        else log('cloud Full automation: an outcome for no item of this Mac', {job: String(each.job).slice(0, 40)});
        if (!held) delete sent[each.job];
        save({sent, inbox: (mine().inbox || []).filter(kept => kept !== each && !(kept.job === each.job && kept.night === each.night))});
      }
    });
  }

  /** Asks the site for the outcomes (while any item is out, and once at start for the ones that waited). -> true while some are still out. */
  async function takeBack() {
    const out = () => Object.keys(mine().sent || {}).length;
    if (!eligible() || (!out() && !(mine().inbox || []).length)) return false;
    if (out() && !mine().started) { await serial(() => sendAll('retrying')); return true; }   // a send the site did not answer: the same night again (409 says it has it)
    const got = await site.readTake(storage).catch(() => ({ok: false}));
    if (!got.ok) return out() > 0;
    await heard({submits: []});   // the listener may have taken them already; this writes anything the inbox still holds
    // The site holds nothing for this install and no outcome arrived: what is still out was pressed or not, nobody knows: told as "check" (never silently "not sent").
    if (!got.pendingSubmits && !(got.submits || []).length && out()) {
      const stale = Object.entries(mine().sent).filter(([, entry]) => now().getTime() - (entry.at || 0) > GIVE_UP_MS);
      for (const [job, entry] of stale) {
        await serial(async () => { if (!entry.stopped) await side.take(entry.session, {state: 'unknown'}); const sent = {...mine().sent}; delete sent[job]; save({sent}); });   // a Stop the person gave is no press to check on
        log('cloud Full automation: an outcome never arrived', {});
      }
    }
    return out() > 0;
  }

  /** The person's Stop, Cancel or Applied on an item the cloud holds: the site stops that job (a press that already happened is still told back). -> whether the cloud held it. */
  async function stopFor(session) {
    const entry = Object.entries(mine().sent || {}).find(([, each]) => each.session === session);
    if (!entry) return false;
    save({sent: {...mine().sent, [entry[0]]: {...entry[1], stopped: true}}});   // kept: a press that crossed the Stop is still mapped back, and the wait for an outcome never alarms for it
    const stopped = await site.stop(storage, entry[0]).catch(() => ({ok: false}));
    if (!stopped?.ok) log('cloud Full automation: the Stop did not reach the site', {status: stopped?.status || 0});
    return true;
  }
  const stopForUrl = async url => {
    const entry = Object.values(mine().sent || {}).find(each => each.url === url);
    return entry ? stopFor(entry.session) : false;
  };
  // Why (owner 10 Nov 2026, "Stop and quit" in the quit dialog's case 3): the person chose to stop them, so this quit hands nothing over.
  const declineQuit = () => { declinedAt = now().getTime(); };
  const declined = why => why === 'the app quits' && now().getTime() - declinedAt < 60000;
  return {declineQuit, handOver: why => (declined(why) ? Promise.resolve({skipped: 'the person chose Stop and quit'}) : serial(() => sendAll(why))).catch(error => { log(`cloud Full automation not sent (${why})`, {error: String(error?.message || error).slice(0, 120)}); return {ok: false, error: error.message}; }),
    takeBack: () => takeBack().catch(() => false), heard: got => heard(got).catch(() => null), stopFor, stopForUrl, open: () => Object.keys(mine().sent || {}).length};
}
