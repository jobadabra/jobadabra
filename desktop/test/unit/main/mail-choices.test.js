// The person's switch per e-mail (lib/mail-choices.js, hr 4/8): a press stores the choice with the app's own JPF1 key, a refused save leaves the switch where it was and says so, a row never chosen
// shows the suggested default of the mode and a chosen one is never reset by a mode change, the engine's env is told only the rows that are off (and nothing while the switches are dark).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {MAIL_SWITCHES_SHOWN, allowed, mailOff, modeOf, read, set, settle, turnOn, turnOnSuggested} from '../../../lib/mail-choices.js';

const KEY = 'JPF1.install-0001.tok';
const ON = {notifyBy: ['email', 'app'], notifyEmail: 'a@b.co', emailConsent: {at: '2026-11-05T10:00:00.000Z', wording: 'x', where: 'cv'}};   // e-mail is on: an address and the person's yes
const storage = ({settings = {}, secrets = {JOBADABRA_TRIAL_KEY: KEY}} = {}) => {
  const kept = {...settings};
  return {settings: () => kept, saveSettings: patch => Object.assign(kept, patch), secret: name => secrets[name] || ''};
};
const ROWS = [
  {id: 'app-matches', name: 'New matches', when: 'a search finds new jobs', suggested: {mac: 'digest', always: 'digest'}, choice: ''},
  {id: 'app-needs-you', name: 'An application needs you', when: 'an application waits', suggested: {mac: 'no', always: 'mail'}, choice: ''},
  {id: 'app-stopped', name: 'Always on stopped working', when: 'a run fails', suggested: {mac: 'hidden', always: 'mail'}, choice: ''},
];
const site = (answers, asked = []) => async (url, init) => { asked.push({url, method: init?.method, key: init?.headers['x-api-key'], body: init?.body ? JSON.parse(init.body) : null}); const answer = answers.shift(); if (answer instanceof Error) throw answer; return {json: async () => answer}; };

test('the switches are dark for people until the held-mail change has shipped, and the engine is told nothing meanwhile', () => {
  assert.equal(MAIL_SWITCHES_SHOWN, false);
  const dark = storage({settings: {mailRows: ROWS}});
  assert.deepEqual(mailOff(dark), []);
  assert.equal(allowed(dark, 'app-matches'), true);
});

test('a read shows each row as the person chose it, else as their mode suggests, and leaves out rows hidden in that mode', async () => {
  const mac = storage({settings: ON}), asked = [];
  const view = await read(mac, site([{ok: true, rows: ROWS}], asked));
  assert.equal(asked[0].url, 'https://www.jobadabra.top/api/mail/choices');
  assert.equal(asked[0].key, KEY);
  assert.equal(view.mode, 'mac');
  assert.deepEqual(view.rows.map(row => [row.id, row.on]), [['app-matches', true], ['app-needs-you', false]], 'Mac only: matches in the digest, "needs you" off (the app shows it), "stopped" not shown');
  assert.match(view.where, /^From your Mac: only while your Mac is awake and the app is open/);
  const always = storage({settings: {...ON, cloud: {repo: 'me/jobadabra'}}});
  const other = await read(always, site([{ok: true, rows: ROWS}]));
  assert.equal(other.mode, 'always');
  assert.deepEqual(other.rows.map(row => [row.id, row.on]), [['app-matches', true], ['app-needs-you', true], ['app-stopped', true]]);
  assert.match(other.where, /^From Always on: on schedule, even with your Mac off/);
});

test('a row the person chose stays as chosen when the mode changes; one they never chose follows the new mode', async () => {
  const chosen = ROWS.map(row => (row.id === 'app-matches' ? {...row, choice: 'off'} : row));
  const person = storage({settings: ON});
  await read(person, site([{ok: true, rows: chosen}]));
  assert.deepEqual(mailOff(person, true), ['app-matches', 'app-needs-you']);   // Mac only: matches off (chosen), "needs you" off by default; "stopped" is hidden here, so never sent from a Mac
  person.saveSettings({hostedSearch: {on: true}});
  assert.equal(modeOf(person), 'always');
  assert.deepEqual(mailOff(person, true), ['app-matches'], 'chosen off stays off in Always on, where the default for the others is on');
});

test('turning a switch off posts {mail, on: false} with the app\'s own JPF1 key and the mirror follows', async () => {
  const asked = [], person = storage({settings: {mailRows: ROWS}});
  assert.deepEqual(await set(person, 'app-needs-you', false, site([{ok: true}], asked)), {ok: true});
  assert.deepEqual(asked, [{url: 'https://www.jobadabra.top/api/mail/choices', method: 'POST', key: KEY, body: {mail: 'app-needs-you', on: false}}]);
  assert.deepEqual(mailOff(person, true).filter(id => id === 'app-needs-you'), ['app-needs-you']);
});

test('a refused save (503 not_saved) says so and the mirror keeps the old choice', async () => {
  const person = storage({settings: {mailRows: ROWS}});
  const done = await set(person, 'app-needs-you', false, site([{ok: false, reason: 'not_saved'}]));
  assert.equal(done.ok, false);
  assert.match(done.error, /switch is back where it was/);
  assert.equal(person.settings().mailRows.find(row => row.id === 'app-needs-you').choice, '');
  assert.equal((await set(person, 'app-needs-you', false, site([new Error('offline')]))).ok, false, 'offline is a refusal too');
});

