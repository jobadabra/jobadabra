// The checks of Always on's Test on your own GitHub that need no GitHub: Notion answers, the person's own AI key answers, and a test message reaches them.
// Why (5 Nov 2026, owner: "Direct check, ~5 s"; "for 'Always on: your GitHub' it shouldn't [work with free AI]"; "send a notification test… telegram or email, whatever the user built"): each is one cheap call from the app,
// never a run in the person's repository. No secret is logged, returned or put in a sentence; a result is a state and a plain line.
// Guarded by test/unit/main/always-on-test.test.js.
import {notificationText} from '../i18n/user-notifications.js';
import {notificationLanguage} from './notification-language.js';
import * as ai from './ai/index.js';
import {isFreeKey} from './ai-free.js';
import * as channel from './notify-channel.js';
import * as notion from './notion-core.js';   // Notion-only: one read of the token's own user (no page or row), to say whether the token answers
import {api as telegram} from './telegram.js';

const ok = (line = '') => ({state: 'ok', line});
const failed = line => ({state: 'failed', line});
const SLOW_MS = 8000;
/** A fetcher that gives up after `ms`: no link of the Test may wait for ever (the Test has no run to time out). */
export const timed = (fetcher, ms = SLOW_MS) => (url, options = {}) => fetcher(url, {...options, signal: AbortSignal.timeout(ms)});
const WHY = {401: 'refused the key (401)', 403: 'answered 403: the key may be restricted, or not allowed to list models', 429: 'is busy (429): try again in a minute'};

/** Notion answers with the person's token: one read of the token's own user. */
export async function notionCheck(storage, {fetcher = globalThis.fetch} = {}) {
  const token = storage.secret('NOTION_TOKEN');
  if (!token) return failed('Notion is not connected. Connect it in Settings → Connections, then test again.');   // about Notion
  try {
    await notion.call(token, 'GET', 'users/me', null, timed(fetcher), {retries: 0, pace: false});
    return ok();
  } catch (error) {
    return failed(error.status === 401 ? 'Notion refused your token (401). Connect Notion again in Settings → Connections.' : error.status ? `Notion answered with an error (${error.status}). Try again in a minute.` : 'Notion did not answer. Check your connection, then test again.');   // about Notion
  }
}

/** The AI key GitHub runs use (the chosen family's own key) answers: a list of the provider's models, which costs nothing. Free AI never counts here: it does not run on GitHub. */
export async function aiCheck(storage, {fetcher = globalThis.fetch} = {}) {
  const engine = ai.alwaysOnEngine(storage.settings(), ai.keysOf(storage)), key = storage.secret(ai.ENGINES[engine].key);
  if (!key) return failed('There is no AI key. Paste your own key in Settings → Connections → AI, then test again.');
  if (isFreeKey(key)) return failed('Free AI does not run on your own GitHub. Paste your own AI key in Settings → Connections → AI, or use our servers.');
  const [name, url, headers] = engine === 'openai'
    ? ['OpenAI', 'https://api.openai.com/v1/models?limit=1', {Authorization: `Bearer ${key}`}]
    : ['Anthropic', 'https://api.anthropic.com/v1/models?limit=1', {'x-api-key': key, 'anthropic-version': '2023-06-01'}];
  try {
    const response = await timed(fetcher)(url, {headers: {...headers, 'User-Agent': 'jobadabra-desktop'}});
    return response.ok ? ok() : failed(`${name} ${WHY[response.status] || `answered with an error (${response.status})`}. ${[401, 403].includes(response.status) ? 'Check the key in Settings → Connections → AI.' : 'Test again in a minute.'}`);
  } catch { return failed(`${name} did not answer. Check your connection, then test again.`); }
}

/** One test message through every way the person set up (Telegram with their bot, e-mail through our site); the app's own notification and a way not set up are not tried. -> a state and a line naming each way that failed.
 *  Why (5 Nov 2026, hr: web #430): the site limits the test e-mail to once a day per address and says `earlier` when today's went already, so the app keeps no limit of its own. */
export async function notifyCheck(storage, {fetcher = globalThis.fetch} = {}) {
  const ways = channel.channelsOf(storage).filter(name => name === 'email' || name === 'telegram');
  if (!ways.length) return failed('Nothing can reach you yet: no e-mail address or Telegram bot is set up.');
  const locale = notificationLanguage(storage), message = notificationText(locale, 'testMessage');
  const lines = [];
  let said = '';
  if (ways.includes('telegram')) {
    try { await telegram(storage.secret('TELEGRAM_BOT_TOKEN'), 'sendMessage', {chat_id: storage.settings().telegramChatId, text: message}, timed(fetcher)); }
    catch (error) { lines.push(`Telegram: ${String(error.message || 'did not answer').slice(0, 120)}. Check the bot in Settings → Connections.`); }
  }
  if (ways.includes('email')) {
    const state = channel.installKey(storage) ? await channel.state(storage, timed(fetcher)).catch(() => null) : null;
    if (!channel.installKey(storage)) lines.push('E-mail: this install has no key for our site yet. Open the app online once, then test again.');
    else if (!state?.reached) lines.push('E-mail: the website could not be reached. Test again when you are online.');
    else if (!state.confirmed) lines.push(`E-mail: ${state.email || 'your address'} is not confirmed yet, so the test e-mail would wait. Confirm it with the link in your first e-mail.`);
    else {
      const sent = await channel.sendTest(storage, {subject: notificationText(locale, 'testSubject'), text: message}, timed(fetcher));
      if (!sent.ok) lines.push(`E-mail: ${sent.error}`);
      else if (sent.earlier) said = 'A test e-mail already reached you today.';   // the site sent none now: said, not failed
    }
  }
  return lines.length ? failed(lines.join(' ')) : ok(said);
}
