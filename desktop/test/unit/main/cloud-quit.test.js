// What a quit with Full automation applications working offers about Always on (lib/cloud-quit.js, cs 4/4, owner 10 Nov 2026: approved as drawn): which of the three cases applies, and what the third button does.
// Guard: safety (Always on is never turned on without the address the person gave, and a quit hands nothing to the cloud for an install the cloud would refuse).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chooseCloud, offerFor} from '../../../lib/cloud-quit.js';
import {sessionsOnly} from '../../../lib/quit-dialog.js';

const now = () => Date.now();   // clock: relative, the plan answer is "fresh" against the real clock the plan itself reads
const store = ({plan = 'pro', on = false, email = 'a@example.test', repo = ''} = {}) => ({settings: () => ({plan: {at: now(), status: {plan, mode: 'live'}}, hostedSearch: {on}, notifyEmail: email, emailConsent: {at: '2026-11-01T00:00:00Z'}, ...(repo ? {cloud: {repo}} : {})})});
const auto = {background: {mode: 'auto', state: 'filling'}}, fill = {background: {mode: 'fill', state: 'filling'}};
const here = () => true;

test('three cases for a Pro install with a Full automation application working: Always on on, off with an address, off without one', () => {
  assert.equal(offerFor(store({on: true}), [auto], {real: here}), 'on');
  assert.equal(offerFor(store({repo: 'me/jobadabra'}), [auto], {real: here}), 'on', 'Always on on the person\'s own GitHub counts too');
  assert.equal(offerFor(store(), [auto], {real: here}), 'off');
  assert.equal(offerFor(store({email: ''}), [auto], {real: here}), 'setup');
});

test('code review: once today\'s night started, a later quit is the old dialog (the site takes one night a day: the dialog must not promise a hand-over)', () => {
  const started = (night, on = true) => ({settings: () => ({...store({on}).settings(), cloudAuto: {night, started: true}})});
  assert.equal(offerFor(started(new Date().toISOString().slice(0, 10)), [auto], {real: here}), null);
  assert.equal(offerFor(started('2020-01-01'), [auto], {real: here}), 'on', 'an earlier day does not count');
});

test('nothing is offered to a Free install, for Fill mode or Claude sessions, a press already sent, or in a test, the twin or the demo', () => {
  assert.equal(offerFor(store({plan: 'free'}), [auto], {real: here}), null, 'the cloud refuses Free: the offer would lie');
  assert.equal(offerFor(store(), [fill, {}], {real: here}), null);
  assert.equal(offerFor(store(), [{background: {mode: 'auto', state: 'submitting'}}], {real: here}), null);
  assert.equal(offerFor(store(), [auto], {real: () => false}), null);
});

test('the third button: on quits; off turns Always on on with the address on file and quits, or stays open when it could not; setup stays open', async () => {
  const asked = [];
  const turn = ok => async (_storage, given) => { asked.push(given); return {ok}; };
  assert.equal(await chooseCloud(store(), 'on'), 'quit');
  assert.equal(await chooseCloud(store(), 'off', {turnOn: turn(true)}), 'quit');
  assert.deepEqual(asked, [{}], 'no address typed here: the one on file');
  assert.equal(await chooseCloud(store(), 'off', {turnOn: turn(false)}), 'stay');
  assert.equal(await chooseCloud(store(), 'off', {turnOn: async () => { throw new Error('offline'); }}), 'stay');
  asked.length = 0;
  assert.equal(await chooseCloud(store(), 'setup', {turnOn: turn(true)}), 'stay');
  assert.deepEqual(asked, [], 'nothing is turned on for the set-up case');
});

test('the dialog: Keep working is always first (the default); the third button and words follow the case; no case is the old dialog', () => {
  const label = session => session.company;
  const sessions = [{company: 'Acme', ...auto}, {company: 'Globex', ...auto}];
  const old = sessionsOnly(sessions, label);
  assert.deepEqual(old.buttons, ['Keep working', 'Stop and quit']);
  for (const [kind, third, words] of [['off', 'Turn on Always on and quit', /Turn on Always on/], ['setup', 'Set up Always on…', /Always on lets our cloud browser/], ['on', 'Hand over and quit', /hands them to our cloud browser/]]) {
    const dialog = sessionsOnly(sessions, label, kind);
    assert.deepEqual(dialog.buttons, ['Keep working', 'Stop and quit', third], kind);
    assert.match(dialog.detail, words, kind);
    assert.equal(dialog.message, old.message, 'the question is the same');
  }
});