test('a repo key or a missing key never reaches the site, and an unknown row or value is refused', async () => {
  const asked = [];
  assert.equal((await set(storage({secrets: {JOBADABRA_TRIAL_KEY: 'JPT1.handle.mac'}}), 'app-matches', true, site([{ok: true}], asked))).ok, false);
  assert.equal((await set(storage({secrets: {}}), 'app-matches', true, site([{ok: true}], asked))).ok, false);
  assert.equal((await set(storage(), 'app-everything', true, site([{ok: true}], asked))).ok, false);
  assert.equal((await set(storage(), 'app-matches', 'yes', site([{ok: true}], asked))).ok, false);
  assert.deepEqual(asked, []);
});

test('before e-mail is on every row shows off with a Suggested tag where the mode would start it on; a person with no address on our site gets no rows yet', async () => {
  const person = storage();
  const view = await read(person, site([{ok: true, rows: ROWS}]));
  assert.equal(view.emailing, false);
  assert.deepEqual(view.rows.map(row => [row.id, row.on, row.suggested]), [['app-matches', false, true], ['app-needs-you', false, false]], 'Mac only: the digest of matches is suggested; the hidden row is not shown');
  const none = storage();
  assert.deepEqual((await read(none, site([{ok: false, reason: 'no_address'}]))).rows, []);
  assert.deepEqual(none.settings().mailRows, [], 'nothing is mirrored for the engine');
  assert.equal((await read(storage(), site([{ok: false, reason: 'unauthorized'}]))).ok, false, 'any other refusal is shown as one');
});

test('turning a row on when e-mail is not on yet saves the address, turns the Email channel on with this row\'s own line as the consent, then stores the row, in one press', async () => {
  const person = storage(), asked = [], saves = [];
  const save = async choice => { saves.push(choice); Object.assign(person.settings(), ON); return {ok: true}; };
  const done = await turnOn(person, 'app-needs-you', {address: 'a@b.co', name: 'An application needs you', save, fetcher: site([{ok: true, rows: ROWS}, {ok: true}, {ok: true}], asked)});
  assert.deepEqual(done, {ok: true, addressSaved: true});
  assert.deepEqual(saves.map(({by, email, consentVia, consentGiven, consentWording}) => ({by, email, consentVia, consentGiven, consentWording})), [{by: ['app', 'email'], email: 'a@b.co', consentVia: 'settings', consentGiven: 'switched', consentWording: 'E-mail me: An application needs you.'}]);
  assert.deepEqual(asked.filter(call => call.method === 'POST').map(call => call.body), [{mail: 'app-matches', on: false}, {mail: 'app-needs-you', on: true}], 'every other row is stored off first, then this one on');
});

test('no address anywhere, or the website refusing it, puts the switch back and stores no row', async () => {
  const asked = [];
  const noAddress = await turnOn(storage(), 'app-matches', {address: '', save: async () => ({ok: true}), fetcher: site([{ok: true}], asked)});
  assert.equal(noAddress.ok, false);
  assert.match(noAddress.error, /Add your e-mail address in Settings → Notifications first/);
  const taken = await turnOn(storage(), 'app-matches', {address: 'a@b.co', save: async () => ({ok: false, error: 'That address already has a Jobadabra account.'}), fetcher: site([{ok: true}], asked)});
  assert.deepEqual([taken.ok, taken.error], [false, 'That address already has a Jobadabra account.']);
  assert.deepEqual(asked, []);
});

test('with e-mail already on, a press stores the row and never touches the address', async () => {
  const saves = [];
  assert.deepEqual(await turnOn(storage({settings: ON}), 'app-weekly', {address: 'other@b.co', save: async choice => { saves.push(choice); return {ok: true}; }, fetcher: site([{ok: true}])}), {ok: true, addressSaved: false});
  assert.deepEqual(saves, []);
});

test('the CV step writes every row the mode shows: the suggested ones on, the rest off, a chosen row and a hidden one left alone', async () => {
  const asked = [], rows = [{id: 'app-matches', suggested: {mac: 'digest', always: 'digest'}, choice: ''}, {id: 'app-needs-you', suggested: {mac: 'no', always: 'mail'}, choice: ''}, {id: 'app-weekly', suggested: {mac: 'mail', always: 'mail'}, choice: 'off'}, {id: 'app-stopped', suggested: {mac: 'hidden', always: 'mail'}, choice: ''}];
  assert.deepEqual(await turnOnSuggested(storage({settings: ON}), site([{ok: true, rows}, {ok: true}, {ok: true}], asked), true), {ok: true, turned: ['app-matches']});
  assert.deepEqual(asked.filter(call => call.method === 'POST').map(call => call.body), [{mail: 'app-matches', on: true}, {mail: 'app-needs-you', on: false}]);
  const always = [], inAlways = storage({settings: {...ON, cloud: {repo: 'me/j'}}});
  const turned = (await turnOnSuggested(inAlways, site([{ok: true, rows}, {ok: true}, {ok: true}, {ok: true}], always), true)).turned;
  assert.deepEqual(turned, ['app-matches', 'app-needs-you', 'app-stopped'], 'Always on: the digest, "needs you" and "stopped" on; the weekly stays as chosen');
  assert.deepEqual(always.filter(call => call.method === 'POST').map(call => call.body.mail), ['app-matches', 'app-needs-you', 'app-stopped']);
});

