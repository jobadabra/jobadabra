// Gmail offered at the right moment (owner, 2 Nov 2026, spec docs/superpowers/specs/2026-11-02-gmail-offer-timing-design.md): the dialog after the first Submit (twice at most), the dialog on a page that
// asks for a mailed code (any mode, once per run, the job waits), the always-present Suggestions card, and nothing once connected. A fake connection only: never the owner's Google account or Keychain.
process.env.JOBADABRA_E2E = '1';   // Keychain reads come from an isolated, empty file: no real sign-in is ever seen (lib/keychain.js)
import {readScreenSource} from '../../static-screen-source.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {MAX_ASKS, WAITING, afterApply, createCodeOffer, gmailConnected, state} from '../../../lib/gmail-offer.js';
import * as server from '../../../lib/server.js';
import {KEY, gmailEntries, offerWords} from '../../../renderer/gmail-offer-words.js';
import {DOES, LOOK, jobsEntries} from '../../../renderer/suggestions.js';
import {strictSetSecret} from '../../strict-set-secret.js';

const store = (settings = {}) => { const mine = {...settings}; return {settings: () => mine, saveSettings: patch => Object.assign(mine, patch)}; };
const off = () => false, on = () => true;

test('the first Submit offers Gmail; one later Submit offers it again; then never again by itself', () => {
  const storage = store(), told = [];
  const tell = (...args) => told.push(args);
  assert.equal(afterApply({storage, tell, connected: off, employer: 'Acme'}), true);
  assert.deepEqual(told[0], ['gmail-offer', {why: 'applied', employer: 'Acme'}]);
  assert.equal(afterApply({storage, tell, connected: off}), true, 'Not now the first time: asked once more after a later apply');
  assert.equal(afterApply({storage, tell, connected: off}), false, 'two asks, then only Settings, ⌘K and Suggestions');
  assert.equal(told.length, MAX_ASKS);
  assert.equal(state(storage).asked, MAX_ASKS);
});

test('connected: no offer after a Submit and nothing is counted', () => {
  const storage = store(), told = [];
  assert.equal(afterApply({storage, tell: (...args) => told.push(args), connected: on}), false);
  assert.deepEqual(told, []);
  assert.equal(state(storage).asked, 0);
});

test('a page that asks for a mailed code: the job waits with its reason, the window is told once per run, connected means nothing', () => {
  const parked = [], told = [];
  const offer = createCodeOffer({tell: (...args) => told.push(args), park: (...args) => parked.push(args), connected: off});
  assert.equal(offer({session: 's1', host: 'jobs.acme.test', email: 'me@example.test'}), true, 'the caller then skips reading the mail');
  assert.equal(offer({session: 's2', host: 'careers.beta.test', email: 'me@example.test'}), true);
  assert.deepEqual(parked, [['s1', 'account', 'jobs.acme.test', WAITING], ['s2', 'account', 'careers.beta.test', WAITING]], 'every such job waits; the other jobs in the queue are not touched');
  assert.equal(told.length, 1, 'one dialog, not one per job');
  assert.deepEqual(told[0], ['gmail-offer', {why: 'code', host: 'jobs.acme.test'}]);
  assert.match(WAITING, /code from your e-mail: connect Gmail/);
  assert.equal(createCodeOffer({tell: () => assert.fail('told'), park: () => assert.fail('parked'), connected: on})({session: 's', host: 'h', email: 'e'}), false, 'connected: the mail is read as before');
  assert.equal(createCodeOffer({tell: () => assert.fail('told'), park: () => assert.fail('parked'), connected: off})({session: 's', host: 'h', email: ''}), false, 'no e-mail to read a code from: nothing to promise');
});

test('the code dialog is not limited by the after-Submit count', () => {
  const storage = store({gmailOffer: {asked: MAX_ASKS}}), told = [];
  const offer = createCodeOffer({tell: (...args) => told.push(args), park: () => {}, connected: off});
  assert.equal(afterApply({storage, tell: () => assert.fail('told'), connected: off}), false);
  assert.equal(offer({session: 's', host: 'h', email: 'e'}), true);
  assert.equal(told.length, 1);
});

test('the real connection read sees none in a test run (isolated Keychain)', () => { assert.equal(gmailConnected(), false); });

