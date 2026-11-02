// The message to the person's chosen channels when an application waits for them (spec docs/superpowers/specs/2026-11-02-waiting-message-design.md): one an hour, a burst is one message, none without a working channel.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createWaitingMessage, HOUR_MS, useBotApi, WINDOW_MS} from '../lib/waiting-message.js';

// A fake clock and timers: advance(ms) runs every timer that falls due, in order, with `now` set to its time.
const START = Date.parse('2026-11-02T09:00:00Z');
function world({channels = ['email', 'telegram', 'app'], settings = {}, hold = null} = {}) {
  const clock = {t: START}, timers = [], runs = [], sent = {email: [], telegram: []}, saved = {...settings};
  const storage = {settings: () => saved, saveSettings: patch => Object.assign(saved, patch)};
  const message = createWaitingMessage(storage, {
    now: () => clock.t, setTimer: (fn, ms) => { const timer = {at: clock.t + ms, fn}; timers.push(timer); return timer; },
    channels: () => channels,
    sendEmail: async mail => { if (hold) await hold.promise; sent.email.push(mail); return true; }, sendTelegram: async text => { sent.telegram.push(text); return true; }, log: () => {}});
  const advance = async ms => {
    const end = clock.t + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const next = timers[0];
      if (!next || next.at > end) break;
      timers.shift(); clock.t = next.at; const run = next.fn(); runs.push(run); if (!hold) await run;   // with `hold` a send stays in flight: do not wait for it
    }
    clock.t = end;
  };
  return {message, advance, sent, saved, clock, timers, runs};
}
const job = (id, extra = {}) => ({id, title: `Role ${id}`, company: `Acme ${id}`, note: 'Solve the check and press Submit yourself.', ...extra});

test('one waiting application: after the short window one message goes to every working channel, with the job and what it needs', async () => {
  const {message, advance, sent} = world();
  message.add(job('a'));
  await advance(WINDOW_MS - 1);
  assert.equal(sent.email.length + sent.telegram.length, 0, 'not before the window ends');
  await advance(2);
  assert.equal(sent.email.length, 1);
  assert.equal(sent.telegram.length, 1);
  assert.equal(sent.email[0].subject, '1 application is waiting for you');
  assert.match(sent.email[0].text, /Role a at Acme a: Solve the check and press Submit yourself\./);
  assert.match(sent.email[0].text, /Open Jobadabra to finish it\./);
  assert.match(sent.telegram[0], /1 application is waiting for you/);
});

test('a burst (the jobs an earlier run held, handed over at start) is one message listing all of them', async () => {
  const {message, advance, sent} = world();
  for (const id of ['a', 'b', 'c']) message.add(job(id));
  await advance(WINDOW_MS + 1);
  assert.equal(sent.email.length, 1);
  assert.equal(sent.email[0].subject, '3 applications are waiting for you');
  for (const id of ['a', 'b', 'c']) assert.match(sent.email[0].text, new RegExp(`Acme ${id}`));
});

test('at most one message an hour: a second wait 10 minutes later is held, then goes once, together with any other that came', async () => {
  const {message, advance, sent, saved} = world();
  message.add(job('a'));
  await advance(WINDOW_MS + 1);
  assert.equal(sent.email.length, 1, 'positive control: the first one went');
  assert.ok(Date.parse(saved.waitingMessageAt) > 0, 'the cap is kept in settings, so a restart does not reset it');
  await advance(10 * 60000);
  message.add(job('b'));
  await advance(20 * 60000);
  message.add(job('c'));
  await advance(20 * 60000);
  assert.equal(sent.email.length, 1, 'still inside the hour: nothing more');
  await advance(HOUR_MS);
  assert.equal(sent.email.length, 2, 'one message when the hour is over');
  assert.equal(sent.email[1].subject, '2 applications are waiting for you');
});

test('the cap survives a restart: a message sent 30 minutes before the app started is not followed by another inside the hour', async () => {
  const {message, advance, sent, clock} = world({settings: {waitingMessageAt: new Date(START - 30 * 60000).toISOString()}});
  message.add(job('a'));
  await advance(WINDOW_MS + 1);
  assert.equal(sent.email.length, 0);
  await advance(30 * 60000);
  assert.equal(sent.email.length, 1);
  assert.ok(clock.t >= START + 30 * 60000);
});

test('no channel that works (no address, no bot, only the app): nothing is sent and the hour is not used up', async () => {
  const {message, advance, sent, saved} = world({channels: ['app']});
  message.add(job('a'));
  await advance(WINDOW_MS + 1);
  assert.deepEqual([sent.email.length, sent.telegram.length, saved.waitingMessageAt], [0, 0, undefined]);
});

