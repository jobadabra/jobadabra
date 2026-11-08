// The one shape of a CI Telegram notice: icon + bold title + a one-line verdict, up to 3 bullets of a few words, and one named link ("Open the run"). notice({icon, title, verdict, bullets, run}) -> alertHtml payload.
//   notice({icon: '⚠️', title: 'Nightly skipped', verdict: "Main's e2e is red on apply", bullets: ['Flaky: “step”'], run: 'https://github.com/o/r/actions/runs/1'})
// Why (8 Nov 2026, owner on a Telegram shot: "let's improve the text formatting/style"; the nightly skip and the store failures were one plain line each, beside credit and failure alerts built with alertHtml): every
// CI notice goes through this builder, so a new one cannot be a wall of text; more than 3 bullets become "+N more". Guard: test/harness/notice-shape.test.mjs.
// Job: report health
import {alertHtml} from './telegram-html.mjs';

export const MAX_BULLETS = 3;

/** Takes {icon, title, verdict, bullets: [text | {text, url}], run, linkText}; returns the Telegram payload. */
export function notice({icon = '⚠️', title, verdict = '', bullets = [], run = '', linkText = 'Open the run'}) {
  const shown = bullets.length > MAX_BULLETS ? [...bullets.slice(0, MAX_BULLETS - 1), `+${bullets.length - (MAX_BULLETS - 1)} more`] : bullets;
  return alertHtml({icon, title, verdict, bullets: shown.map(one => ({parts: [one]})), links: run ? [{text: linkText, url: run}] : []});
}
