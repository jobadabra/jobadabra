// One plain-text Telegram message from CI through the Build Log bot (its own bot and chat: BUILDLOG_TELEGRAM_TOKEN / BUILDLOG_TELEGRAM_CHAT, as the daily digest). Missing keys: skipped with a line,
// never a failure. The token is only in the URL of the one request and never printed. Guard: e2e/test/discovery-cli.test.mjs.
// With `event` (an id of jobadabra-web shared/notify-registry.js) the owner's switchboard goes first (switch, "when", bot); this bot sends it when the switchboard cannot deliver (nt 3/4c, fail-open).
// Job: report health
import {reportFallback, viaSwitchboard} from './switchboard.mjs';

/** Sends one plain-text message: the owner's switchboard first when `event` is given, else (or when it cannot deliver) the old bot: `bot` {token, chat}, by default the Build Log bot from env. -> the line to print; a missing key or a refusal is a line, never a throw. */
export async function postTelegram(text, {env = process.env, fetcher = fetch, event = '', bot = null} = {}) {
  const token = bot ? bot.token : env.BUILDLOG_TELEGRAM_TOKEN, chat = bot ? bot.chat : env.BUILDLOG_TELEGRAM_CHAT;
  if (!text) return 'telegram: nothing to say';
  const board = event ? await viaSwitchboard({event, text: String(text).slice(0, 3900)}, env, fetcher) : null;
  if (board) return board.replace(/^ci-alert: /, 'telegram: ');
  if (!token || !chat) return `telegram: not sent (${bot ? 'the bot token / chat id are not set' : 'BUILDLOG_TELEGRAM_TOKEN / BUILDLOG_TELEGRAM_CHAT are not set'})`;
  const answer = await fetcher(`https://api.telegram.org/bot${token}/sendMessage`, {method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({chat_id: chat, text: String(text).slice(0, 3900), disable_web_page_preview: true}), signal: AbortSignal.timeout(20000)});
  if (answer.ok && event) await reportFallback(event, env, fetcher);
  return answer.ok ? 'telegram: sent' : `telegram: refused (${answer.status})`;
}
