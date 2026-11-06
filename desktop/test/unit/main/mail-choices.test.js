// The person's switch per e-mail (lib/mail-choices.js, hr 4/8): a press stores the choice with the app's own JPF1 key, a refused save leaves the switch where it was and says so, a row never chosen
// shows the suggested default of the mode and a chosen one is never reset by a mode change, the engine's env is told only the rows that are off (and nothing while the screens are hidden by the gate).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {MAIL_SWITCHES_SHOWN, allowed, alwaysOnTurnedOn, choose, emailing, mailOff, modeOf, read, set, settle, turnOn, turnOnSuggested} from '../../../lib/mail-choices.js';

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

test('the switches are shown (the site holds the row on a held mail, web #463): the engine is told the rows that are off; hiding the gate tells it nothing', () => {
  assert.equal(MAIL_SWITCHES_SHOWN, true);
  const person = storage({settings: {mailRows: [{id: 'app-matches', choice: 'off', suggested: {mac: 'digest', always: 'digest'}}]}});
  assert.deepEqual(mailOff(person), ['app-matches']);
  assert.equal(allowed(person, 'app-matches'), false);
  assert.deepEqual(mailOff(person, false), [], 'gate hidden: nothing is honoured');
  assert.equal(allowed(person, 'app-matches', false), true);
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
  assert.equal(await settle(person, site([{ok: true, rows}], asked), false), false, 'hidden gate: nothing is written');
  assert.deepEqual(asked, []);
  assert.equal(await settle(storage(), site([{ok: true, rows}], asked), true), false, 'e-mail not on: nothing to write');
  assert.equal(await settle(person, site([{ok: true, rows}, {ok: true}, {ok: true}], asked)), true);
  assert.deepEqual(asked.filter(call => call.method === 'POST').map(call => call.body), [{mail: 'app-matches', on: true}, {mail: 'app-needs-you', on: false}]);
  assert.ok(person.settings().mailRowsSettled);
  const before = asked.length;
  assert.equal(await settle(person, site([{ok: true, rows}], asked), true), false, 'once');
  assert.equal(asked.length, before);
  const failing = storage({settings: ON});
  assert.equal(await settle(failing, site([{ok: false, reason: 'not_read'}]), true), false);
  assert.equal(failing.settings().mailRowsSettled, undefined, 'a failure leaves it for the next start');
});

