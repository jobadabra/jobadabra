// The CI notice (store, nightly, refill, generic): one card (lib/tg-card.mjs). notice({icon, title, verdict, bullets, run, linkText}) -> alertHtml payload.
//   notice({icon: '⚠️', title: 'Nightly skipped', verdict: "Main's e2e is red on apply", bullets: ['Flaky: "step"'], run: 'https://github.com/o/r/actions/runs/1'})
// Why (8 Nov 2026, owner on a Telegram shot: "let's improve the text formatting/style"): every CI notice goes through one builder, so a new one cannot be a wall of text; more than 3 bullets become "+N more".
// Why (10 Nov 2026, owner: every message reads like the Central scout one): the icon picks the colour dot, the title is the bold headline, the bullets are the rows, the verdict is the one ✅/⚠️ line.
// Guard: test/harness/notice-shape.test.mjs.
// Job: report health
import {card} from './tg-card.mjs';

export const MAX_BULLETS = 3;
const LEVELS = {'🔴': 'red', '⚠️': 'orange', '🟠': 'orange', '✅': 'green', '🟢': 'green', 'ℹ️': 'grey', '⚪': 'grey'};

/** Takes {icon, title, verdict, bullets: [text], run, linkText, level?}; returns the Telegram payload. The icon (or `level`) is the colour dot; ✅/🟢 reads "fine", every other dot "needs a look". */
export function notice({icon = '⚠️', title, verdict = '', bullets = [], run = '', linkText = 'Open the run', level = ''}) {
  const dot = level || LEVELS[String(icon).trim()] || 'orange';
  const shown = bullets.length > MAX_BULLETS ? [...bullets.slice(0, MAX_BULLETS - 1), `+${bullets.length - (MAX_BULLETS - 1)} more`] : bullets;
  return card({level: dot, headline: title, why: shown.map(text => ({icon: '•', text})), whyTitle: '',
    verdict: verdict ? {ok: ['green'].includes(dot) ? true : dot === 'grey' ? undefined : false, text: verdict} : null, link: run ? {text: linkText, url: run} : null});
}