test('someone who already has e-mail on gets the same writes once, only with the switches shown, never twice, and never without e-mail', async () => {
  const rows = [{id: 'app-matches', suggested: {mac: 'digest', always: 'digest'}, choice: ''}, {id: 'app-needs-you', suggested: {mac: 'no', always: 'mail'}, choice: ''}];
  const asked = [], person = storage({settings: ON});
  assert.equal(await settle(person, site([{ok: true, rows}], asked)), false, 'dark: nothing is written');
  assert.deepEqual(asked, []);
  assert.equal(await settle(storage(), site([{ok: true, rows}], asked), true), false, 'e-mail not on: nothing to write');
  assert.equal(await settle(person, site([{ok: true, rows}, {ok: true}, {ok: true}], asked), true), true);
  assert.deepEqual(asked.filter(call => call.method === 'POST').map(call => call.body), [{mail: 'app-matches', on: true}, {mail: 'app-needs-you', on: false}]);
  assert.ok(person.settings().mailRowsSettled);
  const before = asked.length;
  assert.equal(await settle(person, site([{ok: true, rows}], asked), true), false, 'once');
  assert.equal(asked.length, before);
  const failing = storage({settings: ON});
  assert.equal(await settle(failing, site([{ok: false, reason: 'not_read'}]), true), false);
  assert.equal(failing.settings().mailRowsSettled, undefined, 'a failure leaves it for the next start');
});

test('dark: the CV step writes no row at all, so no mail stops on the site for a hidden switch', async () => {
  const asked = [];
  assert.deepEqual(await turnOnSuggested(storage({settings: ON}), site([{ok: true, rows: ROWS}], asked)), {ok: true, turned: []});
  assert.deepEqual(asked, []);
});

test('a press that fails after e-mail was switched on takes e-mail off again, so a retry starts the whole block (no half-written state)', async () => {
  const kept = storage({settings: {notifyBy: ['app']}}), saves = [];
  const save = async choice => { saves.push(choice.by); kept.saveSettings({notifyBy: choice.by, notifyEmail: choice.email || kept.settings().notifyEmail, emailConsent: choice.by.includes('email') ? ON.emailConsent : undefined}); return {ok: true}; };
  const answer = await turnOn(kept, 'app-matches', {address: 'a@b.co', save, fetcher: site([{ok: true, rows: ROWS}, new Error('offline'), new Error('offline')])});
  assert.equal(answer.ok, false);
  assert.deepEqual(saves, [['app', 'email'], ['app']], 'on, then back off');
});

test('no address answered by the website empties the mirror, so the engine stops honouring an earlier address\'s choices', async () => {
  const kept = storage({settings: {...ON, mailRows: [{id: 'app-matches', choice: 'off', suggested: {mac: 'digest', always: 'digest'}}]}});
  assert.equal((await read(kept, site([{ok: false, reason: 'no_address'}]))).ok, true);
  assert.deepEqual(kept.settings().mailRows, []);
});

test('two first presses on different rows run one after the other: the second sees e-mail on and stores only its own row, so neither row ends up off', async () => {
  const kept = storage({settings: {notifyBy: ['app']}}), stored = new Map(), applied = [];
  const save = async choice => { await new Promise(resolve => setTimeout(resolve, 3)); kept.saveSettings({notifyBy: choice.by, notifyEmail: choice.email, emailConsent: ON.emailConsent}); return {ok: true}; };   // the real save goes to the site first
  // A slow site that applies a write when its delay ends (an off of the first press's row takes 60 ms, the rest 1-3 ms): without the queue the second press's off lands after the first press's on.
  const fetcher = async (url, init) => {
    const body = init?.body ? JSON.parse(init.body) : null;
    await new Promise(resolve => setTimeout(resolve, !body ? 5 : body.on ? 1 : body.mail === 'app-matches' ? 60 : 3));
    if (body) { stored.set(body.mail, body.on ? 'on' : 'off'); applied.push([body.mail, body.on]); }
    return {json: async () => (body ? {ok: true} : {ok: true, rows: ROWS.slice(0, 2).map(row => ({...row, choice: stored.get(row.id) || ''}))})};
  };
  const [first, second] = await Promise.all([turnOn(kept, 'app-matches', {address: 'a@b.co', save, fetcher}), turnOn(kept, 'app-needs-you', {address: 'a@b.co', save, fetcher})]);
  assert.deepEqual([first.ok, second.ok], [true, true]);
  assert.deepEqual([stored.get('app-matches'), stored.get('app-needs-you')], ['on', 'on'], `both rows the person pressed end on (writes: ${JSON.stringify(applied)})`);
});
