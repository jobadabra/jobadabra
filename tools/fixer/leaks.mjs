// The leak scan: what may not be posted in public (an e-mail, a secret, a home folder, a copied passage, a GitHub mention) and the second redaction of the brief (moved out of tools/feedback-ai.mjs, 4 Nov 2026, [hm] 2/6).
import {redact} from '../../desktop/lib/feedback-bundle.js';

/** The brief with the app's own redactor over every word the AI will read (second pass: the app redacted the logs when it sent them). No home folder is known here, so the folder rule is the generic one. */
export function redactBrief(brief) {
  const clean = text => redact(text, {home: '', lineChars: 800});
  return {...brief, text: clean(brief.text), screen: clean(brief.screen), files: Object.fromEntries(Object.entries(brief.files || {}).map(([kind, text]) => [kind, clean(text)]))};
}

const words = text => String(text || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').filter(Boolean);
/** Passages of 8 or more words that `text` shares with the report or its files (a copy, not a coincidence). */
export function copied(text, brief, run = 8) {
  const mine = words(text), from = [brief.text, ...Object.values(brief.files || {})].map(words), seen = new Set();
  for (const source of from) for (let i = 0; i + run <= source.length; i++) seen.add(source.slice(i, i + run).join(' '));
  const hits = [];
  for (let i = 0; i + run <= mine.length; i++) if (seen.has(mine.slice(i, i + run).join(' '))) hits.push(mine.slice(i, i + run).join(' '));
  return hits;
}

/** Why `text` may not be posted in public, as short reasons that never repeat the text ([] = clean): what the app's redactor would still change (e-mails, tokens, home folders, link queries), or a passage copied from the report. */
export function leaks(text, brief) {
  // Zero-width characters are removed first: "ana@exam\u200bple.com" must read as the address it is (7/7 review).
  const reasons = [], body = String(text || '').replace(/[\u200b-\u200f\u2060\ufeff]/g, '');
  if (/[\w.+%-]+\s*(?:@|\[at\]|\(at\)|\{at\})\s*[\w-]+(?:\s*(?:\.|\[dot\]|\(dot\))\s*[\w-]+)+/i.test(body)) reasons.push('an e-mail address');
  // Why (7/7 review, 3 Nov 2026): a phone number is also 3-3-4 digits with separators, and a Windows home folder is any case and either slash.
  if (/\+\d[\d\s().-]{7,}\d/.test(body) || /(?<!\d)\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}(?!\d)/.test(body)) reasons.push('a phone number');
  if (/(?:\/(?:Users|home)\/|[A-Za-z]:[\\/]Users[\\/])[^\s/\\"'<>|:]+/i.test(body)) reasons.push('a home-folder name');
  if (copied(body, brief).length) reasons.push('a passage copied from the report or its files');
  // The redactor is the net under the specific checks: it speaks only when none of them did (an e-mail is also something it hides).
  if (!reasons.length && redact(body, {home: '', lineChars: 1e9}).replace(/…/g, '') !== body.replace(/…/g, '')) reasons.push('something the redactor would hide (a token, a secret, a link query)');
  return [...new Set(reasons)];
}

/**
 * What the pull request's TEXT (title and body, not the diff) may not carry because GitHub acts on it: an @mention (notifies a person), `#123` or `fixes #n` (links or closes an issue), a link.
 * -> short reasons, [] = clean. Why (7/7 review, 3 Nov 2026): the text is the AI's, steered by a stranger's report, and the repository is public.
 */
export function prText(text) {
  const body = String(text || '').replace(/[​-‏⁠﻿]/g, ''), reasons = [];
  if (/(?:^|[^\w`/.@-])@[A-Za-z][\w-]*/.test(body)) reasons.push('an @mention');
  if (/(?:^|[^\w&])#\d+\b/.test(body)) reasons.push('an issue or pull request number');
  if (/(?:https?:)?\/\/[^\s/]+\.[a-z]{2,}/i.test(body)) reasons.push('a link');
  return reasons;
}
