// The message to the person's chosen channels when an application waits for them (spec docs/superpowers/specs/2026-11-02-waiting-message-design.md): one an hour, a burst is one message, none without a working channel.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createWaitingMessage, HOUR_MS, useBotApi, WINDOW_MS} from '../lib/waiting-message.js';

// A fake clock and timers: advance(ms) runs every timer that falls due, in order, with `now` set to its time.
const START = Date.parse('2026-11-02T09:00:00Z');
function world({channels = ['email', 'telegram', 'app'], settings = {}, waiting = () => true} = {}) {
  const clock = {t: START}, timers = [], sent = {email: [], telegram: []}, saved = {...settings};
  const storage = {settings: () => saved, saveSettings: patch => Object.assign(saved, patch)};
  const message = createWaitingMessage(storage, {
    now: () => clock.t, setTimer: (fn, ms) => { const timer = {at: clock.t + ms, fn}; timers.push(timer); return timer; }, clearTimer: timer => { timers.splice(timers.indexOf(timer), 1); },
    channels: () => channels, stillWaiting: id => waiting(id),
    sendEmail: async mail => { sent.email.push(mail); return true; }, sendTelegram: async text => { sent.telegram.push(text); return true; }, log: () => {}});
  const advance = async ms => {
    const end = clock.t + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const next = timers[0];
      if (!next || next.at > end) break;
      timers.shift(); clock.t = next.at; await next.fn();
    }
    clock.t = end;
  };
  return {message, advance, sent, saved, clock, timers};
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
  const {message, advance, sent} = world({waiting: id => !handled.has(id)});
  message.add(job('a')); message.add(job('b'));
  handled.add('a');
  await advance(WINDOW_MS + 1);
  assert.equal(sent.email[0].subject, '1 application is waiting for you');
  assert.doesNotMatch(sent.email[0].text, /Acme a/);
  const second = world({waiting: () => false});
  second.message.add(job('c'));
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
