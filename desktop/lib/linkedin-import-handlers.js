// "Import from LinkedIn" over IPC (spec docs/superpowers/specs/2026-11-03-linkedin-profile-import-design.md): the window asks to import or update, is told each step, gets the
// "What came in" rows, and sends back which ones are ticked. The consent, the key and the reads are lib/linkedin-import.js; the rows lib/linkedin-import-review.js; the AI match
// and the one LinkedIn source lib/experience.js. In demo mode no Keychain, browser or LinkedIn is touched. The key is never in an answer or a log line (counts only). Guard:
// test/linkedin-import-handlers.test.js.
import * as engine from './linkedin-import.js';
import * as review from './linkedin-import-review.js';
import * as experience from './experience.js';
import * as claudeCode from './claude-code.js';
import * as contactDetails from './contact.js';
import {baseCv} from './cv.js';
import {log as appLog} from './log.js';

const DEMO_REVIEW = {positions: [{id: 'p:0:0', kind: 'position', label: 'Data Analyst · Northwind', sub: '2019 – 2022', chip: 'new', newBullets: 0, ticked: true},
  {id: 'p:1:0', kind: 'position', label: 'Product Manager · Acme', sub: '2022 – Present', chip: 'new-bullets', newBullets: 2, ticked: true}],
  education: [{id: 'e:0', kind: 'education', label: 'MSc Economics · Universität Wien', sub: '2013 – 2015', chip: 'new', ticked: true}],
  skills: [{id: 's:0', kind: 'skill', label: 'SQL', chip: 'new', ticked: true}, {id: 's:1', kind: 'skill', label: 'Looker', chip: 'new', ticked: true}],
  languages: [{id: 'l:0', kind: 'language', label: 'English (Full professional)', chip: 'new', ticked: true}],
  details: [{id: 'd:postal_code', kind: 'detail', field: 'postal_code', current: '', linkedin: '1010', chip: 'new', ticked: true},
    {id: 'd:location', kind: 'detail', field: 'location', current: 'Vienna', linkedin: 'Wien, Austria', chip: 'differs', ticked: false}], have: {skills: 12, languages: 1, education: 0}};

/**
 * Register the window's channels. The defaults are the app's (shell, window, the chosen AI, Your details); a test passes its own openExternal, sendStep, aiOf, readContact, saveContact
 * and deps (keychain, fetcher, sleep).
 */