test('markApplied, the one verdict of a Submit in every Apply mode, tells the window; a failing offer never undoes Applied', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-gmail-offer-'));
  const base = {secret: () => 't', setSecret: strictSetSecret(), path: (...p) => path.join(dir, ...p)};
  const told = [];
  server.setWindowSignal((...args) => told.push(args));
  const find = async () => ({url: 'https://jobs.example.test/acme/1', title: 'SRE', company: 'Acme', status: 'kit_ready'});
  const setStatus = async () => ({ok: true});
  try {
    const mine = store();
    const first = await server.localEnv({...base, ...mine}, () => {}, {find, setStatus}).markApplied('https://jobs.example.test/acme/1', 'a confirmation page');
    assert.equal(first.ok, true);
    assert.deepEqual(told.filter(([channel]) => channel === 'gmail-offer'), [['gmail-offer', {why: 'applied', employer: 'Acme'}]]);
    const broken = {...base, settings: () => ({}), saveSettings: () => { throw new Error('store busy'); }};
    const second = await server.localEnv(broken, () => {}, {find, setStatus}).markApplied('https://jobs.example.test/acme/1', 'a confirmation page');
    assert.equal(second.ok, true, 'Applied stands');
  } finally { server.setWindowSignal(() => {}); }
});

test('the words: what the first Submit buys, and the code case promises typing it; both end in Connect Gmail and Not now', () => {
  const applied = offerWords({why: 'applied', employer: 'Acme'});
  assert.match(applied.lead, /Your confirmation from Acme will land in Gmail\. Connect it, and Jobadabra moves this job to Interview or Rejected when they reply\./);
  assert.doesNotMatch(offerWords({why: 'applied'}).lead, /from \./, 'no employer: no dangling "from"');
  const code = offerWords({why: 'code', host: 'www.acme.test'});
  assert.match(code.title, /Connect Gmail and I'll type the codes from the next job on/, 'scoped: this job\'s code is not re-requested (JOB-223)');
  assert.match(code.lead, /acme\.test/);
  assert.match(code.lead, /This job waits for you/, 'no promise to type this job\'s code: connecting does not re-request it');
  for (const words of [applied, code]) { assert.equal(words.yes, 'Connect Gmail'); assert.equal(words.no, 'Not now'); }
});

test('the Suggestions card: always there while Gmail is not connected (no Not now), on the Jobs bar and Focus, gone when connected or not read yet', () => {
  const [entry, ...rest] = gmailEntries({view: {loaded: true, connected: false}});
  assert.equal(rest.length, 0);
  assert.equal(entry.key, KEY);
  assert.deepEqual(entry.answers, [], 'the card cannot be hidden for good');
  assert.deepEqual(entry.actions, [{label: 'Connect Gmail', do: 'connect_gmail'}]);
  assert.ok(!DOES.includes('connect_gmail'), 'a window-made button, like the hosted and LinkedIn ones: not in the engine\'s list');
  assert.ok(LOOK.gmail && LOOK.gmail.icon === 'mail', 'the row has its look');
  assert.deepEqual(jobsEntries([entry]), [entry], 'topic applying: the Jobs bar shows it too');
  assert.deepEqual(gmailEntries({view: {loaded: true, connected: true}}), []);
  assert.deepEqual(gmailEntries({view: {loaded: false, connected: false}}), [], 'no flash of an offer before the state is read');
  assert.deepEqual(gmailEntries({}), []);
});

test('the doors: the dialog, the card and ⌘K all end in the Settings button, and the setup wizard offers nothing', () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../renderer');
  const read = file => readScreenSource(path.join(root, file), 'utf8');
  assert.match(read('pages/gmail-offer.js'), /\$\('google-connect'\)\.click\(\)/, 'one sign-in flow');
  assert.match(read('pages/focus-suggestions.js'), /connect_gmail: \(\) => connectGmail\(\)/);
  assert.match(read('pages/nav.js'), /addGmailCommand\(add\)/, '⌘K');
  assert.match(readScreenSource(path.join(root, '..', 'lib', 'ext-server-handlers.js'), 'utf8'), /mode === 'full' && codeOffer\(/, 'the code offer only where a connected Gmail types the code');
  assert.match(read('index.html'), /id="gmail-offer-dialog"/);
  for (const day of ['pages/wizard.js', 'onboarding.js']) assert.doesNotMatch(read(day), /gmail|google/i, `${day}: nothing is asked on day one`);
});
