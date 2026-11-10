// The one shape of an owner Telegram message, after the Central scout alert (owner, 10 Nov 2026: "This is a model: how I should like to see all the others, in terms of readability").
//   card({level: 'orange', headline: 'Central scout: 23 of 200 AI calls failed', bar: {done: 177, total: 200, doneWord: 'worked', restWord: 'failed'},
//         why: [{icon: '📡', count: 22, text: 'The connection dropped'}], verdict: {ok: true, text: 'Nothing is lost.'}, link: {text: 'Open the run', url}}) -> alertHtml payload
// Shape: colour dot + bold headline with the number · a text bar · "Why" rows (one icon per cause, its count) · up to 3 one-line facts · ONE verdict line (✅ fine / ⚠️ needs you) · ONE link.
// Telegram cannot colour text: colour is the dot (🔴 needs you now, 🟠 degraded, 🟢 fine or back, ⚪ information), bars are block characters, columns only inside <pre>.
// Why (10 Nov 2026, owner: "let's make this telegram message have a better readability… ASCII. Colors"; inventory of ~40 kinds, 8 builders): every sender goes through this one function, so a new
// message cannot be a wall of text. Long lists become "top 3 + N more"; the one link is the only link. checkCard() is the one check every sender's sample message passes (test/harness/tg-card-shape.test.mjs).
// Pure and dependency-free except alertHtml, so a copy can run in a Cloudflare Worker (jobadabra-web shared/tg-card.js is that copy; a parity test keeps them equal).
// Job: report health
import {alertHtml} from './telegram-html.mjs';

export const DOT = {red: '🔴', orange: '🟠', green: '🟢', grey: '⚪'};
export const MAX_WHY = 4;       // rows shown; more become "top 3 + N more"
export const MAX_LINES = 12;    // non-empty lines of the whole message

/** Ten blocks: filled for `done` of `total`; one failure always leaves one empty block, one answer always one filled. */
export function bar(done, total, width = 10) {
  if (!total) return '░'.repeat(width);
  let filled = Math.round((done / total) * width);
  if (done < total) filled = Math.min(filled, width - 1);
  if (done > 0) filled = Math.max(filled, 1);
  return '▓'.repeat(filled) + '░'.repeat(width - filled);
}

// A row or verdict longer than this is cut at a word: the run keeps the full text.
export const ROW_MAX = 130, VERDICT_MAX = 200, BODY_MAX = 500;
const clip = (text, max) => { const one = String(text ?? ''); return one.length <= max ? one : `${one.slice(0, max - 1).replace(/\s+\S*$/, '')}…`; };
const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
export { plural };

/**
 * {level, headline, body?: a quoted text (folded, ≤ 500 characters), bar?: {done, total, doneWord, restWord}, why?: [{icon, count?, text}], whyTitle?, facts?: [text], verdict?: {ok, text}, link?: {text, url}} -> alertHtml payload.
 * `ok: true` draws ✅, `ok: false` ⚠️, no `ok` draws the text bare. A missing headline throws: a message without one is a bug in the sender.
 */
export function card({level = 'grey', headline, body = '', bodyMax = BODY_MAX, bar: bars = null, why = [], whyTitle = 'Why', facts = [], verdict = null, link = null}) {
  if (!headline) throw new Error('tg-card: a message needs a headline');
  const rows = why.length > MAX_WHY ? [...why.slice(0, MAX_WHY - 1), {icon: '…', text: `+${why.length - (MAX_WHY - 1)} more`}] : why;
  const blocks = [];
  if (body) blocks.push([{parts: [clip(body, bodyMax)], expandable: true}]);   // a person's own words (feedback): a folded quote, never a row
  if (bars) blocks.push([{parts: [`${bar(bars.done, bars.total)}  ${bars.done} ${bars.doneWord || 'ok'} · ${bars.total - bars.done} ${bars.restWord || 'not ok'}`]}]);
  if (rows.length) blocks.push([...(whyTitle ? [{parts: [whyTitle]}] : []), ...rows.map(one => ({parts: [`${one.icon ? `${one.icon} ` : ''}${one.count === undefined ? '' : `${one.count}  `}${clip(one.text, ROW_MAX)}`]}))]);
  if (facts.length) blocks.push(facts.slice(0, 3).map(text => ({parts: [clip(text, ROW_MAX)]})));
  if (verdict) blocks.push([{parts: [`${verdict.ok === true ? '✅ ' : verdict.ok === false ? '⚠️ ' : ''}${clip(verdict.text, VERDICT_MAX)}`]}]);
  if (link) blocks.push([{parts: [{text: link.text, url: link.url}]}]);
  return alertHtml({icon: DOT[level] || level, title: headline, blocks});
}

/**
 * The one check a message passes: a dot + bold headline first, at most MAX_LINES lines, at most one link, no raw JSON or error dump, no secret or e-mail address.
 * -> the list of problems (empty = fine).
 */
export function checkCard(payload) {
  const text = String(payload?.text ?? payload ?? ''), plain = text.replace(/<[^>]+>/g, '');
  const problems = [], lines = plain.split('\n').filter(line => line.trim());
  if (!/^(🔴|🟠|🟢|⚪|🟡|🔵)\s<b>[^<]+<\/b>/.test(text)) problems.push('starts with a colour dot and a bold headline');
  if (lines.length > MAX_LINES) problems.push(`has ${lines.length} lines (max ${MAX_LINES})`);
  const links = (text.match(/<a /g) || []).length;
  if (links > 1) problems.push(`has ${links} links (max 1)`);
  if (/https?:\/\/\S+/.test(plain)) problems.push('shows a bare URL');
  if (/[{[]\s*"[\w-]+"\s*:/.test(plain)) problems.push('shows raw JSON');
  if (/\b\d{8,10}:[A-Za-z0-9_-]{30,}\b|\bgh[pousr]_[A-Za-z0-9]{20,}|\bsk-[A-Za-z0-9_-]{20,}|[\w.+-]+@[\w-]+\.[\w.-]+/.test(plain)) problems.push('holds a secret or an e-mail address');
  return problems;
}