export function registerLinkedinImportHandlers({DEMO, ipcMain, storage, shell, getWindow = () => null, deps = {},
  openExternal = url => shell.openExternal(url),
  sendStep = (channel, payload) => { const win = getWindow(); if (win && !win.isDestroyed()) win.webContents.send(channel, payload); },
  aiOf = () => ({apiKey: storage.secret('ANTHROPIC_API_KEY'), client: claudeCode.client(storage)}),
  readContact = () => contactDetails.read(storage), saveContact = contact => contactDetails.save(storage, contact)}) {
  let held = null;   // the review being ticked: {cv, match, review, mainless}; in memory only, cleared on apply or a new run
  let runNo = 0;     // Why (independent review, 3 Nov 2026): a run that was cancelled or replaced must not set `held` or answer for the newer one; every await re-checks its number
  const stale = mine => mine !== runNo;
  const knownSource = () => experience.list(storage).find(s => s.kind === 'linkedin') || null;
  const say = (what, extra = {}) => sendStep('linkedinImportStep', {what, ...extra});
  const view = () => (DEMO ? {connected: false} : engine.state(storage, deps));
  ipcMain.handle('linkedinImportState', view);

  // The consent step of a run -> {token} | {ok: false, error}; a run replaced meanwhile answers Cancelled and keeps nothing.
  async function signIn(mine) {
    say('waiting');
    const consent = await engine.connect(openExternal);
    if (stale(mine)) return {ok: false, error: 'Cancelled.'};
    if (!consent.ok) return consent;
    const kept = engine.saveToken(storage, consent, deps);
    return kept.ok ? {token: consent.token} : kept;
  }

  // LinkedIn's roles against the main CV by the person's AI -> {match} | {ok: false, error}; no main CV means no comparison (everything is new).
  async function matchRoles(main, cv) {
    if (!main) return {match: []};
    const ai = aiOf();
    if (!ai.apiKey && !ai.client) return {ok: false, error: 'Choose your AI in Settings → Connections → AI first: your LinkedIn roles are compared with your CV.'};
    try { return {match: (await experience.matchAgainst(main, cv, ai.apiKey, ai.client)).match}; } catch (error) { return {ok: false, error: error.message}; }
  }

  // The reading step of a run -> {cv, all} | {ok: false, error, stopped?, status?}; a key LinkedIn refuses is deleted, never kept.
  async function readProfile(token, mine) {
    say('reading');
    const all = await engine.fetchAll(token, {...deps, onProgress: (domain, status) => { if (!stale(mine)) say('domain', {domain, status}); }});
    if (stale(mine)) return {ok: false, error: 'Cancelled.'};
    if (all.stopped) {
      if (all.stopped === 'unauthorized') await engine.disconnect(storage, deps);
      return {ok: false, error: all.error, stopped: all.stopped};
    }
    try { return {cv: engine.toProfileCv(all.tables), all}; } catch (error) { return {ok: false, error: error.message, status: all.status}; }
  }

  // Import (the person signs in on LinkedIn) or Update (a kept key, no sign-in) -> {ok, review, status} | {ok: false, error, stopped?}.
  ipcMain.handle('linkedinImportRun', async (_, {update = false} = {}) => {
    if (DEMO) { held = null; return {ok: true, review: DEMO_REVIEW, status: Object.fromEntries(engine.DOMAINS.map(d => [d, 'ok']))}; }
    held = null;
    const mine = ++runNo;
    let token = update ? engine.readToken(storage, deps) : null;
    if (!token) {
      const signed = await signIn(mine);
      if (!signed.token) return signed;
      token = signed.token;
    }
    const read = await readProfile(token, mine);
    if (!read.cv) return read;
    const {cv, all} = read;
    const main = baseCv(storage);
    say('comparing');
    const compared = await matchRoles(main, cv);
    if (!compared.match) return compared;
    const {match} = compared;
    const contact = await readContact().catch(() => ({}));
    if (stale(mine)) return {ok: false, error: 'Cancelled.'};
    const rows = review.buildReview({main, cv, match, profileRow: all.tables['Profile.csv']?.[0] || null, contact, known: knownSource()?.cv || null});
    held = {cv, match, review: rows, mainless: !main};
    appLog('linkedin-import', 'read', {positions: rows.positions.length, education: rows.education.length, skills: rows.skills.length, languages: rows.languages.length, details: rows.details.length,
      pending: Object.values(all.status).filter(s => s === 'pending').length});
    return {ok: true, review: rows, status: all.status, mainless: !main};
  });

  // The ticked row ids -> saved. With a main CV: one LinkedIn source (never the main CV) + the ticked Your details values. No main CV: the CV step builds it (PR 3/3).
  ipcMain.handle('linkedinImportApply', async (_, ticked) => {
    if (DEMO) return {ok: true, added: 0};
    if (!held) return {ok: false, error: 'Nothing to add: import from LinkedIn again.'};
    const ids = Array.isArray(ticked) ? ticked.filter(id => typeof id === 'string') : [];
    const picked = review.applyPicks(held, held.review, ids);
    const counts = {positions: picked.cv.jobs.reduce((n, j) => n + j.roles.length, 0), details: Object.keys(picked.details).length};
    if (!held.mainless && (picked.cv.jobs.length || picked.cv.skills || picked.cv.education || picked.cv.languages)) {
      const merged = review.mergeSource(knownSource(), picked);   // what was imported before stays
      experience.saveLinkedin(storage, merged.cv, merged.match);
    }
    if (Object.keys(picked.details).length) {
      try {
        const now = await readContact().catch(() => ({}));
        // Why (independent review): a line shown as empty ("new") that the person has filled in since must not be overwritten; a "differs" line they ticked is their choice.
        for (const row of held.review.details) if (row.chip === 'new' && picked.details[row.field] !== undefined && String(now[row.field] || '').trim()) delete picked.details[row.field];
        counts.details = Object.keys(picked.details).length;
        if (counts.details) await saveContact({...now, ...picked.details});
      } catch (error) { return {ok: false, error: `Your details were not saved: ${error.message}`}; }
    }
    const done = held; held = null;
    appLog('linkedin-import', 'added', {...counts, ticked: ids.length});
    return {ok: true, added: ids.length, ...counts, ...(done.mainless ? {mainless: true, cv: picked.cv} : {})};
  });
  ipcMain.handle('linkedinImportCancel', () => { runNo++; engine.cancel(); held = null; return {ok: true}; });
  ipcMain.handle('linkedinImportDisconnect', async () => { held = null; return DEMO ? {ok: true, revoked: false} : engine.disconnect(storage, deps); });
}
