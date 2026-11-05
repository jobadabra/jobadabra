// Job: report health
// CLI: tell the owner one message from a workflow step, through the switchboard first (the owner's switch, "when" and bot), the CI-alerts bot when it cannot deliver.
//   node tell-owner.mjs --event <registry id> --file <message.txt>
// Why (5 Nov 2026, nt 3/4e): a step that had its own curl to Telegram (the PR-check scorecard) was an alert no Notifications switch could stop. Never fails the run: a missing file or key is a line.
import fs from 'node:fs';
import {postTelegram} from './lib/telegram-post.mjs';

const flag = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] || '' : ''; };

/** Reads the message file and sends it; -> the line printed. */
export async function main(env = process.env) {
  const event = flag('--event'), file = flag('--file');
  const text = file && fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : '';
  return postTelegram(text, {env, event, bot: {token: env.CI_ALERTS_TELEGRAM_BOT_TOKEN, chat: env.CI_ALERTS_TELEGRAM_CHAT_ID}});
}
if (import.meta.url === `file://${process.argv[1]}`) console.log(await main());
