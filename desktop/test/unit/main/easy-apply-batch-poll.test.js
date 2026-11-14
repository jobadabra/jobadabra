// LinkedIn Easy Apply in Background and Full automation, plan 4a-2b, wired into the controller's poll (lib/background-apply-controller.js -> lib/easy-apply-batch.js): a queued
// LinkedIn job launches only after the sign-in is in the hidden browser, in the same poll; while LinkedIn is paused it goes to the person and never launches, and another site's
// job in the same batch still does.
// Guard: privacy — the copied LinkedIn session is a credential, and a LinkedIn page opened signed out or during the 24 h stop is the D3 request the owner forbade.
// Stood in: the store, the hidden browser (start + a CDP spy), the session list, the sign-in reader (never the Keychain); the controller and the batch module are real.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createBackgroundApplyController} from '../../../lib/background-apply-controller.js';
import {localDay} from '../../../lib/easy-apply-limits.js';

const NOW = Date.UTC(2026, 10, 13, 12, 0);
const job = (session, state) => ({session, mode: 'auto', chosenAt: 'c1', state, owner: ''});
function rig(settings, ea = {}) {
  let mine = structuredClone(settings);
  const storage = {settings: () => mine, saveSettings: patch => { mine = {...mine, ...patch}; return mine; }};
  const events = [], states = {ea: {...job('ea', 'queued'), ...ea}, other: job('other', 'queued')};
  const urls = {ea: 'https://www.linkedin.com/jobs/view/ea/', other: 'https://jobs.example.test/other'};
  const controller = createBackgroundApplyController(storage, {
    store: {read: async url => states[Object.keys(urls).find(id => urls[id] === url)],
      claim: async (_url, session) => ({ok: true, state: {...states[session], state: 'preflight', owner: 'o1'}}),
      handoff: async (_url, session, _owner, reason) => { events.push(`handed ${session} ${reason}`); return {...states[session], state: 'needs_user_handoff', manualOverride: true, reason, handoffAt: NOW}; }},
    browser: {start: async () => ({owner: 'o1'}), send: async (method, params) => { events.push(`${method} ${params.cookies.map(c => c.name).join(',')}`); return {}; }},
    terminals: {list: () => Object.keys(urls).map(id => ({id, url: urls[id], background: {}, outcome: ''})), record: id => ({id, background: {}}), report: () => {}},
    config: () => ({mode: 'auto', chosenAt: 'c1', auto: {waitMin: 1}}), token: () => 't', notify: () => {}, stop: () => false, log: () => {}, now: () => NOW,
    readSession: () => ({li_at: 'FAKE', JSESSIONID: 'ajax:1'})});
  const poll = async () => { const answer = await controller.handle({action: 'poll', owner: 'o1'}); events.push(`launch ${answer.jobs.map(each => each.session).join(',')}`); return answer; };
  return {poll, events};
}

test('a queued LinkedIn job launches only after the sign-in is in, in the same poll', async () => {
  const {poll, events} = rig({linkedinJobs: {on: true}, easyApply: {on: true, warnedAt: '2026-11-13T09:00:00Z'}});
  await poll();
  assert.deepEqual(events, ['Storage.setCookies li_at,JSESSIONID', 'launch ea,other']);
});

test('while LinkedIn is paused the LinkedIn job goes to the person and never launches; the other site\'s job still does', async () => {
  const {poll, events} = rig({linkedinJobs: {on: true, pauseUntil: new Date(NOW + 3600e3).toISOString()}, easyApply: {on: true, warnedAt: '2026-11-13T09:00:00Z'}});
  await poll();
  assert.deepEqual(events, ['handed ea linkedin_paused', 'launch other']);
});

// Why (14 Nov 2026, plan 4b-1; spec "waits in the queue as queued"): at the day's 15 sends a Full automation job that would send on LinkedIn is not opened, and no sign-in goes in for it.
test('at the day\'s 15 sends a stamped LinkedIn job stays queued and unopened; a LinkedIn job that only fills still opens', async () => {
  const today = {linkedinJobs: {on: true}, easyApply: {on: true, warnedAt: '2026-11-13T09:00:00Z', cap: {day: localDay(new Date(NOW)), sent: 15, lastAt: new Date(NOW - 3600e3).toISOString()}}};
  const capped = rig(today, {linkedinConfirmedAt: 'c2'});
  await capped.poll();
  assert.deepEqual(capped.events, ['launch other'], 'no hand-over, no sign-in, no launch: it waits for tomorrow');
  const fills = rig(today, {mode: 'fill'});
  await fills.poll();
  assert.deepEqual(fills.events, ['Storage.setCookies li_at,JSESSIONID', 'launch ea,other']);
});
