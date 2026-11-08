// The mail to the person when Full automation sent applications for them (row `app-applied`; owner, 8 Nov 2026): one mail per burst, never for the person's own press, switch off = no mail.
// Fictional jobs and a fake sender: nothing here can reach a real inbox.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createAppliedMessage, WINDOW_MS} from '../../../lib/applied-message.js';
import {allowed} from '../../../lib/mail-choices.js';
import {createBackgroundApplyController} from '../../../lib/background-apply-controller.js';

const AT = Date.parse('2026-11-08T09:12:00Z');
function world({channels = ['email', 'app'], send = null} = {}) {
  const timers = [], sent = [];
  const message = createAppliedMessage({settings: () => ({}), secret: () => ''}, {now: () => AT, setTimer: (fn, ms) => { const timer = {fn, ms}; timers.push(timer); return timer; },
    channels: () => channels, sendEmail: async mail => { if (send) return send(mail); sent.push(mail); return true; }, log: () => {}});
  const fire = async () => { while (timers.length) await timers.shift().fn(); };
  return {message, sent, timers, fire};
}
const job = (id, extra = {}) => ({id, title: `Role ${id}`, company: `Acme ${id}`, at: AT, ...extra});

test('two applications sent in a burst: one mail after the window, listing both, with the button to Jobs', async () => {
  const {message, sent, timers, fire} = world();
  message.add(job('a')); message.add(job('b'));
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, WINDOW_MS);
  await fire();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].subject, 'Applied for you: 2 applications sent');
  assert.match(sent[0].text, /Role a · Acme a/);
  assert.match(sent[0].text, /Role b · Acme b/);
  assert.equal(sent[0].buttons[0].text, 'See what was sent');
  assert.match(sent[0].buttons[0].url, /\/open\?view=jobs$/);
});

test('the same application is mailed once, even if its receipt is reported twice', async () => {
  const {message, sent, fire} = world();
  message.add(job('a')); await fire();
  message.add(job('a')); await fire();
  assert.equal(sent.length, 1);
});

test('no working e-mail: nothing is sent and nothing breaks', async () => {
  const {message, sent, fire} = world({channels: ['app', 'telegram']});
  message.add(job('a')); await fire();
  assert.equal(sent.length, 0);
});

test('a failing send is dropped, and a later application still gets its mail', async () => {
  let fail = true;
  const {message, sent, fire} = world({send: async mail => { if (fail) throw new Error('down'); sent.push(mail); return true; }});
  message.add(job('a')); await fire();
  fail = false;
  message.add(job('b')); await fire();
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /Acme b/);
});

// The controller's hook: Full automation's confirmed receipt queues the mail; the person's own press and an unconfirmed reply do not.
function controller(state, queued, extra = {}) {
  return createBackgroundApplyController({}, {
    store: {receipt: async () => state, humanReceipt: async () => state},
    browser: {start: async () => ({owner: 'o1'})},
    terminals: {list: () => [], record: id => ({id, url: 'https://jobs.example.test/1', title: 'Nurse', company: 'Demo Klinik', background: {}, outcome: ''}), report: () => {}},
    config: () => ({mode: 'auto'}), token: () => 't', notify: () => {}, log: () => {}, now: () => AT, applied: {add: item => queued.push(item)}, ...extra});
}
test('Full automation\'s confirmed receipt queues the mail; the person\'s own press, an unconfirmed reply and a failing mail do not break it', async () => {
  const queued = [], done = {ok: true, state: 'receipt_confirmed', mode: 'auto'};
  assert.deepEqual(await controller(done, queued).outcome({session: 's1', owner: 'o1', attempt: 'att1'}, true), {ok: true});
  assert.deepEqual(queued.map(item => [item.id, item.title, item.company, item.at]), [['s1', 'Nurse', 'Demo Klinik', AT]]);
  await controller(done, queued).outcome({session: 's1', owner: 'o1', humanAt: Date.now()}, true);   // the person's own Submit press: they know
  await controller({ok: true, state: 'needs_user_handoff', mode: 'auto'}, queued).outcome({session: 's1', owner: 'o1', attempt: 'att1'}, false);   // no confirmation came back
  assert.equal(queued.length, 1);
  const broken = controller(done, queued, {applied: {add: () => { throw new Error('boom'); }}});
  assert.deepEqual(await broken.outcome({session: 's1', owner: 'o1', attempt: 'att2'}, true), {ok: true});
});

test('the sender asks the person\'s switch for `app-applied` first: off holds the mail, on lets it go', () => {
  const rows = choice => ({settings: () => ({mailRows: [{id: 'app-applied', choice, suggested: {mac: 'mail', always: 'mail'}}]}), secret: () => ''});
  assert.equal(allowed(rows('off'), 'app-applied'), false);
  assert.equal(allowed(rows('on'), 'app-applied'), true);
  assert.equal(allowed({settings: () => ({}), secret: () => ''}, 'app-applied'), true, 'never read: today\'s behaviour holds');
});

test('a sender that throws at once never escapes the timer', async () => {
  const {message, fire} = world({send: () => { throw new Error('sync boom'); }});
  message.add(job('a'));
  await fire();   // would reject (an unhandled rejection in the app) without the catch
});
