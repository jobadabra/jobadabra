// The message to the person's e-mail and Telegram when an application waits for them (spec docs/superpowers/specs/2026-11-02-waiting-message-design.md): until now only the app's own
// notification said it, and a person who is away heard nothing. One message an hour at most; a burst (the jobs an earlier run held, handed over at start) is one message; none
// without a working channel. Never for a Claude session's own question (lib/app-reminders.js sessionNeedsYou: the 1 Oct 2026 noise reason). Guard: test/unit/main/waiting-message.test.js.
import {notificationText} from '../i18n/user-notifications.js';
import {notificationLanguage} from './notification-language.js';
import * as notifyChannel from './notify-channel.js';
import {allowed} from './mail-choices.js';
import {log as appLog} from './log.js';
import {createBatchWindow, defaultTimer, perStorage} from './mail-batch.js';

export const HOUR_MS = 60 * 60 * 1000;
export const WINDOW_MS = 60 * 1000;   // Why (2 Nov 2026): the first waiting application opens a window so the ones handed over together go out as one message

/** The one waiting-message sender of this app profile (the controller and its handoff sites share it). */
export const waitingMessageFor = perStorage(storage => createWaitingMessage(storage));

/**
 * -> {add({id, title, company, note, open?})}. `add` queues an application that needs the person; the window (WINDOW_MS) and the hour since `settings.waitingMessageAt` (the only persisted state,
 * so a restart keeps the cap) decide when the one message goes. Invariants: at most one message an hour; an application the person handled meanwhile (`item.open`) is left out; with no
 * working channel nothing is sent and the hour is not used up; a failed send is logged and dropped (the app's own notification already showed it). Everything else is injectable for tests.
 */
export function createWaitingMessage(storage, {now = Date.now, setTimer = defaultTimer, channels = () => notifyChannel.channelsOf(storage),
  sendEmail = mail => allowed(storage, 'app-needs-you') && notifyChannel.sendEmail(storage, {...mail, urgent: true, mail: 'app-needs-you'}), sendTelegram = text => sendBot(storage, text), log = appLog} = {}) {
  const handed = new Map();   // `handed`: every application handed over and when (in memory), whether or not a message went: the pop-up "waited N hours" (waitedFor)
  const lastAt = () => Date.parse(storage.settings().waitingMessageAt) || 0;
  async function send(queued) {
    const items = queued.filter(item => item.open?.() !== false);   // `open`: the caller's own check that the person has not handled it
    if (!items.length) return;
    const by = channels(), mail = by.includes('email'), bot = by.includes('telegram');
    if (!mail && !bot) { log('apply', 'waiting application not sent: no e-mail or Telegram works', {count: items.length}); return; }
    const locale = notificationLanguage(storage), textOf = (key, variables) => notificationText(locale, key, variables);
    const subject = textOf('waiting', {count: items.length});
    const lines = items.map(item => `${item.title && item.company ? textOf('atCompany', {title: item.title, company: item.company}) : item.title || item.company || textOf('application')}: ${item.note}`);
    const text = lines.join('\n');
    const buttons = [{text: textOf('open'), url: 'https://www.jobadabra.top/open?view=sessions'}];
    const done = await Promise.all([mail && sendEmail({subject, text, buttons}), bot && sendTelegram(`${subject}\n${text}\n\n${textOf('finish')}`)].map(sent => Promise.resolve(sent).catch(() => false)));
    if (done.some(Boolean)) storage.saveSettings({waitingMessageAt: new Date(now()).toISOString()});
    log('apply', 'waiting application message', {count: items.length, email: !!done[0], telegram: !!done[1]});
  }
  // Why (#3008, Gitar, 2 Nov 2026): while a send is in flight `waitingMessageAt` is not yet saved; the window (lib/mail-batch.js) re-arms only after it ends, with the fresh time.
  const batch = createBatchWindow({delay: () => Math.max(WINDOW_MS, lastAt() ? lastAt() + HOUR_MS - now() : 0), send, log, setTimer});
  return {
    add(item) { if (!handed.has(item.id)) handed.set(item.id, {...item, at: now()}); batch.add(item); },
    /** -> {hours, count, title, company} of the applications still waiting for over an hour (the oldest named), or null. Only an application whose `open()` says yes counts; in memory, so after a restart the hours start again. */
    waitedFor() {
      const waiting = [...handed.entries()].filter(([, item]) => typeof item.open === 'function' && item.open() === true && now() - item.at >= HOUR_MS).map(([, item]) => item);
      if (!waiting.length) return null;
      const oldest = waiting.reduce((a, b) => (b.at < a.at ? b : a));
      return {hours: Math.floor((now() - oldest.at) / HOUR_MS), count: waiting.length, title: oldest.title, company: oldest.company};
    },
  };
}

// The person's own bot, as app-notify's few-new-jobs line sends it. -> true when Telegram took it.
// Why (2 Nov 2026): telegram.js is not imported here (not even lazily): the analysis behind tests/tooling/ci/test_workflow_paths.py follows it into app-core/src and would widen page-cases' paths, and the apply
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
