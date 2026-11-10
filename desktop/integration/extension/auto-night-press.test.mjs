// Integration test (extension layer): the cloud browser's Full automation night (desktop/ready-fill/auto-night.mjs; spec docs/superpowers/specs/2026-11-08-cloud-browser-runner-design.md, "auto") presses a real
// form's Submit exactly once, and only for an item that carries its own confirmation (owner, 10 Nov 2026: "Build it now (Recommended)").
// Real: the night itself (night.mjs runNight task `auto`), the extension as the night copies it (owned), a real headless Chromium, the gate (submit-gate.js) and the net (no-submit.mjs). Stood in: the site (its
// batch, live line, /reserve, /result, and its AI: the form judge and the confirmation judge answer from the fixture page's own truth, as a model does on it). Every host maps to the local fixture server
// (forms.mjs); no employer, no real site, no owner data: the applicant is the fixture's fictional one.
import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {chromium} from '../../e2e/lib/visit-page.mjs';
import {CONTACT} from '../../e2e/lib/apply-fixtures.mjs';
import {FORMS, hostRules, startForms} from '../../e2e/lib/forms.mjs';
import {runNight} from '../../ready-fill/night.mjs';

const NIGHT_MS = 240000;   // hang guard only: one form fills, is judged and sent in under a minute on the Mac
const FORM = FORMS.submitter, URL_ = `https://${FORM.host}${FORM.path}`;
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n').toString('base64');
const NOW = Date.now();   // clock: relative every item time is minutes or days before this one reading, compared with the night's own clock
const itemOf = (id, change = {}) => ({job: id, url: URL_, session: `night${id}`, state: 'cloud', manualOverride: false, mode: 'auto', chosenAt: new Date(NOW - 86400000).toISOString(),
  autoConfirmedAt: new Date(NOW - 3600000).toISOString(), queuedAt: NOW - 3000000, allowIneligible: false, waitMin: 0, ...change});
const jobOf = (id, change) => ({id, url: URL_, title: FORM.title, company: FORM.company, kit: {answers: FORM.kit}, cv: PDF, letterPdf: '', item: itemOf(id, change), stage: 'Kit ready', eligible: true});
const said = value => ({content: [{type: 'text', text: JSON.stringify(value)}], stop_reason: 'end_turn', usage: {}});
const userText = params => (params.messages || []).map(message => [message.content].flat().map(part => (typeof part === 'string' ? part : part?.text || '')).join('\n')).join('\n');

// The site, faked at fetch: one night of `jobs`; its AI answers the form judge from the sketch (every required field filled: ready, the form's own Submit) and the confirmation from the landed page.
function site(jobs) {
  const seen = {results: [], reserved: [], asked: []};
  const fetchImpl = async (url, options = {}) => {
    const route = new URL(url).pathname.split('/').pop(), body = options.body ? JSON.parse(options.body) : null;
    const reply = value => ({ok: true, status: 200, json: async () => value});
    if (route === 'batch') return reply({ok: true, line: true, task: 'auto', sentAt: new Date(NOW - 600000).toISOString(), contact: CONTACT, jobs, facts: {}});
    if (route === 'progress') return reply({ok: true});
    if (route === 'reserve') { seen.reserved.push(body.job); return reply({ok: true, attempt: `attempt-${body.job}`}); }
    if (route === 'result') { seen.results.push(body); return reply({ok: true}); }
    if (route !== 'ai') return reply({});
    const text = userText(body);
    if (/JOB APPLICATION form/.test(body.system)) {
      seen.asked.push('form');
      const empty = /· required · empty/.test(text);
      return reply(said({answer: empty ? 'needs_person' : 'ready', blocked_kind: '', needs: '', needs_kind: '', step: 'final', next_control: '', submit_control: empty ? '' : 'Submit Application', bot_check: false, login_wall: false, account_to_create: false, confidence: 0.95}));
    }
    if (/confirmation that an application was submitted/.test(body.system)) { seen.asked.push('confirmation'); return reply(said({confirmation: /successfully submitted/.test(text), bot_check: false})); }
    seen.asked.push('other');
    return reply({error: 'not asked here'});
  };
  return {fetchImpl, seen};
}

let forms;
before(async () => { forms = await startForms(); });
after(async () => { await forms?.close(); });
const night = s => runNight({chromium, site: 'https://site.example', token: 't', task: 'auto', fetchImpl: s.fetchImpl,
  extraArgs: [`--host-resolver-rules=${hostRules(forms.port)}`, '--ignore-certificate-errors'], launchOptions: {ignoreHTTPSErrors: true}});

test('an item with its own confirmation is filled, judged ready, reserved and pressed exactly once; the receipt makes it submitted', {timeout: NIGHT_MS}, async () => {
  const s = site([jobOf('j1')]), before = forms.posts.length;
  await night(s);
  assert.deepEqual(s.seen.results.map(result => [result.job, result.state, result.why, result.attempt]), [['j1', 'submitted', 'receipt', 'attempt-j1']], `asked: ${s.seen.asked.join(',')}`);
  assert.deepEqual(s.seen.reserved, ['j1']);
  assert.equal(forms.posts.length - before, 1, 'the form received exactly one submission');
});

test('an item without its own confirmation is never reserved and the form receives nothing', {timeout: NIGHT_MS}, async () => {
  const s = site([jobOf('j2', {autoConfirmedAt: ''})]), before = forms.posts.length;
  await night(s);
  assert.deepEqual(s.seen.reserved, []);
  assert.equal(forms.posts.length - before, 0);
  assert.deepEqual(s.seen.results.map(result => [result.job, result.state, result.why]), [['j2', 'not_submitted', 'not_confirmed']], `asked: ${s.seen.asked.join(',')}`);
});
