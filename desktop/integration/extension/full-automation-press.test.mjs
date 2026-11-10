// Integration test (extension layer): Full automation's one press (extension/background-apply.js pressOnce) goes through the press floor and is the extension's own press.
// Why (10 Nov 2026, owner: "Fix it now (Recommended)"): the press ran in the page's own world, where page/submit-press.js does not exist: a "Withdraw application" named as the submit was clicked,
// and the submit event of the click reached the app as the person's press, so the receipt carried no attempt (store.humanReceipt) and the "applied" e-mail was never sent.
// Real: the extension as the app copies it for its hidden browser (owned), a real headless Chromium, the fixture form (forms.mjs FORMS.submitter) posting for real. Stood in: the app (lib/background-apply-controller.js:
// poll, `ready` granting one permit, `manual`; the form judge and the confirmation answer from the fixture's own truth, as the AI does). Every host maps to the local fixture server; no employer, no owner data.
import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {chromium} from '../../e2e/lib/visit-page.mjs';
import {CONTACT} from '../../e2e/lib/apply-fixtures.mjs';
import {EXTENSION_DIR} from '../../e2e/lib/extension.mjs';
import {FORMS, hostRules, startForms} from '../../e2e/lib/forms.mjs';
import {at, capOf, clocked, onHang} from '../../e2e/lib/test-clock.mjs';
import {openNightBrowser} from '../../ready-fill/night-browser.mjs';
import {createStandIn} from '../../ready-fill/stand-in.mjs';
import {sessionTabUrl} from '../../lib/session-tab.js';

const PRESS_MS = 90000;   // hang guard only: the form fills, is judged and pressed in seconds
const FORM = FORMS.submitter, OWNER = 'stand-in-owner';
const SUBMIT = {url: `https://${FORM.host}${FORM.path}`, control: 'Submit Application'};
const WITHDRAW = {url: `https://${FORM.host}${FORM.autoPath}?withdraw=1`, control: 'Withdraw application'};   // the details-only form whose one submit button reads "Withdraw application"
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n').toString('base64');
const jobOf = shape => ({id: shape.control, url: shape.url, title: FORM.title, company: FORM.company, kit: {answers: FORM.kit}, cv: PDF, letterPdf: ''});

let forms, standIn, context, worker, profile, pending = [];
const ended = new Map(), asked = [];   // session -> {confirmation: attempt} | {manual: reason}; asked: every action the extension sent, the evidence a red prints
const controlOf = session => [SUBMIT, WITHDRAW].find(shape => session.endsWith(shape === SUBMIT ? 'a' : 'b')).control;

/** The app's controller for one Full automation job: the form judge names the job's own control, `ready` grants its one permit, a hand-off or a receipt ends it. */
function background(body) {
  if (body?.owner !== OWNER) return {ok: false};
  if (body.action === 'poll') { const jobs = pending; pending = []; return {ok: true, jobs, checks: [], handoffs: [], closes: []}; }
  asked.push(`${body.action}${body.reason ? ` ${body.reason}` : ''}`);
  if (body.action === 'manual') { ended.set(body.session, {manual: String(body.reason || '')}); return {ok: true, manual: true, reason: body.reason}; }
  if (body.action === 'ready') return {ok: true, submit: true, attempt: `attempt-${body.session}`, control: controlOf(body.session), signature: 's'};
  return {ok: true};
}
const judged = body => (body?.phase !== 'form' || body.background?.owner !== OWNER ? {} : {ok: true, answer: 'ready', needs: '', needsKind: '', botCheck: false, loginWall: false, accountCreation: false,
  step: 'final', nextControl: '', submitControl: controlOf(body.background.session), confidence: 0.95, blockedKind: '', background: {proof: `proof-${body.background.session}`, signature: 's'}});
function confirmation(body) {
  asked.push(`confirmation ${body?.background?.attempt || '(no attempt)'}`);
  ended.set(body?.background?.session, {confirmation: body?.background?.attempt || ''});
  return {ok: true, confirmation: true};
}

before(async () => {
  forms = await startForms();
  standIn = await createStandIn({contact: CONTACT, jobs: [jobOf(SUBMIT), jobOf(WITHDRAW)]}, {background, pageKind: () => ({role: 'form', kind: 'form', botCheck: false, by: 'ai'}),
    routes: {'/extension/account-judge': judged, '/extension/confirmation': confirmation}});
  ({context, worker, profile} = await openNightBrowser({chromium, standIn, extensionDir: EXTENSION_DIR, owned: true, storage: {backgroundOwner: OWNER},
    extraArgs: [`--host-resolver-rules=${hostRules(forms.port)}`, '--ignore-certificate-errors'], launchOptions: {ignoreHTTPSErrors: true}}));
});

after(async () => {
  await context?.close();
  await standIn?.close();
  await forms?.close();
  if (profile) (await import('node:fs')).rmSync(profile, {recursive: true, force: true});
});

/** Hands one Full automation job to the extension and waits for its end: a receipt (its attempt) or a hand-off (its reason); null at the cap. */
async function run(session, shape) {
  onHang(() => context?.close()); onHang(() => standIn?.close()); onHang(() => forms?.close());
  pending.push({session, url: sessionTabUrl(shape.url, session), mode: 'auto'});
  at('the poll that hands the job over');
  await worker.evaluate(() => globalThis.__jobPilottoBackgroundSessions.poll());
  at('the job\'s end: a receipt or a hand-off');
  for (const stop = Date.now() + capOf(PRESS_MS); Date.now() < stop && !ended.has(session);) await new Promise(resolve => setTimeout(resolve, 250));
  return ended.get(session) || null;
}

test('a granted permit presses the form\'s Submit once, as the extension\'s own press: the receipt carries its attempt', {timeout: PRESS_MS + 30000}, clocked(PRESS_MS + 15000, async () => {
  const before_ = forms.posts.length;
  const end = await run('fa000001a', SUBMIT);
  assert.deepEqual(end, {confirmation: 'attempt-fa000001a'}, `the extension asked: ${asked.join(', ')}`);
  assert.equal(forms.posts.length - before_, 1, 'the form received exactly one submission');
}));

test('a "Withdraw application" named as the submit is never pressed: nothing is sent and the job goes to the person', {timeout: PRESS_MS + 30000}, clocked(PRESS_MS + 15000, async () => {
  const before_ = forms.posts.length;
  const end = await run('fa000002b', WITHDRAW);
  assert.deepEqual(end, {manual: "submit_not_pressed"}, `the extension asked: ${asked.join(", ")}; routes: ${JSON.stringify(Object.entries(standIn.asked.reduce((n, r) => ({...n, [r]: (n[r] || 0) + 1}), {})))}`);
  assert.equal(forms.posts.length - before_, 0, 'the form received a submission');
}));