test('an application the person handled meanwhile is left out; none left, no message', async () => {
  const handled = new Set();
  const {message, advance, sent} = world();
  message.add(job('a', {open: () => !handled.has('a')})); message.add(job('b', {open: () => !handled.has('b')}));
  handled.add('a');
  await advance(WINDOW_MS + 1);
  assert.equal(sent.email[0].subject, '1 application is waiting for you');
  assert.doesNotMatch(sent.email[0].text, /Acme a/);
  const second = world();
  second.message.add(job('c', {open: () => false}));
  await second.advance(WINDOW_MS + 1);
  assert.equal(second.sent.email.length, 0);
});

test('only the channels that work are used: e-mail alone, or Telegram alone', async () => {
  const mail = world({channels: ['email', 'app']});
  mail.message.add(job('a'));
  await mail.advance(WINDOW_MS + 1);
  assert.deepEqual([mail.sent.email.length, mail.sent.telegram.length], [1, 0]);
  const bot = world({channels: ['telegram', 'app']});
  bot.message.add(job('a'));
  await bot.advance(WINDOW_MS + 1);
  assert.deepEqual([bot.sent.email.length, bot.sent.telegram.length], [0, 1]);
});

test('the same application asked twice in a window is listed once', async () => {
  const {message, advance, sent} = world();
  message.add(job('a')); message.add(job('a'));
  await advance(WINDOW_MS + 1);
  assert.equal(sent.email[0].subject, '1 application is waiting for you');
});

test('Telegram goes through the sender the app registered, to the person\'s own bot and chat; without one it is not available and the e-mail still goes', async () => {
  const calls = [], sent = [];
  const storage = {secret: name => (name === 'TELEGRAM_BOT_TOKEN' ? 'tok' : ''), settings: () => ({telegramChatId: '42'}), saveSettings: () => {}};
  const build = by => {
    const timers = [];
    const message = createWaitingMessage(storage, {setTimer: fn => timers.push(fn), channels: () => by, sendEmail: async mail => { sent.push(mail); return true; }, log: () => {}});
    message.add(job('a'));
    return timers[0];
  };
  useBotApi(null);
  await build(['telegram'])();
  assert.deepEqual(calls, [], 'no sender registered: nothing to Telegram');
  useBotApi(async (...args) => { calls.push(args); });
  await build(['telegram', 'email'])();
  assert.equal(calls.length, 1);
  assert.deepEqual([calls[0][0], calls[0][1], calls[0][2].chat_id], ['tok', 'sendMessage', '42']);
  assert.match(calls[0][2].text, /1 application is waiting for you/);
  assert.equal(sent.length, 1, 'e-mail alongside');
});

test('an application handed over while the message is being sent waits for the hour: no second message a minute later (Gitar on #3008)', async () => {
  let release;
  const hold = {promise: new Promise(resolve => { release = resolve; })};
  const {message, advance, sent, runs} = world({hold});
  message.add(job('a'));
  await advance(WINDOW_MS + 1);   // the send is now in flight, waitingMessageAt not yet saved
  message.add(job('b'));
  release();
  await Promise.all(runs);
  assert.equal(sent.email.length, 1, 'positive control: the first message went');
  await advance(5 * 60000);
  assert.equal(sent.email.length, 1, 'the second one is not sent a minute or five after the first');
  await advance(HOUR_MS);
  assert.equal(sent.email.length, 2, 'it goes when the hour is over');
  assert.equal(sent.email[1].subject, '1 application is waiting for you');
});

// 2/2 (docs/superpowers/specs/2026-11-02-notify-moments-design.md): the "waited N hours" pop-up needs a number that is true.
test('waitedFor: how long the oldest application still waiting has waited, counted from when it was handed over, whether or not a message went', async () => {
  const {message, clock, advance} = world({channels: ['app']});   // no working channel: nothing is sent, the wait is still counted
  assert.equal(message.waitedFor(), null, 'nothing waiting: nothing claimed');
  message.add(job(1, {open: () => true}));
  await advance(2 * HOUR_MS);
  message.add(job(2, {open: () => true}));
  const waited = message.waitedFor();   // job 2 was handed over just now: under an hour, not counted
  assert.deepEqual({hours: waited.hours, count: waited.count, title: waited.title, company: waited.company}, {hours: 2, count: 1, title: 'Role 1', company: 'Acme 1'});
  assert.equal(clock.t, START + 2 * HOUR_MS);
});

test('waitedFor: under an hour, a handled application, and one with no way to ask "still waiting?" are not claimed', async () => {
  const {message, advance} = world({channels: ['app']});
  let handled = false;
  message.add(job(1, {open: () => !handled}));
  message.add(job(2));   // no `open`: nothing says it still waits
  await advance(30 * 60 * 1000);
  assert.equal(message.waitedFor(), null, 'under an hour');
  await advance(40 * 60 * 1000);
  assert.equal(message.waitedFor().count, 1, 'job 2 has no open(): not counted');
  handled = true;
  assert.equal(message.waitedFor(), null, 'handled meanwhile');
});
