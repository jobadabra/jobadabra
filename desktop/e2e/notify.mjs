// Sends one CI notice in the shared shape (lib/notice.mjs) for a shell caller: env NOTICE_TITLE, NOTICE_VERDICT, NOTICE_BULLETS (one per line), NOTICE_RUN (a link, optional), NOTICE_EVENT, NOTICE_LEVEL (optional), NOTICE_ICON (optional).
//   NOTICE_TITLE='Store publish did not start' NOTICE_VERDICT='v1 is stable, …' NOTICE_EVENT=release-failed NOTICE_LEVEL=problem node desktop/e2e/notify.mjs
// Why (8 Nov 2026, owner: "let's improve the text formatting/style"): tools/release-stable.sh built plain strings for send(); a shell caller now says the parts and the shared builder shapes the message.
// Job: report health
import {send} from './ci-alert.mjs';
import {notice} from './lib/notice.mjs';

const env = process.env;
const message = notice({icon: env.NOTICE_ICON || '⚠️', title: env.NOTICE_TITLE || 'CI notice', verdict: env.NOTICE_VERDICT || '', bullets: String(env.NOTICE_BULLETS || '').split('\n').filter(Boolean), run: env.NOTICE_RUN || ''});
console.log(await send(message, env, fetch, {event: env.NOTICE_EVENT, ...(env.NOTICE_LEVEL ? {level: env.NOTICE_LEVEL} : {})}));
