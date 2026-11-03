// The automatic refill's Telegram alert (owner, 17 Oct 2026: a PR whose replay finds changed asks starts replay-refill.yml itself, Telegram when a cap stops it).
// Why (3 Nov 2026, Gitar on #3111): the `cap` command (this month's refill dollars from /ai-cost, at most $5) is gone with the API key: broker calls are not dollars, so it could never fire.
// Job: report health
// Runs in the refill workflow's pick job (main's code), never in the PR's job. Guard: e2e/test/filling/refill-auto.test.mjs.
//   node refill-auto.mjs alert "<what>"          (env CI_ALERTS_TELEGRAM_*) -> the owner's Telegram
import path from 'node:path';
import {send} from './ci-alert.mjs';

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const [command, arg] = process.argv.slice(2);
  if (command !== 'alert') { console.error('usage: node refill-auto.mjs alert "<what>"'); process.exit(2); }
  console.log(await send(`⚠️ Replay refill (automatic): ${arg}\n${process.env.GITHUB_SERVER_URL || 'https://github.com'}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`));
}
