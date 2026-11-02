// The message to the person's e-mail and Telegram when an application waits for them (spec docs/superpowers/specs/2026-11-02-waiting-message-design.md): until now only the app's own
// notification said it, and a person who is away heard nothing. One message an hour at most; a burst (the jobs an earlier run held, handed over at start) is one message; none
// without a working channel. Never for a Claude session's own question (lib/app-reminders.js sessionNeedsYou: the 1 Oct 2026 noise reason). Guard: test/waiting-message.test.js.
import * as notifyChannel from './notify-channel.js';
import {log as appLog} from './log.js';

export const HOUR_MS = 60 * 60 * 1000;
export const WINDOW_MS = 60 * 1000;   // Why (2 Nov 2026): the first waiting application opens a window so the ones handed over together go out as one message

const instances = new WeakMap();
/** The one waiting-message sender of this app profile (the controller and its handoff sites share it). */
export function waitingMessageFor(storage) {
  if (!instances.has(storage)) instances.set(storage, createWaitingMessage(storage));
  return instances.get(storage);
}

const unref = timer => { timer?.unref?.(); return timer; };
const words = count => `${count} application${count === 1 ? ' is' : 's are'} waiting for you`;

/**
 * -> {add({id, title, company, note, open?})}. `add` queues an application that needs the person; the window (WINDOW_MS) and the hour since `settings.waitingMessageAt` (the only persisted state,
 * so a restart keeps the cap) decide when the one message goes. Invariants: at most one message an hour; an application the person handled meanwhile (`stillWaiting`) is left out; with no
 * working channel nothing is sent and the hour is not used up; a failed send is logged and dropped (the app's own notification already showed it). Everything else is injectable for tests.
 */
export function createWaitingMessage(storage, {now = Date.now, setTimer = (fn, ms) => unref(setTimeout(fn, ms)), clearTimer = clearTimeout, channels = () => notifyChannel.channelsOf(storage), stillWaiting = () => true,
  sendEmail = mail => notifyChannel.sendEmail(storage, {...mail, urgent: true}), sendTelegram = text => sendBot(storage, text), log = appLog} = {}) {
  const pending = new Map();
  let timer = null;
  const lastAt = () => Date.parse(storage.settings().waitingMessageAt) || 0;
  const arm = () => { if (!timer && pending.size) timer = setTimer(flush, Math.max(WINDOW_MS, lastAt() ? lastAt() + HOUR_MS - now() : 0)); };
  async function flush() {
    timer = null;
    const items = [...pending.values()].filter(item => stillWaiting(item.id) && item.open?.() !== false);   // `open`: the caller's own check that the person has not handled it
    pending.clear();
    try {
      if (!items.length) return;
      const by = channels(), mail = by.includes('email'), bot = by.includes('telegram');
      if (!mail && !bot) { log('apply', 'waiting application not sent: no e-mail or Telegram works', {count: items.length}); return; }
      const subject = words(items.length);
      const lines = items.map(item => `${[item.title, item.company].filter(Boolean).join(' at ') || 'An application'}: ${item.note}`);
      const text = `${lines.join('\n')}\n\nOpen Jobadabra to finish it.`;
      const done = await Promise.all([mail && sendEmail({subject, text}), bot && sendTelegram(`${subject}\n${text}`)].map(sent => Promise.resolve(sent).catch(() => false)));
      if (done.some(Boolean)) storage.saveSettings({waitingMessageAt: new Date(now()).toISOString()});
      log('apply', 'waiting application message', {count: items.length, email: !!done[0], telegram: !!done[1]});
    } finally { arm(); }   // an application that came while this one was sending
  }
  return {
    add(item) { pending.set(item.id, item); arm(); },
    cancel() { if (timer) clearTimer(timer); timer = null; pending.clear(); },
  };
}

// The person's own bot, as app-notify's few-new-jobs line sends it. -> true when Telegram took it.
// Why (2 Nov 2026): telegram.js is not imported here (not even lazily): the analysis behind tests/test_workflow_paths.py follows it into app-core/src and would widen page-cases' paths, and the apply
// controller imports this file. The app registers the sender once (lib/app-notify.js createAppNotify); until then Telegram is not available here and the message goes by e-mail only.
let botApi = null;
/** Registers the Telegram sender (`telegram.api`: token, method, body -> a promise); null clears it. Takes effect at the next send; without one a send to Telegram is skipped, never thrown. */
export const useBotApi = fn => { botApi = fn; };
async function sendBot(storage, text) {
  const token = storage.secret('TELEGRAM_BOT_TOKEN'), chat = storage.settings().telegramChatId;
  if (!token || !chat || !botApi) return false;
  await botApi(token, 'sendMessage', {chat_id: chat, text});
  return true;
}