test('hidden gate: the CV step writes no row at all, so no mail stops on the site for a switch nobody can see', async () => {
  const asked = [];
  assert.deepEqual(await turnOnSuggested(storage({settings: ON}), site([{ok: true, rows: ROWS}], asked), false), {ok: true, turned: []});
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

const AO_ROWS = [
  {id: 'app-matches', suggested: {mac: 'digest', always: 'digest'}, choice: ''},          // never chosen
  {id: 'app-needs-you', suggested: {mac: 'no', always: 'mail'}, choice: 'off'},            // written off by the app (the first turn-on of a Mac-only person)
  {id: 'app-weekly', suggested: {mac: 'mail', always: 'mail'}, choice: 'off'},             // the person pressed this one off
  {id: 'app-applied', suggested: {mac: 'mail', always: 'mail'}, choice: 'on'},             // already on
  {id: 'app-nothing', suggested: {mac: 'hidden', always: 'hidden'}, choice: ''},           // shown in no mode
];

test('Always on turned on: every row turns on in one go, the ones this install wrote off too, except a row the person pressed off themselves', async () => {
  const asked = [], person = storage({settings: {...ON, mailRowsPressed: ['app-weekly'], mailRowsAppOff: ['app-needs-you']}});   // the app of THIS install wrote app-needs-you off (writeUnchosen); nobody pressed app-weekly here
  const done = await alwaysOnTurnedOn(person, site([{ok: true, rows: AO_ROWS}, {ok: true}, {ok: true}], asked), true);
  assert.deepEqual(done, {ok: true, written: ['app-matches', 'app-needs-you']});
  assert.deepEqual(asked.filter(call => call.method === 'POST').map(call => call.body), [{mail: 'app-matches', on: true}, {mail: 'app-needs-you', on: true}], 'the pressed-off row, the one already on and the hidden one are not written');
  assert.equal(person.settings().mailNote, '');
});

// #3344 (HIGH, 6 Nov 2026): the site stores one "off" for the person's press and for an off the app wrote (the first turn-on of a Mac-only person), and only this install knows which was which.
test('Always on never turns on a row the site holds off that this install did not write off: the person turned it off on another install (#3344)', async () => {
  const asked = [], person = storage({settings: ON});   // a second install: nothing pressed here, nothing written off here
  const done = await alwaysOnTurnedOn(person, site([{ok: true, rows: AO_ROWS}, {ok: true}], asked), true);
  assert.deepEqual(asked.filter(call => call.method === 'POST').map(call => call.body), [{mail: 'app-matches', on: true}], 'only the row nobody chose is written: both off rows stay the person\'s');
  assert.deepEqual(done, {ok: true, written: ['app-matches']});
});

test('the app\'s own offs are the only ones Always on turns on: a Mac-only first turn-on, then Always on on the same install, turns the rows it wrote off on; another install leaves them off', async () => {
  const stored = new Map(), applied = [];
  const fetcher = async (url, init) => {
    const body = init?.body ? JSON.parse(init.body) : null;
    if (body) { stored.set(body.mail, body.on ? 'on' : 'off'); applied.push([body.mail, body.on]); }
    return {json: async () => (body ? {ok: true} : {ok: true, rows: ROWS.map(row => ({...row, choice: stored.get(row.id) || ''}))})};
  };
  const mac = storage({settings: {notifyBy: ['app']}});
  await turnOn(mac, 'app-matches', {address: 'a@b.co', save: async choice => { mac.saveSettings({notifyBy: choice.by, notifyEmail: choice.email, emailConsent: ON.emailConsent}); return {ok: true}; }, fetcher});
  assert.equal(stored.get('app-needs-you'), 'off', 'positive control: the first turn-on of a Mac-only person stored the other row off');
  assert.deepEqual(mac.settings().mailRowsAppOff, ['app-needs-you'], 'this install remembers it wrote that off');
  const other = storage({settings: ON});
  assert.deepEqual((await alwaysOnTurnedOn(other, fetcher, true)).written, ['app-stopped'], 'a second install writes only the row nobody chose; it cannot tell the other off from the person\'s, so that stays off');
  assert.equal(stored.get('app-needs-you'), 'off');
  assert.deepEqual((await alwaysOnTurnedOn(mac, fetcher, true)).written, ['app-needs-you'], 'the install that wrote it off turns it on (the hr plan\'s first turn-on)');
  assert.equal(stored.get('app-needs-you'), 'on');
  assert.deepEqual(mac.settings().mailRowsAppOff, [], 'a row written on is no longer one the app holds off');
});

test('a row the site no longer holds off leaves the list of offs the app wrote, on every read of the rows', async () => {
  const person = storage({settings: {...ON, mailRowsAppOff: ['app-needs-you', 'app-weekly', 'app-stopped']}});
  const rows = [{id: 'app-needs-you', suggested: {mac: 'no', always: 'mail'}, choice: 'on'}, {id: 'app-weekly', suggested: {mac: 'mail', always: 'mail'}, choice: 'off'}, {id: 'app-matches', suggested: {mac: 'digest', always: 'digest'}, choice: ''}];
  await read(person, site([{ok: true, rows}]));
  assert.deepEqual(person.settings().mailRowsAppOff, ['app-weekly', 'app-stopped'], 'turned on elsewhere: gone; still off: kept; not in the answer: kept (nothing is known about it)');
});

test('a write of offs by another path while Always on writes is not lost (the list is read again when Always on saves)', async () => {
  const person = storage({settings: {...ON, mailRowsAppOff: ['app-needs-you']}});
  const fetcher = async (url, init) => {
    if (init?.body && !person.settings().mailRowsAppOff.includes('app-stopped')) person.saveSettings({mailRowsAppOff: [...person.settings().mailRowsAppOff, 'app-stopped']});   // e.g. the CV step wrote a row off meanwhile
    return {json: async () => (init?.body ? {ok: true} : {ok: true, rows: AO_ROWS})};
  };
  await alwaysOnTurnedOn(person, fetcher, true);
  assert.deepEqual(person.settings().mailRowsAppOff.sort(), ['app-stopped'], 'app-needs-you was written on and leaves; the row added meanwhile stays');
});

test('a press on a row the app wrote off makes it the person\'s: Always on no longer touches it', async () => {
  const person = storage({settings: {...ON, mailRowsAppOff: ['app-needs-you']}});
  await choose(person, 'app-needs-you', false, {fetcher: site([{ok: true}])});
  assert.deepEqual(person.settings().mailRowsAppOff, []);
  const asked = [];
  await alwaysOnTurnedOn(person, site([{ok: true, rows: AO_ROWS}, {ok: true}], asked), true);
  assert.deepEqual(asked.filter(call => call.method === 'POST').map(call => call.body.mail), ['app-matches']);
});

test('a press is remembered: off adds the row to the pressed list, on takes it out, a refused press changes nothing', async () => {
  const person = storage({settings: ON});
  assert.deepEqual(await choose(person, 'app-weekly', false, {fetcher: site([{ok: true}])}), {ok: true});
  assert.deepEqual(person.settings().mailRowsPressed, ['app-weekly']);
  assert.equal((await choose(person, 'app-matches', false, {fetcher: site([{ok: false, reason: 'not_saved'}])})).ok, false);
  assert.deepEqual(person.settings().mailRowsPressed, ['app-weekly']);
  assert.deepEqual(await choose(person, 'app-weekly', true, {save: async () => ({ok: true}), fetcher: site([{ok: true}])}), {ok: true, addressSaved: false});
  assert.deepEqual(person.settings().mailRowsPressed, []);
});

test('Always on: a first row press with e-mail off turns every other unchosen row on (Mac only: off)', async () => {
  const rows = [{id: 'app-matches', suggested: {mac: 'digest', always: 'digest'}, choice: ''}, {id: 'app-needs-you', suggested: {mac: 'no', always: 'mail'}, choice: ''}, {id: 'app-weekly', suggested: {mac: 'mail', always: 'mail'}, choice: ''}];
  for (const [settings, expected] of [[{notifyBy: ['app']}, false], [{notifyBy: ['app'], cloud: {repo: 'me/j'}}, true]]) {
    const asked = [], person = storage({settings});
    await turnOn(person, 'app-matches', {address: 'a@b.co', save: async choice => { person.saveSettings({notifyBy: choice.by, notifyEmail: choice.email, emailConsent: ON.emailConsent}); return {ok: true}; }, fetcher: site([{ok: true, rows}, {ok: true}, {ok: true}, {ok: true}], asked)});
    assert.deepEqual(asked.filter(call => call.method === 'POST').map(call => [call.body.mail, call.body.on]).sort(), [['app-matches', true], ['app-needs-you', expected], ['app-weekly', expected]]);
  }
});

test('a refusal while turning Always on keeps its words, lets the screen follow the site, and nothing is written while hidden or without an address', async () => {
  const person = storage({settings: {...ON, mailRowsAppOff: ['app-needs-you']}}), asked = [];
  const refused = await alwaysOnTurnedOn(person, site([{ok: true, rows: AO_ROWS}, {ok: false, reason: 'not_saved'}, {ok: true}], asked), true);
  assert.equal(refused.ok, false);
  assert.deepEqual(refused.written, ['app-needs-you'], 'what landed is kept; the next read shows the truth');
  assert.match(person.settings().mailNote, /^Not every e-mail could be turned on just now: Could not save it just now/);
  const view = await read(person, site([{ok: true, rows: AO_ROWS.map(row => (row.id === 'app-needs-you' ? {...row, choice: 'on'} : row))}]));
  assert.match(view.note, /Not every e-mail/);
  assert.equal((await set(person, 'app-weekly', false, site([{ok: true}]))).ok, true);
  assert.equal(person.settings().mailNote, '', 'a saved press clears an older refusal\'s words');
  const calls = [];
  assert.deepEqual(await alwaysOnTurnedOn(storage({settings: ON}), site([{ok: true, rows: AO_ROWS}], calls), false), {ok: true, written: []}, 'hidden gate');
  assert.deepEqual(await alwaysOnTurnedOn(storage({settings: ON}), site([{ok: false, reason: 'no_address'}], calls), true), {ok: true, written: []}, 'no address on the site');
  assert.deepEqual(calls.length, 1, 'the hidden gate reached nothing; the no-address read was the only call');
});

test('Always on writing in the background and a press off made meanwhile: the person\'s off is the last word, and the row stays off', async () => {
  const person = storage({settings: ON}), stored = new Map();
  const rows = [{id: 'app-matches', suggested: {mac: 'digest', always: 'digest'}, choice: ''}];
  // A site that applies a write the moment it arrives but answers the person's off slowly (30 ms): the app has not yet noted the press when Always on's write goes out.
  const fetcher = async (url, init) => {
    const body = init?.body ? JSON.parse(init.body) : null;
    const snapshot = rows.map(row => ({...row, choice: stored.get(row.id) || ''}));
    if (body) stored.set(body.mail, body.on ? 'on' : 'off');
    await new Promise(resolve => setTimeout(resolve, !body ? 2 : body.on ? 1 : 30));
    return {json: async () => (body ? {ok: true} : {ok: true, rows: snapshot})};
  };
  const background = alwaysOnTurnedOn(person, fetcher, true);
  const press = choose(person, 'app-matches', false, {fetcher});
  await Promise.all([background, press]);
  assert.equal(stored.get('app-matches'), 'off', 'the press waited for the background write, so its off landed last');
  assert.deepEqual(person.settings().mailRowsPressed, ['app-matches']);
});

// News from Jobadabra (owner, 6 Nov 2026: "I like the 2 switches", both start off): the site's `news` list, pressed like a row, kept apart from the app rows.
const NEWS = [{id: 'releases', name: "What's new", when: 'a new version and what changed', on: false}, {id: 'tips', name: 'News and tips', when: 'offers and tips', on: true}];

test('a read carries the site\'s news list with its own words and answers, and ignores an id the app does not know', async () => {
  const person = storage({settings: ON});
  const view = await read(person, site([{ok: true, rows: ROWS, news: [...NEWS, {id: 'come-back', name: 'Come back', on: true}, {id: 'releases'}]}]));
  assert.deepEqual(view.news, [{id: 'releases', name: "What's new", when: 'a new version and what changed', on: false}, {id: 'tips', name: 'News and tips', when: 'offers and tips', on: true}]);
  assert.deepEqual(view.rows.map(row => row.id), ['app-matches', 'app-needs-you'], 'news never joins the app rows');
  assert.deepEqual((await read(person, site([{ok: true, rows: ROWS}]))).news, [], 'an older answer with no list: no card');
  assert.deepEqual((await read(person, site([{ok: false, reason: 'no_address'}]))).news, []);
});

test('a news press posts {mail, on} with the app\'s key and keeps nothing beside the app rows (no mirror, no pressed list)', async () => {
  const asked = [], person = storage({settings: {...ON, mailRows: ROWS}});
  assert.deepEqual(await choose(person, 'tips', true, {fetcher: site([{ok: true}], asked)}), {ok: true, addressSaved: false});
  assert.deepEqual(asked, [{url: 'https://www.jobadabra.top/api/mail/choices', method: 'POST', key: KEY, body: {mail: 'tips', on: true}}]);
  assert.deepEqual(await choose(person, 'releases', false, {fetcher: site([{ok: true}])}), {ok: true});
  assert.equal(person.settings().mailRowsPressed, undefined, 'a news switch is not one of the person\'s app rows');
  assert.deepEqual(person.settings().mailRows, ROWS, 'the mirror of the app rows is untouched');
  assert.equal(person.settings().mailRows.some(row => NEWS.some(item => item.id === row.id)), false);
});

test('a refused news press says why and the screen follows the site; an id that is neither a row nor a news mail is refused without a call', async () => {
  const asked = [], person = storage({settings: ON});
  assert.deepEqual(await choose(person, 'releases', true, {fetcher: site([{ok: false, reason: 'not_saved'}], asked)}), {ok: false, error: 'Could not save it just now. The switch is back where it was; try again in a minute.'});
  assert.match((await choose(person, 'marketing', true, {fetcher: site([], asked)})).error, /not one of the switches/);
  assert.equal(asked.length, 1);
});

test('the first news press with e-mail off sends only the address and the news answer: no Email channel, no consent, no app row, in either mode', async () => {
  for (const settings of [{notifyBy: ['app']}, {notifyBy: ['app'], cloud: {repo: 'me/j'}}]) {
    const asked = [], person = storage({settings});
    const done = await choose(person, 'releases', true, {address: 'a@b.co', name: "What's new", save: async () => assert.fail('the app\'s e-mail saver is not used for news'), fetcher: site([{ok: true}, {ok: true}], asked)});
    assert.deepEqual(done, {ok: true, addressSaved: true});
    assert.deepEqual(asked.map(call => [call.method, call.url.replace('https://www.jobadabra.top', ''), call.body]), [['PUT', '/api/account/email', {email: 'a@b.co'}], ['POST', '/api/mail/choices', {mail: 'releases', on: true}]]);
    assert.deepEqual(person.settings().notifyBy, ['app'], 'e-mail stays off for the app\'s own mails');
    assert.equal(person.settings().emailConsent, undefined, 'no app-mail consent is recorded');
    assert.equal(emailing(person), false);
  }
  const refused = storage({settings: {notifyBy: ['app']}}), calls = [];
  assert.equal((await choose(refused, 'tips', true, {address: 'a@b.co', fetcher: site([{ok: false, error: 'taken'}], calls)})).ok, false);
  assert.equal(calls.length, 1, 'a refused address stores no news answer');
  assert.deepEqual((await choose(storage({settings: {notifyBy: ['app']}}), 'tips', true, {fetcher: site([])})), {ok: false, error: 'Add your e-mail address in Settings → Notifications first, then turn it on.'}, 'no address anywhere: no call, the switch goes back');
});
